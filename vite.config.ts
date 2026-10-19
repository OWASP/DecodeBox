import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Injects the Content Security Policy into the built index.html.
 *
 * Done at build time rather than written into the source HTML for two reasons.
 * The policy hashes the theme script inlined in index.html, and computing that
 * hash from the emitted markup means it can never go stale when the script is
 * edited. And `connect-src 'none'` — which is the point of the policy, since
 * DecodeBox makes no network requests at all — would block the dev server's
 * hot-reload websocket if it applied during development.
 *
 * Notes on the two relaxations:
 *
 * - `style-src` allows 'unsafe-inline' because React writes inline `style`
 *   attributes. Without a separate `style-src-attr`, those fall back to
 *   `style-src`. CSS injection requires HTML injection to already have
 *   succeeded, and `script-src` — where the real risk lives — stays strict.
 * - `frame-ancestors` is absent because browsers ignore it when it arrives in a
 *   <meta> element, and GitHub Pages cannot set response headers. A deployment
 *   behind a proxy should add it there. See SECURITY.md.
 */
const CSP_META = /\s*<meta http-equiv="Content-Security-Policy"[^>]*>/;

/**
 * Builds the policy from the markup as it finally stands.
 *
 * Every inline script is hashed, so the list can never go stale against the
 * scripts actually present — which matters most in the standalone build, where
 * the whole application becomes one more inline script after this file's other
 * plugin has run.
 */
function withCsp(html: string): string {
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  const hashes = inlineScripts.map(
    (match) => `'sha256-${createHash('sha256').update(match[1] ?? '').digest('base64')}'`,
  );

  const policy = [
    "default-src 'none'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    "connect-src 'none'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  return html
    .replace(CSP_META, '')
    .replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
    );
}

function cspPlugin(): Plugin {
  return {
    name: 'decodebox-csp',
    apply: 'build',
    transformIndexHtml: { order: 'post', handler: withCsp },
  };
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Read rather than imported: esbuild, which loads this config, does not honour
// a named import from a JSON module.
const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  version: string;
};

function dataUri(file: string, mime: string): string {
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
}

/**
 * Folds the whole application into a single HTML file.
 *
 * The reason is the air-gapped case, and the honest position is that it did not
 * work before. A normal build is an index.html plus module scripts, and a
 * browser will not load an ES module from a `file://` URL — the origin is
 * opaque, so the request fails the CORS check and the page comes up blank.
 * "Open it straight from disk" was a claim the build could not honour.
 *
 * One file with everything inlined has no request left to fail. Double-click it
 * and it runs: no server, no npm, no network, nothing to install.
 *
 * The Web Worker is the one thing lost. It needs a separate script by
 * definition, so from a single file it cannot start — which the worker client
 * already handles by falling back to the main thread. A standalone build is
 * therefore single-threaded on very large inputs and identical otherwise.
 */
