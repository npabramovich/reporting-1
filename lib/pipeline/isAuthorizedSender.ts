import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export async function isAuthorizedSender(
  supabase: AdminClient,
  fundId: string,
  email: string
): Promise<boolean> {
  const { data } = await supabase
    .from('authorized_senders')
    .select('id')
    .eq('fund_id', fundId)
    .eq('email', email)
    .maybeSingle()
  return !!data
}
