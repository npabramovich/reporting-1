'use client'

import { useEffect, useState, useCallback } from 'react'
import { DollarSign, Plus, Trash2, Pencil, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import type { InvestmentTransaction, CompanyStatus } from '@/lib/types/database'
import type { CompanyInvestmentSummary } from '@/lib/types/investments'

interface Props {
  companyId: string
  companyStatus: CompanyStatus
}

type TransactionType = 'investment' | 'proceeds' | 'unrealized_gain_change'

const TYPE_LABELS: Record<TransactionType, string> = {
  investment: 'Investment',
  proceeds: 'Proceeds',
  unrealized_gain_change: 'Unrealized Change',
}

function fmt(val: number | null | undefined): string {
  if (val == null) return '-'
  return val.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtNum(val: number | null | undefined): string {
  if (val == null) return '-'
  return val.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function fmtPrice(val: number | null | undefined): string {
  if (val == null) return '-'
  return val.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

function fmtMoic(val: number | null | undefined): string {
  if (val == null) return '-'
  return `${val.toFixed(2)}x`
}

const EMPTY_FORM: Record<string, string> = {
  transaction_type: 'investment',
  round_name: '',
  transaction_date: '',
  notes: '',
  investment_cost: '',
  interest_converted: '',
  shares_acquired: '',
  share_price: '',
  cost_basis_exited: '',
  proceeds_received: '',
  proceeds_escrow: '',
  proceeds_written_off: '',
  proceeds_per_share: '',
  unrealized_value_change: '',
  current_share_price: '',
}

export function CompanyInvestments({ companyId, companyStatus }: Props) {
  const [transactions, setTransactions] = useState<InvestmentTransaction[]>([])
  const [summary, setSummary] = useState<CompanyInvestmentSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/companies/${companyId}/investments`)
      if (res.ok) {
        const data = await res.json()
        setTransactions(data.transactions)
        setSummary(data.summary)
      }
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { load() }, [load])

  function openAdd() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setError(null)
    setDialogOpen(true)
  }

  function openEdit(txn: InvestmentTransaction) {
    setEditingId(txn.id)
    setForm({
      transaction_type: txn.transaction_type,
      round_name: txn.round_name ?? '',
      transaction_date: txn.transaction_date ?? '',
      notes: txn.notes ?? '',
      investment_cost: txn.investment_cost?.toString() ?? '',
      interest_converted: txn.interest_converted?.toString() ?? '',
      shares_acquired: txn.shares_acquired?.toString() ?? '',
      share_price: txn.share_price?.toString() ?? '',
      cost_basis_exited: txn.cost_basis_exited?.toString() ?? '',
      proceeds_received: txn.proceeds_received?.toString() ?? '',
      proceeds_escrow: txn.proceeds_escrow?.toString() ?? '',
      proceeds_written_off: txn.proceeds_written_off?.toString() ?? '',
      proceeds_per_share: txn.proceeds_per_share?.toString() ?? '',
      unrealized_value_change: txn.unrealized_value_change?.toString() ?? '',
      current_share_price: txn.current_share_price?.toString() ?? '',
    })
    setError(null)
    setDialogOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)

    const numOrNull = (v: string) => v.trim() ? parseFloat(v) : null

    const payload: Record<string, unknown> = {
      transaction_type: form.transaction_type,
      round_name: form.round_name || null,
      transaction_date: form.transaction_date || null,
      notes: form.notes || null,
      investment_cost: numOrNull(form.investment_cost),
      interest_converted: numOrNull(form.interest_converted) ?? 0,
      shares_acquired: numOrNull(form.shares_acquired),
      share_price: numOrNull(form.share_price),
      cost_basis_exited: numOrNull(form.cost_basis_exited),
      proceeds_received: numOrNull(form.proceeds_received),
      proceeds_escrow: numOrNull(form.proceeds_escrow) ?? 0,
      proceeds_written_off: numOrNull(form.proceeds_written_off) ?? 0,
      proceeds_per_share: numOrNull(form.proceeds_per_share),
      unrealized_value_change: numOrNull(form.unrealized_value_change),
      current_share_price: numOrNull(form.current_share_price),
    }

    try {
      const url = editingId
        ? `/api/companies/${companyId}/investments/${editingId}`
        : `/api/companies/${companyId}/investments`
      const res = await fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to save')
        return
      }

      setDialogOpen(false)
      load()
    } catch {
      setError('Failed to save transaction')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(txnId: string) {
    setDeletingId(txnId)
    try {
      const res = await fetch(`/api/companies/${companyId}/investments/${txnId}`, {
        method: 'DELETE',
      })
      if (res.ok) load()
    } finally {
      setDeletingId(null)
    }
  }

  const txnType = form.transaction_type as TransactionType

  if (loading) {
    return (
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-2">
          <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">Investment Details</span>
        </div>
        <div className="animate-pulse space-y-2">
          <div className="h-8 bg-muted rounded w-full" />
          <div className="h-8 bg-muted rounded w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <DollarSign className="h-3.5 w-3.5" />
          Investment Details
          {transactions.length > 0 && (
            <span className="text-xs bg-muted rounded-full px-1.5 py-0.5">{transactions.length}</span>
          )}
        </button>
        <Button size="sm" variant="ghost" onClick={openAdd} className="h-7 px-2">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {expanded && summary && summary.totalInvested > 0 && (
        <div className="flex items-center gap-4 mb-3 text-sm">
          <span>
            <span className="text-muted-foreground">Invested:</span>{' '}
            <span className="font-medium">{fmt(summary.totalInvested)}</span>
          </span>
          <span>
            <span className="text-muted-foreground">FMV:</span>{' '}
            <span className="font-medium">{fmt(summary.fmv)}</span>
          </span>
          {summary.moic != null && (
            <span>
              <span className="text-muted-foreground">MOIC:</span>{' '}
              <span className="font-medium">{fmtMoic(summary.moic)}</span>
            </span>
          )}
          {summary.totalRealized > 0 && (
            <span>
              <span className="text-muted-foreground">Realized:</span>{' '}
              <span className="font-medium">{fmt(summary.totalRealized)}</span>
            </span>
          )}
        </div>
      )}

      {expanded && transactions.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-3 py-2 font-medium">Type</th>
                <th className="text-left px-3 py-2 font-medium">Round</th>
                <th className="text-left px-3 py-2 font-medium">Date</th>
                {companyStatus === 'exited' ? (
                  <>
                    <th className="text-right px-3 py-2 font-medium">Cost</th>
                    <th className="text-right px-3 py-2 font-medium">Proceeds</th>
                  </>
                ) : (
                  <>
                    <th className="text-right px-3 py-2 font-medium">Invested</th>
                    <th className="text-right px-3 py-2 font-medium">Shares</th>
                    <th className="text-right px-3 py-2 font-medium">Price</th>
                    <th className="text-right px-3 py-2 font-medium">FMV</th>
                  </>
                )}
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {transactions.map(txn => {
                const round = summary?.rounds.find(r => r.roundName === txn.round_name)
                return (
                  <tr key={txn.id} className="border-b last:border-b-0">
                    <td className="px-3 py-2">
                      <span className="text-xs text-muted-foreground">
                        {TYPE_LABELS[txn.transaction_type as TransactionType] ?? txn.transaction_type}
                      </span>
                    </td>
                    <td className="px-3 py-2">{txn.round_name ?? '-'}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {txn.transaction_date
                        ? new Date(txn.transaction_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                        : '-'}
                    </td>
                    {companyStatus === 'exited' ? (
                      <>
                        <td className="px-3 py-2 text-right font-mono">
                          {txn.transaction_type === 'investment' ? fmt(txn.investment_cost) : fmt(txn.cost_basis_exited)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {txn.transaction_type === 'proceeds' ? fmt(txn.proceeds_received) : '-'}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-right font-mono">
                          {txn.transaction_type === 'investment' ? fmt(txn.investment_cost) : '-'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {txn.transaction_type === 'investment' ? fmtNum(txn.shares_acquired) : '-'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {txn.transaction_type === 'investment'
                            ? fmtPrice(txn.share_price)
                            : txn.transaction_type === 'unrealized_gain_change'
                            ? fmtPrice(txn.current_share_price)
                            : '-'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {txn.transaction_type === 'investment' && round
                            ? fmt(round.currentValue)
                            : txn.transaction_type === 'unrealized_gain_change'
                            ? fmt(txn.unrealized_value_change)
                            : '-'}
                        </td>
                      </>
                    )}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1 justify-end">
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => openEdit(txn)}
                          className="h-7 px-1.5 text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => handleDelete(txn.id)}
                          disabled={deletingId === txn.id}
                          className="h-7 px-1.5 text-muted-foreground hover:text-destructive"
                        >
                          {deletingId === txn.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {expanded && transactions.length === 0 && (
        <p className="text-xs text-muted-foreground px-3 py-2">
          No investment transactions recorded yet.
        </p>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Transaction' : 'Add Transaction'}</DialogTitle>
            <DialogDescription>
              {editingId ? 'Update the transaction details.' : 'Record a new investment transaction.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!editingId && (
              <div>
                <Label>Transaction Type</Label>
                <Select
                  value={form.transaction_type}
                  onValueChange={v => setForm(f => ({ ...f, transaction_type: v }))}
                >
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="investment">Investment</SelectItem>
                    <SelectItem value="proceeds">Proceeds</SelectItem>
                    <SelectItem value="unrealized_gain_change">Unrealized Change</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Round Name</Label>
                <Input
                  className="mt-1"
                  value={form.round_name}
                  onChange={e => setForm(f => ({ ...f, round_name: e.target.value }))}
                  placeholder="e.g. Series A"
                />
              </div>
              <div>
                <Label>Date</Label>
                <Input
                  className="mt-1"
                  type="date"
                  value={form.transaction_date}
                  onChange={e => setForm(f => ({ ...f, transaction_date: e.target.value }))}
                />
              </div>
            </div>

            {txnType === 'investment' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Investment Cost ($)</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="any"
                    value={form.investment_cost}
                    onChange={e => setForm(f => ({ ...f, investment_cost: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Interest Converted ($)</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="any"
                    value={form.interest_converted}
                    onChange={e => setForm(f => ({ ...f, interest_converted: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Shares Acquired</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="any"
                    value={form.shares_acquired}
                    onChange={e => setForm(f => ({ ...f, shares_acquired: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Share Price ($)</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="any"
                    value={form.share_price}
                    onChange={e => setForm(f => ({ ...f, share_price: e.target.value }))}
                  />
                </div>
              </div>
            )}

            {txnType === 'proceeds' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Cost Basis Exited ($)</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="any"
                    value={form.cost_basis_exited}
                    onChange={e => setForm(f => ({ ...f, cost_basis_exited: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Proceeds Received ($)</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="any"
                    value={form.proceeds_received}
                    onChange={e => setForm(f => ({ ...f, proceeds_received: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Proceeds Escrow ($)</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="any"
                    value={form.proceeds_escrow}
                    onChange={e => setForm(f => ({ ...f, proceeds_escrow: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Written Off ($)</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="any"
                    value={form.proceeds_written_off}
                    onChange={e => setForm(f => ({ ...f, proceeds_written_off: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Proceeds Per Share ($)</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="any"
                    value={form.proceeds_per_share}
                    onChange={e => setForm(f => ({ ...f, proceeds_per_share: e.target.value }))}
                  />
                </div>
              </div>
            )}

            {txnType === 'unrealized_gain_change' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Unrealized Value Change ($)</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="any"
                    value={form.unrealized_value_change}
                    onChange={e => setForm(f => ({ ...f, unrealized_value_change: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Current Share Price ($)</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="any"
                    value={form.current_share_price}
                    onChange={e => setForm(f => ({ ...f, current_share_price: e.target.value }))}
                  />
                </div>
              </div>
            )}

            <div>
              <Label>Notes</Label>
              <Input
                className="mt-1"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional notes"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingId ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
