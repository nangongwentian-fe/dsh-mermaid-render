# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-11-18

### Added

- Inline toolbar under every diagram: zoom out, a percentage readout that resets to 100 % when
  clicked, zoom in (25 %–400 % overall), a **fit width** toggle, and **fullscreen**.
- Zoom is applied by assigning the SVG a new layout size instead of a CSS `transform`. The browser
  therefore re-renders the vectors at the target size, so text and strokes stay sharp at every zoom
  level; a transformed layer is rasterized once and then stretched, which is what makes scaled
  diagrams look soft.
- Fullscreen overlay carries its own copy of the SVG: `Esc` closes it, `⌘/Ctrl` + wheel zooms, and the
  inline diagram is untouched while it is open (it is re-fitted when it closes).
- Zoom and fit state survive the automatic re-render on light/dark theme changes.

### Changed

- The controls moved into the shipped code-card banner, immediately before its wrap/copy actions, so
  a diagram has exactly one control row instead of a top header and a bottom bar. The group is
  re-attached on the next scan if React replaces that row.
- **Show source / Show diagram** is now an icon (`</>` / `▦`) instead of text, matching the icon
  actions beside it; its hint and accessible name still follow the active locale.
- Every control shows a hover hint. The hints are portalled to `<body>` because the card clips
  overflow, and they replace the native `title` tooltip so a control never shows two hints.
- The failed/oversized notice moved above the diagram, where the source fallback is shown.

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

### Documentation

- README includes light- and dark-theme screenshots of the plugin in the DSH chat UI.
