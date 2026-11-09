/**
 * Browser half of the `@local/mermaid-render` bundle: renders ```mermaid code
 * blocks in the DeepSeek Harness Web client as diagrams.
 *
 * Why a DOM enhancer instead of a Markdown renderer slot: the shipped
 * `MarkdownText`/`CodeBlock` pipeline owns every fenced code block and exposes
 * no renderer registration point (no slot, no factory, no Client service for a
 * fence renderer), so a plugin cannot replace CodeBlock's React component. The
 * surface this plugin uses instead is the shipped code-block DOM contract,
 * which is stable across the transcript, the plan/document panels and any other
 * MarkdownText consumer:
 *
 *   .md-code-block                      (CodeBlock root)
 *     [data-code-block-banner]          (language label + wrap/copy actions)
 *     [data-code-block-content]         (source: <pre><code>…</code></pre>)
 *
 * The plugin appends one sibling "view" after those two children, hides the
 * source once a diagram is ready, and keeps the shipped header (copy still
 * copies the source). It never re-renders React-owned children, so streaming
 * increments and React reconciliation keep working.
 *
 * The mermaid library itself ships as the package-local lazy chunk
 * `client.mermaid.js` (a pinned, self-contained build): it is fetched through
 * `require.async` only when the first mermaid fence appears, so app boot stays
 * cheap. Rendering untrusted model output uses mermaid's `strict` security
 * level plus `htmlLabels: false`; the produced SVG is inert.
 *
 * Theme awareness reads the host theme's `color-scheme` and DSH `--dsw-alias-*`
 * tokens at render time, and re-renders every diagram when the theme changes.
 */
