# Bundled fonts

These font files are self-hosted rather than loaded from a font CDN. Fetching a font at runtime
would tell a third party the IP address of everyone who opens DecodeBox, which contradicts the
one guarantee this project makes. Self-hosting also means the application works with no network
at all, which matters for air-gapped and incident-response use.

Both families are subset to Latin and Latin Extended, and both are licensed under the
[SIL Open Font License 1.1](https://openfontlicense.org/), which permits redistribution.

| File | Family | Copyright |
| --- | --- | --- |
| `inter-latin.woff2`, `inter-latin-ext.woff2` | Inter | Copyright The Inter Project Authors |
| `jetbrains-mono-latin.woff2`, `jetbrains-mono-latin-ext.woff2` | JetBrains Mono | Copyright The JetBrains Mono Project Authors |

Upstream sources: [Inter](https://github.com/rsms/inter) ·
[JetBrains Mono](https://github.com/JetBrains/JetBrainsMono)
