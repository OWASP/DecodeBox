# Runtime integrations

## Browser and TypeScript

Load a classic script as shown in the [quick start](README.md#quick-start), or import the ES
module in a module script. Serve the file with a JavaScript MIME type. Cross-origin imports
also require CORS. For a restrictive CSP, serve a verified copy from an allowed origin.
Browser cryptography requires the host's secure-context APIs.

```js
import DecodeBox from "./sdk/decodebox.mjs";
await DecodeBox.ready;
const encoded = await DecodeBox.executeOperation("to-base64", "Hello");
console.log(encoded); // SGVsbG8=
```

For TypeScript, keep `decodebox.d.mts` next to `decodebox.mjs` and use a resolver that
understands ESM declarations, such as `NodeNext` or `Bundler`.

```ts
import sdk, { type Step } from "./sdk/decodebox.mjs";
const steps: Step[] = [{ opId: "from-base64" }];
const result = await sdk.bake("SGVsbG8=", steps);
if (result.error) throw new Error(result.error.message);
console.log(result.output); // Hello
```

The web provider uses Web Crypto, secure random bytes, platform encoders, URL parsing and
compression streams. Inspect `capabilities()` for the actual host. Updating browser or JDK
time zone data can change historical abbreviations.

## GraalJS

Supply the verified classic bundle as a local script to a Java-enabled GraalJS context.
Shell-style `load` and `print` must be available for this example.

```js
load("decodebox.js");
DecodeBox.ready
  .then(() => DecodeBox.executeOperation("sha-256", "abc"))
  .then(print);
```

Java class lookup and access to the provider's JCA, time, encoding, byte-array and compression
services must be permitted by the embedding host. Restrict host access to trusted scripts.
Loading by URL requires host I/O and a GraalJS configuration permitting `js.load-from-url`.
A locally verified bundle avoids granting remote-loading permission. Processing makes no
outbound requests. Promises settle at the owning context's microtask checkpoints. Operations
that sleep or call synchronous Java code occupy that thread.

## ZAP

In the Script Console, select **Stand Alone** and **ECMAScript : Graal.js**. Set the
`DECODEBOX_SDK` environment variable to the absolute path to a verified local classic bundle
before starting ZAP. Run this script and check its output in the console.

```js
const path = Java.type("java.lang.System").getenv("DECODEBOX_SDK");
if (!path) throw new Error("Set DECODEBOX_SDK to a verified local file");
load(String(path));
DecodeBox.ready.then(async () => {
  const output = await DecodeBox.executeOperation("from-base64", "SGVsbG8gWkFQ");
  if (output !== "Hello ZAP") throw new Error("Unexpected decoded text");
  print(output);
});
```

The separate [native ZAP add-on](https://github.com/m4sh-wacker/DecodeBox-ZAP-Addon)
has its own trust policy. It checks SDK size, API major and SHA-256. A changed bundle needs
a separately trusted digest or the add-on's supported approval process. A plain checksum list
does not satisfy its signed-manifest mode. Host permissions and trusted pins are managed by the
consumer. See [integrity and offline use](README.md#integrity-and-offline-use).
