'use client'

import { useEffect, useState } from 'react'
import { Loader2, Copy, Check, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AGENT_TOOL_MANIFEST } from '@/lib/accounting/agent-tools-manifest'
import { PORTFOLIO_TOOL_MANIFEST } from '@/lib/agent/portfolio-tools-manifest'

// One surface, two domains: the portfolio (what the fund owns and how it's doing) and
// the ledger (what the books say). Grouped so the list reads as capability, not a
// flat wall of 28 names.
const TOOL_GROUPS = [
  { label: 'Portfolio, companies and performance', tools: PORTFOLIO_TOOL_MANIFEST },
  { label: 'Ledger and accounting', tools: AGENT_TOOL_MANIFEST },
]
const TOOL_COUNT = PORTFOLIO_TOOL_MANIFEST.length + AGENT_TOOL_MANIFEST.length

interface Key { id: string; name: string; key_prefix: string; scopes: string; last_used_at: string | null; revoked_at: string | null; created_at: string }

/**
 * Agent access: the caller's own API keys plus the MCP/REST endpoints an agent connects
 * to. Keys act as their owner — any member's key can read; only an admin's key can
 * write. Non-admins can mint read-only keys only.
 */
export function LedgerAgentAccess({ isAdmin }: { isAdmin: boolean }) {
  const [keys, setKeys] = useState<Key[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [mcpUrl, setMcpUrl] = useState('')
  const [showTools, setShowTools] = useState(false)

  useEffect(() => { setMcpUrl(`${window.location.origin}/api/accounting/mcp`); load() }, [])

  function load() {
    setLoading(true)
    fetch('/api/accounting/keys').then(r => (r.ok ? r.json() : [])).then(d => setKeys(Array.isArray(d) ? d : [])).finally(() => setLoading(false))
  }

  async function create() {
    if (!name.trim()) return
    setCreating(true); setNewToken(null)
    const res = await fetch('/api/accounting/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, readOnly }) })
    const data = await res.json()
    if (res.ok) { setNewToken(data.token); setName(''); load() }
    setCreating(false)
  }

  async function revoke(id: string) {
    await fetch(`/api/accounting/keys?id=${id}`, { method: 'DELETE' })
    load()
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(null), 1500)
  }

  const active = keys.filter(k => !k.revoked_at)

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Connect an AI agent (Claude, or anything that speaks MCP) to your fund over MCP or REST,
        authenticated with an API key as a Bearer token. It can ask what the fund owns, how each
        company and vehicle is performing, who the LPs are, and what the books say. Your keys act
        as you: {isAdmin
          ? 'as an admin, your keys can read everything and write — record investments, post entries, run allocations and closes.'
          : 'your keys can read the portfolio, performance and the ledger; writing requires an admin.'}
      </p>
      <p className="text-[11px] text-muted-foreground">
        Agent writes to the ledger land as <strong>drafts</strong> for you to review — recording an
        investment drafts the journal entry it implies rather than posting it.
      </p>

      {/* Endpoints */}
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-12 shrink-0 text-xs">MCP</span>
          <code className="flex-1 bg-muted rounded px-2 py-1 text-xs font-mono truncate">{mcpUrl || '…'}</code>
          <button onClick={() => copy(mcpUrl, 'mcp')} className="text-muted-foreground hover:text-foreground">{copied === 'mcp' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}</button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-12 shrink-0 text-xs">REST</span>
          <code className="flex-1 bg-muted rounded px-2 py-1 text-xs font-mono truncate">{mcpUrl.replace('/mcp', '/agent')}</code>
          <button onClick={() => copy(mcpUrl.replace('/mcp', '/agent'), 'rest')} className="text-muted-foreground hover:text-foreground">{copied === 'rest' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}</button>
        </div>
      </div>

      {newToken && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="text-amber-700 dark:text-amber-400 mb-1">Copy this token now — it won&rsquo;t be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-background rounded px-2 py-1 text-xs font-mono truncate">{newToken}</code>
            <button onClick={() => copy(newToken, 'token')} className="text-muted-foreground hover:text-foreground">{copied === 'token' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}</button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Key name (e.g. Claude agent)" className="border rounded px-2 py-1.5 text-sm flex-1 bg-transparent" />
        {isAdmin && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={readOnly} onChange={e => setReadOnly(e.target.checked)} />read-only</label>
        )}
        <Button size="sm" onClick={create} disabled={creating || !name.trim()}>{creating && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Create key</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">You can create as many keys as you need — one per agent or integration.</p>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
      ) : active.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active keys.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {active.map(k => (
              <tr key={k.id} className="border-t">
                <td className="py-1.5">{k.name}</td>
                <td className="py-1.5 font-mono text-xs text-muted-foreground">{k.key_prefix}…</td>
                <td className="py-1.5 text-xs text-muted-foreground">{k.scopes}</td>
                <td className="py-1.5 text-xs text-muted-foreground">{k.last_used_at ? 'used' : 'unused'}</td>
                <td className="py-1.5 text-right"><button onClick={() => revoke(k.id)} className="text-muted-foreground hover:text-red-600" title="Revoke"><Trash2 className="h-3.5 w-3.5" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button onClick={() => setShowTools(v => !v)} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
        {showTools ? 'Hide' : 'Show'} available tools ({TOOL_COUNT})
      </button>
      {showTools && (
        <div className="space-y-4">
          {TOOL_GROUPS.map(g => (
            <div key={g.label} className="space-y-1.5">
              <p className="text-xs font-medium">{g.label} <span className="text-muted-foreground font-normal">({g.tools.length})</span></p>
              {g.tools.map(t => (
                <div key={t.name} className="text-sm flex gap-2">
                  <code className="text-xs bg-muted rounded px-1.5 py-0.5 font-mono shrink-0">{t.name}</code>
                  <span className={`text-[10px] uppercase tracking-wider px-1 py-0.5 rounded self-center shrink-0 ${t.scope === 'write' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-muted text-muted-foreground'}`}>{t.scope}</span>
                  <span className="text-muted-foreground text-xs self-center">{t.description}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
