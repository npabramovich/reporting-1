import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOutboundConfig, sendOutboundEmail } from '@/lib/email'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  if (membership.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const body = await req.json()
  const { subject, body_html, body_text, recipients, quarter_label, cc } = body

  if (!subject?.trim()) return NextResponse.json({ error: 'Subject is required' }, { status: 400 })
  if (!body_html?.trim() && !body_text?.trim()) return NextResponse.json({ error: 'Body is required' }, { status: 400 })
  if (!recipients?.length) return NextResponse.json({ error: 'No recipients selected' }, { status: 400 })

  // Get the fund's outbound email config
  const config = await getOutboundConfig(admin, membership.fund_id)
  if (!config) {
    return NextResponse.json({ error: 'No outbound email provider configured. Set one up in Settings.' }, { status: 400 })
  }

  // Send one email per company — all addresses for a company go in the To field
  const results: { emails: string; success: boolean; error?: string; messageId?: string }[] = []

  for (const recipient of recipients as { emails: string[]; companyName: string }[]) {
    const toAddresses = recipient.emails.join(', ')
    try {
      const result = await sendOutboundEmail(config, {
        to: toAddresses,
        subject: subject.trim(),
        html: body_html.trim(),
        cc: cc?.trim() || undefined,
      })
      results.push({ emails: toAddresses, success: true, messageId: result.id?.toString() })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      results.push({ emails: toAddresses, success: false, error: msg })
    }
  }

  // Save the request record
  const sent = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  await admin.from('email_requests').insert({
    fund_id: membership.fund_id,
    subject: subject.trim(),
    body_html: (body_text ?? body_html).trim(),
    recipients,
    quarter_label: quarter_label?.trim() || null,
    sent_by: user.id,
    status: 'sent',
    sent_at: new Date().toISOString(),
    send_results: { sent, failed, details: results },
  })

  return NextResponse.json({ sent, failed, results })
}
