'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader2, Check, AlertTriangle, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCurrency, formatCurrencyFull } from '@/components/currency-context'

interface Txn { id: string; txn_date: string; amount: number; description: string; counterparty: string | null; status: string; suggested_account_code: string | null }
interface Rec { bankEndingBalance: number; ledgerCashBalance: number; difference: number; matchedCount: number; unmatchedCount: number; unmatchedTotal: number; tiesOut: boolean }

const STATUS_STYLE: Record<string, string> = {
  drafted: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  reconciled: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  ignored: 'bg-muted text-muted-foreground',
  unmatched: 'bg-muted text-muted-foreground',
}

export function BankView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyFull(v, currency)
  const [csv, setCsv] = useState('')
  const [txns, setTxns] = useState<Txn[]>([])
  const [rec, setRec] = useState<Rec | null>(null)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/accounting/bank').then(r => (r.ok ? r.json() : [])),
      fetch('/api/accounting/bank/reconcile').then(r => (r.ok ? r.json() : null)),
    ]).then(([t, r]) => { setTxns(Array.isArray(t) ? t : []); setRec(r) }).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  async function doImport() {
    setImporting(true); setResult(null)
    const res = await fetch('/api/accounting/bank/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }) })
    const data = await res.json()
    if (res.ok) { setResult(data); setCsv(''); load() }
    else setResult({ imported: 0, skipped: 0, errors: [data.error ?? 'Import failed'] })
    setImporting(false)
  }

  async function act(id: string, action: 'post' | 'ignore') {
    await fetch('/api/accounting/bank', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id }) })
    load()
  }

  return (
    <div className="space-y-6">
      {/* Import */}
      <div className="border rounded-lg p-4 space-y-2">
        <p className="text-sm font-medium">Import transactions</p>
        <p className="text-xs text-muted-foreground">Paste a CSV/TSV export from your bank, Ramp, or QuickBooks. Columns matched automatically (date, description, amount, or debit/credit). Each row is deduped and drafted as a balanced entry for review.</p>
        <textarea value={csv} onChange={e => setCsv(e.target.value)} rows={5} placeholder="Date,Description,Amount&#10;2026-06-01,Capital call Fund II,5000000&#10;2026-06-15,Audit fee,-12000" className="w-full border border-input rounded p-2 text-sm font-mono bg-transparent" />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={doImport} disabled={importing || csv.trim().length < 5}>{importing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}Import</Button>
          {result && (
            <span className="text-sm text-muted-foreground">
              {result.imported} imported{result.skipped ? `, ${result.skipped} duplicate(s) skipped` : ''}{result.errors.length ? `, ${result.errors.length} error(s)` : ''}.
            </span>
          )}
        </div>
        {result?.errors?.length ? <p className="text-xs text-red-600">{result.errors[0]}</p> : null}
      </div>

      {/* Reconciliation */}
      {rec && (
        <div className={`rounded-lg border p-3 text-sm flex flex-wrap items-center gap-x-6 gap-y-1 ${rec.tiesOut ? 'border-green-500/40 bg-green-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
          <span className="flex items-center gap-2 font-medium">
            {rec.tiesOut ? <Check className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
            Bank reconciliation
          </span>
          <span className="text-muted-foreground">Ledger cash <span className="font-mono text-foreground">{fmt(rec.ledgerCashBalance)}</span></span>
          <span className="text-muted-foreground">Bank ending <span className="font-mono text-foreground">{fmt(rec.bankEndingBalance)}</span></span>
          <span className="text-muted-foreground">Difference <span className={`font-mono ${rec.difference !== 0 ? 'text-amber-600' : 'text-foreground'}`}>{fmt(rec.difference)}</span></span>
          {rec.unmatchedCount > 0 && <span className="text-muted-foreground">{rec.unmatchedCount} unmatched ({fmt(rec.unmatchedTotal)})</span>}
        </div>
      )}

      {/* Transactions */}
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
      ) : txns.length === 0 ? (
        <div className="border border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">No transactions yet. Import a feed above.</div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-3 py-2 font-medium">Date</th>
                <th className="text-left px-3 py-2 font-medium">Description</th>
                <th className="text-right px-3 py-2 font-medium">Amount</th>
                <th className="text-left px-3 py-2 font-medium">Suggested</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {txns.map(t => (
                <tr key={t.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs">{t.txn_date}</td>
                  <td className="px-3 py-2">{t.description}</td>
                  <td className={`px-3 py-2 text-right font-mono ${t.amount < 0 ? 'text-muted-foreground' : ''}`}>{fmt(t.amount)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{t.suggested_account_code ?? '—'}</td>
                  <td className="px-3 py-2"><span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${STATUS_STYLE[t.status] ?? ''}`}>{t.status}</span></td>
                  <td className="px-3 py-2 text-right">
                    {t.status === 'drafted' && (
                      <span className="flex items-center gap-1 justify-end">
                        <button onClick={() => act(t.id, 'post')} className="text-xs text-green-600 hover:underline">Post</button>
                        <span className="text-muted-foreground">·</span>
                        <button onClick={() => act(t.id, 'ignore')} className="text-xs text-muted-foreground hover:underline">Ignore</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
