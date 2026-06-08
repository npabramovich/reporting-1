'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Check, Save, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DefaultsEditor } from '@/app/(app)/settings/memo-agent/defaults/editor'
import { StyleAnchorsLibrary } from '@/app/(app)/settings/memo-agent/style-anchors/library'
import { SCHEMA_NAMES, type SchemaName } from '@/lib/memo-agent/validate'

const SCHEMA_LABELS: Record<SchemaName, { label: string; description: string }> = {
  rubric: { label: 'Rubric', description: 'Scoring dimensions, scale, criteria' },
  qa_library: { label: 'Q&A Library', description: 'Partner Q&A pool — categories, skip logic, references to rubric dimensions' },
  data_room_ingestion: { label: 'Data Room Ingestion', description: 'Per-document extraction, claims, gap analysis' },
  research_dossier: { label: 'Research Dossier', description: 'External research, source quality tiers, founder constraints' },
  memo_output: { label: 'Memo Output', description: 'Memo assembly — sections, paragraph-level provenance, partner-only fields' },
  style_anchors: { label: 'Example Memos', description: 'Metadata for uploaded reference memos — voice and structure aggregation rules' },
  instructions: { label: 'Instructions', description: 'Operating manual — hard rules, six-stage flow, behavioral defaults' },
}

function Accordion({ title, subtitle, defaultOpen, children }: { title: string; subtitle?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div className="border rounded-md bg-card">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        <span className="flex items-center gap-2">
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
          <span className="font-medium">{title}</span>
        </span>
        {subtitle && <span className="text-xs text-muted-foreground truncate ml-4">{subtitle}</span>}
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t">{children}</div>}
    </div>
  )
}

const STAGES = ['ingest', 'research', 'qa', 'draft', 'score'] as const
type Stage = typeof STAGES[number]

const STAGE_META: Record<Stage, { label: string; hint: string; placeholder: string }> = {
  ingest: {
    label: 'Stage 1 — Ingestion',
    hint: 'How documents are read and findings extracted. Guidance here shapes what the agent treats as a finding and how it classifies documents.',
    placeholder: 'e.g. Treat founder LinkedIn-style bios as team_bio. Pull out every revenue or pipeline number even if stated loosely.',
  },
  research: {
    label: 'Stage 2 — Research',
    hint: 'How findings are verified and competitors / founders are researched.',
    placeholder: 'e.g. Prioritise verifying revenue and customer findings. For competitors, focus on the specific wedge, not the broad category.',
  },
  qa: {
    label: 'Stage 3 — Q&A',
    hint: 'How the partner Q&A flow is framed.',
    placeholder: 'e.g. Keep questions short and specific. Ask about team dynamics and founder motivation.',
  },
  draft: {
    label: 'Stage 4 — Memo draft',
    hint: 'How the memo is written — voice, structure, depth, what to emphasise. This is the highest-leverage guidance.',
    placeholder: 'e.g. Write in a punchy, opinionated voice. Open with the bet in two sentences. Be willing to take a clear view. Keep it under four pages.',
  },
  score: {
    label: 'Stage 5 — Scoring',
    hint: 'How rubric dimensions are judged.',
    placeholder: 'e.g. Weight team and market more heavily than current traction at the pre-seed stage.',
  },
}

type SchemaSummary = Record<SchemaName, { schema_version: string; edited_at: string } | null>

