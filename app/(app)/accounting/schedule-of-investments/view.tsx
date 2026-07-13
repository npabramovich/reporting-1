'use client'

import { useEffect, useState } from 'react'
import { Loader2, AlertTriangle, Check } from 'lucide-react'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'

interface SoiRow {
  name: string
  cost: number
  fairValue: number
  pctOfNetAssets: number
  industry?: string | null
  assetType?: string
  shares?: number | null
  sharePrice?: number | null
  moic?: number | null
}
interface SoiGroup { name: string; cost: number; fairValue: number; pctOfNetAssets: number }
interface Soi {
  rows: SoiRow[]
  totalCost: number
  totalFairValue: number
  netAssets: number
  source: 'tracker' | 'ledger'
  ledgerCost: number
  ledgerFairValue: number
  costVariance: number
  fairValueVariance: number
  byIndustry: SoiGroup[]
  byGeography: SoiGroup[]
  byAssetType: SoiGroup[]
}

export function ScheduleOfInvestmentsView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`
  const [soi, setSoi] = useState<Soi | null>(null)
  const [loading, setLoading] = useState(true)
  const lf = useLedgerFetch()

  useEffect(() => {
    setLoading(true)
    lf('/api/accounting/statements')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setSoi(d?.scheduleOfInvestments ?? null))
      .finally(() => setLoading(false))
  }, [lf])

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
  if (!soi || soi.rows.length === 0) {
    return <div className="border border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">No investments booked yet. Record the investment purchase (Dr 1100 / Cr 1000) and revalue it.</div>
  }

  const tied = soi.costVariance === 0 && soi.fairValueVariance === 0
  const num = (v: number | null | undefined, dp = 0) =>
    v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })

  const groupTable = (title: string, groups: SoiGroup[]) => (
    <div className="border rounded-lg overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left px-3 py-2 font-medium">{title}</th>
            <th className="text-right px-3 py-2 font-medium">Cost</th>
            <th className="text-right px-3 py-2 font-medium">Fair value</th>
            <th className="text-right px-3 py-2 font-medium">% of net assets</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <tr key={g.name} className="border-b last:border-b-0">
              <td className="px-3 py-2">{g.name}</td>
              <td className="px-3 py-2 text-right font-mono">{fmt(g.cost)}</td>
              <td className="px-3 py-2 text-right font-mono">{fmt(g.fairValue)}</td>
              <td className="px-3 py-2 text-right font-mono text-muted-foreground">{pct(g.pctOfNetAssets)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="space-y-5">
      {/* The SOI's rows come from the portfolio tracker; the ledger is the control
          total. If they disagree, say so loudly rather than showing a tidy number. */}
      <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${tied ? 'text-muted-foreground' : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
        {tied ? <Check className="h-4 w-4 mt-0.5 shrink-0 text-green-600" /> : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
        {tied ? (
          <span>Ties to the ledger — cost {fmt(soi.ledgerCost)}, fair value {fmt(soi.ledgerFairValue)}.</span>
        ) : (
          <span>
            <strong>Does not tie to the ledger.</strong> The tracker says cost {fmt(soi.totalCost)} / fair value {fmt(soi.totalFairValue)};
            the ledger says {fmt(soi.ledgerCost)} / {fmt(soi.ledgerFairValue)}.
            Variance: cost <span className="font-mono">{fmt(soi.costVariance)}</span>, fair value <span className="font-mono">{fmt(soi.fairValueVariance)}</span>.
            A mark or purchase was recorded in one system and not the other.
          </span>
        )}
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-3 py-2 font-medium">Investment</th>
              <th className="text-left px-3 py-2 font-medium">Industry</th>
              <th className="text-left px-3 py-2 font-medium">Type</th>
              <th className="text-right px-3 py-2 font-medium">Shares</th>
              <th className="text-right px-3 py-2 font-medium">Price</th>
              <th className="text-right px-3 py-2 font-medium">Cost</th>
              <th className="text-right px-3 py-2 font-medium">Fair value</th>
              <th className="text-right px-3 py-2 font-medium">MOIC</th>
              <th className="text-right px-3 py-2 font-medium">% of net assets</th>
            </tr>
          </thead>
          <tbody>
            {soi.rows.map((r, i) => (
              <tr key={r.name + i} className="border-b last:border-b-0">
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.industry ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.assetType ?? '—'}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{num(r.shares)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{r.sharePrice == null ? '—' : fmt(r.sharePrice)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(r.cost)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(r.fairValue)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{r.moic == null ? '—' : `${r.moic.toFixed(2)}×`}</td>
                <td className="px-3 py-2 text-right font-mono text-muted-foreground">{pct(r.pctOfNetAssets)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/30 font-semibold">
              <td className="px-3 py-2" colSpan={5}>Total (net assets {fmt(soi.netAssets)})</td>
              <td className="px-3 py-2 text-right font-mono">{fmt(soi.totalCost)}</td>
              <td className="px-3 py-2 text-right font-mono">{fmt(soi.totalFairValue)}</td>
              <td />
              <td className="px-3 py-2 text-right font-mono text-muted-foreground">{soi.netAssets ? pct(soi.totalFairValue / soi.netAssets) : '—'}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {soi.source === 'tracker' && (
        <div className="grid gap-4 md:grid-cols-2">
          {soi.byIndustry.length > 0 && groupTable('By industry', soi.byIndustry)}
          {soi.byAssetType.length > 0 && groupTable('By asset type', soi.byAssetType)}
          {soi.byGeography.length > 0 && groupTable('By geography', soi.byGeography)}
        </div>
      )}
    </div>
  )
}
