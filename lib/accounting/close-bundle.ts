// A period close's reproducibility bundle — the loader and the store.
//
// The bundle itself (its files, its manifest, how it verifies) is the open fund engine's
// (packages/fund-engine/src/bundle.ts). This module gathers what the engine needs from the
// database — the close's own ledger snapshot, the vehicle's carry terms, allocation basis, partners
// and commitments, and the audit trail's chain head — and keeps the result in close_bundles
// (supabase/migrations/20261016170000_close_bundles_and_audit_hash_chain.sql).
//
// Anyone holding a bundle can check it without this app: `fund-engine verify --bundle <dir>`.

import type { SupabaseClient } from '@supabase/supabase-js'
import JSZip from 'jszip'
import {
  BUNDLE_FILES, buildBundle, termsFileFrom, verifyBundle,
  type BundleManifest, type CloseBundle, type VerifyResult,
} from '@portfolio/fund-engine'
import { loadCarryTerms } from './carry'
import { loadAllocationBasis, loadResolvedCommitments } from './terms'
import { fetchAllRows, loadEntityNames } from './load'
import { vehicleIdByName } from './vehicle-id'
import { lpCapitalCode } from './chart'

/** PostgREST's "column not in the schema cache" and Postgres' "undefined column/table". */
const MISSING_SCHEMA = new Set(['PGRST204', 'PGRST205', '42703', '42P01'])
export const isMissingSchema = (error: { code?: string } | null | undefined) => !!error?.code && MISSING_SCHEMA.has(error.code)

/** The audit trail's chain head for a fund: the last event's sequence and hash. Null before the chain exists. */
export async function auditChainHead(admin: SupabaseClient, fundId: string): Promise<{ headSeq: number; headHash: string } | null> {
  const { data, error } = await (admin as any).from('accounting_audit_events')
    .select('chain_seq, row_hash').eq('fund_id', fundId)
    .order('chain_seq', { ascending: false }).limit(1).maybeSingle()
  if (error || !data || data.chain_seq == null || !data.row_hash) return null
  return { headSeq: Number(data.chain_seq), headHash: String(data.row_hash) }
}

/**
 * The vehicle's terms as the engine's terms file: carry terms, allocation basis, and every partner
 * with a capital account (or a commitment, or a share of the carry), named, with their capital
 * account's chart code and their commitment as of `asOf`.
 */
export async function vehicleTermsFile(admin: SupabaseClient, fundId: string, group: string, asOf: string): Promise<Record<string, unknown>> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const [carry, basis, names, commitments, capitalAccounts] = await Promise.all([
    loadCarryTerms(admin, fundId, group),
    loadAllocationBasis(admin, fundId, group),
    loadEntityNames(admin, fundId, group),
    loadResolvedCommitments(admin, fundId, group, asOf),
    vehicleId
      ? fetchAllRows<any>((f, t) => (admin as any).from('chart_of_accounts').select('code, lp_entity_id')
        .eq('fund_id', fundId).eq('vehicle_id', vehicleId).not('lp_entity_id', 'is', null).order('code').range(f, t))
      : Promise.resolve([]),
  ])
  const accountOf = new Map<string, string>()
  for (const a of capitalAccounts as { code: string; lp_entity_id: string }[]) {
    // A per-partner capital account is 3100-<entity>; other per-partner accounts (receivables) are not capital.
    if (a.code?.startsWith('3100-') && !accountOf.has(a.lp_entity_id)) accountOf.set(a.lp_entity_id, a.code)
  }
  const ids = new Set<string>([...accountOf.keys(), ...commitments.keys(), ...carry.recipients.map(r => r.lpEntityId)])
  const partners = Array.from(ids).map(id => ({
    id,
    name: names.get(id) ?? null,
    account: accountOf.get(id) ?? lpCapitalCode(id),
    commitment: commitments.has(id) ? commitments.get(id)! : null,
  }))
  return termsFileFrom({ vehicle: group, carry, partners, allocationBasis: basis })
}

export interface CloseBundleInput {
  fundId: string
  group: string
  vehicleId: string
  fiscalPeriodId: string
  periodStart: string
  periodEnd: string
  /** The close's ledger snapshot, exactly as stored on the period. */
  snapshot: string
}

/** Build a close's bundle (writes nothing). */
export async function prepareCloseBundle(admin: SupabaseClient, input: CloseBundleInput): Promise<CloseBundle> {
  const [terms, auditChain] = await Promise.all([
    vehicleTermsFile(admin, input.fundId, input.group, input.periodEnd),
    auditChainHead(admin, input.fundId),
  ])
  const notes: string[] = []
  if (!auditChain) notes.push('The audit trail was not hash-chained when this bundle was built, so no chain head is pinned.')
  return buildBundle({
    ledgerText: input.snapshot,
    terms,
    subject: {
      fundId: input.fundId, vehicleId: input.vehicleId, vehicle: input.group, fiscalPeriodId: input.fiscalPeriodId,
      periodStart: input.periodStart, periodEnd: input.periodEnd,
    },
    createdAt: new Date().toISOString(),
    auditChain,
    notes,
  })
}

