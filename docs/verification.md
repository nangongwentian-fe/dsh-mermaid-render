# Verification record

Release: **v1.0.0** · Verified: 2026-11-09 · Target: DeepSeek Harness **0.2.2-rc.1**, profile
`desktop`, DSH Web client served at the local GUI URL.

The verification drove the running Web client (the frontend the desktop app loads) rather than a
mock page: the plugin was installed through DSH's Plugin Manager tooling, then exercised in the live
app with real session content and synthetic code blocks.

## Installation and metadata

| Check | Result |
| --- | --- |
| `plugin_manager install_bundle(<repo dir>)` | applied, no warnings; `link:` dependency and bundle layer added to the profile |
| Loader row activation | active (client bundle requested from `/plugins/??@local/mermaid-render/client.js&rev=…`) |
| Lazy chunk | `/plugins/@local/mermaid-render/client.mermaid.js?rev=…` fetched only on first diagram (5,360,405 B, 200) |
| Plugin Manager row | title "Mermaid diagrams", description, original icon rendered (64×64), enabled switch |
| Disable / re-enable | unload removes views, style tag, host attributes and restores source display; re-enable re-renders |

## Rendering and interaction

| Check | Result |
| --- | --- |
| Plan/document panel (`sequenceDiagram` fence, real session) | rendered as SVG sequence diagram, source hidden |
| Chat transcript (`flowchart LR` reply) | rendered as SVG flowchart in the chat message (accessibility tree exposes `graphics-document`) |
| Header preservation | shipped "Code block" label, wrap toggle and copy remain; copy still copies source |
| Source toggle | source/diagram switch both ways; `aria-pressed` tracks state |
| Natural size | 1442 px diagram in a 705 px column scrolls horizontally instead of shrinking text |
| React state churn | clicking shipped wrap/copy buttons re-renders `CodeBlock`; injected view survives, no React errors |
| Streaming settle gate | block inside `[data-streaming]` stays unenhanced until the attribute disappears, then renders |

## Theme

`prefers-color-scheme: dark` emulation switched the host (`color-scheme: dark`,
`body[data-ds-dark-theme]`, tokens `#232324`/`#f9fafb`/`#7aaaff`). The diagram re-rendered
automatically (new SVG id) with the dark palette (`actor fill rgb(49, 57, 71)`, border
`rgb(122, 170, 255)`, text `rgb(249, 250, 251)`), and switching back restored the light palette.
Flowchart node strokes use the visible label-tertiary token (`rgb(129, 133, 140)` light).

## Fallbacks and security

| Probe | Result |
| --- | --- |
| Invalid mermaid | localized "could not be rendered" note, source visible, toggle hidden, only a debug `console.warn` |
| Oversized source (> 50,000 chars) | localized "too large" note, source visible, no render attempted |
| Empty source after a rendered diagram | enhancement reset (view hidden, SVG removed, source visible); refilling re-renders |
| Malicious directive attempt: `%%{init: {"themeCSS": "…url(https://evil.invalid/x.png)", "htmlLabels": true}}%%` + valid flowchart | directive stripped, SVG rendered, **0** resource requests to `evil.invalid`, no `foreignObject`, no injected CSS |
| Console | no errors across all checks |

## Build and artifact consistency

| Check | Result |
| --- | --- |
| `node --check client.js` | passes |
| `cmp src/client.js client.js` | byte-identical |
| `client.mermaid.js` | header + `vendor/mermaid.iife.min.js` + footer, 5,360,405 B |
| Vendor purity | mermaid 12.3.0 IIFE sets `globalThis.__MERMAID__`; 0 `import(`, 0 `import.meta`, 0 `eval(` |
| Bundle size | minified 5,359,911 B / ~1.54 MB gzip; fetched lazily, not part of app boot |

## Independent review

Two review rounds were performed by fresh, read-only reviewers against the source and the installed
DSH client packages:

- Round 1 found one high-severity issue (mermaid `%%{init}%%` config escape enabling CSS injection /
  external fetch even under `strict`) and several medium/low issues (detection keyword coverage,
  theme signature, color parsing fallback, scan cost, chunk retry, locale/a11y, docs).
- Round 2 (after fixes) found no P0/P1 defects, confirmed the round-1 findings closed, and raised
  small follow-ups (error-code localization, dead record fields, empty-source stale diagram, hex
  validation, DSH dark-theme signal, detection/doc nits), which were fixed and re-checked in a final
  closure pass.

## Not verified

- Electron-specific chrome behavior (the desktop window shares the same host and frontend; it was not
  driven directly by the automation).
- Screen-reader output beyond the accessibility tree, and the zh locale switch at runtime (the zh
  dictionary is registered but UI verification was English).
- Mermaid's own internals beyond the security/API behavior documented above; a future mermaid upgrade
  must re-run this record.
