'use client'

import { useEffect, useState } from 'react'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminSectionContext, Section } from '@/components/settings/section'

/**
 * Connect a Heartbeat community so new threads in chosen channels become deals.
 *
 * ADMIN ONLY — and the component renders nothing at all for non-admins, because a
 * Heartbeat API key is a community-wide credential that can read every channel.
 * (The Affinity card, by contrast, is open to any member: that key is scoped to
 * the individual's own permissions.) The API enforces this too; hiding the card
 * is just so it isn't dangled at people who'd get a 403.
 *
 * It carries its OWN AdminSectionContext, unlike the cards inside the settings page's
 * admin blocks: this one sits in the shared "External Data" group, right beside the
 * per-user Affinity card. Without the provider it would inherit `false` from there and
 * render as an ordinary member-editable setting — the very confusion the amber border
 * and lock exist to prevent. It is only ever mounted for an admin (see the null return
 * below), so hard-coding `true` here cannot mislead anyone.
 */

interface WatchedChannel {
  channel_id: string
  channel_name: string | null
  webhook_registered: boolean
}

interface Status {
  connected: boolean
  enabled: boolean
  channels: Array<{ id: string; name: string }>
  channels_error?: string | null
  watched: WatchedChannel[]
  last_verified_at: string | null
  last_error: string | null
  imported_count: number
}

