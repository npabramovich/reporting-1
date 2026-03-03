import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { noteIds } = body as { noteIds: string[] }

  if (!Array.isArray(noteIds) || noteIds.length === 0) {
    return NextResponse.json({ error: 'noteIds required' }, { status: 400 })
  }

  // Cap at 500 to prevent abuse
  const ids = noteIds.slice(0, 500)

  const admin = createAdminClient()

  // Upsert read receipts — ignore conflicts (already read)
  const rows = ids.map(noteId => ({
    user_id: user.id,
    note_id: noteId,
  }))

  await admin
    .from('note_reads' as any)
    .upsert(rows, { onConflict: 'user_id,note_id', ignoreDuplicates: true })

  return NextResponse.json({ ok: true })
}
