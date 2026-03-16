import { NextResponse } from 'next/server'
import { getGitHubStars } from '@/lib/github-stars'

export async function GET() {
  const stars = await getGitHubStars()
  return NextResponse.json({ stars })
}
