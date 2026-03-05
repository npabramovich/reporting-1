/**
 * Lightweight HTML sanitizer that strips dangerous tags and event handler attributes.
 * Used to sanitize user-provided body_html before storage and sending.
 */
export function sanitizeHtml(html: string): string {
  // Remove dangerous tags (script, iframe, object, embed, form) and their content
  let sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
  sanitized = sanitized.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
  sanitized = sanitized.replace(/<embed\b[^>]*\/?>/gi, '')
  sanitized = sanitized.replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '')

  // Remove self-closing / unclosed variants of the above
  sanitized = sanitized.replace(/<\/?(script|iframe|object|embed|form)\b[^>]*>/gi, '')

  // Remove event handler attributes (on*)
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')

  return sanitized
}
