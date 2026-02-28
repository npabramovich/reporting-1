'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CompanyForm } from '@/components/company-form'
import { Check, X, Pencil, Building2, Loader2 } from 'lucide-react'
import type { Company } from '@/lib/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReviewItem {
  id: string
  issue_type: string
  extracted_value: string | null
  context_snippet: string | null
  created_at: string
  company: { id: string; name: string } | null
  metric: { id: string; name: string; unit: string | null; value_type: string } | null
  email: { id: string; subject: string | null; received_at: string; from_address: string } | null
}

interface ReviewData {
  total: number
  counts: Record<string, number>
  items: ReviewItem[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ISSUE_LABELS: Record<string, string> = {
  new_company_detected: 'New Company',
  low_confidence: 'Low Confidence',
  ambiguous_period: 'Ambiguous Period',
  metric_not_found: 'Metric Not Found',
  company_not_identified: 'Unidentified Company',
  duplicate_period: 'Duplicate Period',
}

const STATUS_COLORS: Record<string, string> = {
  new_company_detected: 'bg-blue-100 text-blue-800 border-blue-200',
  low_confidence: 'bg-amber-100 text-amber-800 border-amber-200',
  ambiguous_period: 'bg-orange-100 text-orange-800 border-orange-200',
  metric_not_found: 'bg-slate-100 text-slate-700 border-slate-200',
  company_not_identified: 'bg-red-100 text-red-800 border-red-200',
  duplicate_period: 'bg-purple-100 text-purple-800 border-purple-200',
}

// ---------------------------------------------------------------------------
// EmailReviewModal
// ---------------------------------------------------------------------------

export function EmailReviewModal({
  emailId,
  open,
  onOpenChange,
  onResolved,
}: {
  emailId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onResolved: () => void
}) {
  const [data, setData] = useState<ReviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [resolving, setResolving] = useState<Record<string, boolean>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [createCompanyFor, setCreateCompanyFor] = useState<ReviewItem | null>(null)

  const load = useCallback(async () => {
    if (!emailId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/emails/${emailId}/reviews`)
      if (!res.ok) throw new Error('Failed to load reviews')
      setData(await res.json())
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [emailId])

  useEffect(() => {
    if (open && emailId) {
      load()
    } else {
      setData(null)
      setEditingId(null)
      setCreateCompanyFor(null)
    }
  }, [open, emailId, load])

  async function resolve(
    item: ReviewItem,
    resolution: 'accepted' | 'rejected' | 'manually_corrected',
    resolvedValue?: string
  ) {
    setResolving(prev => ({ ...prev, [item.id]: true }))
    try {
      const res = await fetch(`/api/review/${item.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution, resolved_value: resolvedValue }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Failed to resolve')
      }
      setData(prev =>
        prev
          ? {
              ...prev,
              total: prev.total - 1,
              counts: {
                ...prev.counts,
                [item.issue_type]: (prev.counts[item.issue_type] ?? 1) - 1,
              },
              items: prev.items.filter(i => i.id !== item.id),
            }
          : prev
      )
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error resolving item')
    } finally {
      setResolving(prev => ({ ...prev, [item.id]: false }))
      setEditingId(null)
    }
  }

  function startEdit(item: ReviewItem) {
    setEditingId(item.id)
    setEditValue(item.extracted_value ?? '')
  }

  function handleCompanyCreated(company: Company) {
    setCreateCompanyFor(null)
    if (createCompanyFor) {
      resolve(createCompanyFor, 'accepted', company.name)
    }
  }

  const items = data?.items ?? []

  return (
    <>
      <Dialog open={open && !createCompanyFor} onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) onResolved()
      }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Items</DialogTitle>
          </DialogHeader>

          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && items.length === 0 && (
            <div className="py-8 text-center">
              <Check className="h-8 w-8 text-green-500 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">All items resolved.</p>
            </div>
          )}

