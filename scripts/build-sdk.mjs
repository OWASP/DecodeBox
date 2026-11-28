import { createHash } from 'node:crypto';
import { generateDtsBundle } from 'dts-bundle-generator';
import { build } from 'vite';
import { readFile, copyFile, mkdir, writeFile, appendFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { aliases, releasePath } from './sdk-paths.mjs';

const dir = 'dist' + releasePath;
const projectNotice = (await Promise.all(
  ['NOTICE', 'LICENSE'].map((file) => readFile(file, 'utf8')),
)).join('\n').replaceAll('\r\n', '\n');
await mkdir(dir, { recursive: true });
for (const [entry, format, name] of [
  ['classic', 'iife', 'decodebox.js'],
  ['index', 'es', 'decodebox.mjs'],
]) {
  await build({
    configFile: false,
    publicDir: false,
    resolve: {
      // Keep dependency paths in ESM region comments relative to this distribution's project.
      preserveSymlinks: true,
      conditions: ['module', 'production'],
      mainFields: ['module', 'main'],
    },
    plugins: [
      {
        name: 'whatwg-url-encoding',
        enforce: 'pre',
        // The parser constructs these encoders at import time. Scope the standard
        // implementations to that module so an embedding application's globals stay intact.
        transform(code, id) {
          if (id.replaceAll('\\', '/').endsWith('/whatwg-url/lib/encoding.js')) {
            return (
              "const { TextEncoder, TextDecoder } = require('@exodus/bytes/encoding.js');\n" + code
            );
          }
        },
      },
    ],
    build: {
      target: 'es2022',
      emptyOutDir: false,
      outDir: dir,
      minify: 'oxc',
      license: { fileName: 'bundled-licenses.txt' },
      lib: {
        entry: resolve('src/sdk/' + entry + '.ts'),
        name: 'DecodeBoxSDK',
        formats: [format],
        fileName: () => name,
      },
      rolldownOptions: { platform: 'neutral', output: { codeSplitting: false } },
    },
  });
  const licensePath = dir + '/bundled-licenses.txt';
  const notices = projectNotice + '\n' + await readFile(licensePath, 'utf8');
  // Classic scripts can inherit a legacy document encoding when the host omits a charset.
  // A UTF-8 signature preserves Unicode literals on extensionless static hosts.
  if (format === 'iife') {
    const code = await readFile(dir + '/' + name);
    await writeFile(dir + '/' + name, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), code]));
  }
  await appendFile(dir + '/' + name, '\n/*!\n' + notices.replaceAll('*/', '* /') + '\n*/\n');
  await unlink(licensePath);
}

const [types] = generateDtsBundle([{ filePath: 'src/sdk/index.ts', output: { noBanner: true } }], {
  preferredConfigPath: 'tsconfig.json',
});
await writeFile(dir + '/decodebox.d.mts', types);
const checksums = [];
for (const [file, paths] of Object.entries(aliases)) {
  const digest = createHash('sha256').update(await readFile(dir + '/' + file)).digest('hex');
  checksums.push(digest + '  ' + file);
  for (const path of paths) await copyFile(dir + '/' + file, 'dist' + path);
}
await writeFile(dir + '/SHA256SUMS', checksums.join('\n') + '\n');
