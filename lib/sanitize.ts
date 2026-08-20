/**
 * Minimal, dependency-free HTML hardening for GP-authored letter fragments that
 * are rendered into LP browsers via dangerouslySetInnerHTML.
 *
 * This is NOT a general-purpose sanitizer. The portfolio-table HTML it guards is
 * server-generated (and already entity-escapes DB strings at generation time),
 * so the realistic threat is a stored `<script>`/event-handler injected via a
 * direct Data API write by an insider. This strips those high-risk vectors as
 * defense-in-depth. For arbitrary untrusted rich HTML, use a real allowlist
 * sanitizer (e.g. isomorphic-dompurify) instead.
 */
export function sanitizeBasicHtml(html: string | null | undefined): string | null {
  if (!html) return html ?? null
  return html
    // Drop dangerous elements together with their content.
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|svg|math)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    // Drop self-closing / unclosed dangerous tags.
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|svg|math)\b[^>]*\/?>/gi, '')
    // Strip inline event-handler attributes (onclick, onerror, onload, …).
    // The leading [\s/] matches both whitespace and the `/` attribute separator
    // (e.g. `<img src=x/onerror=…>`), which a bare `\s` would miss.
    .replace(/[\s/]on\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/[\s/]on\w+\s*=\s*'[^']*'/gi, '')
    .replace(/[\s/]on\w+\s*=\s*[^\s>]+/gi, '')
    // Neutralize javascript:/vbscript:/data: URIs in href/src-style attributes.
    .replace(/(href|src|xlink:href)\s*=\s*"(?:\s*(?:javascript|vbscript|data)\s*:)[^"]*"/gi, '$1="#"')
    .replace(/(href|src|xlink:href)\s*=\s*'(?:\s*(?:javascript|vbscript|data)\s*:)[^']*'/gi, "$1='#'")
}
