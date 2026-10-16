// The audit trail's hash chain, recomputed outside the database.
//
// Each accounting_audit_events row stores prev_hash (the previous row's row_hash, per fund; the
// first row's is 64 zeros) and row_hash = sha256(prev_hash || canonical JSON of the row's
// content). The database computes both in a trigger (supabase/migrations/…_audit_hash_chain.sql)
// and can walk the chain itself (verify_accounting_audit_chain). This module is the same
// computation in TypeScript, so a chain can be checked by something that does not trust the
// database that wrote it.
//
// CANONICAL JSON — must match public.canonical_jsonb in that migration, character for character:
//   - objects: keys in Unicode code-point order (= UTF-8 byte order = COLLATE "C"), no whitespace;
//   - arrays: in order, no whitespace;
//   - strings: JSON escaping (\" \\ \b \f \n \r \t, other control characters as \u00xx);
//   - numbers: plain decimal, no exponent, no trailing fractional zeros (Postgres trim_scale);
//   - true, false, null as themselves.
// A number is exact when it is representable as a double, which every value the app writes is
// (the app writes them from JavaScript).

import { sha256Hex } from './sha256.ts'

export const AUDIT_CHAIN_GENESIS = '0'.repeat(64)

/** Expand a JavaScript number's string form into plain decimal with no exponent. */
function plainNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`canonical JSON has no representation for ${n}`)
  if (Object.is(n, -0) || n === 0) return '0'
  const s = String(n)
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s)
  if (!m) return s
  const [, sign, int, frac = '', expStr] = m
  const exp = Number(expStr)
  const digits = int + frac
  const point = int.length + exp // position of the decimal point within `digits`
  let out: string
  if (point <= 0) out = '0.' + '0'.repeat(-point) + digits
  else if (point >= digits.length) out = digits + '0'.repeat(point - digits.length)
  else out = digits.slice(0, point) + '.' + digits.slice(point)
  if (out.includes('.')) out = out.replace(/0+$/, '').replace(/\.$/, '')
  out = out.replace(/^0+(?=\d)/, '')
  return sign + out
}

function compareCodePoints(a: string, b: string): number {
  const ai = Array.from(a), bi = Array.from(b)
  const n = Math.min(ai.length, bi.length)
  for (let i = 0; i < n; i++) {
    const d = ai[i].codePointAt(0)! - bi[i].codePointAt(0)!
    if (d !== 0) return d
  }
  return ai.length - bi.length
}

/** Canonical JSON text for a JSON value (see the header). `undefined` object members are dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return plainNumber(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(v => canonicalJson(v === undefined ? null : v)).join(',') + ']'
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
    entries.sort(([a], [b]) => compareCodePoints(a, b))
    return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v)).join(',') + '}'
  }
  throw new Error(`canonical JSON has no representation for a ${typeof value}`)
}

/**
 * A Postgres timestamptz as the chain hashes it: UTC, microseconds, `YYYY-MM-DDTHH:MM:SS.ffffffZ`
 * (to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')). Accepts the forms
 * PostgREST and psql print: a `T` or a space, 0–6 fractional digits, `Z` or a ±HH[:MM] offset.
 */
export function canonicalTimestamp(text: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(String(text).trim())
  if (!m) throw new Error(`not a timestamp: ${text}`)
  const [, y, mo, d, h, mi, s, frac = '', zone = 'Z'] = m
  let offsetMinutes = 0
  if (zone !== 'Z') {
    const z = /^([+-])(\d{2}):?(\d{2})?$/.exec(zone)!
    offsetMinutes = (z[1] === '-' ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3] ?? 0))
  }
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) - offsetMinutes * 60_000
  const iso = new Date(ms).toISOString() // YYYY-MM-DDTHH:MM:SS.000Z
  return `${iso.slice(0, 19)}.${frac.padEnd(6, '0')}Z`
}

