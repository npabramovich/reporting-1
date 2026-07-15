'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, ChevronRight, Trash2, Lock, X, Check, Pencil, Activity } from 'lucide-react'
import { useFeatureVisibility } from '@/components/feature-visibility-context'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'
import { PortfolioNotesProvider, PortfolioNotesButton, PortfolioNotesPanel } from '@/components/portfolio-notes'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Snapshot {
  id: string
  name: string
  as_of_date: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LPsPage() {
  const router = useRouter()
  const fv = useFeatureVisibility()

  // Snapshot index state
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loadingSnapshots, setLoadingSnapshots] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

  // Create snapshot dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDate, setNewDate] = useState('')
  const [creating, setCreating] = useState(false)

  // Delete snapshot confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Snapshot name editing
  const [editingSnapshotListId, setEditingSnapshotListId] = useState<string | null>(null)
  const [editingSnapshotName, setEditingSnapshotName] = useState(false)
  const [snapshotNameDraft, setSnapshotNameDraft] = useState('')

  // ----- Load snapshots -----
  async function loadSnapshots() {
    setLoadingSnapshots(true)
    try {
      const res = await fetch('/api/lps/snapshots')
      if (res.ok) {
        const body = await res.json()
        setSnapshots(body.snapshots ?? [])
        setIsAdmin(body.role === 'admin')
      }
    } finally {
      setLoadingSnapshots(false)
    }
  }

  useEffect(() => {
    loadSnapshots()
  }, [])

  // ----- Handlers -----

  async function handleCreateSnapshot() {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/lps/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), asOfDate: newDate || null }),
      })
      if (res.ok) {
        const snapshot = await res.json()
        setNewName('')
        setNewDate('')
        setCreateOpen(false)
        router.push(`/lps/${snapshot.id}`)
      }
    } finally {
      setCreating(false)
    }
  }

  async function handleDeleteSnapshot() {
    if (!deleteConfirmId || deleteConfirmText !== 'delete') return
    setDeleting(true)
    try {
      await fetch(`/api/lps/snapshots?id=${deleteConfirmId}`, { method: 'DELETE' })
      setDeleteConfirmId(null)
      setDeleteConfirmText('')
      loadSnapshots()
    } finally {
      setDeleting(false)
    }
  }

  async function saveSnapshotListName(snapshotId: string) {
    const name = snapshotNameDraft.trim()
    if (!name) return
    setEditingSnapshotName(false)
    setEditingSnapshotListId(null)
    await fetch('/api/lps/snapshots', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: snapshotId, name }),
    })
    loadSnapshots()
  }

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <PortfolioNotesProvider pageContext="lps">
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      <div className="mb-6 space-y-1">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            {fv.lps === 'admin' && <Lock className="h-4 w-4 text-amber-500" />}LPs
          </h1>
          <div className="flex items-center gap-2">
            <PortfolioNotesButton />
            <AnalystToggleButton />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">Track investments and returns for LPs across portfolios</p>
        <div className="pt-2 flex items-center gap-2">
          <Button size="sm" variant="outline" className="text-muted-foreground" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            New Snapshot
          </Button>
          {/* The other way to produce this report: derived from the books, as of any date,
              instead of frozen at import time. */}
          <Button size="sm" variant="outline" className="text-muted-foreground" asChild>
            <a href="/lps">
              <Activity className="h-4 w-4 mr-1" />
              Live report
            </a>
          </Button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
      <div className="flex-1 min-w-0 w-full">
      {loadingSnapshots ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading...
        </div>
      ) : snapshots.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">No snapshots yet. Create a snapshot to start tracking LP positions.</p>
          <Button variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Create First Snapshot
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {snapshots.map(s => (
            <div
              key={s.id}
              className="border rounded-lg p-4 hover:bg-muted/30 cursor-pointer flex items-center gap-4 group"
              onClick={() => router.push(`/lps/${s.id}`)}
            >
              <div className="flex-1 min-w-0">
                {editingSnapshotName && editingSnapshotListId === s.id ? (
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <input
                      type="text"
                      value={snapshotNameDraft}
                      onChange={e => setSnapshotNameDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveSnapshotListName(s.id)
                        if (e.key === 'Escape') { setEditingSnapshotName(false); setEditingSnapshotListId(null) }
                      }}
                      className="font-medium border border-input rounded px-2 py-0.5 bg-transparent text-foreground text-sm"
                      autoFocus
                    />
                    <button onClick={() => saveSnapshotListName(s.id)} className="text-muted-foreground hover:text-foreground"><Check className="h-3.5 w-3.5" /></button>
                    <button onClick={() => { setEditingSnapshotName(false); setEditingSnapshotListId(null) }} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ) : (
                  <p className="font-medium truncate">{s.name}</p>
                )}
                <p className="text-sm text-muted-foreground">
                  {s.as_of_date ? fmtDate(s.as_of_date) : 'No date'}
                  <span className="mx-2">&middot;</span>
                  Created {fmtDate(s.created_at?.split('T')[0] ?? null)}
                </p>
              </div>
              {isAdmin && <button
                onClick={e => {
                  e.stopPropagation()
                  setSnapshotNameDraft(s.name)
                  setEditingSnapshotName(true)
                  setEditingSnapshotListId(s.id)
                }}
                className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                title="Rename snapshot"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>}
              {isAdmin && <button
                onClick={e => { e.stopPropagation(); setDeleteConfirmId(s.id); setDeleteConfirmText('') }}
                className="text-muted-foreground hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete snapshot"
              >
                <Trash2 className="h-4 w-4" />
              </button>}
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          ))}
        </div>
      )}


      {/* Delete Snapshot Confirmation */}
      <Dialog open={!!deleteConfirmId} onOpenChange={open => { if (!open) { setDeleteConfirmId(null); setDeleteConfirmText('') } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Snapshot</DialogTitle>
            <DialogDescription>
              This will permanently delete this snapshot and all its investor data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div>
            <label className="text-sm text-muted-foreground">
              Type <strong>delete</strong> to confirm
            </label>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              className="w-full border border-input rounded px-2 py-1.5 text-sm bg-transparent text-foreground mt-1"
              placeholder="delete"
              onKeyDown={e => e.key === 'Enter' && handleDeleteSnapshot()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteConfirmId(null); setDeleteConfirmText('') }}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleDeleteSnapshot}
              disabled={deleting || deleteConfirmText !== 'delete'}
            >
              {deleting ? 'Deleting...' : 'Delete Snapshot'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Snapshot Dialog */}
      <Dialog open={createOpen} onOpenChange={open => { if (!open) setCreateOpen(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Snapshot</DialogTitle>
            <DialogDescription>Create a snapshot to track LP positions for a reporting period.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Name</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                className="w-full border border-input rounded px-2 py-1.5 text-sm bg-transparent text-foreground placeholder:text-muted-foreground mt-1"
                placeholder="e.g. Q4 2025"
                onKeyDown={e => e.key === 'Enter' && handleCreateSnapshot()}
              />
            </div>
            <div>
              <label className="text-sm font-medium">As-of Date <span className="text-muted-foreground font-normal">(optional)</span></label>
              <input
                type="date"
                value={newDate}
                onChange={e => setNewDate(e.target.value)}
                className="w-full border border-input rounded px-2 py-1.5 text-sm bg-transparent text-foreground mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateSnapshot} disabled={creating || !newName.trim()}>
              {creating ? 'Creating...' : 'Create Snapshot'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
      <PortfolioNotesPanel />
      <AnalystPanel />
      </div>
    </div>
    </PortfolioNotesProvider>
  )
}
