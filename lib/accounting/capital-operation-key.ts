import { createHash } from 'node:crypto'

/** A transport nonce permits intentional identical operations; payload hashing catches retries. */
export function capitalOperationKey(input: unknown): string {
  function canonical(value: any): any {
    if (Array.isArray(value)) return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]))
    return value
  }
  return createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex')
}

export function validCapitalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validCapitalAmounts(lines: { amount: number }[]): boolean {
  return lines.every(line => Number.isFinite(Number(line.amount)) && Number(line.amount) >= 0 && (Number(line.amount) === 0 || Number(line.amount) >= 0.01))
}
