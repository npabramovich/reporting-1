// app/(app)/companies/[id]/holding-k1-income.tsx
'use client'

import { useEffect, useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCurrency, formatCurrencyFull } from '@/components/currency-context'
import type { HoldingK1Year } from '@/lib/tax/holding-k1-history'

type Year = HoldingK1Year & { vehicleName: string | null }

const COLUMNS: { key: keyof HoldingK1Year; label: string; title: string }[] = [
  { key: 'ordinary', label: 'Ordinary', title: 'Boxes 1 and 4' },
  { key: 'interest', label: 'Interest', title: 'Box 5' },
  { key: 'dividends', label: 'Dividends', title: 'Box 6a (includes qualified, 6b)' },
  { key: 'shortTermGain', label: 'ST gain', title: 'Box 8' },
  { key: 'longTermGain', label: 'LT gain', title: 'Box 9a' },
  { key: 'other', label: 'Other', title: 'Boxes 2, 3, 7, 10 and 11' },
  { key: 'deductions', label: 'Deductions', title: 'Boxes 12, 13H and 13' },
  { key: 'total', label: 'Total', title: 'Income less deductions' },
  { key: 'distributions', label: 'Distributions', title: 'Box 19' },
]

/**
 * A fund holding's K-1 income by year, from the amounts recorded on the Tax page.
 *
 * Renders nothing for a viewer without tax read (the route answers 403) and nothing when no K-1 has
 * amounts yet, so it never adds an empty box to the page. Its own component, beside the register,
 * so the register (components/fund-holding-detail.tsx) stays untouched.
 */
export function HoldingK1Income({ companyId }: { companyId: string }) {
  const currency = useCurrency()
  const [years, setYears] = useState<Year[] | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/accounting/received-k1s/holding?companyId=${encodeURIComponent(companyId)}`)
      .then(res => (res.ok ? res.json() : null))
      .then(json => { if (live) setYears(Array.isArray(json?.years) ? json.years : []) })
      .catch(() => { if (live) setYears([]) })
    return () => { live = false }
  }, [companyId])

  if (!years || years.length === 0) return null
  const byEntity = new Set(years.map(y => y.vehicleId ?? '')).size > 1

  return (
    <section className="mt-6 space-y-2" aria-label="K-1 income by year">
      <h2 className="text-base font-medium">K-1 income by year</h2>
      <p className="text-xs text-muted-foreground">As each K-1 reported it. Deductions and distributions are shown as positive amounts.</p>
      <div className="overflow-x-auto rounded-card border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              {byEntity && <TableHead>Entity</TableHead>}
              {COLUMNS.map(c => <TableHead key={c.key} className="text-right whitespace-nowrap" title={c.title}>{c.label}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {years.map(y => (
              <TableRow key={`${y.taxYear}-${y.vehicleId ?? ''}`}>
                <TableCell className="tabular-nums">
                  {y.taxYear}
                  {y.status === 'amended' && <span className="ml-1 text-xs text-muted-foreground">(amended)</span>}
                </TableCell>
                {byEntity && <TableCell className="whitespace-nowrap">{y.vehicleName ?? 'No entity recorded'}</TableCell>}
                {COLUMNS.map(c => (
                  <TableCell key={c.key} className={`text-right tabular-nums whitespace-nowrap${c.key === 'total' ? ' font-medium' : ''}`}>
                    {formatCurrencyFull(y[c.key] as number, currency)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
