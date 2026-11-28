# SDK API reference

The classic bundle exposes `globalThis.DecodeBox`. ES modules provide a default export,
a named `DecodeBox`, individual methods and the `DecodeBoxError` class. Initialization installs
the classic namespace synchronously. Await `ready` before beginning work.

| Member | Result |
| --- | --- |
| `apiVersion`, `engineVersion` | Public contract and engine release version strings. |
| `capabilities()` | Active runtime, available crypto, randomness, compression formats, charsets and size limits. |
| `listOperations()` | Detached operation definitions with stable IDs, aliases and argument metadata. |
| `getOperation(id)` | One definition, or `null` for an unknown ID. |
| `executeOperation(id, input, args?)` | Promise of a string. Rejects on validation or execution failure. |
| `bake(input, recipe)` | Promise of output, output type, byte length, elapsed time, completed operation IDs and an optional step error. |
| `detect(input)` | Ranked candidates with evidence, previews and recipe steps. |
| `autoDecode(input, options?)` | Tree of decoded layers with stopping reasons. |
| `identify(input)` | Hash identification or `null`. |
| `analyse(input, options?)` | Analysis tree, indicators, findings and truncation information. |
| `inspect(input, {decode?, analyse?}?)` | Decoded root and analysis together. |
| `hints(input, options?)` | CTF flags and suggested transformations. |

Processing and analysis methods return promises. Discovery and capability methods are synchronous.

## Discovery, arguments and recipes

```js
const op = DecodeBox.getOperation("to-base64");
console.log(op.id, op.args.map(({ name, value }) => [name, value]));
const digest = await DecodeBox.executeOperation("sha-256", "abc");
const recipe = [{ opId: "gzip" }, { opId: "gunzip" }, { opId: "to-base64" }];
const result = await DecodeBox.bake(Uint8Array.of(0, 128, 255), recipe);
if (result.error) throw new Error(result.error.message);
console.log(digest, result.output); // binary round trip: AID/
```

Omitted arguments use the values in the operation definition. Supply exact argument names
and the declared types, options and ranges. A toggle-string accepts a string or
`{ value, format }` using one of its `toggleValues`. A recipe accepts an array of
`{ opId, args?, disabled? }`, engine steps returned by detection, or an object with a
`steps` array. Unknown IDs, unknown arguments and invalid option values fail validation.

Strings carry text. Supply a `Uint8Array` or `ArrayBuffer` for bytes; views preserve their
offset and length. Binary operation results are strings with one code unit per byte.
Convert a binary result with `Uint8Array.from(output, c => c.charCodeAt(0))`. For Unicode text,
use the operation's charset setting where available. The output type on a recipe is descriptive.

## Detection and bounded analysis

```js
const input = "U0dWc2JHOD0=";
const candidates = await DecodeBox.detect(input);
const { root, analysis } = await DecodeBox.inspect(input, {
  decode: { maxDepth: 4 }, analyse: { maxNodes: 32 },
});
console.log(candidates.length, root, analysis);
```

Automatic decoding defaults to depth 64, 10,000 ms and confidence threshold 0.55. Analysis
defaults to depth 64, 128 nodes, 10,000 ms and threshold 0.5. Both accept up to 60,000 ms.
Analysis accepts at most 1,024 nodes. Hints accept a format string, depth and time budget.

## Errors and limits

Inspect `error.code` on rejected SDK validation and operation calls. Codes are
`INVALID_INPUT`, `UNKNOWN_OPERATION`, `LIMIT_EXCEEDED` and `OPERATION_FAILED`.
A recipe that fails inside the engine resolves with `error.stepIndex` and `error.message`;
validation can reject the recipe before execution begins. Check both outcomes.

Inputs and aggregate string arguments are limited to 4 MiB in bytes or UTF-16 code units.
Recipes accept up to 128 steps. Step output and decompression are bounded at 16 MiB.
Some formats and algorithms impose tighter limits. Time budgets are cooperative. A synchronous
regular expression, KDF or host operation can occupy its thread until it returns. Execute
untrusted recipes in a terminable worker or a resource-limited host process when a hard wall
clock or memory limit is required.
