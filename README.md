# OWASP DecodeBox

<img src="public/favicon.svg" alt="DecodeBox logo" width="64" height="64">

[![OWASP Project: Incubator](https://img.shields.io/badge/OWASP_Project-Incubator-blue.svg)](https://owasp.org/projects/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Live Site](https://img.shields.io/badge/demo-decodebox.owasp.org-orange.svg)](https://decodebox.owasp.org/)
[![Client-side](https://img.shields.io/badge/processing-100%25_local-green.svg)](#security--privacy)

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
- **Recipes.** Use the operation catalogue to convert formats, decompress data, compute hashes,
  or extract values. Adjust the arguments, reorder steps, and save the recipe for another input.
- **Capture the flag (CTF).** Search decoded layers for flag patterns, review ranked hints for
  the next transformation, and copy the findings into a Markdown report.

## JavaScript SDK

Embed operation discovery, recipes and multilayer analysis in a browser or Java-enabled GraalJS.
The SDK uses the same local processing engine as the workbench. This example uses the existing
SDK distribution. The official site's SDK paths will become available after deployment.

```html
<meta charset="utf-8">
<script src="https://decodebox.m4sh.ir/api.js"></script>
<script>
  DecodeBox.ready.then(async () => {
    console.log(await DecodeBox.executeOperation("from-base64", "SGVsbG8=")); // Hello
  });
</script>
```

See the [SDK guide](docs/sdk/README.md) for versioned downloads, module imports and integrity
verification. See [runtime integrations](docs/sdk/integrations.md) for TypeScript and ZAP.

## Development

Use Node.js 24, run `npm ci`, then `npm run dev`. The [development guide](docs/development.md)
covers regression tests and builds for the site, standalone application and SDK. See the
[documentation index](docs/README.md) for the project layout and API reference.

## Standalone Edition

Select **Download DecodeBox** on the live site, or open the locally built
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

## Project Leader

[Mohammad Hossein Sadeghian](https://github.com/m4sh-wacker)

## License

DecodeBox is licensed under the [Apache License 2.0](LICENSE).
