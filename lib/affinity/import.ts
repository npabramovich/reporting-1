import type { SupabaseClient } from '@supabase/supabase-js'
import { AffinityClient, renderNoteAsMarkdown, type AffinityNote } from '@/lib/affinity/client'
import { classifyDocumentHeuristic } from '@/lib/memo-agent/heuristic-classify'

/**
 * Pull an Affinity organization's notes and attached files into a deal's data
 * room. Shared by the manual "Import from Affinity" button and the background
 * sync job, so the two can never drift apart.
 *
 * Deduping is by Affinity's own IDs (`affinity_note_id` / `affinity_file_id`),
 * which have partial unique indexes on (deal_id, ...). That makes re-import
 * idempotent at the DB level rather than relying on a check-then-insert race —
 * which matters because the sync tick and a user clicking Import can overlap.
 *
 * Events are emitted through a callback so the manual route can stream NDJSON
 * progress while the background job just counts.
 */

const MAX_FILE_BYTES = 100 * 1024 * 1024  // matches the diligence-documents bucket cap

export type ImportEvent =
  | { type: 'log'; message: string }
  | { type: 'listed'; notes: number; files: number }
  | { type: 'progress'; current: number; total: number; item: string }
  | { type: 'imported'; item: string; kind: 'note' | 'file' }
  | { type: 'skipped'; item: string; reason: string }
  | { type: 'error'; item: string; error: string }
  | { type: 'done'; imported: number; skipped: number; errors: number }

export interface ImportResult {
  imported: number
  skipped: number
  errors: number
  /** Document ids created — the caller enqueues an ingest job when non-empty. */
  documentIds: string[]
}

