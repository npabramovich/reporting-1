import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { importBankTransactions } from '@/lib/accounting/bank-import'

// POST — import a CSV/TSV transaction feed. Parses, dedups against prior imports,
// stages each new row, and drafts a balanced entry per row for review.
// Body: { csv: string, source?: string }
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const result = await importBankTransactions(admin, gate.fundId, user.id, (body?.csv ?? '').toString(), (body?.source ?? 'csv').toString())
  if ('error' in result) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
