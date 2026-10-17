// The sample close bundle in examples/bundle/: the sample fund (fixture.ts) closed through
// 2025-06-30. test/bundle.test.ts pins the checked-in files to what buildBundle writes for this.

import { buildBundle, termsFileFrom } from '../src/bundle.ts'
import { serializeLedger } from '../src/text-ledger.ts'
import { sha256Hex } from '../src/sha256.ts'
import { sampleAccounts, sampleEntries } from './fixture.ts'

export const SAMPLE_PERIOD_END = '2025-06-30'

export function sampleBundle() {
  const ledgerText = serializeLedger(sampleAccounts, sampleEntries.filter(e => e.entryDate <= SAMPLE_PERIOD_END))
  const partners = sampleAccounts.filter(a => a.lpEntityId).map(a => ({
    id: a.lpEntityId!,
    name: a.name.replace(/^Partners' capital — /, ''),
    account: a.code,
    commitment: a.code === '3100-aaaaaaaa' ? 600000 : a.code === '3100-bbbbbbbb' ? 400000 : null,
  }))
  const gp = partners.find(p => p.account === '3100-c0ffee00')!.id
  const terms = termsFileFrom({
    vehicle: 'Sample Fund I',
    carry: { kind: 'european', carryRate: 0.2, prefRate: 0.08, catchupRate: 1, prefCompounds: true, gpEntityId: gp, recipients: [{ lpEntityId: gp, pct: 100 }] },
    partners,
    allocationBasis: 'commitment',
  })
  return buildBundle({
    ledgerText,
    terms,
    subject: {
      fundId: '00000000-0000-4000-8000-000000000001',
      vehicleId: '00000000-0000-4000-8000-000000000002',
      vehicle: 'Sample Fund I',
      fiscalPeriodId: '00000000-0000-4000-8000-000000000003',
      periodStart: '2025-06-01',
      periodEnd: SAMPLE_PERIOD_END,
    },
    createdAt: '2025-07-01T12:00:00.000Z',
    auditChain: { headSeq: 42, headHash: sha256Hex('sample audit head') },
  })
}
