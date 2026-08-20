import type { PostmarkPayload } from './processEmail'

/**
 * Provider-agnostic normalized email payload.
 * Each inbound provider adapter converts its native format into this shape,
 * which is then converted to a PostmarkPayload so the existing pipeline
 * (processEmail.ts) works unchanged.
 */
export interface NormalizedEmailPayload {
  from: string
  fromName?: string
  to: string
  date?: string
  subject: string
  textBody: string
  htmlBody: string
  attachments: Array<{
    filename: string
    contentType: string
    content: string // base64
    size: number
  }>
}

/**
 * Convert a Mailgun inbound webhook (multipart form fields) into a
 * NormalizedEmailPayload.
 */
export function normalizeMailgunPayload(fields: Record<string, string>, attachments: Array<{
  filename: string
  contentType: string
  content: Buffer
}>): NormalizedEmailPayload {
  return {
    from: extractEmail(fields.from || fields.sender || ''),
    fromName: extractName(fields.from || ''),
    to: fields.recipient || fields.To || '',
    date: fields.Date || fields.date || undefined,
    subject: fields.subject || '',
    textBody: fields['body-plain'] || '',
    htmlBody: fields['body-html'] || '',
    attachments: attachments.map(a => ({
      filename: a.filename,
      contentType: a.contentType,
      content: a.content.toString('base64'),
      size: a.content.length,
    })),
  }
}

/**
 * Convert a NormalizedEmailPayload into a PostmarkPayload so the existing
 * pipeline (processEmail.ts → runPipeline) works unchanged.
 */
export function toPostmarkPayload(normalized: NormalizedEmailPayload): PostmarkPayload {
  return {
    From: normalized.from,
    FromFull: { Email: normalized.from, Name: normalized.fromName || '' },
    To: normalized.to,
    OriginalRecipient: normalized.to,
    Date: normalized.date,
    Subject: normalized.subject,
    TextBody: normalized.textBody,
    HtmlBody: normalized.htmlBody,
    Attachments: normalized.attachments.map(a => ({
      Name: a.filename,
      ContentType: a.contentType,
      Content: a.content,
      ContentLength: a.size,
    })),
  }
}

// Extract email address from "Name <email@example.com>" format
function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/)
  return match ? match[1] : from.trim()
}

function extractName(from: string): string {
  const match = from.match(/^(.+?)\s*</)
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : ''
}