function standalonePlugin(): Plugin {
  return {
    name: 'decodebox-standalone',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find(
        (file) => file.fileName.endsWith('.html') && file.type === 'asset',
      );
      if (!html || html.type !== 'asset') return;

      let source = String(html.source);

      for (const [name, file] of Object.entries(bundle)) {
        const escaped = escapeForRegExp(file.fileName);

        if (file.type === 'chunk' && file.isEntry) {
          // `__VITE_PRELOAD__` is a placeholder Vite fills in with the chunks a
          // dynamic import depends on. It resolves that list while laying the
          // chunks out — which never happens here, because the imports were
          // inlined and there are no chunks. Left alone it reaches the browser
          // as a reference to nothing and the page dies on load. An empty list
          // is not a workaround: there really is nothing to preload.
          const code = file.code.replace(/__VITE_PRELOAD__/g, '[]');

          // Kept as a module so `import.meta` still resolves. There is nothing
          // left for it to import: the dynamic engine chunk was merged in by
          // `codeSplitting: false` before this ran.
          source = source.replace(
            new RegExp(`<script[^>]*src="[^"]*${escaped}"[^>]*></script>`),
            () => `<script type="module">\n${code}\n</script>`,
          );
          delete bundle[name];
        } else if (file.type === 'asset' && file.fileName.endsWith('.css')) {
          // The fonts live in public/, which Vite copies verbatim rather than
          // processing: the URL is rewritten to point at the copy but the file
          // is never inlined however high assetsInlineLimit goes. Left alone,
          // a single-file build asks for `../fonts/…` next to itself and
          // renders in whatever the fallback stack offers.
          //
          // Matched on the trailing filename rather than a leading slash,
          // because by this point Vite has already made the path relative.
          const css = String(file.source).replace(
            /url\(['"]?[^'")]*fonts\/([^'")/]+)['"]?\)/g,
            (_match, fontFile: string) =>
              `url(${dataUri(resolve('public/fonts', fontFile), 'font/woff2')})`,
          );
          source = source.replace(
            new RegExp(`<link[^>]*href="[^"]*${escaped}"[^>]*>`),
            () => `<style>\n${css}\n</style>`,
          );
          delete bundle[name];
        } else if (file.fileName.includes('worker')) {
          // Nothing can load it from a single file, and the client falls back
          // to the main thread when it cannot start. Shipping it would leave a
          // second file next to the one that is supposed to be the whole app.
          delete bundle[name];
        }
      }

      // publicDir is not copied in this mode, so the icon has to come along too.
      source = source.replace(
        /href="[^"]*favicon\.svg"/,
        () => `href="${dataUri(resolve('public/favicon.svg'), 'image/svg+xml')}"`,
      );

      // The policy has to be rebuilt now, not when the CSP plugin ran: that was
      // during transformIndexHtml, before the application became an inline
      // script, so its hash list covered only the little theme script and the
      // browser would have blocked the entire app.
      html.source = withCsp(source);

      // Not index.html: it is written into the same directory as the site, and
      // it is what the download button points at. The name is also what lands
      // in somebody's Downloads folder, where 'index.html' means nothing.
      html.fileName = 'decodebox.html';
    },
  };
}

export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';

  return {
    plugins: [react(), ...(standalone ? [standalonePlugin()] : []), cspPlugin()],

    // Shown in the download dialog, so somebody holding a copy can tell which
    // one it is. A standalone build never updates itself, which makes "when is
    // this from" the first question anyone asks of it.
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString().replace(/\.\d+Z$/, 'Z')),
    },

    // Relative asset paths, so the same build works on the project page
    // (owasp.github.io/DecodeBox) and on a custom domain.
    base: './',

    build: {
      target: 'es2022',
      sourcemap: false,
      // The standalone file is written beside the site rather than into a
      // directory of its own, so the deployed page has something to link to.
      outDir: 'dist',
      // The normal build empties dist. The standalone one runs afterwards and
      // must not wipe what just landed there.
      emptyOutDir: !standalone,
      // One file means one file: no 404 page, no CNAME, no loose fonts.
      copyPublicDir: !standalone,

      // Everything in one file, fonts included, or nothing can be inlined.
      assetsInlineLimit: standalone ? Number.MAX_SAFE_INTEGER : 4096,
      cssCodeSplit: !standalone,
      rolldownOptions: standalone ? { output: { codeSplitting: false } } : {},

      // Without this the page dies on `__VITE_PRELOAD__ is not defined`. The
      // preload helper is injected for dynamic imports and resolved when the
      // chunks are laid out; with the imports inlined there are no chunks to
      // preload, and the placeholder survives into the output as a reference to
      // nothing. There is also nothing left to preload, so turning it off is
      // the honest fix rather than a workaround.
      modulePreload: standalone ? false : undefined,

      /*
       * The engine loads as its own chunk, split at the dynamic import in
       * src/engine/index.ts, so the interface paints before five hundred
       * operations have finished downloading.
       *
       * That chunk is deliberately not split further. Every operation is
       * reachable from the search box, so a per-category split would trade one
       * download for a stall the first time somebody scrolls the list. The
       * limit is raised to cover it, and only it: if the *shell* ever crosses
       * this line, that is a regression and the warning should fire. The
       * standalone build is one file by design, so the warning is off there.
       */
      chunkSizeWarningLimit: standalone ? 100_000 : 700,
    },

    server: {
      port: 5173,
      open: true,
    },

    preview: {
      port: 4173,
    },

    test: {
      /*
       * The default is five seconds, which is not enough for the first call in
       * a test file.
       *
       * The engine is a separate chunk, reached through a dynamic import, so
       * the first `await` on a facade function in any file loads six hundred
       * kilobytes of operations before it can answer. That cost is real but it
       * is paid once per file, and it is not what any of these tests are
       * measuring — timing out on it would be the build punishing us for the
       * code splitting rather than for anything being slow.
       */
      testTimeout: 30000,
    },
  };
});
