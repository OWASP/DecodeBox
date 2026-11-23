# Changelog

All notable changes to OWASP DecodeBox are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [0.1.2](https://github.com/OWASP/DecodeBox/compare/v0.1.1...v0.1.2) (2026-11-23)

### Fixed

- make HelpDialog modifier labels platform-aware and drop stopPropagation ([`28cbd2e`](https://github.com/OWASP/DecodeBox/commit/28cbd2eb00f06ed6924619a9526953292f5b262c))
- make keyboard shortcuts work and read correctly on macOS ([`89f72e8`](https://github.com/OWASP/DecodeBox/commit/89f72e8cc93422282b1ad9bc75e28a39ada52152))

## [0.1.1](https://github.com/OWASP/DecodeBox/compare/v0.1.0...v0.1.1) (2026-11-22)

### Fixed

- auto-expand newly created favorites and recent sections ([`7805925`](https://github.com/OWASP/DecodeBox/commit/7805925b543158fe65e4d5486a8b12849bddf431))
- improve sidebar quick-access defaults ([`25e50ae`](https://github.com/OWASP/DecodeBox/commit/25e50aee69509511979e2c53b622a6bb89bd0d29))

## [Unreleased]

Changes planned for the next release will be documented here.

## [0.1.0] - 2026-11-20

Initial public release of OWASP DecodeBox.

### Added

- Added a standalone, self-contained HTML build for offline use.
- Added a DecodeBox screenshot to the README.
- Added a demo video to the README.
- Added GitHub Scorecard workflow configuration.
- Added read-back checks for IP formats written by `change-ip-format`.

### Changed

- Improved automatic IPv4 format detection.
- Improved non-ASCII text matching in search, filtering, and identifier operations.
- Refined project branding and README presentation.
- Updated the project tagline to "Encode. Decode. Identify."
- Set `https://decodebox.owasp.org/` as the official project website.

### Fixed

- Fixed a CSV detection issue that could cause the application to hang.
- Fixed Search view behavior when handling incomplete queries.
- Fixed the mobile output bar.
- Fixed output scrolling behavior.
- Addressed issues identified through property-based testing.
- Resolved reported CodeQL alerts and Scorecard findings.

### Security

- Addressed CodeQL alerts.
- Improved security-related project checks through Scorecard findings and remediation.

### Maintenance

- Updated dependencies through Dependabot monthly maintenance groups.
- Applied dependency updates across multiple ecosystems.

### Contributors

Thanks to everyone who contributed to this release:

- [@m4sh-wacker](https://github.com/m4sh-wacker)
- [@arpitjain099](https://github.com/arpitjain099)
- [Dependabot Bot](https://github.com/apps/dependabot)

---

[0.1.0]: https://github.com/OWASP/DecodeBox/releases/tag/v0.1.0