export function DiligenceSettingsEditor({
  initialSchemas,
  initialAnchors,
  initialAnchorConfidence,
}: {
  initialSchemas: SchemaSummary
  initialAnchors: any[]
  initialAnchorConfidence: 'unavailable' | 'preliminary' | 'reliable' | 'robust'
}) {
  const [guidance, setGuidance] = useState<Record<string, string>>({})
  const [anchors, setAnchors] = useState<Array<{ id: string; label: string }>>([])
  const [firstPageAnchorId, setFirstPageAnchorId] = useState<string>('')
  const [checklistTemplate, setChecklistTemplate] = useState<string>('')
  const [checklistIsDefault, setChecklistIsDefault] = useState<boolean>(true)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/diligence/prompts').then(r => r.ok ? r.json() : Promise.reject(new Error('prompts'))),
      fetch('/api/diligence/checklist-template').then(r => r.ok ? r.json() : Promise.reject(new Error('checklist'))),
    ])
      .then(([prompts, checklist]) => {
        setGuidance(prompts.guidance ?? {})
        setAnchors(Array.isArray(prompts.anchors) ? prompts.anchors : [])
        setFirstPageAnchorId(prompts.first_page_anchor_id ?? '')
        setChecklistTemplate(checklist.template ?? '')
        setChecklistIsDefault(!!checklist.isDefault)
        setLoaded(true)
      })
      .catch(() => { setError('Failed to load settings.'); setLoaded(true) })
  }, [])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const [promptsRes, checklistRes] = await Promise.all([
        fetch('/api/diligence/prompts', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guidance, first_page_anchor_id: firstPageAnchorId || null }),
        }),
        // Persist '' when the user wants the bundled default — the GET endpoint
        // distinguishes the two via the isDefault flag.
        fetch('/api/diligence/checklist-template', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template: checklistIsDefault ? '' : checklistTemplate }),
        }),
      ])
      if (!promptsRes.ok) {
        const body = await promptsRes.json().catch(() => ({}))
        throw new Error(body.error ?? 'Save failed (prompts)')
      }
      if (!checklistRes.ok) {
        const body = await checklistRes.json().catch(() => ({}))
        throw new Error(body.error ?? 'Save failed (checklist)')
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function restoreChecklistDefault() {
    // Re-fetch the bundled default so the textarea shows it. Setting
    // isDefault=true makes save() persist '' so future fetches keep tracking
    // the bundled text (useful if we ever update it).
    fetch('/api/diligence/checklist-template?default=1')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('reset')))
      .then(body => {
        setChecklistIsDefault(true)
        setChecklistTemplate(body.template ?? '')
      })
      .catch(() => {})
  }

  if (!loaded) {
    return <div className="p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>
  }

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 max-w-4xl">
      <Link href="/diligence" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to diligence
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight mb-1">Diligence Settings</h1>
      <p className="text-sm text-muted-foreground mb-6 max-w-2xl">
        Everything that shapes how the memo agent screens, researches, and writes for your fund.
        Open the section you need; everything saves to the same place. Open to all partners.
      </p>

      {error && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive mb-4">{error}</div>}

      <div className="space-y-3">
        <Accordion title="Per-stage guidance" subtitle="Tune voice, depth, and approach per stage" defaultOpen>
          <div className="space-y-3 pt-2">
            {STAGES.map(stage => (
              <div key={stage} className="rounded-md border p-3 space-y-2">
                <div className="text-sm font-medium">{STAGE_META[stage].label}</div>
                <p className="text-xs text-muted-foreground">{STAGE_META[stage].hint}</p>
                <textarea
                  value={guidance[stage] ?? ''}
                  onChange={e => setGuidance(prev => ({ ...prev, [stage]: e.target.value }))}
                  rows={stage === 'draft' ? 7 : 4}
                  placeholder={STAGE_META[stage].placeholder}
                  className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            ))}
          </div>
        </Accordion>

        <Accordion title="Memo first-page template" subtitle={firstPageAnchorId ? 'Anchor selected' : 'No exemplar selected'}>
          <div className="space-y-2 pt-2">
            <p className="text-xs text-muted-foreground">
              Pick a sample memo whose first page the agent should model new memos on — title block,
              framing, and opening. The memo&apos;s section structure is taken from the schema (editable
              below); the agent also mirrors your example memos&apos; structure.
            </p>
            {anchors.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No example memos uploaded yet. Add them in the Example memos section below.
              </p>
            ) : (
              <select
                value={firstPageAnchorId}
                onChange={e => setFirstPageAnchorId(e.target.value)}
                className="h-9 px-2 rounded-md border border-input bg-background text-sm w-full max-w-md"
              >
                <option value="">— no first-page exemplar —</option>
                {anchors.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            )}
          </div>
        </Accordion>

        <Accordion title="Default diligence checklist" subtitle={checklistIsDefault ? 'Using bundled default' : 'Customized'}>
          <div className="space-y-2 pt-2">
            <p className="text-xs text-muted-foreground">
              The fund-wide checklist applied when a partner clicks &ldquo;Apply fund default&rdquo; on a deal&apos;s
              Checklist tab. Section headers on their own line; items below.
            </p>
            <textarea
              value={checklistTemplate}
              onChange={e => { setChecklistTemplate(e.target.value); setChecklistIsDefault(false) }}
              rows={14}
              className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={restoreChecklistDefault}>
                Restore bundled default
              </Button>
            </div>
          </div>
        </Accordion>

        {/* The Save button only applies to the four sections above (guidance,
            anchor pick, checklist template). The defaults / example memos /
            schemas editors below have their own save buttons. */}
        <div className="flex justify-end pt-1">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : saved ? <Check className="h-4 w-4 mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            {saved ? 'Saved' : 'Save settings above'}
          </Button>
        </div>

        <Accordion title="Models, caps, web search, export" subtitle="Per-stage providers + cost guardrails">
          <div className="pt-2">
            <DefaultsEditor embedded />
          </div>
        </Accordion>

        <Accordion title="Example memos" subtitle={`${initialAnchors.length} uploaded · ${initialAnchorConfidence} match`}>
          <div className="pt-2">
            <StyleAnchorsLibrary
              initialAnchors={initialAnchors}
              initialConfidence={initialAnchorConfidence}
              embedded
            />
          </div>
        </Accordion>

        <Accordion title="Schemas" subtitle="Rubric, memo structure, document types">
          <div className="pt-2 rounded-md border divide-y">
            {SCHEMA_NAMES.map(name => {
              const meta = SCHEMA_LABELS[name]
              const row = initialSchemas[name]
              return (
                <Link
                  key={name}
                  href={`/settings/memo-agent/schemas/${name}`}
                  className="block p-3 hover:bg-muted/30"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{meta.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{meta.description}</div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground shrink-0">
                      {row ? (
                        <>
                          <div className="font-mono">{row.schema_version}</div>
                          <div>{new Date(row.edited_at).toLocaleDateString()}</div>
                        </>
                      ) : (
                        <span className="italic">not yet seeded</span>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Click a schema to open the YAML editor — versioned, with inline validation and rollback.
          </p>
        </Accordion>
      </div>
    </div>
  )
}