window.__ModuleLoader__.load({
  id: '@local/mermaid-render',
  factory(require) {
    'use strict';

    /** Locale namespace owned by this plugin. */
    const NS = 'mermaidRender';
    /** Package-local lazy chunk holding the pinned mermaid build. */
    const MERMAID_CHUNK = './client.mermaid.js';
    /** Attribute name that marks an enhanced block (handy for debugging). */
    const HOST_ATTRIBUTE = 'data-dsh-mermaid-host';
    /** Attribute name that marks the plugin-owned view element. */
    const VIEW_ATTRIBUTE = 'data-dsh-mermaid-view';
    /** Style element identification. */
    const STYLE_ATTRIBUTE = 'data-dsh-mermaid-style';
    const SCAN_DEBOUNCE_MS = 120;
    const RENDER_DEBOUNCE_MS = 160;
    const SCAN_FALLBACK_MS = 4000;
    /** Refuse to lay out oversized model output (mermaid's own cap is 50k chars). */
    const MAX_RENDER_LENGTH = 50000;

    /**
     * Diagram type keywords that may start a fence body. Kept in sync with the
     * detectors registered by the pinned mermaid 12.3.0 build (vendor/); an
     * unknown type is still handled by the error fallback, so a stale list only
     * costs a missing enhancement for a diagram type added in a newer mermaid.
     */
    const DIAGRAM_KEYWORDS = new Set([
      'graph', 'flowchart', 'flowchart-elk', 'sequenceDiagram', 'classDiagram',
      'classDiagram-v2', 'stateDiagram', 'stateDiagram-v2', 'erDiagram',
      'journey', 'gantt', 'pie', 'quadrantChart', 'requirement',
      'requirementDiagram', 'gitGraph', 'C4Context', 'C4Container',
      'C4Component', 'C4Dynamic', 'C4Deployment', 'mindmap', 'timeline',
      'info', 'sankey-beta', 'sankey', 'xychart-beta', 'xychart',
      'block-beta', 'block', 'packet-beta', 'packet', 'architecture-beta',
      'architecture', 'kanban', 'radar-beta', 'radar', 'treemap-beta',
      'treemap', 'eventmodeling', 'ishikawa', 'ishikawa-beta', 'cynefin-beta',
      'venn-beta', 'wardley-beta', 'railroad-beta', 'railroad-ebnf-beta',
      'railroad-abnf-beta', 'railroad-peg-beta', 'usecase-beta',
      'agentflow-beta', 'swimlane-beta', 'treeView-beta',
    ]);

    const zh = {
      'diagram.label': 'Mermaid 图表',
      'diagram.loading': '正在渲染图表…',
      'diagram.error': '无法渲染这个 Mermaid 图表，已显示源码。',
      'diagram.tooLarge': '图表内容过大，已显示源码。',
      'diagram.showSource': '显示源码',
      'diagram.showDiagram': '显示图表',
    };

    const en = {
      'diagram.label': 'Mermaid diagram',
      'diagram.loading': 'Rendering diagram…',
      'diagram.error': 'This Mermaid diagram could not be rendered; showing the source instead.',
      'diagram.tooLarge': 'This diagram is too large to render; showing the source instead.',
      'diagram.showSource': 'Show source',
      'diagram.showDiagram': 'Show diagram',
    };

    /**
     * The catalog of CSS the plugin injects once per activation. Only theme
     * tokens are used for colors, so the view follows light/dark themes.
     */
    const CSS = `
      .dsh-mermaid-view {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .dsh-mermaid-view[hidden] { display: none; }
      .dsh-mermaid-diagram {
        padding: 12px;
        overflow-x: auto;
        overflow-y: auto;
        max-height: 72vh;
        scrollbar-width: thin;
        background: transparent;
      }
      .dsh-mermaid-diagram[hidden] { display: none; }
      .dsh-mermaid-svg { display: block; }
      .dsh-mermaid-svg svg {
        display: block;
        flex: none;
        max-width: none;
        height: auto;
        background: transparent;
        margin: 0 auto;
      }
      .dsh-mermaid-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 26px;
        padding: 2px 8px 3px;
        border-top: 1px dashed var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.2));
      }
      .dsh-mermaid-badge {
        font-size: 11px;
        line-height: 16px;
        font-weight: 500;
        letter-spacing: 0.02em;
        color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, #8a8f98));
        user-select: none;
      }
      .dsh-mermaid-note {
        flex: 1 1 auto;
        min-width: 0;
        font-size: 12px;
        line-height: 18px;
        color: var(--dsw-alias-label-secondary, #5c6370);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-mermaid-note[hidden] { display: none; }
      .dsh-mermaid-error { color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-secondary, #c0392b)); }
      .dsh-mermaid-toggle {
        appearance: none;
        flex: none;
        margin-left: auto;
        padding: 0 6px;
        border: 0;
        border-radius: var(--dsw-radius-sm, 6px);
        background: transparent;
        color: var(--dsw-alias-label-secondary, #5c6370);
        font: inherit;
        font-size: 12px;
        line-height: 20px;
        cursor: pointer;
      }
      .dsh-mermaid-toggle:hover {
        background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
        color: var(--dsw-alias-label-primary, #0f1115);
      }
      .dsh-mermaid-toggle:focus-visible {
        outline: var(--dsh-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4176e6));
        outline-offset: 1px;
      }
    `;

    /** A constant identity for the empty-string "stale render" marker. */
    const STALE = Symbol('stale');

    /**
     * Extract the fence source from the shipped code-block content element.
     * @param {Element | null} contentElement - `[data-code-block-content]`.
     * @returns {string} the fence body as rendered (trailing newline trimmed).
     */
    function sourceOf(contentElement) {
      if (contentElement === null) return '';
      const pre = contentElement.querySelector('pre');
      const text = pre === null ? '' : pre.textContent ?? '';
      return text.endsWith('\n') ? text.slice(0, -1) : text;
    }

    /**
     * Derive the text that is actually rendered. Leading configuration is
     * untrusted model output: mermaid directives (`%%{init: …}%%`, YAML
     * frontmatter `config:`) can override non-secure config keys such as
     * `htmlLabels` or `themeCSS` even under `securityLevel: 'strict'`, so the
     * renderer strips directives/frontmatter and relies on the extended
     * `secure` config list as a second layer. The displayed/copied source keeps
     * the authored text unchanged.
     * @param {string} source - the authored fence body.
     * @returns {string} the sanitized text handed to mermaid.
     */
    function renderSourceOf(source) {
      let text = source.replace(/^\uFEFF/u, '').replace(/%%\{[\s\S]*?\}%%/gu, '');
      const lines = text.split('\n');
      let first = 0;
      while (first < lines.length && lines[first].trim() === '') first += 1;
      if (lines[first] !== undefined && lines[first].trim() === '---') {
        let close = first + 1;
        while (close < lines.length && lines[close].trim() !== '---') close += 1;
        if (close < lines.length) {
          lines.splice(first, close - first + 1);
          text = lines.join('\n');
        }
      }
      return text;
    }

    /**
     * Whether a fence body starts with a mermaid diagram type. The shipped
     * code-card does not expose the fence info string for unsupported languages
     * (mermaid renders the generic "Code block" label), so detection is by
     * content: skip leading blank lines, `%%` comments/directives and an
     * optional `---` configuration front matter, then match the first word.
     * @param {string} source - the fence body.
     * @returns {boolean}
     */
    function looksLikeMermaid(source) {
      const lines = source.replace(/^\uFEFF/u, '').replace(/%%\{[\s\S]*?\}%%/gu, '').split('\n');
      let first = 0;
      const skipNoise = () => {
        while (first < lines.length && (lines[first].trim() === '' || lines[first].trimStart().startsWith('%%'))) first += 1;
      };
      skipNoise();
      if (lines[first] !== undefined && lines[first].trim() === '---') {
        let close = first + 1;
        while (close < lines.length && lines[close].trim() !== '---') close += 1;
        if (close < lines.length) {
          first = close + 1;
          skipNoise();
        }
      }
      const match = /^([A-Za-z][A-Za-z0-9_-]*)/u.exec((lines[first] ?? '').trimStart());
      return match !== null && DIAGRAM_KEYWORDS.has(match[1]);
    }

    /**
     * Create the per-activation diagram enhancer.
     * @param {{ locale: object }} ctx - the Client plugin context (needs locale).
     * @param {{ async: (specifier: string) => Promise<unknown> }} moduleRequire - the factory's `require`.
     * @returns {{ start: () => () => void }} lifecycle hooks.
     */
    function createEnhancer(ctx, moduleRequire) {
      /** @type {Map<Element, object>} */
      const records = new Map();
      let disposed = false;
      let styleElement = null;
      let scanObserver = null;
      let documentObserver = null;
      let mediaQuery = null;
      let mediaListener = null;
      let scanTimer = 0;
      let fallbackTimer = 0;
      let nextRenderId = 0;
      let mermaidPromise = null;
      let mermaidConfigKey = '';
      let themeSignature = '';
      let renderChain = Promise.resolve();
      let warned = false;
      /** Blocks whose content changed since the previous scan. */
      let dirtyBlocks = new Set();
      /** Whether a theme-relevant mutation happened since the previous scan. */
      let themeDirty = false;
      const colorCache = { canvas: null };
      let translate = () => '';

      /** @param {string} key @param {object} [params] @returns {string} */
      function t(key, params) {
        try {
          return translate(key, params);
        } catch {
          return key;
        }
      }

      /** @returns {boolean} whether the host theme is dark right now. */
      function isDarkTheme() {
        const root = document.documentElement;
        const body = document.body;
        const signals = [
          root.getAttribute('data-theme'), root.getAttribute('data-ds-theme'),
          root.getAttribute('data-color-scheme'), root.getAttribute('data-ds-theme-source'),
          body === null ? null : body.getAttribute('data-theme'),
          body === null ? null : body.getAttribute('data-color-scheme'),
        ];
        for (const value of signals) {
          if (typeof value !== 'string') continue;
          const lower = value.toLowerCase();
          if (lower.includes('dark')) return true;
          if (lower.includes('light')) return false;
        }
        if (root.classList.contains('dark') || root.classList.contains('vscode-dark')) return true;
        if (root.classList.contains('light')) return false;
        if (body !== null) {
          if (body.classList.contains('dark')) return true;
          if (body.classList.contains('light')) return false;
        }
        if (body !== null && body.hasAttribute('data-ds-dark-theme')) return true;
        const scheme = `${getComputedStyle(root).colorScheme} ${body === null ? '' : getComputedStyle(body).colorScheme}`;
        if (scheme.includes('dark')) return true;
        if (scheme.includes('light')) return false;
        const background = body === null ? '' : getComputedStyle(body).backgroundColor;
        const rgba = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)[,\s]+([\d.]+)/u.exec(background);
        const rgbOnly = rgba ?? /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/u.exec(background);
        if (rgbOnly !== null) {
          const alpha = rgba === null ? 1 : Number(rgba[4]);
          if (alpha > 0.5) {
            const luminance = 0.2126 * Number(rgbOnly[1]) + 0.7152 * Number(rgbOnly[2]) + 0.0722 * Number(rgbOnly[3]);
            return luminance < 128;
          }
        }
        return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
      }

      /** @param {string} name @returns {string} raw custom-property text. */
      function tokenValue(name) {
        const target = document.body ?? document.documentElement;
        return getComputedStyle(target).getPropertyValue(name).trim();
      }

      /**
       * Normalize any CSS color (hex, rgb, oklch, …) to an `rgb()` string that
       * mermaid's color helpers can parse. Canvas serializes color4 formats.
       * @param {string} value - raw token value.
       * @returns {string | undefined}
       */
      function normalizeColor(value) {
        if (typeof value !== 'string' || value === '') return undefined;
        const raw = value.trim();
        if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu.test(raw)) return raw;
        if (/^rgba?\(/iu.test(raw)) return raw;
        try {
          if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && !CSS.supports('color', raw)) return undefined;
          if (colorCache.canvas === null) colorCache.canvas = document.createElement('canvas');
          const canvas = colorCache.canvas;
          canvas.width = 1;
          canvas.height = 1;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (context === null) return raw;
          context.clearRect(0, 0, 1, 1);
          // Canvas ignores an unparseable fillStyle, so initialize it with a
          // sentinel and treat that sentinel as "unparseable".
          context.fillStyle = '#010203';
          context.fillStyle = raw;
          context.fillRect(0, 0, 1, 1);
          const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
          if (a === 0 || (r === 1 && g === 2 && b === 3)) return undefined;
          return `rgb(${r}, ${g}, ${b})`;
        } catch {
          return raw;
        }
      }

      /** @param {string[]} names @returns {string | undefined} first resolvable color. */
      function pickColor(names) {
        for (const name of names) {
          const value = normalizeColor(tokenValue(name));
          if (value !== undefined) return value;
        }
        return undefined;
      }

      /** @param {string} color @returns {number[] | undefined} rgb channels. */
      function rgbOf(color) {
        const match = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/u.exec(color);
        if (match !== null) return [Number(match[1]), Number(match[2]), Number(match[3])];
        const hex = /^#([\da-f]{3}|[\da-f]{6})$/iu.exec(color);
        if (hex !== null) {
          const value = hex[1].length === 3 ? hex[1].replace(/./gu, (part) => part + part) : hex[1];
          return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
        }
        return undefined;
      }

      /**
       * Blend one color toward another; keeps diagrams readable when the host
       * background and surface tokens are close to each other.
       * @param {string | undefined} base - a normalized color.
       * @param {string | undefined} accent - a normalized color.
       * @param {number} weight - accent share, 0..1.
       * @returns {string | undefined}
       */
      function mixColor(base, accent, weight) {
        const a = base === undefined ? undefined : rgbOf(base);
        const b = accent === undefined ? undefined : rgbOf(accent);
        if (a === undefined) return accent;
        if (b === undefined) return base;
        const mixed = a.map((channel, index) => Math.round(channel * (1 - weight) + b[index] * weight));
        return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
      }

      /** @returns {string} the host body font family, or a safe fallback. */
      function bodyFontFamily() {
        try {
          const family = getComputedStyle(document.body ?? document.documentElement).fontFamily;
          return typeof family === 'string' && family !== '' ? family : 'system-ui, sans-serif';
        } catch {
          return 'system-ui, sans-serif';
        }
      }

      /** @returns {string} the host content font size (e.g. "14px"). */
      function bodyFontSize() {
        const size = tokenValue('--dsh-content-font-size');
        return /^\d+(?:\.\d+)?px$/u.test(size) ? size : '14px';
      }

      /** @returns {string} one signature for every theme input used when rendering. */
      function paletteSignature() {
        const tokens = [
          '--dsw-alias-bg-layer-1', '--dsw-alias-label-primary',
          '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary',
          '--dsw-alias-border-l1', '--dsw-alias-border-l2',
          '--dsw-alias-state-business-primary', '--dsw-alias-label-link',
          '--dsh-content-font-size',
        ];
        return [
          isDarkTheme() ? 'dark' : 'light',
          bodyFontFamily(),
          ...tokens.map(tokenValue),
        ].join('|');
      }

      /**
       * Build the mermaid theme variables from DSH tokens so diagrams sit in
       * the host palette in both themes.
       * @returns {object}
       */
      function themeVariables() {
        const background = pickColor(['--dsw-alias-bg-layer-1']) ?? (isDarkTheme() ? '#17181b' : '#ffffff');
        const main = pickColor(['--dsw-alias-label-primary']) ?? (isDarkTheme() ? '#e8eaf0' : '#0f1115');
        const secondary = pickColor(['--dsw-alias-label-secondary', '--dsw-alias-label-primary']) ?? (isDarkTheme() ? '#a3a9b3' : '#5c6370');
        const stroke = pickColor(['--dsw-alias-label-tertiary', '--dsw-alias-label-secondary']) ?? (isDarkTheme() ? '#adb2b8' : '#81858c');
        const border = pickColor(['--dsw-alias-border-l2', '--dsw-alias-border-l1']) ?? 'rgba(127,127,127,0.25)';
        const borderSoft = pickColor(['--dsw-alias-border-l1', '--dsw-alias-border-l2']) ?? 'rgba(127,127,127,0.12)';
        const brand = pickColor(['--dsw-alias-state-business-primary', '--dsw-alias-label-link']) ?? '#4176e6';
        const layer = mixColor(background, brand, isDarkTheme() ? 0.16 : 0.07);
        const layerStrong = mixColor(background, brand, isDarkTheme() ? 0.28 : 0.13);
        const surfaceAlt = mixColor(background, main, 0.04);
        const fontFamily = bodyFontFamily();
        const fontSize = bodyFontSize();
        const pieAccents = () => {
          // Distinct hues, softened toward the host surface so the pie palette
          // stays legible in both themes without hardcoding per-theme colors.
          const hues = ['#5ad8a6', '#f6bd16', '#e8684a', '#6dc8ec', '#9270ca', '#ff9d4d', '#269a99', '#ff99c3', '#a0d911', '#5b8ff9', '#d3adf7'];
          const weight = isDarkTheme() ? 0.35 : 0.2;
          return hues.map((hue) => mixColor(hue, background, weight) ?? hue);
        };
        return {
          fontFamily,
          fontSize,
          background,
          textColor: main,
          titleColor: main,
          primaryColor: layer,
          primaryTextColor: main,
          primaryBorderColor: stroke,
          secondaryColor: layerStrong ?? layer,
          secondaryTextColor: main,
          secondaryBorderColor: stroke,
          tertiaryColor: surfaceAlt ?? background,
          tertiaryTextColor: main,
          tertiaryBorderColor: borderSoft,
          lineColor: secondary,
          defaultLinkColor: brand,
          mainBkg: layer,
          nodeBorder: stroke,
          nodeTextColor: main,
          clusterBkg: background,
          clusterBorder: border,
          edgeLabelBackground: layer,
          labelBackground: layer,
          labelColor: main,
          labelBoxBkgColor: layer,
          labelBoxBorderColor: stroke,
          labelTextColor: main,
          actorBkg: layer,
          actorBorder: brand,
          actorTextColor: main,
          actorLineColor: secondary,
          signalColor: secondary,
          signalTextColor: main,
          loopTextColor: secondary,
          noteBkgColor: background,
          noteTextColor: main,
          noteBorderColor: stroke,
          activationBkgColor: layer,
          activationBorderColor: border,
          sequenceNumberColor: background,
          sectionBkgColor: background,
          altSectionBkgColor: layerStrong ?? layer,
          sectionBkgColor2: layer,
          gridColor: borderSoft,
          taskBkgColor: layer,
          taskTextColor: main,
          taskBorderColor: stroke,
          taskTextOutsideColor: secondary,
          activeTaskBkgColor: layerStrong ?? layer,
          activeTaskBorderColor: brand,
          doneTaskBkgColor: layer,
          doneTaskBorderColor: stroke,
          critBkgColor: layer,
          critBorderColor: brand,
          todayLineColor: brand,
          pie1: brand,
          ...pieAccents().reduce((palette, color, index) => {
            palette[`pie${index + 2}`] = color;
            return palette;
          }, {}),
        };
      }

      /**
       * Configure mermaid lazily, once per theme/font generation.
       * @param {object} mermaid - the mermaid API object.
       */
      function configureMermaid(mermaid) {
        const key = paletteSignature();
        if (key === mermaidConfigKey) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          secure: [
            'secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges',
            'suppressErrorRendering', 'themeCSS', 'htmlLabels', 'themeVariables',
            'theme', 'fontFamily', 'layout', 'look', 'darkMode',
          ],
          theme: 'base',
          look: 'classic',
          darkMode: isDarkTheme(),
          themeVariables: themeVariables(),
          fontFamily: bodyFontFamily(),
          fontSize: bodyFontSize(),
          htmlLabels: false,
          flowchart: { useMaxWidth: false, curve: 'basis' },
          sequence: { useMaxWidth: false },
          gantt: { useMaxWidth: false },
          er: { useMaxWidth: false },
          class: { useMaxWidth: false },
          state: { useMaxWidth: false },
          journey: { useMaxWidth: false },
          gitGraph: { useMaxWidth: false },
          pie: { useMaxWidth: false },
          quadrantChart: { useMaxWidth: false },
          requirement: { useMaxWidth: false },
          mindmap: { useMaxWidth: false },
          timeline: { useMaxWidth: false },
          sankey: { useMaxWidth: false },
          xyChart: { useMaxWidth: false },
          block: { useMaxWidth: false },
          packet: { useMaxWidth: false },
          architecture: { useMaxWidth: false },
          kanban: { useMaxWidth: false },
          radar: { useMaxWidth: false },
          treemap: { useMaxWidth: false },
          maxTextSize: 50000,
          maxEdges: 500,
          logLevel: 'fatal',
        });
        mermaidConfigKey = key;
      }

      /**
       * Load the pinned mermaid build from the package-local lazy chunk once.
       * @returns {Promise<object>} the mermaid API object.
       */
      function loadMermaid() {
        if (mermaidPromise === null) {
          mermaidPromise = Promise.resolve()
            .then(() => moduleRequire.async(MERMAID_CHUNK))
            .then((exports) => {
              const candidate = exports !== null && typeof exports === 'object' && typeof exports.render === 'function'
                ? exports
                : exports !== null && typeof exports === 'object' && exports.default !== null && typeof exports.default === 'object' && typeof exports.default.render === 'function'
                  ? exports.default
                  : null;
              if (candidate === null) throw new Error('the mermaid chunk did not export the mermaid API');
              return candidate;
            })
            .catch((error) => {
              mermaidPromise = null;
              throw error;
            });
        }
        return mermaidPromise;
      }

      /** Serialize mermaid render calls; the library keeps shared parser state. */
      function withMermaidLock(task) {
        const run = renderChain.then(task, task);
        renderChain = run.then(() => undefined, () => undefined);
        return run;
      }

      /** @param {string} renderId @returns {void} */
      function removeMermaidArtifacts(renderId) {
        for (const id of [renderId, `d${renderId}`, `dmermaid-${renderId}`]) {
          const element = document.getElementById(id);
          if (element !== null && element.closest(`[${VIEW_ATTRIBUTE}]`) === null) element.remove();
        }
      }

      /** @param {unknown} error @returns {void} */
      function warnOnce(error) {
        if (warned) return;
        warned = true;
        try {
          console.warn('[mermaid-render] diagram rendering failed', error);
        } catch {
          /* console unavailable */
        }
      }

      /** @param {object} record @param {number} generation @returns {boolean} */
      function isStale(record, generation) {
        return disposed
          || generation !== record.generation
          || !record.block.isConnected
          || record.contentElement === null;
      }

      /** @param {object} record @returns {void} */
      function syncToggle(record) {
        const ready = record.state === 'ready';
        const showSource = ready && record.showSource === true;
        if (ready) record.contentElement.style.display = showSource ? '' : 'none';
        record.diagram.hidden = !ready || showSource;
        record.toggle.hidden = !ready;
        if (ready) {
          record.toggle.textContent = showSource ? t('diagram.showDiagram') : t('diagram.showSource');
          record.toggle.setAttribute('aria-pressed', showSource ? 'true' : 'false');
        }
        record.view.hidden = false;
      }

      /** @param {object} record @returns {void} */
      function showError(record, code) {
        record.state = 'error';
        record.errorCode = code;
        record.diagram.hidden = true;
        record.note.hidden = false;
        record.note.textContent = code === 'tooLarge' ? t('diagram.tooLarge') : t('diagram.error');
        record.toggle.hidden = true;
        record.view.hidden = false;
        record.contentElement.style.display = '';
      }

      /** @param {object} record @param {string} svg @returns {void} */
      function mountSvg(record, svg) {
        let holder = record.diagram.querySelector('.dsh-mermaid-svg');
        if (holder === null) {
          record.diagram.replaceChildren();
          holder = document.createElement('div');
          holder.className = 'dsh-mermaid-svg';
          record.diagram.appendChild(holder);
        }
        // Mermaid with securityLevel "strict" sanitizes labels and builds a
        // static SVG; assigning its serialized output is the documented path.
        holder.innerHTML = svg;
      }

      /**
       * Render (or re-render) one enhanced block.
       * @param {object} record - the block record.
       * @returns {Promise<void>}
       */
      async function renderRecord(record) {
        if (disposed || !record.block.isConnected || record.contentElement === null) return;
        const source = record.source;
        if (source.trim() === '') {
          record.generation += 1;
          record.state = 'idle';
          record.errorCode = undefined;
          record.diagram.replaceChildren();
          record.diagram.hidden = true;
          record.view.hidden = true;
          record.note.hidden = true;
          record.toggle.hidden = true;
          record.contentElement.style.display = '';
          return;
        }
        const generation = record.generation + 1;
        record.generation = generation;
        const firstRender = record.state !== 'ready';
        if (firstRender) {
          record.diagram.hidden = false;
          record.diagram.replaceChildren();
          const loading = document.createElement('div');
          loading.className = 'dsh-mermaid-note';
          loading.textContent = t('diagram.loading');
          record.diagram.appendChild(loading);
          record.view.hidden = false;
        }
        let mermaid;
        try {
          mermaid = await loadMermaid();
        } catch (error) {
          if (isStale(record, generation)) return;
          // The lazy chunk is the only retryable failure: retry with backoff.
          if (record.attempts < 3) {
            record.attempts += 1;
            scheduleRender(record, 1500 * record.attempts);
          }
          warnOnce(error);
          showError(record);
          return;
        }
        if (isStale(record, generation)) return;
        try {
          const renderedSource = renderSourceOf(source);
          if (renderedSource.trim() === '') throw new Error('empty diagram source');
          if (renderedSource.length > MAX_RENDER_LENGTH) {
            const tooLarge = new Error('diagram source exceeds the render limit');
            tooLarge.mermaidRenderCode = 'tooLarge';
            throw tooLarge;
          }
          const svg = await withMermaidLock(async () => {
            if (isStale(record, generation)) throw STALE;
            configureMermaid(mermaid);
            const renderId = `dsh-mermaid-${++nextRenderId}`;
            try {
              const result = await mermaid.render(renderId, renderedSource);
              return result !== null && typeof result === 'object' && typeof result.svg === 'string' ? result.svg : '';
            } finally {
              removeMermaidArtifacts(renderId);
            }
          });
          if (svg === STALE || isStale(record, generation) || record.source !== source) return;
          if (svg.trim() === '') throw new Error('mermaid produced an empty SVG');
          mountSvg(record, svg);
          record.state = 'ready';
          record.attempts = 0;
          record.errorCode = undefined;
          record.note.hidden = true;
          record.note.textContent = '';
          syncToggle(record);
        } catch (error) {
          if (error === STALE || isStale(record, generation)) return;
          warnOnce(error);
          showError(record, error !== null && typeof error === 'object' ? error.mermaidRenderCode : undefined);
        }
      }

      /**
       * Debounce one record's render; a newer schedule supersedes the old one.
       * @param {object} record - the block record.
       * @param {number} delay - delay in milliseconds.
       * @returns {void}
       */
      function scheduleRender(record, delay) {
        if (record.timer !== 0) {
          clearTimeout(record.timer);
          record.timer = 0;
        }
        record.timer = window.setTimeout(() => {
          record.timer = 0;
          void renderRecord(record);
        }, delay);
      }

      /**
       * Create and attach the plugin-owned view for one code block.
       * @param {Element} block - the `.md-code-block` element.
       * @param {Element} contentElement - its `[data-code-block-content]`.
       * @returns {object} the record.
       */
      function createRecord(block, contentElement) {
        const view = document.createElement('div');
        view.className = 'dsh-mermaid-view';
        view.setAttribute(VIEW_ATTRIBUTE, '');
        view.setAttribute('role', 'figure');
        view.setAttribute('aria-label', t('diagram.label'));
        view.hidden = true;

        const diagram = document.createElement('div');
        diagram.className = 'dsh-mermaid-diagram';
        diagram.hidden = true;

        const bar = document.createElement('div');
        bar.className = 'dsh-mermaid-bar';
        const badge = document.createElement('span');
        badge.className = 'dsh-mermaid-badge';
        badge.textContent = 'Mermaid';
        const note = document.createElement('span');
        note.className = 'dsh-mermaid-note dsh-mermaid-error';
        note.setAttribute('role', 'alert');
        note.hidden = true;
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'dsh-mermaid-toggle';
        toggle.setAttribute('aria-pressed', 'false');
        toggle.textContent = t('diagram.showSource');
        bar.append(badge, note, toggle);
        view.append(diagram, bar);
        block.setAttribute(HOST_ATTRIBUTE, '');
        block.appendChild(view);

        /** @type {object} */
        const record = {
          block,
          contentElement,
          view,
          diagram,
          note,
          toggle,
          source: sourceOf(contentElement),
          pendingSource: false,
          state: 'idle',
          showSource: false,
          errorCode: undefined,
          attempts: 0,
          generation: 0,
          timer: 0,
        };
        toggle.addEventListener('click', () => {
          if (record.state !== 'ready') return;
          record.showSource = record.showSource !== true;
          syncToggle(record);
        });
        return record;
      }

      /** @param {object} record @returns {void} */
      function disposeRecord(record) {
        if (record.timer !== 0) {
          clearTimeout(record.timer);
          record.timer = 0;
        }
        record.generation += 1;
        if (record.view.parentNode !== null) record.view.remove();
        if (record.block.isConnected) {
          record.block.removeAttribute(HOST_ATTRIBUTE);
          try {
            record.contentElement.style.display = '';
            record.contentElement.style.removeProperty('display');
          } catch {
            /* detached */
          }
        }
      }

      /**
       * Reconcile records with the DOM: attach new mermaid blocks, re-render
       * edited ones, and drop detached ones. Streaming blocks are skipped until
       * their message settles so partial diagrams never flash.
       * @returns {void}
       */
      function scan() {
        if (disposed || document.body === null) return;
        const blocks = document.querySelectorAll('.md-code-block');
        const seen = new Set();
        for (const block of blocks) {
          if (!(block instanceof Element)) continue;
          const existing = records.get(block);
          if (existing !== undefined) {
            if (!block.isConnected) continue;
            seen.add(block);
            if (!dirtyBlocks.has(block)) continue;
            const contentElement = block.querySelector('[data-code-block-content]');
            if (contentElement === null) continue;
            if (contentElement !== existing.contentElement) {
              existing.contentElement = contentElement;
              existing.contentElement.style.display = existing.state === 'ready' && existing.showSource !== true ? 'none' : '';
            }
            const source = sourceOf(contentElement);
            if (source === existing.source) continue;
            existing.source = source;
            if (existing.state === 'error') existing.state = 'idle';
            if (block.closest('[data-streaming]') === null) scheduleRender(existing, RENDER_DEBOUNCE_MS);
            else existing.pendingSource = true;
            continue;
          }
          if (block.closest('[data-streaming]') !== null) continue;
          const contentElement = block.querySelector('[data-code-block-content]');
          if (contentElement === null) continue;
          const source = sourceOf(contentElement);
          if (!looksLikeMermaid(source)) continue;
          const record = createRecord(block, contentElement);
          records.set(block, record);
          seen.add(block);
          scheduleRender(record, 0);
        }
        dirtyBlocks.clear();
        for (const [block, record] of records) {
          if (!seen.has(block) || !block.isConnected) {
            disposeRecord(record);
            records.delete(block);
          } else if (record.pendingSource && block.closest('[data-streaming]') === null) {
            record.pendingSource = false;
            scheduleRender(record, RENDER_DEBOUNCE_MS);
          }
        }
        handleThemeChange();
      }

      /**
       * Mark the code block containing a node for a source re-read.
       * @param {Node | null} node - an added/mutated node.
       * @returns {void}
       */
      function markBlockDirty(node) {
        if (node === null) return;
        const element = node instanceof Element ? node : node.parentElement;
        if (element === null || typeof element.closest !== 'function') return;
        const block = element.closest('.md-code-block');
        if (block !== null) dirtyBlocks.add(block);
      }

      /** @returns {void} */
      function scheduleScan() {
        if (disposed) return;
        if (scanTimer !== 0) return;
        scanTimer = window.setTimeout(() => {
          scanTimer = 0;
          scan();
        }, SCAN_DEBOUNCE_MS);
      }

      /** Re-render diagrams when the host theme tokens or color scheme change. @returns {void} */
      function handleThemeChange() {
        if (disposed || !themeDirty) return;
        themeDirty = false;
        const signature = paletteSignature();
        if (signature === themeSignature) return;
        themeSignature = signature;
        for (const record of records.values()) {
          if (record.state === 'ready' || record.state === 'error') scheduleRender(record, 0);
        }
      }

      /** @returns {void} */
      function start() {
        translate = ctx.locale.bind(NS);
        styleElement = document.createElement('style');
        styleElement.setAttribute(STYLE_ATTRIBUTE, '');
        styleElement.textContent = CSS;
        document.head.appendChild(styleElement);

        scanObserver = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            const target = mutation.target;
            const element = target instanceof Element ? target : target.parentElement;
            if (element !== null && element.closest(`[${VIEW_ATTRIBUTE}]`) !== null) continue;
            if (mutation.type === 'attributes' && mutation.attributeName === 'data-ds-dark-theme' && target === document.body) themeDirty = true;
            if (mutation.type === 'childList') {
              for (const node of mutation.addedNodes) markBlockDirty(node);
            }
            markBlockDirty(element);
            scheduleScan();
          }
        });
        if (document.body !== null) {
          scanObserver.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'data-streaming', 'data-code-wrap', 'data-code-block-content', 'data-ds-dark-theme'],
          });
        }
        documentObserver = new MutationObserver(() => {
          themeDirty = true;
          scheduleScan();
        });
        documentObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class', 'style', 'data-theme', 'data-ds-theme', 'data-ds-theme-source', 'data-color-scheme', 'lang'],
        });
        if (typeof matchMedia === 'function') {
          mediaQuery = matchMedia('(prefers-color-scheme: dark)');
          mediaListener = () => {
            themeDirty = true;
            scheduleScan();
          };
          if (typeof mediaQuery.addEventListener === 'function') mediaQuery.addEventListener('change', mediaListener);
          else if (typeof mediaQuery.addListener === 'function') mediaQuery.addListener(mediaListener);
        }
        themeSignature = paletteSignature();
        themeDirty = false;
        const localeDispose = typeof ctx.locale.subscribe === 'function'
          ? ctx.locale.subscribe(() => {
            translate = ctx.locale.bind(NS);
            for (const record of records.values()) {
              record.view.setAttribute('aria-label', t('diagram.label'));
              if (record.state === 'ready') syncToggle(record);
              else if (record.state === 'error') record.note.textContent = record.errorCode === 'tooLarge' ? t('diagram.tooLarge') : t('diagram.error');
            }
          })
          : () => {};
        // Low-frequency safety net for signals the observers cannot see (e.g. a
        // token value changing without an attribute mutation on body/html).
        fallbackTimer = window.setInterval(() => {
          if (disposed) return;
          if (records.size === 0 && document.querySelector('.md-code-block') === null) return;
          themeDirty = true;
          scheduleScan();
        }, SCAN_FALLBACK_MS);
        scan();
        return () => {
          if (typeof localeDispose === 'function') localeDispose();
          fallbackTimer = window.clearInterval(fallbackTimer);
          if (mediaQuery !== null && mediaListener !== null) {
            if (typeof mediaQuery.removeEventListener === 'function') mediaQuery.removeEventListener('change', mediaListener);
            else if (typeof mediaQuery.removeListener === 'function') mediaQuery.removeListener(mediaListener);
          }
          mediaQuery = null;
          mediaListener = null;
          if (scanObserver !== null) scanObserver.disconnect();
          scanObserver = null;
          if (documentObserver !== null) documentObserver.disconnect();
          documentObserver = null;
          if (scanTimer !== 0) {
            clearTimeout(scanTimer);
            scanTimer = 0;
          }
          for (const record of records.values()) disposeRecord(record);
          records.clear();
          if (styleElement !== null && styleElement.parentNode !== null) styleElement.remove();
          styleElement = null;
        };
      }

      return {
        /**
         * Activate the enhancer; returned disposer restores the untouched DOM.
         * @returns {() => void}
         */
        start() {
          const dispose = start();
          return () => {
            if (disposed) return;
            disposed = true;
            dispose();
          };
        },
      };
    }

    return {
      inject: ['locale'],
      /**
       * Activate the browser half.
       * @param {object} ctx - Client plugin context.
       * @returns {void}
       */
      apply(ctx) {
        if (typeof document === 'undefined') return;
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mermaid-render: dictionaries');
        const enhancer = createEnhancer(ctx, require);
        ctx.effect(() => enhancer.start(), 'mermaid-render: diagram rendering');
      },
    };
  },
});
