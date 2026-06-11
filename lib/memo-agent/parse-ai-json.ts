/**
 * Tolerant JSON extractor for AI responses.
 *
 * Models routinely wrap their JSON output in a code fence, prefix it with
 * commentary ("Here's the analysis:\n{...}"), or trail it with a sign-off.
 * Direct `JSON.parse` over the raw text fails in all of those cases. This
 * helper:
 *
 *   1. Strips a leading ```json / ``` fence if present
 *   2. Tries direct JSON.parse
 *   3. Falls back to slicing from the first `{` to its matching close brace
 *      (respecting strings and escape sequences) and parsing that
 *
 * Throws a descriptive Error including a 300-char prefix of the offending
 * text when no JSON object can be extracted.
 */
export function extractJsonObject(raw: string): unknown {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    if (start === -1) throw new Error(`No JSON object in response: ${cleaned.slice(0, 300)}`)
    const end = matchBalancedBrace(cleaned, start)
    if (end === -1) throw new Error(`Unbalanced JSON in response: ${cleaned.slice(0, 300)}`)
    const slice = cleaned.slice(start, end + 1)
    try { return JSON.parse(slice) } catch {
      throw new Error(`JSON in response did not parse: ${slice.slice(0, 300)}`)
    }
  }
}

/**
 * Given a `{` at `start`, return the index of its matching `}` (string- and
 * escape-aware), or -1 if the object is never closed (e.g. the response was
 * truncated at the model's output-token limit).
 */
function matchBalancedBrace(s: string, start: number): number {
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inString) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Recover the completed top-level objects of a named array from a possibly
 * truncated JSON response.
 *
 * When a model runs past its output-token budget mid-array, the document as a
 * whole is unparseable — but every element it *finished* before the cut is
 * still valid JSON. This locates `"<key>": [ ... ]` and returns each balanced
 * `{...}` element it can parse, silently dropping a truncated final element.
 * Returns [] if the key/array can't be located at all.
 */
export function recoverArrayItems(raw: string, key: string): unknown[] {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const keyRe = new RegExp(`"${key}"\\s*:\\s*\\[`)
  const m = keyRe.exec(cleaned)
  if (!m) return []
  const out: unknown[] = []
  let i = m.index + m[0].length
  while (i < cleaned.length) {
    const ch = cleaned[i]
    if (ch === ']') break // array closed cleanly
    if (ch === '{') {
      const end = matchBalancedBrace(cleaned, i)
      if (end === -1) break // final element was cut off — stop here
      const slice = cleaned.slice(i, end + 1)
      try { out.push(JSON.parse(slice)) } catch { /* skip a malformed element */ }
      i = end + 1
      continue
    }
    i += 1
  }
  return out
}
