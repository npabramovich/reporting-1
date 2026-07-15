'use client'

// Live LP report cards — the printable, per-investor summaries built from LIVE data (not a
// frozen snapshot). One card per investor, aggregated across every vehicle; print/save all
// at once. The snapshot archive still prints frozen cards; this is the everyday, always-current
// version, and it reuses the exact same card layout so they're indistinguishable on paper.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, ArrowLeft, Printer, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LpReportCard, REPORT_CARD_PRINT_CSS, type ReportCardRow, type ReportCardTotals } from '@/components/lp-report-card'

interface Investor { investorId: string; investorName: string; rows: ReportCardRow[] }
interface Payload {
  fund: { name: string; logo: string | null; address: string | null }
  currency: string
  asOf: string | null
  investors: Investor[]
  vehicleDates: { vehicle: string; date: string | null }[]
}

const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null)

function totalsOf(rows: ReportCardRow[]): ReportCardTotals {
  const t = rows.reduce((a, r) => ({
    commitment: a.commitment + r.commitment,
    paidInCapital: a.paidInCapital + r.paidInCapital,
    distributions: a.distributions + r.distributions,
    nav: a.nav + r.nav,
    totalValue: a.totalValue + r.totalValue,
  }), { commitment: 0, paidInCapital: 0, distributions: 0, nav: 0, totalValue: 0 })
  // Ratios computed AFTER summing.
  return {
    ...t,
    pctFunded: ratio(t.paidInCapital, t.commitment),
    dpi: ratio(t.distributions, t.paidInCapital),
    rvpi: ratio(t.nav, t.paidInCapital),
    tvpi: ratio(t.distributions + t.nav, t.paidInCapital),
  }
}

export default function LiveCardsPage() {
  const [asOf, setAsOf] = useState('')
  const [applied, setApplied] = useState('')
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback((date: string) => {
    setLoading(true)
    fetch(`/api/lps/live-cards${date ? `?asOf=${date}` : ''}`)
      .then(r => (r.ok ? r.json() : null))
      .then(setData)
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load(applied) }, [load, applied])

  const asOfLabel = data?.asOf ?? undefined

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full print:p-0">
      <style>{REPORT_CARD_PRINT_CSS}</style>

      <div className="flex items-center gap-3 mb-6 no-print flex-wrap">
        <Button variant="outline" size="sm" className="text-muted-foreground" asChild>
          <Link href="/lps"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Link>
        </Button>
        <label className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> As of</label>
        <Input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="h-9 w-40" />
        <Button size="sm" variant="outline" onClick={() => setApplied(asOf)} disabled={loading}>{asOf ? 'Rebuild' : 'Latest'}</Button>
        {applied && <Button size="sm" variant="ghost" onClick={() => { setAsOf(''); setApplied('') }}>Clear</Button>}
        <span className="flex-1" />
        <Button size="sm" onClick={() => window.print()} disabled={!data || data.investors.length === 0}>
          <Printer className="h-4 w-4 mr-1" /> Print all
        </Button>
      </div>

      {loading && !data ? (
        <div className="flex items-center py-16 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Building cards…</div>
      ) : !data || data.investors.length === 0 ? (
        <p className="text-sm text-muted-foreground">No LP data to print.</p>
      ) : (
        <div className="space-y-8">
          {data.investors.map((inv, i) => (
            <div key={inv.investorId} className={i < data.investors.length - 1 ? 'card-break' : ''}>
              <LpReportCard
                fundName={data.fund.name}
                fundLogo={data.fund.logo}
                fundAddress={data.fund.address}
                investorName={inv.investorName}
                rows={inv.rows}
                totals={totalsOf(inv.rows)}
                asOfFormatted={asOfLabel}
                vehicleDataDates={data.vehicleDates.filter(v => inv.rows.some(r => r.portfolioGroup === v.vehicle))}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
