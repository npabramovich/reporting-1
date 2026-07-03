import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { persistEntry } from '@/lib/accounting/persist'
import { buildAllocationEntry, type AllocationBody } from '@/lib/accounting/allocation-actions'

// POST — compute (and optionally post) a period allocation or period close.
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = (await req.json().catch(() => ({}))) as AllocationBody & { post?: boolean; group?: string }
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const built = await buildAllocationEntry(admin, gate.fundId, group, body)
  if ('error' in built) return NextResponse.json({ error: built.error }, { status: 400 })

  if (!body.post) return NextResponse.json({ preview: built.entry })

  const result = await persistEntry(admin, gate.fundId, group, user.id, built.entry, 'posted')
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, entryId: result.entryId, entry: built.entry })
}
