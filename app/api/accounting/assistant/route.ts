import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { runAssistant, applyProposal } from '@/lib/accounting/assistant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST — { action: 'ask', message }  → review + proposals for the vehicle
//        { action: 'apply', proposal } → apply one proposal as a draft entry
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  if (body?.action === 'apply') {
    if (!body?.proposal) return NextResponse.json({ error: 'proposal is required' }, { status: 400 })
    const result = await applyProposal(admin, gate.fundId, group, user.id, body.proposal)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true, ...result })
  }

  const result = await runAssistant(admin, gate.fundId, group, String(body?.message ?? ''))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result)
}
