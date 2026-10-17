import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertReadAccess } from '@/lib/api-helpers'
import { hasAccess, loadAccessContext } from '@/lib/access/effective'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { closeBundleZip, loadCloseBundle, verifyStoredBundle } from '@/lib/accounting/close-bundle'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET — a closed period's reproducibility bundle (lib/accounting/close-bundle.ts): the ledger
// snapshot, the vehicle's terms, the fund engine's statements and the manifest that hashes them.
//
//   ?group=<entity>        the entity (omit when the caller sees one)
//   ?periodId=<uuid>       the fiscal period; or
//   ?periodEnd=YYYY-MM-DD  the period ending on that date (omit both for the latest close)
//   ?format=zip            the bundle as a ZIP, ready for `fund-engine verify --bundle <dir>`
//   ?format=verify         the engine's verification of the stored bundle, run here
//   (default)              the manifest, the bundle hash and every file inline, as JSON
//
// Gated on accounting read (route-domains.ts). A bundle holds every partner's capital account and
// the carry, and its hashes cover all of it — a partial bundle would not verify — so it also needs
// lp_capital and gp_economics, checked here, as /api/accounting/statements checks lp_capital for
// the statement of changes in partners' capital.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const sp = req.nextUrl.searchParams
  const group = await resolveGroupOr400(admin, gate, sp.get('group'))
  if (group instanceof NextResponse) return group
  const access = await loadAccessContext(admin, gate.fundId, user.id, gate.role)
  if (!hasAccess(access, 'lp_capital', 'read') || !hasAccess(access, 'gp_economics', 'read')) {
    return NextResponse.json({ error: "A close bundle holds every partner's capital and the carry, so it needs LP capital and GP economics access." }, { status: 403 })
  }

  const periodId = sp.get('periodId')
  const periodEnd = sp.get('periodEnd')
  if (periodId && !UUID.test(periodId)) return NextResponse.json({ error: 'periodId must be a period id' }, { status: 400 })
  if (periodEnd && !ISO_DATE.test(periodEnd)) return NextResponse.json({ error: 'periodEnd must be YYYY-MM-DD' }, { status: 400 })

  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)
  if (!vehicleId) return NextResponse.json({ error: `Unknown entity "${group}"` }, { status: 400 })
  let bundle
  try {
    bundle = await loadCloseBundle(admin, gate.fundId, vehicleId, { periodId, periodEnd })
  } catch (e) {
    console.error('[close-bundle]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'The close bundle could not be read. Try again.' }, { status: 500 })
  }
  if (!bundle) return NextResponse.json({ error: 'No close bundle is recorded for that period. Bundles are kept for closes made since the feature shipped.' }, { status: 404 })

  const format = sp.get('format')
  if (format === 'zip') {
    const { body, fileName } = await closeBundleZip(bundle, group)
    return new NextResponse(new Uint8Array(body), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  }
  const base = {
    vehicle: group,
    periodId: bundle.fiscalPeriodId,
    periodStart: bundle.periodStart,
    periodEnd: bundle.periodEnd,
    bundleSha256: bundle.sha256,
    current: bundle.current,
    createdAt: bundle.createdAt,
  }
  if (format === 'verify') return NextResponse.json({ ...base, verification: verifyStoredBundle(bundle) })
  return NextResponse.json({ ...base, manifest: bundle.manifest, files: bundle.files })
}
