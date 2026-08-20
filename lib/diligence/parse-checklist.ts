/**
 * Parse a free-form checklist (pasted text or stored template) into a flat
 * sequence of sections and items.
 *
 * Heuristic:
 *  - A line is a SECTION header when it is short (≤ 7 words), title-cased,
 *    has no sentence punctuation, and contains no colon.
 *  - Everything else is an item belonging to the most recent section.
 *  - Items appearing before any section land in an implicit "General" section.
 *
 * Returns entries in the order they should be displayed/inserted. Each item
 * carries the label of its parent section so the caller can resolve parent_id
 * after the section row is inserted.
 */

export type ParsedEntry =
  | { kind: 'section'; label: string }
  | { kind: 'item'; label: string; sectionLabel: string }

const TRAILING_PUNCT = /[.?!:;,]\s*$/
const TITLE_WORD = /^[A-Z0-9&]/

function looksLikeSection(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (TRAILING_PUNCT.test(trimmed)) return false
  if (trimmed.includes(':')) return false
  if (trimmed.includes('?')) return false

  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 7) return false

  // First character must be upper-case/alphanumeric — rules out items that
  // start with a quote, parenthesis, or lowercase descriptor.
  if (!TITLE_WORD.test(trimmed)) return false

  // At least two-thirds of words should start with a capital. Items like
  // "Market trends" (1 of 2 capital) → item; "Business Summary" → section.
  const capitalised = words.filter(w => /^[A-Z0-9&]/.test(w)).length
  return capitalised / words.length >= 0.6
}

export function parseChecklistText(text: string): ParsedEntry[] {
  const entries: ParsedEntry[] = []
  const lines = text.split(/\r?\n/)
  let currentSection: string | null = null

  for (const raw of lines) {
    const line = raw.replace(/^[\s\-*•◦○·]+/, '').trim()
    if (!line) continue

    if (looksLikeSection(line)) {
      currentSection = line
      entries.push({ kind: 'section', label: line })
      continue
    }

    if (!currentSection) {
      currentSection = 'General'
      entries.push({ kind: 'section', label: 'General' })
    }
    entries.push({ kind: 'item', label: line, sectionLabel: currentSection })
  }

  return entries
}
