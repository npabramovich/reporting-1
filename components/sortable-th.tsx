'use client'

import { ChevronUp, ChevronDown } from 'lucide-react'

// Small shared sortable-column-header helper, used by the /lps, /lps/capital and
// /funds/capital-accounts tables so they sort consistently.

export interface SortState { key: string; dir: 'asc' | 'desc' }

/** Click behaviour: same column flips direction; a new column starts at `defaultDir`. */
export function nextSort(current: SortState | null, key: string, defaultDir: 'asc' | 'desc' = 'desc'): SortState {
  if (current && current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: defaultDir }
}

/** Compare two values with NULLs always sorted last, then apply the direction. */
export function compareVals(a: number | string | null | undefined, b: number | string | null | undefined, dir: 'asc' | 'desc'): number {
  const an = a == null, bn = b == null
  if (an && bn) return 0
  if (an) return 1
  if (bn) return -1
  const cmp = typeof a === 'string' && typeof b === 'string' ? a.localeCompare(b) : (a as number) - (b as number)
  return dir === 'asc' ? cmp : -cmp
}

export function SortTh({
  label, sortKey, sort, onSort, align = 'left', className = '',
}: {
  label: string
  sortKey: string
  sort: SortState | null
  onSort: (key: string) => void
  align?: 'left' | 'right'
  className?: string
}) {
  const active = sort?.key === sortKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`px-3 py-2 font-medium cursor-pointer select-none hover:text-foreground ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {label}
        {active
          ? (sort!.dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
          : <span className="w-3" />}
      </span>
    </th>
  )
}
