# Security Policy

## Supported Versions

DecodeBox is pre-1.0. Only the `main` branch, and the site built from it, receives security
fixes.

| Version | Supported |
| --- | --- |
| `main` and the live site | ✅ |
| Older builds, including a downloaded `decodebox.html` | ❌ |

A downloaded copy never updates itself, so download it again after a security fix.

---

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Report privately through a
[GitHub Security Advisory](https://github.com/OWASP/DecodeBox/security/advisories/new)
(the **Security** tab → **Report a vulnerability**).

Please include:

- A clear description of the issue and its impact
- The exact input, recipe or steps that reproduce it
- The browser and version you saw it in
- A proof of concept, defanged if it is genuinely malicious

### In scope

DecodeBox runs entirely in the browser and has no backend, so the threat model is narrow but not
empty:

- Cross-site scripting through any path where input, decoded output, recipe data or a shared link
  reaches the page as markup
- Any bypass of the Content Security Policy, or a change that requires weakening it
- Data leaving the browser: DecodeBox makes no network requests, so any path that sends input,
  output or recipes elsewhere is a serious finding
- Prototype pollution through recipe JSON, imported files or the URL fragment
- Input or a recipe that hangs the tab, exhausts memory or recurses without bound
- Cryptographic output that is wrong in a way a user could reasonably rely on
- Weaknesses in the GitHub Actions workflows or the published build

### Out of scope

- Attacks that need a browser extension or local malware to be compromising the user already
- Missing response headers on GitHub Pages, which cannot set them. The policy ships in a `<meta>`
  element, where browsers ignore `frame-ancestors`; a deployment behind your own proxy should add
  it as a real header.
- Automated scanner output with no demonstrated impact

---

## Disclosure Process

- You will get an acknowledgement within 5 working days and an assessment within 10.
- Fixes are discussed in the private advisory, then implemented and deployed.
- The advisory is published once a fix is live. Please allow reasonable time for that before
  disclosing publicly.

---

## Security Best Practices for Contributors

- Never include secrets, tokens or credentials in a pull request, a test fixture or an issue.
  Test data that looks like a credential must be a published example value, such as
  `AKIAIOSFODNN7EXAMPLE`.
- Treat every input as hostile, including recipe JSON, imported files and the URL fragment.
- Never use `eval`, `new Function`, `innerHTML` or `dangerouslySetInnerHTML`.
- Keep workflow permissions read-only unless a step must write, and pin actions to a commit SHA.

---

## Recognition

Researchers who report responsibly are credited in the advisory and the release notes, unless
they ask to stay anonymous.