export function HeartbeatConnect() {
  const [status, setStatus] = useState<Status | null>(null)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingChannels, setSavingChannels] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/settings')
      .then(r => (r.ok ? r.json() : null))
      .then(s => setIsAdmin(!!s?.isAdmin))
      .catch(() => setIsAdmin(false))
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    fetch('/api/settings/heartbeat')
      .then(r => (r.ok ? r.json() : null))
      .then((s: Status | null) => {
        if (!s) return
        setStatus(s)
        setSelected(new Set(s.watched.map(w => w.channel_id)))
      })
      .catch(() => {})
  }, [isAdmin])

  async function connect() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey.trim() }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? 'Could not connect')
        return
      }
      setApiKey('')
      await refresh()
    } catch {
      setError('Could not reach Heartbeat.')
    } finally {
      setSaving(false)
    }
  }

  async function refresh() {
    const res = await fetch('/api/settings/heartbeat')
    if (!res.ok) return
    const s: Status = await res.json()
    setStatus(s)
    setSelected(new Set(s.watched.map(w => w.channel_id)))
  }

  async function saveChannels() {
    if (!status) return
    setSavingChannels(true)
    setError(null)
    try {
      const channels = status.channels
        .filter(c => selected.has(c.id))
        .map(c => ({ channel_id: c.id, channel_name: c.name }))

      const res = await fetch('/api/settings/heartbeat', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? 'Could not save channels')
        return
      }
      await refresh()
    } finally {
      setSavingChannels(false)
    }
  }

  async function setEnabled(next: boolean) {
    if (!status) return
    setStatus({ ...status, enabled: next }) // optimistic
    const res = await fetch('/api/settings/heartbeat', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    })
    if (!res.ok) setStatus({ ...status, enabled: !next }) // roll back rather than lie
  }

  async function disconnect() {
    setSaving(true)
    await fetch('/api/settings/heartbeat', { method: 'DELETE' })
    setStatus(null)
    setSelected(new Set())
    setSaving(false)
    await refresh()
  }

  // Not an admin (or we don't know yet) — render nothing.
  if (!isAdmin) return null

  const watchedIds = new Set((status?.watched ?? []).map(w => w.channel_id))
  const dirty =
    selected.size !== watchedIds.size ||
    Array.from(selected).some(id => !watchedIds.has(id))

  return (
    <AdminSectionContext.Provider value={true}>
      <Section title="Heartbeat">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Connect your Heartbeat community so that a new thread in a channel you choose arrives
          in Deals automatically, screened against your thesis like an emailed pitch.
        </p>
        <p className="text-xs text-muted-foreground">
          A Heartbeat key is issued for the whole community and can read every channel, so only
          an admin can set it. It is stored encrypted and never shown again after you save it.
        </p>

        {!status?.connected ? (
          <div className="flex gap-2">
            <Input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && apiKey.trim()) connect() }}
              placeholder="Heartbeat API key"
              autoComplete="off"
            />
            <Button onClick={connect} disabled={saving || !apiKey.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Connect'}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>
                Connected
                {status.imported_count > 0 && (
                  <span className="text-muted-foreground">
                    {' '}— {status.imported_count} deal{status.imported_count === 1 ? '' : 's'} imported so far
                  </span>
                )}
              </span>
            </div>

            {status.last_error && (
              <div className="flex items-start gap-2 text-sm text-amber-600">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{status.last_error} Re-enter your key below to reconnect.</span>
              </div>
            )}

            {/* Channel picker. Nothing is watched by default, and that is the point:
                a community is a firehose, and turning every thread in #general into a
                deal would bury the real dealflow. */}
            <div className="rounded-md border p-3 space-y-2">
              <p className="text-xs font-medium">Channels to watch</p>

              {status.channels_error ? (
                <p className="text-xs text-amber-600">{status.channels_error}</p>
              ) : status.channels.length === 0 ? (
                <p className="text-xs text-muted-foreground">No channels found in this community.</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Only threads posted in these channels become deals. Threads posted before you
                    started watching a channel are left alone.
                  </p>
                  <div className="max-h-56 overflow-y-auto space-y-1 pt-1">
                    {status.channels.map(c => (
                      <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={e => {
                            const next = new Set(selected)
                            if (e.target.checked) next.add(c.id)
                            else next.delete(c.id)
                            setSelected(next)
                          }}
                          className="h-3.5 w-3.5"
                        />
                        <span>{c.name}</span>
                      </label>
                    ))}
                  </div>
                  {dirty && (
                    <Button size="sm" onClick={saveChannels} disabled={savingChannels}>
                      {savingChannels ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save channels'}
                    </Button>
                  )}
                </>
              )}
            </div>

            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={status.enabled}
                onChange={e => setEnabled(e.target.checked)}
                className="mt-1 h-3.5 w-3.5"
              />
              <span>
                Import new threads as deals
                <span className="block text-xs text-muted-foreground">
                  Uncheck to pause without disconnecting — your key and watched channels are kept,
                  and nothing is imported until you switch it back on.
                </span>
              </span>
            </label>

            <div className="flex gap-2">
              <Input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="Replace with a new key…"
                autoComplete="off"
              />
              <Button onClick={connect} disabled={saving || !apiKey.trim()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Update'}
              </Button>
              <Button variant="outline" onClick={disconnect} disabled={saving}>
                Disconnect
              </Button>
            </div>

            {status.watched.some(w => !w.webhook_registered) && (
              <p className="text-xs text-amber-600">
                Some channels have no live webhook, so their threads will arrive on the hourly
                sweep instead of immediately. Re-saving your key re-registers them.
              </p>
            )}

            <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
              <p className="text-xs font-medium">How it works</p>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc ml-4">
                <li>
                  <strong>A new thread in a watched channel becomes a deal within seconds</strong>,
                  via a webhook Heartbeat calls. It is screened against your thesis exactly like an
                  emailed pitch, and shows up in Deals with the source “Heartbeat”.
                </li>
                <li>
                  <strong>An hourly sweep re-reads each watched channel</strong> as a safety net, so
                  a thread posted while the webhook was down still lands. A thread never becomes two
                  deals.
                </li>
                <li>
                  <strong>Very short threads are ignored</strong> — a “+1” or a bare link is not a
                  pitch, and won&rsquo;t be turned into one.
                </li>
              </ul>
            </div>
          </>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <p className="text-xs text-muted-foreground">
          Generate a key in Heartbeat under Settings → Integrations → API.
        </p>
      </div>
      </Section>
    </AdminSectionContext.Provider>
  )
}
