// Resolving a memo citation to something a human can act on.
//
// A paragraph's `sources` are `{ source_type, source_id }` pairs, where source_id is
// the id of a CLAIM, a research FINDING, or a Q&A answer — never a document. Rendered
// naively that gives you "[1] claim:c_4f2a", which tells a reader nothing: they can't
// tell which document in the data room backs the sentence, which is the whole point of
// a citation in an investment memo.
//
// The link exists, it just takes one hop: the ingestion output nests claims UNDER the
// document they were extracted from (`ingestion.documents[].claims[]`), so a claim id
// resolves to a `document_id`, which resolves to a file name. This module walks that
// chain once and hands back a lookup every renderer shares, so the markdown export, the
// DOCX export, and the on-screen editor all cite a source the same way.

export interface SourceRef {
  source_type: string
  source_id: string
}

export interface SourceLabel {
  /** What to show: the data-room document, the research URL's title, etc. */
  label: string
  /** The claim's field / the finding's headline — the specific thing being cited. */
  detail?: string
  /** Set when the citation resolves to a data-room document, so the UI can link to it. */
  documentId?: string
  /** Set for research findings that carry a URL. */
  url?: string
}

/** The slices of the draft this needs. Everything is optional — a partial draft still renders. */
export interface SourceLabelInput {
  ingestion?: {
    documents?: Array<{
      document_id?: string
      detected_type?: string
      claims?: Array<{ id?: string; field?: string; value?: string }>
    }>
  } | null
  research?: {
    findings?: Array<{ id?: string; claim?: string; headline?: string; summary?: string; url?: string; source_url?: string; source?: string }>
  } | null
  qa?: Array<{ question_id?: string; question?: string }> | null
  /** document_id → file name, from `diligence_documents`. */
  documentNames?: Record<string, string> | null
}

export const sourceKey = (s: SourceRef) => `${s.source_type}:${s.source_id}`

/**
 * Build the citation lookup, keyed by `"<source_type>:<source_id>"`.
 *
 * Unresolvable ids are deliberately absent rather than faked — a caller that can't find
 * a key falls back to the raw id, which is ugly but honest. Silently inventing a
 * document name for a claim we can't trace would be worse than showing the id.
 */
export function buildSourceLabels(input: SourceLabelInput): Map<string, SourceLabel> {
  const out = new Map<string, SourceLabel>()
  const names = input.documentNames ?? {}

  for (const doc of input.ingestion?.documents ?? []) {
    const docId = doc.document_id
    if (!docId) continue
    // Fall back to the detected type, then the raw id: a document that was never named
    // still beats printing a bare claim id.
    const docLabel = names[docId] || doc.detected_type || docId
    for (const c of doc.claims ?? []) {
      if (!c.id) continue
      out.set(`claim:${c.id}`, {
        label: docLabel,
        detail: c.field || undefined,
        documentId: docId,
      })
    }
  }

  for (const f of input.research?.findings ?? []) {
    if (!f.id) continue
    const url = f.url || f.source_url || undefined
    // Research findings vary in shape across schema versions; take the first field that
    // actually carries text rather than assuming one.
    const text = f.headline || f.claim || f.summary || undefined
    out.set(`finding:${f.id}`, {
      label: f.source || hostOf(url) || 'Research',
      detail: text,
      url,
    })
  }

  for (const r of input.qa ?? []) {
    if (!r.question_id) continue
    out.set(`qa_answer:${r.question_id}`, { label: 'Founder Q&A', detail: r.question || undefined })
  }

  return out
}

function hostOf(url?: string): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

/**
 * One-line rendering of a citation: the document (or source), then the specific field.
 * `assumption` and `gap` sources have no artefact behind them, so they name themselves.
 */
export function formatSource(ref: SourceRef, labels: Map<string, SourceLabel>): string {
  const hit = labels.get(sourceKey(ref))
  if (hit) return hit.detail ? `${hit.label} — ${hit.detail}` : hit.label
  if (ref.source_type === 'assumption') return `Assumption — ${ref.source_id}`
  if (ref.source_type === 'gap') return `Gap — ${ref.source_id}`
  // Unresolved: show what we have rather than pretend.
  return `${ref.source_type}:${ref.source_id}`
}
