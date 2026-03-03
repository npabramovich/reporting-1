'use client'

import { useMemo } from 'react'

interface Props {
  content: string
}

// Match @Name patterns — alphanumeric, spaces, hyphens, apostrophes
const MENTION_RE = /@([\w][\w\s\-']{0,40}[\w])/g

/**
 * Renders note content with highlighted @mentions and preserved whitespace.
 */
export function NoteContent({ content }: Props) {
  const parts = useMemo(() => {
    const result: Array<{ type: 'text' | 'mention'; value: string }> = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    // Reset regex state
    MENTION_RE.lastIndex = 0

    while ((match = MENTION_RE.exec(content)) !== null) {
      if (match.index > lastIndex) {
        result.push({ type: 'text', value: content.slice(lastIndex, match.index) })
      }
      result.push({ type: 'mention', value: match[0] })
      lastIndex = match.index + match[0].length
    }

    if (lastIndex < content.length) {
      result.push({ type: 'text', value: content.slice(lastIndex) })
    }

    return result
  }, [content])

  if (parts.length === 0) {
    return <p className="text-sm whitespace-pre-wrap">{content}</p>
  }

  return (
    <p className="text-sm whitespace-pre-wrap">
      {parts.map((part, i) =>
        part.type === 'mention' ? (
          <span key={i} className="text-blue-600 dark:text-blue-400 font-medium">
            {part.value}
          </span>
        ) : (
          <span key={i}>{part.value}</span>
        )
      )}
    </p>
  )
}
