# JavaScript SDK

DecodeBox exposes the workbench engine to browsers and Java-enabled GraalJS. Processing takes
place in the consuming runtime. The `/api` resource distributes the classic JavaScript SDK.
There is no REST endpoint for submitting data.

## Quick start

The existing distribution is hosted at [decodebox.m4sh.ir](https://decodebox.m4sh.ir/).
The same paths under `https://decodebox.owasp.org` are pending official deployment.
This example uses the existing distribution.

```html
<meta charset="utf-8">
<script src="https://decodebox.m4sh.ir/api.js"></script>
<script>
  DecodeBox.ready.then(async () => {
    console.log(await DecodeBox.executeOperation("from-base64", "SGVsbG8=")); // Hello
  });
</script>
```

## Distribution

| Format | Following the current build | Fixed engine release |
| --- | --- | --- |
| Classic | `/api`, `/api.js`, `/sdk/decodebox.js`, `/sdk/v1/decodebox.js` | `/sdk/v1/{engineVersion}/decodebox.js` |
| ES module | `/sdk/decodebox.mjs`, `/sdk/v1/decodebox.esm.js` | `/sdk/v1/{engineVersion}/decodebox.mjs` |
| Module declarations | `/sdk/decodebox.d.mts` | `/sdk/v1/{engineVersion}/decodebox.d.mts` |

The integration build also emits `/sdk/v1/{engineVersion}/SHA256SUMS`. The API version tracks
the public contract. The engine version follows the project's release. Applications that rely
on particular operation behavior can pin a release and verify its bytes.

The extensionless alias on the existing Pages site uses `application/octet-stream`.
Chromium can load it as a classic script under that site's current headers. Use `/api.js` in
strict MIME environments and the module path for imports. GitHub Pages controls response types.
The official classic build includes a UTF-8 signature so it also loads in documents that use
a legacy encoding. When using the existing distribution, declare UTF-8 on the consuming page.

## Integrity and offline use

For an official release that includes the SDK, obtain `DecodeBox-SDK-vX.Y.Z-SHA256SUMS`
from the corresponding [OWASP release](https://github.com/OWASP/DecodeBox/releases).
Download the three versioned files into one directory and run the following there,
substituting the actual release tag.

```sh
sha256sum -c DecodeBox-SDK-vX.Y.Z-SHA256SUMS
```

Use the hash of the exact file your integration loads. A digest fetched alongside a file can
detect corruption. Establish provenance through a separately trusted release or a pin supplied
by your administrator. The Pages manifest alone cannot authenticate the publisher.

You can serve the verified files from your own static origin, next to the consuming app, or
load the classic bundle from disk. A local copy includes the engine and its dependencies.
Processing requires no external network access or package installation.

See the [API reference](api-reference.md) and [runtime integrations](integrations.md).
