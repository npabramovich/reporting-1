import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

interface LpInvestmentDef {
  investor: string
  entity: string
  portfolio_group: string
  commitment: number
  paid_in_capital: number
  called_capital: number
  outstanding_balance: number
  distributions: number
  nav: number
  total_value: number
  dpi: number
  rvpi: number
  tvpi: number
  irr: number
}

// LP positions for Hemrock Ventures Fund I + Fund II as of 2025-12-31.
// Numbers reconcile to Fund I total commit $12M, Fund II total commit $10M
// matching the existing fund_cash_flows seed data.
const SNAPSHOT_NAME = 'Year End 2025'
const SNAPSHOT_DATE = '2025-12-31'
const SNAPSHOT_DESCRIPTION = 'Annual LP snapshot reconciled to fund cash flows and portfolio NAV. Multiples reflect Q4 2025 marks.'

// Fake LP portal logins for the demo activity log. Emails use this sentinel
// domain so re-seeds can find and clear the prior demo accounts.
const DEMO_LP_DOMAIN = 'lp.hemrock-demo.example.com'

const LP_INVESTMENTS: LpInvestmentDef[] = [
  // --- Fund I LPs (total commit $12M; called $10.3M; FMV $21.4M) ---
  {
    investor: 'Hemrock Founders Capital LP',
    entity: 'Hemrock Founders Capital LP',
    portfolio_group: 'Fund I',
    commitment: 4_000_000,
    paid_in_capital: 3_433_333,
    called_capital: 3_433_333,
    outstanding_balance: 566_667,
    distributions: 0,
    nav: 7_133_333,
    total_value: 7_133_333,
    dpi: 0.00,
    rvpi: 2.08,
    tvpi: 2.08,
    irr: 0.31,
  },
  {
    investor: 'Northstar Family Office',
    entity: 'Northstar Family Office I LLC',
    portfolio_group: 'Fund I',
    commitment: 3_000_000,
    paid_in_capital: 2_575_000,
    called_capital: 2_575_000,
    outstanding_balance: 425_000,
    distributions: 0,
    nav: 5_350_000,
    total_value: 5_350_000,
    dpi: 0.00,
    rvpi: 2.08,
    tvpi: 2.08,
    irr: 0.31,
  },
  {
    investor: 'Coastal University Endowment',
    entity: 'Coastal University Endowment',
    portfolio_group: 'Fund I',
    commitment: 2_500_000,
    paid_in_capital: 2_145_833,
    called_capital: 2_145_833,
    outstanding_balance: 354_167,
    distributions: 0,
    nav: 4_458_333,
    total_value: 4_458_333,
    dpi: 0.00,
    rvpi: 2.08,
    tvpi: 2.08,
    irr: 0.31,
  },
  {
    investor: 'Pinecrest Foundation',
    entity: 'Pinecrest Foundation Charitable Trust',
    portfolio_group: 'Fund I',
    commitment: 1_500_000,
    paid_in_capital: 1_287_500,
    called_capital: 1_287_500,
    outstanding_balance: 212_500,
    distributions: 0,
    nav: 2_675_000,
    total_value: 2_675_000,
    dpi: 0.00,
    rvpi: 2.08,
    tvpi: 2.08,
    irr: 0.31,
  },
  {
    investor: 'Various Angels Fund I',
    entity: 'Hemrock Angels Aggregator I LP',
    portfolio_group: 'Fund I',
    commitment: 1_000_000,
    paid_in_capital: 858_333,
    called_capital: 858_333,
    outstanding_balance: 141_667,
    distributions: 0,
    nav: 1_783_333,
    total_value: 1_783_333,
    dpi: 0.00,
    rvpi: 2.08,
    tvpi: 2.08,
    irr: 0.31,
  },

  // --- Fund II LPs (total commit $10M; called $8.5M; FMV $16.85M) ---
  {
    investor: 'Hemrock Founders Capital LP',
    entity: 'Hemrock Founders Capital LP',
    portfolio_group: 'Fund II',
    commitment: 3_500_000,
    paid_in_capital: 2_975_000,
    called_capital: 2_975_000,
    outstanding_balance: 525_000,
    distributions: 0,
    nav: 5_897_500,
    total_value: 5_897_500,
    dpi: 0.00,
    rvpi: 1.98,
    tvpi: 1.98,
    irr: 0.28,
  },
  {
    investor: 'Northstar Family Office',
    entity: 'Northstar Family Office II LLC',
    portfolio_group: 'Fund II',
    commitment: 2_500_000,
    paid_in_capital: 2_125_000,
    called_capital: 2_125_000,
    outstanding_balance: 375_000,
    distributions: 0,
    nav: 4_212_500,
    total_value: 4_212_500,
    dpi: 0.00,
    rvpi: 1.98,
    tvpi: 1.98,
    irr: 0.28,
  },
  {
    investor: 'Greenfield Pension',
    entity: 'Greenfield County Employees Pension',
    portfolio_group: 'Fund II',
    commitment: 2_000_000,
    paid_in_capital: 1_700_000,
    called_capital: 1_700_000,
    outstanding_balance: 300_000,
    distributions: 0,
    nav: 3_370_000,
    total_value: 3_370_000,
    dpi: 0.00,
    rvpi: 1.98,
    tvpi: 1.98,
    irr: 0.28,
  },
  {
    investor: 'Coastal University Endowment',
    entity: 'Coastal University Endowment',
    portfolio_group: 'Fund II',
    commitment: 1_500_000,
    paid_in_capital: 1_275_000,
    called_capital: 1_275_000,
    outstanding_balance: 225_000,
    distributions: 0,
    nav: 2_527_500,
    total_value: 2_527_500,
    dpi: 0.00,
    rvpi: 1.98,
    tvpi: 1.98,
    irr: 0.28,
  },
  {
    investor: 'Various Angels Fund II',
    entity: 'Hemrock Angels Aggregator II LP',
    portfolio_group: 'Fund II',
    commitment: 500_000,
    paid_in_capital: 425_000,
    called_capital: 425_000,
    outstanding_balance: 75_000,
    distributions: 0,
    nav: 842_500,
    total_value: 842_500,
    dpi: 0.00,
    rvpi: 1.98,
    tvpi: 1.98,
    irr: 0.28,
  },
]

