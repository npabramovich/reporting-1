type SupabaseAdmin = { from: (table: string) => any }

export async function logActivity(
  admin: SupabaseAdmin,
  fundId: string,
  userId: string,
  action: string,
  metadata: Record<string, unknown> = {}
) {
  try {
    await admin.from('user_activity_logs').insert({
      fund_id: fundId,
      user_id: userId,
      action,
      metadata,
    })
  } catch (err) {
    console.error('[activity] Failed to log activity:', err)
  }
}
