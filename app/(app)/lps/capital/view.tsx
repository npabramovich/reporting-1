'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, ClipboardPaste, Trash2, Pencil, Check, X, BookOpen, ListTree } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useConfirm } from '@/components/confirm-dialog'
import { useCurrency, formatCurrencyFull } from '@/components/currency-context'

interface AcctRow {
  lpEntityId: string
  name: string
  commitment: number
  called: number
  funded: number
  itd: { distributions: number; ending: number }
}
interface AcctResp { rows: AcctRow[]; nav: number; source: 'ledger' | 'events'; period?: unknown }

interface Position {
  lpEntityId: string
  name: string
  asOfDate: string
  commitment: number | null
  calledCapital: number | null
  distributions: number | null
  nav: number | null
}

export function LpCapitalView({ isAdmin }: { isAdmin: boolean }) {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyFull(v, currency)
  const confirm = useConfirm()

  const [vehicles, setVehicles] = useState<string[]>([])
  const [group, setGroup] = useState<string>('')
  const [acct, setAcct] = useState<AcctResp | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [dates, setDates] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/accounting/vehicles')
      .then(r => (r.ok ? r.json() : []))
      .then((v: string[]) => { setVehicles(Array.isArray(v) ? v : []); if (v?.length) setGroup(g => g || v[0]) })
  }, [])

  const load = useCallback(() => {
    if (!group) return
    setLoading(true)
    Promise.all([
      fetch(`/api/accounting/capital-accounts?group=${encodeURIComponent(group)}`).then(r => (r.ok ? r.json() : null)),
      fetch(`/api/accounting/positions?group=${encodeURIComponent(group)}`).then(r => (r.ok ? r.json() : null)),
    ]).then(([a, p]) => {
      setAcct(a)
      setPositions(p?.positions ?? [])
      setDates(p?.dates ?? [])
    }).finally(() => setLoading(false))
  }, [group])
  useEffect(() => { load() }, [load])

  const isTracking = acct?.source !== 'ledger'

  return (
    <div className="space-y-6">
      {/* Vehicle selector — the LPs section has no accounting vehicle bar, so it's local. */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted-foreground">Vehicle</label>
        <select
          value={group}
          onChange={e => setGroup(e.target.value)}
          className="h-9 px-3 rounded-md border border-input bg-background text-sm"
        >
          {vehicles.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        {acct && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {acct.source === 'ledger' ? <BookOpen className="h-3.5 w-3.5" /> : <ListTree className="h-3.5 w-3.5" />}
            {acct.source === 'ledger' ? 'from the ledger' : 'from tracked positions'}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : (
        <>
          {/* Capital accounts — the statement, from whichever producer. */}
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground bg-muted/40">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">LP</th>
                  <th className="text-right px-3 py-2 font-medium">Committed</th>
                  <th className="text-right px-3 py-2 font-medium">Called / paid-in</th>
                  <th className="text-right px-3 py-2 font-medium">Distributions</th>
                  <th className="text-right px-3 py-2 font-medium">NAV</th>
                </tr>
              </thead>
              <tbody>
                {(acct?.rows ?? []).map(r => (
                  <tr key={r.lpEntityId} className="border-t">
                    <td className="px-3 py-1.5 font-medium">{r.name}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmt(r.commitment)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmt(r.called)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmt(-r.itd.distributions)}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-medium">{fmt(r.itd.ending)}</td>
                  </tr>
                ))}
                {(acct?.rows ?? []).length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground text-sm">
                    No LP capital yet. {isTracking ? 'Paste positions below to get started.' : 'This ledger has no capital postings yet.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Positions input — only for tracking vehicles; a ledger vehicle is edited via the ledger. */}
          {isTracking && isAdmin && (
            <PositionsPanel
              group={group}
              positions={positions}
              dates={dates}
              onChange={load}
              fmt={fmt}
              confirm={confirm}
            />
          )}
          {isTracking && !isAdmin && (
            <p className="text-xs text-muted-foreground">Capital tracking is admin-edited.</p>
          )}
          {!isTracking && (
            <p className="text-xs text-muted-foreground">
              This vehicle is on the ledger — its capital accounts come from posted entries. Edit them in the Funds section.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function PositionsPanel({
  group, positions, dates, onChange, fmt, confirm,
}: {
  group: string
  positions: Position[]
  dates: string[]
  onChange: () => void
  fmt: (v: number) => string
  confirm: ReturnType<typeof useConfirm>
}) {
  const [showPaste, setShowPaste] = useState(false)
  const [pasteDate, setPasteDate] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [activeDate, setActiveDate] = useState<string>(dates[0] ?? '')

  useEffect(() => { if (dates.length && !dates.includes(activeDate)) setActiveDate(dates[0]) }, [dates, activeDate])

  const rowsForDate = useMemo(
    () => positions.filter(p => p.asOfDate === activeDate).sort((a, b) => a.name.localeCompare(b.name)),
    [positions, activeDate],
  )

  async function doPaste() {
    setBusy(true); setMsg(null)
    const res = await fetch('/api/accounting/positions/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group, asOfDate: pasteDate, data: pasteText }),
    })
    const d = await res.json()
    setBusy(false)
    if (!res.ok) { setMsg(d.error ?? 'Import failed'); return }
    setMsg(`Imported ${d.written} positions as of ${d.asOfDate}.`)
    setShowPaste(false); setPasteText('')
    onChange()
  }

  async function deleteDate(date: string) {
    const ok = await confirm({ title: `Delete the ${date} positions?`, description: 'Removes every LP position stored for this date on this vehicle.', confirmLabel: 'Delete', variant: 'destructive' })
    if (!ok) return
    await fetch(`/api/accounting/positions?group=${encodeURIComponent(group)}&asOfDate=${date}`, { method: 'DELETE' })
    onChange()
  }

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">Tracked positions</h2>
          <p className="text-xs text-muted-foreground">
            Paste a statement or edit by hand. Each import is the cumulative position as of a date; the capital accounts and
            the roll-forward are derived from the dates you keep here.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => { setShowPaste(v => !v); setPasteDate(''); setPasteText(''); setMsg(null) }}>
          <ClipboardPaste className="h-4 w-4 mr-1" /> Paste positions
        </Button>
      </div>

      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}

      {showPaste && (
        <div className="rounded-md border p-3 space-y-2">
          <label className="text-xs text-muted-foreground flex items-center gap-2">
            As of
            <Input type="date" value={pasteDate} onChange={e => setPasteDate(e.target.value)} className="h-9 w-40" />
          </label>
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            rows={8}
            placeholder="Paste spreadsheet rows (with headers): investor, commitment, called/paid-in, distributions, NAV…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={doPaste} disabled={busy || !pasteDate || !pasteText.trim()}>
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Import
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowPaste(false)}>Cancel</Button>
            <span className="text-xs text-muted-foreground">The AI maps the columns; re-pasting a date replaces it.</span>
          </div>
        </div>
      )}

      {dates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No positions yet. Paste a statement above.</p>
      ) : (
        <>
          {/* Date tabs — the history over time. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {dates.map(d => (
              <button
                key={d}
                onClick={() => setActiveDate(d)}
                className={`text-xs rounded-md border px-2 py-1 ${d === activeDate ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-accent'}`}
              >
                {d}
              </button>
            ))}
            {activeDate && (
              <button onClick={() => deleteDate(activeDate)} className="ml-1 text-xs text-muted-foreground hover:text-red-600 inline-flex items-center gap-1">
                <Trash2 className="h-3.5 w-3.5" /> delete {activeDate}
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-1.5 font-medium">LP</th>
                  <th className="text-right px-3 py-1.5 font-medium">Committed</th>
                  <th className="text-right px-3 py-1.5 font-medium">Called / paid-in</th>
                  <th className="text-right px-3 py-1.5 font-medium">Distributions</th>
                  <th className="text-right px-3 py-1.5 font-medium">NAV</th>
                  <th className="px-3 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rowsForDate.map(p => (
                  <PositionRow key={p.lpEntityId} group={group} pos={p} onSaved={onChange} fmt={fmt} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function PositionRow({ group, pos, onSaved, fmt }: { group: string; pos: Position; onSaved: () => void; fmt: (v: number) => string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({
    commitment: pos.commitment ?? '', calledCapital: pos.calledCapital ?? '',
    distributions: pos.distributions ?? '', nav: pos.nav ?? '',
  })
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    await fetch('/api/accounting/positions', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group, asOfDate: pos.asOfDate, lpEntityId: pos.lpEntityId, ...draft }),
    })
    setSaving(false); setEditing(false); onSaved()
  }

  const cell = (v: number | null) => (v == null ? '—' : fmt(v))

  if (!editing) {
    return (
      <tr className="border-t group">
        <td className="px-3 py-1.5 font-medium">{pos.name}</td>
        <td className="px-3 py-1.5 text-right font-mono">{cell(pos.commitment)}</td>
        <td className="px-3 py-1.5 text-right font-mono">{cell(pos.calledCapital)}</td>
        <td className="px-3 py-1.5 text-right font-mono">{cell(pos.distributions)}</td>
        <td className="px-3 py-1.5 text-right font-mono">{cell(pos.nav)}</td>
        <td className="px-3 py-1.5 text-right">
          <button onClick={() => setEditing(true)} className="text-muted-foreground opacity-0 group-hover:opacity-100"><Pencil className="h-3.5 w-3.5" /></button>
        </td>
      </tr>
    )
  }
  const inp = (k: keyof typeof draft) => (
    <Input value={String(draft[k] ?? '')} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} inputMode="decimal" className="h-8 w-28 text-right font-mono ml-auto" />
  )
  return (
    <tr className="border-t bg-muted/20">
      <td className="px-3 py-1.5 font-medium">{pos.name}</td>
      <td className="px-3 py-1.5">{inp('commitment')}</td>
      <td className="px-3 py-1.5">{inp('calledCapital')}</td>
      <td className="px-3 py-1.5">{inp('distributions')}</td>
      <td className="px-3 py-1.5">{inp('nav')}</td>
      <td className="px-3 py-1.5 text-right whitespace-nowrap">
        <button onClick={save} disabled={saving} className="text-green-600 mr-2">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : <Check className="h-3.5 w-3.5 inline" />}</button>
        <button onClick={() => setEditing(false)} className="text-muted-foreground"><X className="h-3.5 w-3.5 inline" /></button>
      </td>
    </tr>
  )
}