export async function seedLpSnapshot(admin: Admin, fundId: string): Promise<void> {
  // Clear prior demo LP documents (re-seed idempotency; shares cascade).
  await (admin as any).from('lp_documents').delete().eq('fund_id', fundId)
  // Clear prior demo portal engagement (activity log, messages, fake accounts).
  await (admin as any).from('lp_access_events').delete().eq('fund_id', fundId)
  await (admin as any).from('lp_messages').delete().eq('fund_id', fundId)
  await (admin as any).from('lp_accounts').delete().ilike('email', `%@${DEMO_LP_DOMAIN}`)

  // Snapshot row.
  const { data: snapshot } = await admin
    .from('lp_snapshots')
    .insert({
      fund_id: fundId,
      name: SNAPSHOT_NAME,
      as_of_date: SNAPSHOT_DATE,
      description: SNAPSHOT_DESCRIPTION,
    } as any)
    .select('id')
    .single()
  if (!snapshot) return
  const snapshotId = (snapshot as any).id as string

  // Investors → entities → investments.
  const investorIdMap: Record<string, string> = {}
  const entityIdMap: Record<string, string> = {}

  // Distinct investors.
  const investors = Array.from(new Set(LP_INVESTMENTS.map(i => i.investor)))
  for (const name of investors) {
    const { data } = await admin
      .from('lp_investors')
      .insert({ fund_id: fundId, name } as any)
      .select('id')
      .single()
    if (data) investorIdMap[name] = (data as any).id
  }

  // Distinct entities.
  const seenEntities = new Set<string>()
  for (const inv of LP_INVESTMENTS) {
    if (seenEntities.has(inv.entity)) continue
    seenEntities.add(inv.entity)
    const investorId = investorIdMap[inv.investor]
    if (!investorId) continue
    const { data } = await admin
      .from('lp_entities')
      .insert({
        fund_id: fundId,
        investor_id: investorId,
        entity_name: inv.entity,
      } as any)
      .select('id')
      .single()
    if (data) entityIdMap[inv.entity] = (data as any).id
  }

  // Investments per snapshot.
  for (const inv of LP_INVESTMENTS) {
    const entityId = entityIdMap[inv.entity]
    if (!entityId) continue
    await admin.from('lp_investments').insert({
      fund_id: fundId,
      entity_id: entityId,
      portfolio_group: inv.portfolio_group,
      commitment: inv.commitment,
      paid_in_capital: inv.paid_in_capital,
      called_capital: inv.called_capital,
      outstanding_balance: inv.outstanding_balance,
      distributions: inv.distributions,
      nav: inv.nav,
      total_value: inv.total_value,
      dpi: inv.dpi,
      rvpi: inv.rvpi,
      tvpi: inv.tvpi,
      irr: inv.irr,
      snapshot_id: snapshotId,
    } as any)
  }

  // LP portal demo (Option A): share the snapshot + the demo letter with every
  // demo investor so the "view as LP" preview shows real content.
  const investorIds = Object.values(investorIdMap)
  if (investorIds.length > 0) {
    await (admin as any).from('lp_snapshot_shares').insert(
      investorIds.map(id => ({ snapshot_id: snapshotId, lp_investor_id: id, fund_id: fundId })),
    )
    const { data: letters } = await (admin as any).from('lp_letters').select('id').eq('fund_id', fundId)
    for (const l of (letters ?? [])) {
      await (admin as any).from('lp_letter_shares').insert(
        investorIds.map(id => ({ letter_id: l.id, lp_investor_id: id, fund_id: fundId })),
      )
    }
  }

  // Sample LP documents — display-only. storage_path uses a 'sample/' sentinel
  // (no real file), so the portal recognizes them and blocks download.
  // Showcases the Documents tab + both scopes (fund-wide and per-investor).
  const sampleFundDocs: Array<{ title: string; file: string; category: string; doc_date: string | null; size: number }> = [
    { title: 'Fund I Annual Report 2025', file: 'Fund-I-Annual-Report-2025.pdf', category: 'Financials', doc_date: '2025-12-31', size: 2_400_000 },
    { title: 'Audited Financial Statements 2025', file: 'Audited-Financials-2025.pdf', category: 'Financials', doc_date: '2026-03-15', size: 1_100_000 },
    { title: '2025 K-1 Tax Package', file: 'K-1-Package-2025.pdf', category: 'Tax', doc_date: '2026-03-15', size: 480_000 },
    { title: 'Limited Partnership Agreement', file: 'LPA.pdf', category: 'Legal', doc_date: null, size: 3_200_000 },
  ]
  for (const d of sampleFundDocs) {
    await (admin as any).from('lp_documents').insert({
      fund_id: fundId, title: d.title, file_name: d.file, storage_path: `sample/${fundId}/${d.file}`,
      mime_type: 'application/pdf', size_bytes: d.size, scope: 'fund', category: d.category, doc_date: d.doc_date,
    })
  }
  if (investorIds.length > 0) {
    const { data: capDoc } = await (admin as any).from('lp_documents').insert({
      fund_id: fundId, title: 'Q4 2025 Capital Account Statement', file_name: 'Capital-Account-Q4-2025.pdf',
      storage_path: `sample/${fundId}/Capital-Account-Q4-2025.pdf`, mime_type: 'application/pdf', size_bytes: 320_000,
      scope: 'investor', category: 'Capital Accounts', doc_date: '2025-12-31',
    }).select('id').single()
    if (capDoc) {
      await (admin as any).from('lp_document_shares').insert(
        investorIds.map(id => ({ document_id: capDoc.id, lp_investor_id: id, fund_id: fundId })),
      )
    }
  }

  // -------------------------------------------------------------------------
  // Portal engagement — fake LP logins + views/downloads for the Activity page,
  // plus a couple of LP messages. Accounts are display-only (no auth user), so
  // they can't sign in; they exist to give the activity log real names.
  // -------------------------------------------------------------------------
  await seedLpEngagement(admin, fundId, investorIdMap, snapshotId)
}

