'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Metric } from '@/lib/types/database'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  metric: Metric
  onSuccess: () => void
}

export function AddDataPointDialog({
  open,
  onOpenChange,
  companyId,
  metric,
  onSuccess,
}: Props) {
  const [value, setValue] = useState('')
  const [periodYear, setPeriodYear] = useState(new Date().getFullYear().toString())
  const [periodMonth, setPeriodMonth] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const buildPeriodLabel = () => {
    const yr = periodYear
    if (periodMonth) {
      const month = new Date(2000, parseInt(periodMonth) - 1).toLocaleString('en', { month: 'short' })
      return `${month} ${yr}`
    }
    return `FY ${yr}`
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)

    const pYear = parseInt(periodYear)
    if (isNaN(pYear)) {
      setError('Invalid year')
      setSaving(false)
      return
    }

    const label = buildPeriodLabel()
    const pMonth = periodMonth ? parseInt(periodMonth) : null
    const body: Record<string, unknown> = {
      period_label: label,
      period_year: pYear,
      period_quarter: pMonth ? Math.ceil(pMonth / 3) : null,
      period_month: pMonth,
      value: metric.value_type === 'text' ? value : parseFloat(value),
      notes: notes || null,
    }

    const res = await fetch(
      `/api/companies/${companyId}/metrics/${metric.id}/values`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )

    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Failed to add data point')
      setSaving(false)
      return
    }

    setSaving(false)
    onOpenChange(false)
    setValue('')
    setNotes('')
    onSuccess()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add data point — {metric.name}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Year</Label>
              <Input
                type="number"
                value={periodYear}
                onChange={(e) => setPeriodYear(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Month</Label>
              <select
                value={periodMonth}
                onChange={(e) => setPeriodMonth(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="">— (annual)</option>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={String(i + 1)}>
                    {new Date(2000, i).toLocaleString('en', { month: 'long' })}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label>
              Value
              {metric.unit && (
                <span className="text-muted-foreground font-normal ml-1">({metric.unit})</span>
              )}
            </Label>
            <Input
              type={metric.value_type === 'text' ? 'text' : 'number'}
              step="any"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
          </div>

          <div>
            <Label>Notes (optional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Source: board deck Q4"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Add'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
