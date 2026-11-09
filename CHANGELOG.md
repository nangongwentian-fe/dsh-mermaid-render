# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-09

First public release.

### Added

- Browser-only DSH bundle that enhances the shipped Markdown code-block DOM and renders
  ` ```mermaid ` fences as inline SVG diagrams in chat replies and plan/document panels.
- **Show source / Show diagram** toggle, preserving the shipped language label, wrap and copy actions.
- Theme-aware rendering from `--dsw-alias-*` tokens with automatic re-render on light/dark changes.
- Localized fallbacks for invalid or oversized diagrams; rendering waits for streaming rows to settle.
- Pinned mermaid **12.3.0** shipped as an offline, package-local lazy chunk loaded through
  `require.async` on first use (no CDN, no network at render time).
- Security hardening for untrusted model output: `strict` mode, `htmlLabels: false`,
  `suppressErrorRendering: true`, an extended `secure` config list, directive/front-matter stripping,
  and a source length cap.
- Plugin Manager metadata and original icon; disabling the plugin restores the original DOM.
- Build script, CI for build consistency and vendor purity, verification record, and third-party notices.
