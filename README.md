# OWASP DecodeBox

[![OWASP Project: Incubator](https://img.shields.io/badge/OWASP_Project-Incubator-blue.svg)](https://owasp.org/projects/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Live Site](https://img.shields.io/badge/demo-decodebox.owasp.org-orange.svg)](https://decodebox.owasp.org/)
[![Client-side](https://img.shields.io/badge/processing-100%25_local-green.svg)](#security--privacy)

**Encode. Decode. Identify.**

<https://github.com/user-attachments/assets/55300ac6-472c-4ad9-aa3e-17edf85ab166>

## Overview

OWASP DecodeBox is a browser-based workbench for identifying unknown data and tracing how it was
encoded. Paste text or open a file to inspect its layers, see the evidence for a format match,
and turn the steps that reached a layer into an editable recipe.

[Live site](https://decodebox.owasp.org/) · [Source code](https://github.com/OWASP/DecodeBox)

## Key Features

- **Operations and recipes.** Chain any of the 504 registered operations to convert data formats,
  unpack compressed data, compute hashes, or extract values from binary files. Reorder steps,
  adjust their arguments, and save a recipe to use with another input.
- **Detection and analysis.** Explore decoded layers in the Detection view. Each finding shows
  the evidence that triggered its rule and the path to the matching layer. Indicators such as
  URLs, IP addresses, and hashes retain their location in the tree.
- **Capture the flag (CTF).** Use the Search view to look for a flag prefix or pattern across
  layers. Ranked hints suggest transformations to try next, including shifts for classical
  ciphers. Copy the analysis as a Markdown report to keep the findings and their evidence together.

## Quick Start

To try a recipe on the live site, paste `data:text/plain;base64,aGVsbG8=` into the input,
search for **From Data URI**, and add it to the recipe. The output is `hello`.

To run from source, use Node.js **22.12.0 or later**. The project pins Node.js 22 in
`.nvmrc`, and CI tests on Node.js 22 and 24.

```sh
git clone https://github.com/OWASP/DecodeBox.git
cd DecodeBox
npm ci
npm run dev
```

Open the local address printed by Vite. Run `npm test -- --run` for a single test run or
`npm run build` to type-check the project and generate the static site in `dist/`.

## Security & Privacy

DecodeBox processes input in the browser. Ordinary analysis sends no input to an application
backend. The production Content Security Policy sets `connect-src 'none'`, blocking script
connections such as requests through the Fetch API. The build hashes inline scripts and bundles
its fonts.

Saved recipes live in the browser's local storage. A share link encodes the recipe, including
custom operation arguments, in the URL fragment after `#`. Input is excluded by default.
If you select **Include the input as well**, anyone who receives the link can read the embedded
input. Check both the input and the recipe arguments for sensitive values before sharing.

Report vulnerabilities privately using the instructions in the [security policy](SECURITY.md).

## Standalone Edition

Select **Download DecodeBox** on the live site and save `decodebox.html`. Open it directly from
disk to work offline. The file includes the interface, engine, styles, and fonts. A local build
produces the same edition at `dist/decodebox.html`.

When opened from disk, the engine runs on the main thread, so large inputs can pause the
interface. Download a fresh copy after a security fix. Standalone copies do not update themselves.

## How It Works

1. **Identify candidate formats.** The engine checks signals such as character sets, file
   signatures, and entropy. It tries candidate decoders and scores the result using evidence such
   as a known file header or readable text. When format matches are weak, it can also try
   single-byte XOR keys and letter rotations, scoring the results for readability.
2. **Follow the layers.** The engine repeats detection on decoded output and explores embedded
   values, such as an encoded field inside JSON. Depth, node, and time limits bound the search.
   The decoding chain records why it stopped, including a repeated result or a one-way hash.
3. **Inspect the evidence.** Analysis scans the resulting tree for indicators and security
   findings. A credential-shaped string, for example, can trigger a rule on its format alone.
   Use the matched text and its context to assess the finding.

## Project Status

DecodeBox is an [OWASP Incubator project](https://owasp.org/projects/decodebox).
The [release history](CHANGELOG.md) records the initial public release, version 0.1.0.
The test suite contains 1,205 passing tests. An accessibility audit and broader language support
remain open areas for contribution.

## Contributing

For a detection or decoding error, include a small, non-sensitive input, the steps you took,
and the result you expected. Contributions to operations should include test vectors. Follow the
[OWASP contributing guidelines](https://github.com/OWASP/.github/blob/master/CONTRIBUTING.md)
and the [OWASP Code of Conduct](https://policy.owasp.org/operational/code-of-conduct).

## Architecture

<details>
<summary>Source layout and engine interface</summary>

The React interface calls the TypeScript engine through its [public interface]. The operation
registry supplies names, arguments, and descriptions to the UI. To trace a recipe, follow
the call from the application store to the [recipe executor].

- [Workflows] run CI, documentation checks, and deployment.
- [Public assets] include fonts and icons.
- [Application source]
  - [Components] implement the workspace, detection, and CTF views.
  - [Store] manages application state and recipe actions.
  - [Library] handles share links and saved recipes.
  - [Engine]
    - [Operations] implement individual transformations.
    - [Core] handles bytes and executes recipes.
    - [Detection] identifies formats and follows decoding chains.
    - [Analysis] explores embedded values and collects findings and indicators.
    - [CTF] searches for flags and ranks hints.
    - [Worker] runs larger jobs in the background.

</details>

[public interface]: src/engine/index.ts
[recipe executor]: src/engine/core/bake.ts
[Workflows]: .github/workflows/
[Public assets]: public/
[Application source]: src/
[Components]: src/components/
[Store]: src/store/
[Library]: src/lib/
[Engine]: src/engine/
[Operations]: src/engine/operations/
[Core]: src/engine/core/
[Detection]: src/engine/detection/
[Analysis]: src/engine/analysis/
[CTF]: src/engine/ctf/
[Worker]: src/engine/worker/

## Project Lead and License

[Mohammad Hossein Sadeghian](https://github.com/m4sh-wacker) leads OWASP DecodeBox.
The project is licensed under the [Apache License 2.0](LICENSE).
