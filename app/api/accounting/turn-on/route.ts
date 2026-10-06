import { NextResponse } from 'next/server'

/** Retired: clients must choose the actual data-entry operation, not change a mode. */
export async function POST() {
  return NextResponse.json({ error: 'Accounting is always available. Import books, enter balances, or record a transaction.' }, { status: 410 })
}
