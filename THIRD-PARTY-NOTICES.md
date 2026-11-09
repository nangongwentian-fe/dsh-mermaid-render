# Third-party notices

This repository redistributes a prebuilt, minified bundle of **mermaid 12.3.0**
(`vendor/mermaid.iife.min.js` and the generated `client.mermaid.js`). The plugin code
itself is licensed under the MIT License (see `LICENSE`); the bundled copy of mermaid
and its transitive dependencies remain under their own licenses, reproduced or listed
below.

## mermaid

- Package: `mermaid@12.3.0`
- License: MIT
- Upstream: <https://github.com/mermaid-js/mermaid>

```text
The MIT License (MIT)

Copyright (c) 2014 - 2022 Knut Sveidqvist

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Bundled dependencies

The esbuild-produced bundle inlines 59 npm packages. Grouped by the
license declared in each package manifest:

| License | Packages |
| --- | --- |
| ISC | `d3`, `d3-axis`, `d3-brush`, `d3-chord`, `d3-color`, `d3-contour`, `d3-delaunay`, `d3-dispatch`, `d3-drag`, `d3-dsv`, `d3-fetch`, `d3-force`, `d3-format`, `d3-geo`, `d3-hierarchy`, `d3-interpolate`, `d3-polygon`, `d3-quadtree`, `d3-random`, `d3-scale`, `d3-scale-chromatic`, `d3-selection`, `d3-time`, `d3-time-format`, `d3-timer`, `d3-transition`, `d3-zoom` |
| MIT | `@braintree/sanitize-url`, `@iconify/utils`, `@mermaid-js/parser`, `@upsetjs/venn.js`, `cose-base`, `cytoscape`, `cytoscape-cose-bilkent`, `cytoscape-fcose`, `dagre-d3-es`, `dayjs`, `es-toolkit`, `katex`, `khroma`, `layout-base`, `lodash-es`, `marked`, `mermaid`, `roughjs`, `stylis`, `ts-dedent` |
| BSD-3-Clause | `d3-array`, `d3-ease`, `d3-path`, `d3-sankey`, `d3-shape` |
| Apache-2.0 | `@chevrotain/cst-dts-gen`, `@chevrotain/gast`, `@chevrotain/regexp-to-ast`, `@chevrotain/utils`, `chevrotain` |
| (MPL-2.0 OR Apache-2.0) | `dompurify` |
| EPL-2.0 OR GPL-3.0-or-later | `elkjs` |

Notes:

- `elkjs` is dual-licensed **EPL-2.0 OR GPL-3.0-or-later**; it is included for the ELK diagram layout. If you redistribute this bundle, review those terms.
- `dompurify` is dual-licensed **MPL-2.0 OR Apache-2.0**.
- Package-level license texts are distributed with the corresponding npm packages and upstream repositories; they are not repeated here. Full license texts are also available from <https://www.npmjs.com/> for each package and version.
- The generated files are byte-for-byte reproducible with the pinned mermaid version and the documented esbuild command (see `README.md` → Build), which is how this notice was derived.