export async function importAffinityIntoDataRoom(params: {
  admin: SupabaseClient
  apiKey: string
  fundId: string
  dealId: string
  organizationId: number
  opportunityId?: number | null
  /** Whose key this ran as — recorded as the document uploader. */
  userId: string
  /** Skip files entirely (notes-only import). */
  notesOnly?: boolean
  emit?: (event: ImportEvent) => void
}): Promise<ImportResult> {
  const { admin, fundId, dealId, organizationId, userId } = params
  const emit = params.emit ?? (() => {})
  const affinity = new AffinityClient(params.apiKey)

  let imported = 0
  let skipped = 0
  let errors = 0
  const documentIds: string[] = []

  emit({ type: 'log', message: 'Fetching notes from Affinity…' })

  const scope = {
    organizationId,
    ...(params.opportunityId ? { opportunityId: params.opportunityId } : {}),
  }

  const { notes, truncated } = await affinity.listNotes(scope)
  const files = params.notesOnly ? [] : await affinity.listEntityFiles(scope)

  if (truncated) {
    // Never let a cap look like completeness.
    emit({
      type: 'log',
      message: 'Note: this company has more than 500 notes in Affinity; only the first 500 were pulled.',
    })
  }

  emit({ type: 'listed', notes: notes.length, files: files.length })

  const org = await affinity.getOrganization(organizationId).catch(() => null)
  const orgName = org?.name ?? 'company'

  // Resolve note authors in one pass so each note header can name a real person
  // rather than an opaque Affinity user id.
  const authorNames = await resolveAuthorNames(affinity, notes)

  // Pre-fetch what we already have so re-imports report "already imported"
  // instead of surfacing a unique-violation as an error.
  const { data: existingRows } = await admin
    .from('diligence_documents')
    .select('affinity_note_id, affinity_file_id')
    .eq('deal_id', dealId)
    .eq('fund_id', fundId)
  const seenNotes = new Set(
    ((existingRows as any[]) ?? []).map(r => r.affinity_note_id).filter(Boolean).map(Number)
  )
  const seenFiles = new Set(
    ((existingRows as any[]) ?? []).map(r => r.affinity_file_id).filter(Boolean).map(Number)
  )

  const total = notes.length + files.length
  let current = 0

  // --- Notes → markdown documents -----------------------------------------
  for (const note of notes) {
    current++
    const label = `Affinity note #${note.id}`
    emit({ type: 'progress', current, total, item: label })

    if (seenNotes.has(note.id)) {
      skipped++
      emit({ type: 'skipped', item: label, reason: 'already imported' })
      continue
    }

    try {
      const markdown = renderNoteAsMarkdown(note, {
        authorName: note.creator_id ? authorNames.get(note.creator_id) : undefined,
        organizationName: orgName,
      })
      const body = Buffer.from(markdown, 'utf-8')

      const dateStr = (note.created_at ?? '').slice(0, 10) || 'undated'
      const fileName = `Affinity note ${dateStr} (#${note.id}).md`
      const storagePath = `${dealId}/${Date.now()}_affinity_note_${note.id}.md`

      const { error: upErr } = await admin.storage
        .from('diligence-documents')
        .upload(storagePath, body, { contentType: 'text/markdown', upsert: false })
      if (upErr) {
        errors++
        emit({ type: 'error', item: label, error: upErr.message })
        continue
      }

      // An Affinity "AI notetaker" note IS a call transcript, so it gets the
      // detected_type that already exists for one. Ordinary notes are left as
      // 'other' at low confidence — the agent's ingest stage is the
      // authoritative classifier and will refine it. (We deliberately do not
      // invent a 'crm_note' type: detected_type must come from
      // data_room_ingestion.yaml's document_types, and the shipped defaults are
      // treated as immutable. `source_kind` carries the Affinity badge instead.)
      const isTranscript = note.type === 3
      const { data: row, error: insErr } = await admin
        .from('diligence_documents')
        .insert({
          deal_id: dealId,
          fund_id: fundId,
          storage_path: storagePath,
          file_name: fileName,
          file_format: 'md',
          file_size_bytes: body.length,
          detected_type: isTranscript ? 'call_transcript' : 'other',
          type_confidence: isTranscript ? 'high' : 'low',
          parse_status: 'pending',
          source_kind: 'affinity',
          affinity_note_id: note.id,
          uploaded_by: userId,
        } as any)
        .select('id')
        .single()

      if (insErr) {
        await admin.storage.from('diligence-documents').remove([storagePath]).catch(() => {})
        // A unique violation means a concurrent sync beat us to it — that's a
        // skip, not a failure.
        if ((insErr as any).code === '23505') {
          skipped++
          emit({ type: 'skipped', item: label, reason: 'already imported' })
        } else {
          errors++
          emit({ type: 'error', item: label, error: insErr.message })
        }
        continue
      }

      documentIds.push((row as any).id as string)
      imported++
      emit({ type: 'imported', item: label, kind: 'note' })
    } catch (err) {
      errors++
      emit({ type: 'error', item: label, error: err instanceof Error ? err.message : 'unknown error' })
    }
  }

  // --- Entity files → real documents ---------------------------------------
  for (const file of files) {
    current++
    const label = file.name
    emit({ type: 'progress', current, total, item: label })

    if (seenFiles.has(file.id)) {
      skipped++
      emit({ type: 'skipped', item: label, reason: 'already imported' })
      continue
    }

    if (typeof file.size === 'number' && file.size > MAX_FILE_BYTES) {
      skipped++
      emit({
        type: 'skipped',
        item: label,
        reason: `too large (${Math.round(file.size / 1024 / 1024)} MB, 100 MB max)`,
      })
      continue
    }

    try {
      const bytes = await affinity.downloadEntityFile(file.id)
      if (bytes.length === 0) {
        skipped++
        emit({ type: 'skipped', item: label, reason: 'empty file' })
        continue
      }

      // Strip control characters as well as path/reserved characters — the same
      // hardening as the Drive importer, since a name can later reach a
      // Content-Disposition header.
      const safeName = file.name
        .replace(/[\x00-\x1f\x7f\/\\:*?"<>|]/g, '_')
        .replace(/\.\./g, '_')
        .slice(0, 200) || `affinity_file_${file.id}`
      const ext = (safeName.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'bin').toLowerCase()
      // Storage keys must be ASCII-safe; display names can keep their characters.
      const keySafe = safeName.replace(/[^a-zA-Z0-9._-]/g, '_')
      const storagePath = `${dealId}/${Date.now()}_affinity_${file.id}_${keySafe}`
      const mime = guessMime(ext)

      const { error: upErr } = await admin.storage
        .from('diligence-documents')
        .upload(storagePath, bytes, { contentType: mime, upsert: false })
      if (upErr) {
        errors++
        emit({ type: 'error', item: label, error: upErr.message })
        continue
      }

      const { detected_type, confidence } = classifyDocumentHeuristic(safeName, mime)

      const { data: row, error: insErr } = await admin
        .from('diligence_documents')
        .insert({
          deal_id: dealId,
          fund_id: fundId,
          storage_path: storagePath,
          file_name: safeName,
          file_format: ext,
          file_size_bytes: bytes.length,
          detected_type,
          type_confidence: confidence,
          parse_status: 'pending',
          source_kind: 'affinity',
          affinity_file_id: file.id,
          uploaded_by: userId,
        } as any)
        .select('id')
        .single()

      if (insErr) {
        await admin.storage.from('diligence-documents').remove([storagePath]).catch(() => {})
        if ((insErr as any).code === '23505') {
          skipped++
          emit({ type: 'skipped', item: label, reason: 'already imported' })
        } else {
          errors++
          emit({ type: 'error', item: label, error: insErr.message })
        }
        continue
      }

      documentIds.push((row as any).id as string)
      imported++
      emit({ type: 'imported', item: label, kind: 'file' })
    } catch (err) {
      errors++
      emit({ type: 'error', item: label, error: err instanceof Error ? err.message : 'unknown error' })
    }
  }

  await admin
    .from('diligence_deals')
    .update({ affinity_last_synced_at: new Date().toISOString() } as any)
    .eq('id', dealId)
    .eq('fund_id', fundId)

  emit({ type: 'done', imported, skipped, errors })
  return { imported, skipped, errors, documentIds }
}

/**
 * Map Affinity creator ids to display names. Affinity has no bulk user endpoint
 * on v1, and note creators are usually a handful of repeat colleagues — so we
 * resolve the distinct ids only, and fall back to the raw id if a lookup fails
 * (a missing author name must never fail an import).
 */
async function resolveAuthorNames(
  affinity: AffinityClient,
  notes: AffinityNote[]
): Promise<Map<number, string>> {
  const names = new Map<number, string>()
  const ids = Array.from(new Set(notes.map(n => n.creator_id).filter((x): x is number => !!x)))

  // Affinity persons and Affinity *users* are different objects, and v1 exposes
  // no user lookup. whoami covers the common case (the notes you wrote); anyone
  // else is labelled by id so provenance is still traceable inside Affinity.
  try {
    const me = await affinity.whoami()
    if (me?.user?.id) {
      names.set(me.user.id, `${me.user.firstName} ${me.user.lastName}`.trim() || me.user.emailAddress)
    }
  } catch {
    // non-fatal
  }

  for (const id of ids) {
    if (!names.has(id)) names.set(id, `Affinity user #${id}`)
  }
  return names
}

function guessMime(ext: string): string {
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    csv: 'text/csv',
    txt: 'text/plain',
    md: 'text/markdown',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  }
  return map[ext] ?? 'application/octet-stream'
}
