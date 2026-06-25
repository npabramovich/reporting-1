'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Share2, Mail } from 'lucide-react'

interface Investor { id: string; name: string }

/**
 * Admin control on the GP snapshot page: choose which LP investors can see this
 * snapshot in their portal, and invite an investor's contact to create a login.
 */
export function LpSnapshotShare({ snapshotId }: { snapshotId: string }) {
  const [open, setOpen] = useState(false)
  const [investors, setInvestors] = useState<Investor[]>([])
  const [shared, setShared] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [inviteFor, setInviteFor] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!open || investors.length) return
    setLoading(true)
    Promise.all([
      fetch('/api/lps/investors').then(r => (r.ok ? r.json() : [])),
      fetch(`/api/lps/snapshots/${snapshotId}/share`).then(r => (r.ok ? r.json() : { lp_investor_ids: [] })),
    ])
      .then(([invs, sh]) => {
        setInvestors((Array.isArray(invs) ? invs : []).map((i: any) => ({ id: i.id, name: i.name })))
        setShared(new Set(sh.lp_investor_ids ?? []))
      })
      .finally(() => setLoading(false))
  }, [open, snapshotId, investors.length])

  async function toggle(id: string) {
    const next = new Set(shared)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setShared(next)
    setSaving(true)
    await fetch(`/api/lps/snapshots/${snapshotId}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lp_investor_ids: Array.from(next) }),
    }).catch(() => {})
    setSaving(false)
  }

  async function invite(investorId: string) {
    if (!inviteEmail.trim()) return
    const res = await fetch('/api/lps/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lp_investor_id: investorId, email: inviteEmail.trim() }),
    })
    setMsg(res.ok ? `Invitation sent to ${inviteEmail.trim()}.` : 'Invite failed.')
    setInviteEmail('')
    setInviteFor(null)
  }

  return (
    <div className="rounded-md border bg-card">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors">
        <Share2 className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium text-sm">Share with LPs</span>
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-1" />}
        <span className="text-xs text-muted-foreground ml-auto">{shared.size > 0 ? `${shared.size} shared` : 'not shared'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t pt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Check an investor to make this report visible in their portal. Invite an investor to create their login.
          </p>
          {msg && <div className="text-xs text-emerald-600 dark:text-emerald-400">{msg}</div>}
          {loading ? (
            <div className="text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 inline animate-spin mr-1" /> Loading…</div>
          ) : investors.length === 0 ? (
            <div className="text-xs text-muted-foreground">No LP investors yet — add them to the snapshot above first.</div>
          ) : (
            <div className="rounded-md border divide-y">
              {investors.map(inv => (
                <div key={inv.id} className="px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={shared.has(inv.id)} onChange={() => toggle(inv.id)} className="h-3.5 w-3.5" />
                    <span className="flex-1 min-w-0 truncate">{inv.name}</span>
                    <button onClick={() => { setInviteFor(inviteFor === inv.id ? null : inv.id); setInviteEmail('') }} className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                      <Mail className="h-3 w-3" /> Invite
                    </button>
                  </div>
                  {inviteFor === inv.id && (
                    <div className="flex gap-2 mt-2 ml-5">
                      <Input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="lp@email.com" className="h-7 text-xs" />
                      <Button size="sm" className="h-7 text-xs" onClick={() => invite(inv.id)} disabled={!inviteEmail.trim()}>Send</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