// LP accounts to fake activity for (must match investor names seeded above).
const DEMO_LP_ACCOUNTS = [
  { investor: 'Northstar Family Office', display: 'Northstar Family Office', slug: 'northstar' },
  { investor: 'Coastal University Endowment', display: 'Coastal University Endowment', slug: 'coastal' },
  { investor: 'Greenfield Pension', display: 'Greenfield County Pension', slug: 'greenfield' },
]
const DEMO_AUTHORIZED = { display: 'Alex Rivera', slug: 'arivera', principal: 'Northstar Family Office' }

async function seedLpEngagement(
  admin: Admin,
  fundId: string,
  investorIdMap: Record<string, string>,
  snapshotId: string,
): Promise<void> {
  const a = admin as any
  const now = Date.now()
  const ts = (daysAgo: number) => new Date(now - daysAgo * 86400000).toISOString()

  // Targets the events point at (the docs + letters we just shared).
  const { data: docRows } = await a.from('lp_documents').select('id, title').eq('fund_id', fundId)
  const { data: letterRows } = await a.from('lp_letters').select('id, period_label').eq('fund_id', fundId)
  const docs = (docRows ?? []) as { id: string; title: string }[]
  const letters = (letterRows ?? []) as { id: string; period_label: string }[]
  const docByTitle = (needle: string) => docs.find(d => d.title.toLowerCase().includes(needle.toLowerCase())) ?? null

  // Create the fake LP accounts + their links.
  const accountByInvestor: Record<string, string> = {}
  for (const acc of DEMO_LP_ACCOUNTS) {
    const investorId = investorIdMap[acc.investor]
    if (!investorId) continue
    const { data: created } = await a.from('lp_accounts').insert({
      kind: 'lp', email: `${acc.slug}@${DEMO_LP_DOMAIN}`, display_name: acc.display, status: 'active',
    }).select('id').single()
    if (!created) continue
    accountByInvestor[acc.investor] = created.id
    await a.from('lp_account_links').insert({ lp_account_id: created.id, fund_id: fundId, lp_investor_id: investorId })
  }

  // One authorized user delegated on the principal's account (no direct link).
  let authorizedAccountId: string | null = null
  const principalId = accountByInvestor[DEMO_AUTHORIZED.principal]
  const principalInvestorId = investorIdMap[DEMO_AUTHORIZED.principal]
  if (principalId && principalInvestorId) {
    const { data: au } = await a.from('lp_accounts').insert({
      kind: 'authorized_user', email: `${DEMO_AUTHORIZED.slug}@${DEMO_LP_DOMAIN}`, display_name: DEMO_AUTHORIZED.display, status: 'active',
    }).select('id').single()
    if (au) {
      authorizedAccountId = au.id
      await a.from('lp_authorized_users').insert({
        authorized_user_account_id: au.id, principal_lp_account_id: principalId, lp_investor_id: principalInvestorId,
      })
    }
  }

  const annual = docByTitle('Annual Report')
  const cap = docByTitle('Capital Account')
  const k1 = docByTitle('K-1')
  const letter = letters[0] ?? null

  const events: any[] = []
  const add = (accountId: string | null, investor: string, type: 'login' | 'view' | 'download', targetType: 'portal' | 'snapshot' | 'letter' | 'document', targetId: string | null, title: string | null, daysAgo: number) => {
    if (!accountId) return
    if (targetType !== 'portal' && !targetId) return
    events.push({
      fund_id: fundId, lp_account_id: accountId, auth_user_id: null,
      lp_investor_id: investorIdMap[investor] ?? null,
      event_type: type, target_type: targetType, target_id: targetId, target_title: title,
      metadata: {}, created_at: ts(daysAgo),
    })
  }

  const ns = accountByInvestor['Northstar Family Office'] ?? null
  const co = accountByInvestor['Coastal University Endowment'] ?? null
  const gf = accountByInvestor['Greenfield Pension'] ?? null

  // Northstar — most active LP.
  add(ns, 'Northstar Family Office', 'login', 'portal', null, null, 1)
  add(ns, 'Northstar Family Office', 'view', 'snapshot', snapshotId, SNAPSHOT_NAME, 1)
  add(ns, 'Northstar Family Office', 'download', 'document', cap?.id ?? null, cap?.title ?? null, 1)
  add(ns, 'Northstar Family Office', 'download', 'document', annual?.id ?? null, annual?.title ?? null, 6)
  add(ns, 'Northstar Family Office', 'view', 'letter', letter?.id ?? null, letter?.period_label ?? null, 12)

  // Coastal.
  add(co, 'Coastal University Endowment', 'login', 'portal', null, null, 3)
  add(co, 'Coastal University Endowment', 'view', 'snapshot', snapshotId, SNAPSHOT_NAME, 3)
  add(co, 'Coastal University Endowment', 'download', 'document', annual?.id ?? null, annual?.title ?? null, 3)
  add(co, 'Coastal University Endowment', 'download', 'document', k1?.id ?? null, k1?.title ?? null, 9)

  // Greenfield.
  add(gf, 'Greenfield Pension', 'login', 'portal', null, null, 8)
  add(gf, 'Greenfield Pension', 'view', 'snapshot', snapshotId, SNAPSHOT_NAME, 8)
  add(gf, 'Greenfield Pension', 'download', 'document', cap?.id ?? null, cap?.title ?? null, 8)

  // Authorized user acting for Northstar.
  add(authorizedAccountId, 'Northstar Family Office', 'login', 'portal', null, null, 2)
  add(authorizedAccountId, 'Northstar Family Office', 'view', 'snapshot', snapshotId, SNAPSHOT_NAME, 2)
  add(authorizedAccountId, 'Northstar Family Office', 'download', 'document', annual?.id ?? null, annual?.title ?? null, 2)

  if (events.length > 0) await a.from('lp_access_events').insert(events)

  // A couple of LP messages for the Messages section.
  await a.from('lp_messages').insert([
    {
      fund_id: fundId, lp_account_id: co, lp_investor_id: investorIdMap['Coastal University Endowment'] ?? null,
      from_email: `coastal@${DEMO_LP_DOMAIN}`, subject: 'Q4 capital account statement',
      body: 'Thanks for posting the Q4 statement. Could you confirm the outstanding commitment figure for Fund II? It looks slightly different from our records.',
      status: 'open', created_at: ts(4),
    },
    {
      fund_id: fundId, lp_account_id: ns, lp_investor_id: investorIdMap['Northstar Family Office'] ?? null,
      from_email: `northstar@${DEMO_LP_DOMAIN}`, subject: 'K-1 timing',
      body: 'When do you expect the 2025 K-1 packages to be finalized? Our tax team is asking. Thanks!',
      status: 'resolved', created_at: ts(20),
    },
  ])
}
