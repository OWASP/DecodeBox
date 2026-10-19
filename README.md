# OWASP DecodeBox

[![OWASP Project: Incubator](https://img.shields.io/badge/OWASP_Project-Incubator-blue.svg)](https://owasp.org/projects/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Live Site](https://img.shields.io/badge/demo-owasp.github.io%2FDecodeBox-orange.svg)](https://owasp.github.io/DecodeBox/)
[![Client-side](https://img.shields.io/badge/processing-100%25_local-green.svg)](#security--privacy)

**Encode. Decode. Identify.** Smart decoding for any data.

[![DecodeBox auto-decoding a layered payload](docs/screenshot.png)](https://owasp.github.io/DecodeBox/)

---

### Project Status

**Pre-release, and already usable.** The workbench runs, the detection engine unwraps layered
payloads, and the analysis report is complete.

- **Engine:** 504 operations across data formats, ciphers, public-key cryptography, hashing,
  compression, networking, forensics, multimedia and extractors. Every one is covered by a
  round-trip or a published known-answer test — 1,109 tests in all.
- **Interface:** Three modes — a workspace for transforming, a report for understanding, and a
  CTF mode for working out what to try next, deployed at
  **[owasp.github.io/DecodeBox](https://owasp.github.io/DecodeBox/)**.

Still ahead: the accessibility audit and the internationalisation pass. A disassembler and an OCR
engine are deliberately out of scope — they are their own projects, not operations.

### About The Project

The usual model for a tool like this assumes you already know what your data is: you pick the
operations, you chain them, you iterate. That is fine when you recognise the format on sight, and
useless when you do not — which is most of the time an analyst is looking at something new.

DecodeBox starts from the other end. You paste, and it works out what it is holding: every layer
unwrapped, every indicator extracted, every security finding explained, with the evidence for each
claim visible rather than asserted.

Everything runs in your browser. No input, no recipe, and no file ever leaves your machine —
there is no server to send it to.

### Key Objectives

- **Identify:** Name unknown data rather than requiring the user to name it first.
- **Explain:** Show the measurement behind every claim, so a confidence score can be checked.
- **Analyse:** Report what a payload *means* — indicators and security findings at every depth —
  not only what its bytes say.
- **Guarantee:** Keep the processing entirely client-side, and enforce that in the build rather
  than promising it in a document.

### See it in Action

A real payload from the test suite: Base64 over Base64 over gzip over JSON, with a PowerShell
loader in one field.

```text
Findings   4        Indicators 7        Layers 8        257 ms

CRITICAL  Cloud or service credential            CWE-798
          Input → Base64 → Base64 → gzip
          AKIAIOSFODNN7EXAMPLE

CRITICAL  PowerShell download-and-execute        CWE-94
          Input → Base64 → Base64 → gzip → JSON → Base64 → UTF-16LE
          IEX (New-Object Net.WebClient).DownloadString
```

The second finding is six layers down, and the last hop came from a Base64 blob inside one JSON
field. Nothing that greps the original blob sees it, and nothing that unwraps a single linear
chain reaches it.

### How It Works

1. **Detect.** Candidate interpretations are scored from independent signals — Shannon entropy,
   character set, length rules, magic bytes, and whether the decoded result is itself well-formed.
   Each signal carries a human-readable justification, and the last one carries the most weight:
   any long hex string is *shaped* like Base64, but only one reading decodes to something coherent.
2. **Unwrap.** The best candidate is decoded and detection runs again on the result, building a
   tree rather than a chain — including encoded regions buried *inside* structures. The recursion
   is bounded on depth, node count and wall-clock time.
3. **Terminate, and say why.** A chain ends on content, on a named one-way value
   (`Base64 → Base64 → MD5`), on a remainder that cannot be decoded such as a JWT signature, or on
   an honest admission that a limit was reached and there may be more underneath.
4. **Scan.** Indicators and security findings are gathered from every node of the tree, each
   reported with a CWE reference, the evidence, and the exact decode path that revealed it.

When nothing declared explains the input, DecodeBox tries every single-byte XOR key and every
rotation and scores each result for readability — at a confidence that says plainly it was a
search rather than a match.

### Security & Privacy

DecodeBox processes untrusted, deliberately malformed input by design.

- **No backend.** There is nothing to breach, nothing to log, and nothing to subpoena.
- **No network, enforced.** The build ships a Content Security Policy with `connect-src 'none'`
  and `script-src 'self'` plus a hash for the one inline script. Fonts are bundled rather than
  fetched, and the build **fails** if a CDN reference ever appears in the output.
- **No dynamic evaluation.** `eval`, `new Function`, and any path that renders input as HTML are
  forbidden by lint rules, not by convention.

`style-src` does allow `'unsafe-inline'`, because React writes inline `style` attributes;
`script-src`, where the real risk lives, stays strict. To report a vulnerability, see
[SECURITY.md](SECURITY.md) — please do not open a public issue for security reports.

### Repository Structure

```text
DecodeBox/
├── .github/workflows/   # CI, CodeQL, SBOM, markdown quality, Pages deployment
├── public/              # Bundled fonts, favicon, CNAME
├── src/
│   ├── engine/          # The analysis engine — the only half that knows about data
│   │   ├── index.ts     # THE SEAM — the only module the interface imports from
│   │   ├── operations/  # One self-contained module per transformation
│   │   ├── detection/   # Entropy, charset, magic bytes, structural validity
│   │   ├── analysis/    # Recursive exploration, indicators, security findings
│   │   ├── ctf/         # Flag search, cipher key recovery, ranked hints
│   │   ├── core/        # Recipe executor, byte handling, ciphers, codecs
│   │   └── worker/      # The engine off the main thread, past a size threshold
│   ├── components/      # The interface: workspace, report, CTF mode
│   ├── store/           # One zustand store
│   ├── hooks/           # Interaction logic shared across components
│   ├── lib/             # Share links, saved recipes, recipe text format
│   ├── i18n/            # Every user-facing string
│   └── styles/          # Design tokens and themes
├── SECURITY.md
└── LICENSE
```

The interface reaches the engine through one narrow facade exposing seven functions —
`listOperations`, `bake`, `detect`, `autoDecode`, `identify`, `analyse` and `hints`. Both halves
can be developed, tested and replaced independently; the workspace was once rebuilt from scratch
without the engine changing by a line. Adding an operation should never require touching the UI.

### Quick Start

Requires Node.js 22.12 or later. CI builds on 22 and 24; `.nvmrc` pins 22 for development.

```bash
npm install
npm run dev     # development server
npm run test    # 1,109 tests
npm run build   # static site in dist/
```

The build output is fully static — no runtime, no server, no environment variables. Any static
host will serve it.

### One File, No Install

There is a **Download DecodeBox** button in the header of the running application. It hands you
`decodebox.html`: the whole thing in a single 1.2 MB file — the interface, all 504 operations, the
fonts, the styles. Double-click it and it runs. No server, no npm, no network, nothing to install,
which is the point on an air-gapped machine where getting a build toolchain in is harder than
getting one file in.

`npm run build` produces it alongside the site, so any deployment serves it:

```text
dist/index.html       the site
dist/decodebox.html   the same build, in one file
```

It has to be one file rather than a folder. A browser refuses to load an ES module from a
`file://` URL — the origin is opaque, so the request fails its CORS check — which means the
ordinary `dist/` folder opened from disk comes up blank. Everything inlined leaves no request to
fail. The only thing given up is the Web Worker, which needs a second file by definition, so a
standalone build stays on the main thread for very large inputs and is identical otherwise.

### How to Contribute

The site is live, so the most valuable thing you can do right now is **use it and try to break
it**. Contributions are welcome, particularly in these areas:

- **Testing:** Paste real payloads at
  [owasp.github.io/DecodeBox](https://owasp.github.io/DecodeBox/) and report anything it gets
  wrong — especially anything it gets wrong *confidently*.
- **Operations:** New transformations. One self-contained module, one test file, no UI changes.
- **Detection:** Better heuristics that explain their evidence. A confident wrong answer is worse
  than no answer.
- **Accessibility:** The WCAG 2.1 AA audit has not been done yet.

Start with the
[OWASP contributing guidelines](https://github.com/OWASP/.github/blob/master/CONTRIBUTING.md).
All participants are expected to follow the
[OWASP Code of Conduct](https://policy.owasp.org/operational/code-of-conduct).

### Project Leader

- [Mohammad Hossein Sadeghian](https://github.com/m4sh-wacker)

### License

Licensed under the [Apache License 2.0](LICENSE). An OWASP Foundation Incubator project,
classified as a Tool.

---
