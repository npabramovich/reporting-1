import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureDefaults, getActiveSchemas } from '@/lib/memo-agent/firm-schemas'
import { getActiveAnchors, getSynthesisConfidence } from '@/lib/memo-agent/style-anchors'
import { DiligenceSettingsEditor } from './settings-editor'

export const metadata: Metadata = { title: 'Diligence Settings' }

/**
 * Diligence settings — open to any fund member (not admin-only). Single page
 * with accordions for per-stage guidance, default checklist, models / caps /
 * web search / export, example memos, and schemas. Server-loads the data the
 * inlined editors need (schemas list, anchor library) so they don't double-
 * fetch on mount.
 */
export default async function DiligenceSettingsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) redirect('/dashboard')
  const fundId = (membership as any).fund_id as string

  await ensureDefaults(fundId, admin)
  const schemas = await getActiveSchemas(fundId, admin)
  const anchors = await getActiveAnchors(fundId, admin)
  const anchorConfidence = getSynthesisConfidence(anchors.length)

  // Pre-fetch schema metadata for the inline list. We don't need yaml_content
  // here — just version + edited_at for the per-schema row.
  const schemaSummary = Object.fromEntries(
    Object.entries(schemas).map(([name, row]) => [name, row ? { schema_version: row.schema_version, edited_at: row.edited_at } : null]),
  )

  // Anchor list — strip extracted_text for the initial payload.
  const initialAnchors = anchors.map(a => ({
    ...a,
    extracted_text: a.extracted_text ? `${a.extracted_text.slice(0, 200)}…` : null,
    extracted_text_length: a.extracted_text?.length ?? 0,
  })) as any

  return (
    <DiligenceSettingsEditor
      initialSchemas={schemaSummary as any}
      initialAnchors={initialAnchors}
      initialAnchorConfidence={anchorConfidence}
    />
  )
}
