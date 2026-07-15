'use client'

import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

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
  const Icon = active ? (sort!.dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`group px-3 py-2 font-medium cursor-pointer select-none whitespace-nowrap hover:text-foreground ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {label}
        {/* The icon lives in a fixed-width slot so the label never shifts. Idle: hidden. Hover:
            a faint up/down hint that the column is sortable. Active: the solid sort direction. */}
        <Icon className={`h-3 w-3 shrink-0 transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`} />
      </span>
    </th>
  )
}
