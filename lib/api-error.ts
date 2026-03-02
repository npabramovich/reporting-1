import { NextResponse } from 'next/server'

/**
 * Return a generic 500 error to the client while logging the real error server-side.
 * Prevents leaking internal details (table names, column names, constraint names) to clients.
 */
export function dbError(error: { message: string }, context?: string) {
  if (context) {
    console.error(`[${context}]`, error.message)
  } else {
    console.error('[api]', error.message)
  }
  return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 })
}
