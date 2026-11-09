/**
 * Host half of the `@local/mermaid-render` bundle.
 *
 * Intentionally inert: diagram rendering is a pure browser-side enhancement of
 * the code blocks the shipped Chat Markdown renderer already produced. The
 * Loader row still needs a valid Host plugin, and the same package declares the
 * `./client` browser module plus its lazy `client.mermaid.js` chunk.
 */
export function apply() {}
