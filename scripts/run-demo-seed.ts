// One-off runner for the demo seed (seedDemoData is otherwise only reachable via
// the authenticated admin API). Scoped to the demo fund only.
import { createAdminClient } from '../lib/supabase/admin'
import { seedDemoData } from '../lib/demo/seed'

async function main() {
  const admin = createAdminClient()
  const { data: admins, error } = await admin
    .from('fund_members')
    .select('user_id')
    .eq('role', 'admin')
    .limit(1)
  if (error) { console.error('admin lookup failed:', error.message); process.exit(1) }
  const adminUserId = admins?.[0]?.user_id
  if (!adminUserId) { console.error('No admin fund_member found to seed under.'); process.exit(1) }

  console.log('Seeding demo data as admin user', adminUserId, '…')
  const ok = await seedDemoData(adminUserId)
  console.log(ok ? '✅ Demo seeded.' : '❌ seedDemoData returned false.')
  process.exit(ok ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