/** Keep a bundle. Append-only: a re-close keeps a new one beside the old. */
export async function storeCloseBundle(admin: SupabaseClient, input: CloseBundleInput, bundle: CloseBundle, userId: string | null): Promise<{ id: string } | { error: string }> {
  const { data, error } = await (admin as any).from('close_bundles').insert({
    fund_id: input.fundId,
    vehicle_id: input.vehicleId,
    fiscal_period_id: input.fiscalPeriodId,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    bundle_sha256: bundle.sha256,
    engine_version: bundle.manifest.engine.version,
    manifest_json: bundle.files[BUNDLE_FILES.manifest],
    ledger_text: bundle.files[BUNDLE_FILES.ledger],
    terms_json: bundle.files[BUNDLE_FILES.terms],
    statements_json: bundle.files[BUNDLE_FILES.statements],
    audit_head_seq: bundle.manifest.auditChain?.headSeq ?? null,
    audit_head_hash: bundle.manifest.auditChain?.headHash ?? null,
    created_by: userId,
  }).select('id').single()
  if (error) return { error: isMissingSchema(error) ? 'close_bundles does not exist yet (push the migration)' : error.message }
  return { id: (data as any).id }
}

export interface StoredCloseBundle {
  id: string
  fiscalPeriodId: string
  periodStart: string
  periodEnd: string
  sha256: string
  createdAt: string
  manifest: BundleManifest
  files: Record<string, string>
  /** Whether this is the bundle the period's current close recorded (fiscal_periods.close_bundle_sha256). */
  current: boolean
}

/**
 * The bundle for a period — the one its current close recorded, else the latest kept for it — or,
 * with no period, the latest for the vehicle. Null when there is none (or the table is not there yet).
 */
export async function loadCloseBundle(
  admin: SupabaseClient, fundId: string, vehicleId: string, opts: { periodId?: string | null; periodEnd?: string | null } = {},
): Promise<StoredCloseBundle | null> {
  let q = (admin as any).from('close_bundles')
    .select('id, fiscal_period_id, period_start, period_end, bundle_sha256, created_at, manifest_json, ledger_text, terms_json, statements_json')
    .eq('fund_id', fundId).eq('vehicle_id', vehicleId)
  if (opts.periodId) q = q.eq('fiscal_period_id', opts.periodId)
  if (opts.periodEnd) q = q.eq('period_end', opts.periodEnd)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(20)
  if (error) {
    if (isMissingSchema(error)) return null
    throw new Error(error.message)
  }
  const rows = (data ?? []) as any[]
  if (rows.length === 0) return null

  // The period's own record of which bundle its close produced.
  const periodIds = Array.from(new Set(rows.map(r => r.fiscal_period_id)))
  const { data: periods, error: pErr } = await (admin as any).from('fiscal_periods')
    .select('id, status, close_bundle_sha256').eq('fund_id', fundId).in('id', periodIds)
  const recorded = new Map<string, string | null>()
  if (!pErr) for (const p of (periods ?? []) as any[]) recorded.set(p.id, p.status === 'closed' ? p.close_bundle_sha256 ?? null : null)

  const row = rows.find(r => recorded.get(r.fiscal_period_id) === r.bundle_sha256) ?? rows[0]
  return {
    id: row.id,
    fiscalPeriodId: row.fiscal_period_id,
    periodStart: String(row.period_start).slice(0, 10),
    periodEnd: String(row.period_end).slice(0, 10),
    sha256: row.bundle_sha256,
    createdAt: row.created_at,
    manifest: JSON.parse(row.manifest_json),
    files: {
      [BUNDLE_FILES.manifest]: row.manifest_json,
      [BUNDLE_FILES.ledger]: row.ledger_text,
      [BUNDLE_FILES.terms]: row.terms_json,
      [BUNDLE_FILES.statements]: row.statements_json,
    },
    current: recorded.get(row.fiscal_period_id) === row.bundle_sha256,
  }
}

/** Verify a stored bundle with the engine, as `fund-engine verify` would. */
export function verifyStoredBundle(bundle: StoredCloseBundle): VerifyResult {
  return verifyBundle(name => {
    if (!(name in bundle.files)) throw new Error(`missing ${name}`)
    return bundle.files[name]
  }, { expectSha256: bundle.sha256 })
}

/** The bundle's directory name: close-<vehicle>-<period end>. */
export function bundleDirName(group: string, periodEnd: string): string {
  return `close-${group}-${periodEnd}`.replace(/[^A-Za-z0-9._-]+/g, '-')
}

/** A ZIP holding the bundle's directory, ready for `fund-engine verify --bundle <dir>`. */
export async function closeBundleZip(bundle: StoredCloseBundle, group: string): Promise<{ body: Buffer; fileName: string }> {
  const dir = bundleDirName(group, bundle.periodEnd)
  const zip = new JSZip()
  const folder = zip.folder(dir)!
  for (const [name, text] of Object.entries(bundle.files)) folder.file(name, text)
  folder.file('VERIFY.txt', [
    `Close bundle for ${group}, period ${bundle.periodStart} to ${bundle.periodEnd}.`,
    `Bundle SHA-256 (of manifest.json): ${bundle.sha256}`,
    '',
    'Check it with the open fund engine (packages/fund-engine in the Hemrock Portfolio repository):',
    `  node packages/fund-engine/bin/fund-engine.mjs verify --bundle ${dir} --expect-sha256 ${bundle.sha256}`,
    '',
    'VERIFY.txt is not part of the bundle and is not hashed.',
    '',
  ].join('\n'))
  const body = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return { body, fileName: `${dir}.zip` }
}
