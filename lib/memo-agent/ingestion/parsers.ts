import { extractText as extractPlainText } from '@/lib/memo-agent/extract-text'
import { extractFromBuffer } from '@/lib/parsing/extractAttachmentText'
import type { IngestionFileSource } from './sources'

export interface ParsedFile {
  document_id: string
  file_name: string
  file_format: string
  detected_type: string | null
  /** Plain text extracted from the file, suitable for direct prompt inclusion. Empty for PDFs/images. */
  text: string
  /** Base64 content when the AI provider should ingest it natively (PDFs, images). */
  base64: string | null
  /** MIME type for native ingestion. */
  media_type: string | null
  /** Per-file errors that didn't fail the whole run. */
  errors: string[]
}

/**
 * Parse a single deal-room file.
 *
 *   PDF / image                → base64 + media_type, no text (AI ingests natively)
 *   DOCX / PPTX / XLSX / CSV   → text, via the shared extractFromBuffer helper
 *                                so diligence ingest stays aligned with the
 *                                inbound-email parser (markdown tables for
 *                                xlsx, slide-numbered text for pptx, etc.)
 *   MD / TXT                   → text (utf-8 decode)
 */
export async function parseFile(source: IngestionFileSource): Promise<ParsedFile> {
  const errors: string[] = []
  const fmt = source.file_format.toLowerCase()

  const out: ParsedFile = {
    document_id: source.document_id,
    file_name: source.file_name,
    file_format: fmt,
    detected_type: source.detected_type,
    text: '',
    base64: null,
    media_type: null,
    errors,
  }

  try {
    if (fmt === 'pdf') {
      out.base64 = source.buffer.toString('base64')
      out.media_type = 'application/pdf'
      // Also pull plain text as a fallback / for indexing — don't fail if it errors.
      const text = await extractPlainText(source.buffer, 'pdf').catch(() => null)
      if (text) out.text = text
      return out
    }

    if (fmt === 'png' || fmt === 'jpg' || fmt === 'jpeg' || fmt === 'webp' || fmt === 'gif') {
      out.base64 = source.buffer.toString('base64')
      out.media_type = `image/${fmt === 'jpg' ? 'jpeg' : fmt}`
      return out
    }

    if (fmt === 'md' || fmt === 'markdown' || fmt === 'txt') {
      out.text = source.buffer.toString('utf8')
      return out
    }

    // Office formats + CSV — delegate to the shared extractor. ContentType is
    // passed empty so the helper falls back to the filename extension, which
    // we trust here (file_format comes from upload validation).
    if (['docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'csv'].includes(fmt)) {
      const result = await extractFromBuffer(source.buffer, source.file_name, '')
      if (result.skipped) {
        errors.push(result.skipReason ?? `extractFromBuffer skipped ${fmt}`)
      } else {
        out.text = result.extractedText
      }
      return out
    }

    errors.push(`Unsupported format: ${fmt}`)
    return out
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
    return out
  }
}

export async function parseAll(sources: IngestionFileSource[]): Promise<ParsedFile[]> {
  return Promise.all(sources.map(parseFile))
}
