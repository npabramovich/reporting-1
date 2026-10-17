import { describe, it, expect } from 'vitest'
import {
  AUDIT_CHAIN_GENESIS, auditEventContent, auditRowHash, canonicalJson, canonicalTimestamp, verifyAuditChain, type AuditEventRow,
} from '../src/audit-chain.ts'

describe('canonicalJson', () => {
  it('sorts keys by code point, recursively, with no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: null, y: true }], c: 'x' }, A: false })).toBe('{"A":false,"a":{"c":"x","d":[3,{"y":true,"z":null}]},"b":1}')
    // Code-point (UTF-8 byte) order, as COLLATE "C" sorts: "é" (U+00E9) after "z".
    expect(canonicalJson({ é: 1, z: 2, Z: 3 })).toBe('{"Z":3,"z":2,"é":1}')
  })

  it('writes numbers as plain decimals, the way Postgres trim_scale prints them', () => {
    expect(canonicalJson([1, 1.5, -0, 0, 100, 1e21, 1.25e-7, -2.5e22, 123456.789])).toBe('[1,1.5,0,0,100,1000000000000000000000,0.000000125,-25000000000000000000000,123456.789]')
  })

  it('escapes strings as JSON does and drops undefined members', () => {
    expect(canonicalJson({ s: 'quote " back \\ nl \n tab \t ctl \u0001 euro €', u: undefined })).toBe('{"s":"quote \\" back \\\\ nl \\n tab \\t ctl \\u0001 euro €"}')
  })
})

describe('canonicalTimestamp', () => {
  it('normalises the forms PostgREST and psql print to UTC microseconds', () => {
    expect(canonicalTimestamp('2026-10-10T20:00:00.123456+00:00')).toBe('2026-10-10T20:00:00.123456Z')
    expect(canonicalTimestamp('2026-10-10 15:00:00.5-05')).toBe('2026-10-10T20:00:00.500000Z')
    expect(canonicalTimestamp('2026-10-11T01:30:00+05:30')).toBe('2026-10-10T20:00:00.000000Z')
    expect(canonicalTimestamp('2026-10-10T20:00:00Z')).toBe('2026-10-10T20:00:00.000000Z')
  })
})

function chain(n: number): AuditEventRow[] {
  const rows: AuditEventRow[] = []
  let prev = AUDIT_CHAIN_GENESIS
  for (let i = 1; i <= n; i++) {
    const row: AuditEventRow = {
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, fund_id: 'f', vehicle_id: null, actor_id: 'u',
      action: 'entry.post', subject_type: 'journal_entry', subject_id: String(i), reason: null,
      details: { amount: i * 100.5, ids: [i] }, source: 'web', created_at: `2026-10-10T20:00:0${i}.000001+00:00`,
      chain_seq: i, prev_hash: prev, row_hash: null,
    }
    row.row_hash = auditRowHash(prev, auditEventContent(row))
    prev = row.row_hash
    rows.push(row)
  }
  return rows
}

describe('verifyAuditChain', () => {
  it('passes an intact chain in any order and reports its head', () => {
    const rows = chain(4)
    const r = verifyAuditChain([rows[2], rows[0], rows[3], rows[1]])
    expect(r).toMatchObject({ ok: true, checked: 4, headSeq: 4, headHash: rows[3].row_hash, firstBreak: null })
    expect(verifyAuditChain([])).toMatchObject({ ok: true, checked: 0, headSeq: null })
  })

  it('finds an edited row, a deleted row and a forged link', () => {
    const edited = chain(4); edited[1] = { ...edited[1], details: { amount: 1 } }
    expect(verifyAuditChain(edited).firstBreak).toMatchObject({ seq: 2, problem: expect.stringMatching(/content was changed/) })
    const deleted = chain(4); deleted.splice(2, 1)
    expect(verifyAuditChain(deleted).firstBreak).toMatchObject({ seq: 4, problem: expect.stringMatching(/expected sequence 3/) })
    const forged = chain(3); forged[2] = { ...forged[2], prev_hash: 'f'.repeat(64) }
    expect(verifyAuditChain(forged).firstBreak).toMatchObject({ seq: 3, problem: expect.stringMatching(/prev_hash/) })
  })

  it('a pinned head catches rows cut off the end', () => {
    const rows = chain(5)
    const pinned = { seq: 5, hash: rows[4].row_hash! }
    expect(verifyAuditChain(rows, pinned).ok).toBe(true)
    expect(verifyAuditChain(rows.slice(0, 4), pinned)).toMatchObject({ ok: false, firstBreak: { problem: expect.stringMatching(/no longer reaches/) } })
    expect(verifyAuditChain(chain(6), { seq: 3, hash: rows[2].row_hash! }).ok).toBe(true)
  })
})
