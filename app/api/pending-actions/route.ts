import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertReadAccess } from '@/lib/api-helpers'
import { loadAccessContext, hasAccess } from '@/lib/access/effective'
import { getWriteAction } from '@/lib/pending-actions/registry'

/**
 * The fund's pending-action queue. A fund's queue spans domains, so the route itself is ungated
 * (UNGATED_ROUTES) and each row is filtered here by whether the caller can READ its domain —
 * approving still requires WRITE, enforced in the approve endpoint.
 */
export async function GET() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const access = await loadAccessContext(admin, gate.fundId, user.id, gate.role)

  const { data: rows } = await admin
    .from('pending_actions' as any)
    .select('*')
    .eq('fund_id', gate.fundId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  const visible = ((rows ?? []) as unknown as Array<{ action_type: string }>).filter(row => {
    const action = getWriteAction(row.action_type)
    return action ? hasAccess(access, action.domain, 'read', action.accessFeature) : false
  })

  return NextResponse.json(visible)
}
