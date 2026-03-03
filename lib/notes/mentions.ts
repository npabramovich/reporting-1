/**
 * Parse @mentions in note content and return matched user IDs.
 *
 * Builds a map of lowercase display names → user IDs, sorts longest-first
 * for greedy matching, and returns deduplicated user IDs.
 */
export function parseMentions(
  content: string,
  members: Array<{ user_id: string; display_name: string | null }>
): string[] {
  // Build name → userId map (only members with display names)
  const nameToId = new Map<string, string>()
  for (const m of members) {
    if (m.display_name?.trim()) {
      nameToId.set(m.display_name.trim().toLowerCase(), m.user_id)
    }
  }

  if (nameToId.size === 0) return []

  // Sort names longest-first so "John Smith" matches before "John"
  const names = Array.from(nameToId.keys()).sort((a, b) => b.length - a.length)

  // Escape special regex chars in names
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`@(${escaped.join('|')})`, 'gi')

  const matched = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    const name = match[1].toLowerCase()
    const userId = nameToId.get(name)
    if (userId) matched.add(userId)
  }

  return Array.from(matched)
}
