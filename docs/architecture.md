# Architecture

The React entry point lives in [src/app](../src/app/). Components, hooks, Zustand state,
translations and styles have their own directories under `src/`. UI conveniences such as
favorites, recipe sharing and browser storage belong to the application.

The application calls the [engine façade](../src/engine/index.ts), which loads the processing
code on demand. The [worker](../src/engine/worker/) handles work away from the UI thread.
The standalone HTML embeds its scripts, styles and fonts and runs the engine on the main thread.

The [operation registry](../src/engine/operations/index.ts) owns operation IDs, arguments,
metadata and implementations. [Core](../src/engine/core/) executes recipes and handles bytes.
Detection, recursive analysis, inspection and CTF hints use these same operations.
Engine regression tests live in [src/engine/tests](../src/engine/tests/).

The [SDK](../src/sdk/index.ts) validates requests and exposes detached registry metadata.
The classic entry point installs the global object. The module entry point exports the same API.
Neither calls React, the application store or the worker client.

Platform services implement the [runtime interface](../src/engine/runtime/provider.ts).
The web provider uses native browser primitives. The SDK selects the Java provider when GraalJS
exposes Java interop. It uses JCA, SecureRandom, in-memory ZIP streams and Java time zone rules.
Bundled encoding and URL parsers cover APIs that plain GraalJS lacks. The host controls access
to Java classes. New adapters belong behind this internal interface.
