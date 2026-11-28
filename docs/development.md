# Development

Use Node.js 24 and install the locked dependencies. Run these commands at the repository root.

```sh
npm ci
npm run dev
```

Before submitting changes, run the same checks as CI.

```sh
npm run lint
npm run typecheck
npm test -- --run
npm run build
npm run check:sdk-dist
```

The build writes the site to `dist/`, the offline application to `dist/decodebox.html`, and
the SDK to the [distribution paths](sdk/README.md#distribution). Use `npm run preview` for
the site, or open the standalone file from disk. `npm run build:sdk` rebuilds the SDK alone.
The distribution check executes both module formats and verifies alias bytes and release hashes.
CI also loads every JavaScript entry point in Chrome and checks SHA-256 with the Java provider.
To run the browser check against a local preview, use the URL printed by Vite.

```sh
node scripts/check-sdk-browser.mjs http://localhost:4173/
```

## Changes and releases

Add operations to the existing registry and supply operation-specific regression vectors.
Keep platform-dependent services in the runtime providers. Changes to public SDK functions
also need contract tests in [src/sdk/sdk.test.ts](../src/sdk/sdk.test.ts) and an API reference
update. Submit changes on a temporary branch targeting `main`.

Release Please manages the project version. The SDK's API major is independent of that version.
The Pages workflow builds from source, carries forward previous SDK releases and the configured
custom domain, and publishes generated files to the root of `gh-pages`. It stops if an existing
version directory would change. A changed release artifact needs a new engine version through
the normal release process. For tags that contain the SDK, the release workflow attaches
the matching checksum manifest. Production bundles and test output stay outside the source tree.
