import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'

interface Sender {
  email: string
  label: string
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const { fundId, senders } = await req.json() as { fundId: string; senders: Sender[] }

  if (!fundId || !Array.isArray(senders) || senders.length === 0) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Verify the fund belongs to this user
  const { data: membership } = await admin
    .from('fund_members')
    .select('id')
    .eq('fund_id', fundId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rows = senders
    .filter(s => s.email?.trim())
    .map(s => ({
      fund_id: fundId,
      email: s.email.trim().toLowerCase(),
      label: s.label?.trim() || null,
    }))

  const { error } = await admin
    .from('authorized_senders')
    .upsert(rows, { onConflict: 'fund_id,email' })

  if (error) {
    return NextResponse.json({ error: 'Failed to save senders' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
