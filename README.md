# OWASP DecodeBox

[![OWASP Project: Incubator](https://img.shields.io/badge/OWASP_Project-Incubator-blue.svg)](https://owasp.org/projects/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Live Site](https://img.shields.io/badge/demo-decodebox.owasp.org-orange.svg)](https://decodebox.owasp.org/)
[![Client-side](https://img.shields.io/badge/processing-100%25_local-green.svg)](#security--privacy)

**Encode. Decode. Identify.**

<p align="center">
  <a href="#owasp-decodebox">README</a> ·
  <a href="#how-to-contribute">Contributing</a> ·
  <a href="LICENSE">Apache-2.0 License</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<https://github.com/user-attachments/assets/55300ac6-472c-4ad9-aa3e-17edf85ab166>

OWASP DecodeBox is a browser-based workbench for identifying unknown data and tracing how it was
encoded. Paste text or open a file to explore its layers. Each format suggestion comes with
evidence you can inspect, and the steps that reach a layer can become an editable recipe.

- **Detection.** Follow nested encodings, including encoded fields inside structured data.
  The analysis shows where it found each indicator and what triggered each security finding.
- **Recipes.** Choose from 504 operations to convert formats, decompress data, compute hashes,
  or extract values. Adjust the arguments, reorder steps, and save the recipe for another input.
- **Capture the flag (CTF).** Search decoded layers for flag patterns, review ranked hints for
  the next transformation, and copy the findings into a Markdown report.

## Quick Start

[Open DecodeBox](https://decodebox.owasp.org/), paste `data:text/plain;base64,aGVsbG8=` into
the input, and add **From Data URI** to the recipe. The output is `hello`.

For local development, clone the [source repository](https://github.com/OWASP/DecodeBox)
and run these commands from its root with Node.js **22.12.0 or later**.

```sh
npm ci
npm run dev
```

Run `npm test -- --run` to execute the 1,205 tests. Run `npm run build` to produce the static
site and the standalone edition.

**Offline use.** Select **Download DecodeBox** on the live site, or open the locally built
`dist/decodebox.html`. The file includes the engine, interface, and fonts. Large inputs can
pause the tab because processing runs on the main thread. Download a new copy after security fixes.

## Security & Privacy

Analysis runs in your browser. No application backend receives ordinary analysis input.
Saved recipes use browser storage. Share links include the recipe and its custom arguments
in the URL fragment. Input is excluded by default. If you select **Include the input as well**,
anyone with the link can read it. Report vulnerabilities privately through the
[security policy](SECURITY.md).

## How to Contribute

For decoding errors, include a small, non-sensitive sample, your recipe, and the expected result.
Contributions to operations should include test vectors. Follow the
[OWASP contributing guidelines](https://github.com/OWASP/.github/blob/master/CONTRIBUTING.md)
and [Code of Conduct](https://policy.owasp.org/operational/code-of-conduct).

<details>
<summary>Source layout</summary>

- The [engine interface] exposes decoding and analysis to the React [interface components].
- The engine separates [operations], [format detection], and [recursive analysis].

</details>

[Interface components]: src/components/
[engine interface]: src/engine/index.ts
[operations]: src/engine/operations/
[format detection]: src/engine/detection/
[recursive analysis]: src/engine/analysis/

[Mohammad Hossein Sadeghian](https://github.com/m4sh-wacker) leads this
[OWASP Incubator project](https://owasp.org/projects/decodebox).
DecodeBox is licensed under the [Apache License 2.0](LICENSE).