/** The columns an audit row's hash covers. */
export interface AuditEventRow {
  id: string
  fund_id: string
  vehicle_id: string | null
  actor_id: string | null
  action: string
  subject_type: string
  subject_id: string | null
  reason: string | null
  details: unknown
  source: string | null
  created_at: string
  chain_seq: number
  prev_hash: string | null
  row_hash: string | null
}

/** The canonical content of one audit row — what row_hash covers (everything but the two hashes). */
export function auditEventContent(row: AuditEventRow): string {
  return canonicalJson({
    id: row.id,
    fund_id: row.fund_id,
    vehicle_id: row.vehicle_id ?? null,
    actor_id: row.actor_id ?? null,
    action: row.action,
    subject_type: row.subject_type,
    subject_id: row.subject_id ?? null,
    reason: row.reason ?? null,
    details: row.details ?? {},
    source: row.source ?? null,
    created_at: canonicalTimestamp(row.created_at),
    chain_seq: Number(row.chain_seq),
  })
}

/** row_hash = sha256(prev_hash || canonical content). */
export function auditRowHash(prevHash: string, content: string): string {
  return sha256Hex(prevHash + content)
}

export interface AuditChainResult {
  ok: boolean
  checked: number
  headSeq: number | null
  headHash: string | null
  /** The first row that does not hold, and why. */
  firstBreak: { seq: number | null; id: string; problem: string } | null
}

/**
 * Walk one fund's chain from its first row. Rows may arrive in any order; they are walked by
 * chain_seq. Reports the first break: a missing or repeated sequence number, a prev_hash that is not
 * the previous row's hash, or a row whose content no longer matches its own hash.
 *
 * A chain cannot show rows cut off its END — the last row simply becomes the head. That is what a
 * pinned head (a close bundle's manifest) is for: `expectHead` checks the chain still reaches it.
 */
export function verifyAuditChain(
  rows: AuditEventRow[],
  expectHead?: { seq: number; hash: string } | null,
): AuditChainResult {
  const sorted = [...rows].sort((a, b) => Number(a.chain_seq) - Number(b.chain_seq))
  let prev = AUDIT_CHAIN_GENESIS
  let expectedSeq = 1
  let checked = 0
  const fail = (row: AuditEventRow, problem: string): AuditChainResult => ({
    ok: false, checked, headSeq: checked ? expectedSeq - 1 : null, headHash: checked ? prev : null,
    firstBreak: { seq: row.chain_seq == null ? null : Number(row.chain_seq), id: row.id, problem },
  })
  const pinned = new Map<number, string>()
  for (const row of sorted) {
    if (row.chain_seq == null || Number(row.chain_seq) !== expectedSeq) {
      return fail(row, `expected sequence ${expectedSeq}, found ${row.chain_seq ?? 'none'}: a row is missing, repeated or out of order`)
    }
    if (row.prev_hash !== prev) return fail(row, "prev_hash is not the previous row's hash: the chain was broken here")
    let recomputed: string
    try { recomputed = auditRowHash(prev, auditEventContent(row)) } catch (e) { return fail(row, (e as Error).message) }
    if (row.row_hash !== recomputed) return fail(row, 'the row no longer matches its hash: its content was changed')
    pinned.set(expectedSeq, recomputed)
    prev = recomputed
    expectedSeq++
    checked++
  }
  const result: AuditChainResult = { ok: true, checked, headSeq: checked ? expectedSeq - 1 : null, headHash: checked ? prev : null, firstBreak: null }
  if (expectHead) {
    const at = pinned.get(expectHead.seq)
    if (at !== expectHead.hash) {
      return {
        ...result, ok: false,
        firstBreak: { seq: expectHead.seq, id: '', problem: at === undefined ? `the chain no longer reaches the pinned head (sequence ${expectHead.seq})` : `the row at the pinned head (sequence ${expectHead.seq}) has a different hash` },
      }
    }
  }
  return result
}