          {!loading && items.length > 0 && (
            <div className="space-y-3">
              {items.map(item => (
                <ReviewCard
                  key={item.id}
                  item={item}
                  resolving={!!resolving[item.id]}
                  editing={editingId === item.id}
                  editValue={editValue}
                  onEditValueChange={setEditValue}
                  onAccept={() => resolve(item, 'accepted')}
                  onReject={() => resolve(item, 'rejected')}
                  onStartEdit={() => startEdit(item)}
                  onCancelEdit={() => setEditingId(null)}
                  onSubmitEdit={() => resolve(item, 'manually_corrected', editValue)}
                  onCreateCompany={() => setCreateCompanyFor(item)}
                />
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Company Dialog */}
      <Dialog
        open={!!createCompanyFor}
        onOpenChange={o => !o && setCreateCompanyFor(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Company</DialogTitle>
          </DialogHeader>
          <CompanyForm
            initialName={createCompanyFor?.extracted_value ?? ''}
            onSuccess={handleCompanyCreated}
            onCancel={() => setCreateCompanyFor(null)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// ReviewCard (ported from review page)
// ---------------------------------------------------------------------------

function ReviewCard({
  item,
  resolving,
  editing,
  editValue,
  onEditValueChange,
  onAccept,
  onReject,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onCreateCompany,
}: {
  item: ReviewItem
  resolving: boolean
  editing: boolean
  editValue: string
  onEditValueChange: (v: string) => void
  onAccept: () => void
  onReject: () => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSubmitEdit: () => void
  onCreateCompany: () => void
}) {
  const hasValue = !!item.extracted_value
  const isNewCompany = item.issue_type === 'new_company_detected'
  const isUnidentified = item.issue_type === 'company_not_identified'
  const isMetricNotFound = item.issue_type === 'metric_not_found'

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      {/* Top row: badge + company + metric */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[item.issue_type] ?? ''}`}
        >
          {ISSUE_LABELS[item.issue_type] ?? item.issue_type}
        </span>
        {item.company && (
          <span className="text-sm font-medium">{item.company.name}</span>
        )}
        {!item.company && (
          <span className="text-sm text-muted-foreground italic">Unknown company</span>
        )}
        {item.metric && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-sm text-muted-foreground">{item.metric.name}</span>
          </>
        )}
      </div>

      {/* Extracted value */}
      {hasValue && !editing && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">Value</span>
          <span className="font-mono text-sm bg-muted px-2 py-0.5 rounded">
            {item.extracted_value}
            {item.metric?.unit ? ` ${item.metric.unit}` : ''}
          </span>
        </div>
      )}

      {/* Inline edit */}
      {editing && (
        <div className="flex items-center gap-2">
          <Input
            value={editValue}
            onChange={e => onEditValueChange(e.target.value)}
            className="h-8 w-40 font-mono text-sm"
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') onSubmitEdit()
              if (e.key === 'Escape') onCancelEdit()
            }}
          />
          <Button size="sm" onClick={onSubmitEdit} disabled={resolving || !editValue.trim()}>
            <Check className="h-3.5 w-3.5 mr-1" />
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancelEdit}>
            Cancel
          </Button>
        </div>
      )}

      {/* Context snippet */}
      {item.context_snippet && (
        <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground italic leading-relaxed">
          {item.context_snippet}
        </blockquote>
      )}

      {/* Actions */}
      {!editing && (
        <div className="flex flex-wrap gap-2 pt-1">
          {isNewCompany ? (
            <>
              <Button
                size="sm"
                onClick={onCreateCompany}
                disabled={resolving}
                className="gap-1.5"
              >
                <Building2 className="h-3.5 w-3.5" />
                Create Company
              </Button>
              <Button size="sm" variant="outline" onClick={onReject} disabled={resolving}>
                <X className="h-3.5 w-3.5 mr-1" />
                Dismiss
              </Button>
            </>
          ) : (
            <>
              {!isMetricNotFound && !isUnidentified && hasValue && (
                <Button size="sm" onClick={onAccept} disabled={resolving} className="gap-1.5">
                  <Check className="h-3.5 w-3.5" />
                  Accept
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={onReject}
                disabled={resolving}
                className="gap-1.5"
              >
                <X className="h-3.5 w-3.5" />
                {isMetricNotFound || isUnidentified ? 'Dismiss' : 'Reject'}
              </Button>
              {hasValue && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onStartEdit}
                  disabled={resolving}
                  className="gap-1.5"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit &amp; Accept
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
