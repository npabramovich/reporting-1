'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCircle, Check, Copy, Loader2, Shield } from 'lucide-react'
import { Section } from '@/components/settings/section'
import { AccessGrid } from '@/components/settings-access-grid'
import type { FeatureVisibilityMap } from '@/lib/types/features'

interface Member {
  id: string
  userId: string
  email: string
  role: string
  createdAt: string
}

interface JoinRequest {
  id: string
  email: string
  createdAt: string
}

// `featureVisibility` is threaded through to the access grid so it re-derives what's grantable the
// moment a switch above changes — see AccessGrid's note.
export function TeamSection({ isAdmin, featureVisibility }: { isAdmin: boolean; featureVisibility: Record<string, string> }) {
  const [members, setMembers] = useState<Member[]>([])
  const [pendingRequests, setPendingRequests] = useState<JoinRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/members')
    if (res.ok) {
      const data = await res.json()
      setMembers(data.members)
      setPendingRequests(data.pendingRequests)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleRequest = async (requestId: string, action: 'approve' | 'reject') => {
    setProcessingId(requestId)
    const res = await fetch(`/api/settings/members/${requestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    setProcessingId(null)
    if (res.ok) load()
  }

  const handleRemove = async (memberId: string) => {
    setProcessingId(memberId)
    const res = await fetch(`/api/settings/members/${memberId}`, { method: 'DELETE' })
    setProcessingId(null)
    setConfirmRemoveId(null)
    if (res.ok) load()
  }

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !inviteEmail.includes('@')) return
    setInviting(true)
    setInviteError(null)
    setInviteLink(null)
    const res = await fetch('/api/settings/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail.trim() }),
    })
    setInviting(false)
    if (res.ok) {
      const data = await res.json()
      setInviteEmail('')
      if (data.inviteLink) {
        setInviteLink(data.inviteLink)
      } else {
        setInviteLink(null)
      }
      load()
    } else {
      const data = await res.json()
      setInviteError(data.error)
    }
  }

  return (
    <Section title="Team">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading...
        </div>
      ) : (
        <div className="space-y-4">
          {/* Members list */}
          <div className="border rounded-lg divide-y">
            {members.map(m => (
              <div key={m.id} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm">{m.email}</span>
                <div className="flex items-center gap-2">
                  {m.role === 'admin' ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-primary/10 text-primary rounded-full px-2 py-0.5">
                      <Shield className="h-2.5 w-2.5" />
                      Admin
                    </span>
                  ) : (
                    <>
                      <span className="text-xs text-muted-foreground">Member</span>
                      {isAdmin && confirmRemoveId === m.id ? (
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleRemove(m.id)}
                            disabled={processingId === m.id}
                            className="h-6 text-[11px] px-2"
                          >
                            {processingId === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirm'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmRemoveId(null)}
                            className="h-6 text-[11px] px-2"
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : isAdmin ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmRemoveId(m.id)}
                          className="h-6 text-[11px] px-2 text-muted-foreground hover:text-destructive"
                        >
                          Remove
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pending requests (admin only) */}
          {isAdmin && pendingRequests.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-2">Pending requests</p>
              <div className="border rounded-lg divide-y">
                {pendingRequests.map(r => (
                  <div key={r.id} className="flex items-center justify-between px-3 py-2">
                    <div>
                      <span className="text-sm">{r.email}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRequest(r.id, 'reject')}
                        disabled={processingId === r.id}
                        className="h-7 text-xs"
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleRequest(r.id, 'approve')}
                        disabled={processingId === r.id}
                        className="h-7 text-xs"
                      >
                        {processingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Approve'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Invite new member (admin only) */}
          {isAdmin && (
            <div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
                <div className="flex-1">
                  <Label>Invite new member</Label>
                  <p className="text-xs text-muted-foreground mt-1 mb-2">
                    Send an email invitation. The user will be automatically added to the fund upon logging in.
                  </p>
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => { setInviteEmail(e.target.value); setInviteError(null) }}
                    placeholder="teammate@domain.com"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleInvite() }}
                  />
                </div>
                <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim() || !inviteEmail.includes('@')} size="sm">
                  {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </Button>
              </div>
              {inviteError && (
                <p className="text-sm text-destructive flex items-center gap-1 mt-1">
                  <AlertCircle className="h-3 w-3" /> {inviteError}
                </p>
              )}
              {inviteLink && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">
                    Member added! Copy and share this invite link if they did not receive an email:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-[11px] bg-muted rounded px-2 py-1 break-all font-mono">{inviteLink}</code>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(inviteLink)
                        setInviteLinkCopied(true)
                        setTimeout(() => setInviteLinkCopied(false), 2000)
                      }}
                    >
                      {inviteLinkCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Who can reach what. Sits with the roster deliberately: "who is on the team" and
              "what they can see" are one decision, and splitting them across two screens is how
              you end up with a member nobody remembered to scope. */}
          {isAdmin && (
            <div className="pt-2 border-t">
              <p className="text-xs font-medium mb-2 mt-3">Access</p>
              <AccessGrid featureVisibility={featureVisibility as FeatureVisibilityMap} />
            </div>
          )}
        </div>
      )}
    </Section>
  )
}
