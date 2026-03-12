import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'

// Bulk upsert applicability settings
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  const { fundId } = writeCheck

  const body = await req.json()
  const { settings } = body as {
    settings: { compliance_item_id: string; applies: string; dismissed: boolean; dismissed_reason?: string }[]
  }

  if (!Array.isArray(settings) || settings.length === 0 || settings.length > 100) {
    return NextResponse.json({ error: 'settings array required (1-100 items)' }, { status: 400 })
  }

  const VALID_APPLIES = ['yes', 'no', 'unsure']

  const rows = settings.map(s => ({
    fund_id: fundId,
    compliance_item_id: String(s.compliance_item_id).slice(0, 100),
    applies: VALID_APPLIES.includes(s.applies) ? s.applies : 'unsure',
    dismissed: !!s.dismissed,
    dismissed_reason: s.dismissed_reason ? String(s.dismissed_reason).slice(0, 500) : null,
    dismissed_by: s.dismissed ? user.id : null,
    dismissed_at: s.dismissed ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }))

  const { data, error } = await admin
    .from('compliance_fund_settings')
    .upsert(rows, { onConflict: 'fund_id,compliance_item_id' })
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Update a single item's setting
export async function PATCH(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  const { fundId } = writeCheck

  const body = await req.json()
  const { compliance_item_id, applies, dismissed, dismissed_reason, notes } = body

  if (!compliance_item_id) {
    return NextResponse.json({ error: 'compliance_item_id required' }, { status: 400 })
  }

  const VALID_APPLIES = ['yes', 'no', 'unsure']

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (applies !== undefined) {
    updates.applies = VALID_APPLIES.includes(applies) ? applies : 'unsure'
  }
  if (dismissed !== undefined) {
    updates.dismissed = !!dismissed
    updates.dismissed_by = dismissed ? user.id : null
    updates.dismissed_at = dismissed ? new Date().toISOString() : null
    updates.dismissed_reason = dismissed_reason ? String(dismissed_reason).slice(0, 500) : null
  }
  if (notes !== undefined) {
    updates.notes = notes ? String(notes).slice(0, 2000) : null
  }

  const { data, error } = await admin
    .from('compliance_fund_settings')
    .upsert({
      fund_id: fundId,
      compliance_item_id,
      ...updates,
    }, { onConflict: 'fund_id,compliance_item_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
