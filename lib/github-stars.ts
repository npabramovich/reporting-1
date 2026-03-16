import { createAdminClient } from '@/lib/supabase/admin'

const REPO = 'tdavidson/reporting'
const STALE_MINUTES = 360 // refresh at most once every 6 hours

/**
 * Get the cached GitHub star count from app_settings.
 * If the cached value is stale (older than STALE_MINUTES), refresh it in the background.
 * Returns the star count, or null if not yet populated.
 */
export async function getGitHubStars(): Promise<number | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('app_settings')
    .select('github_stars, github_stars_checked_at')
    .limit(1)
    .single()

  if (!data) return null

  const checkedAt = data.github_stars_checked_at
    ? new Date(data.github_stars_checked_at).getTime()
    : 0
  const isStale = Date.now() - checkedAt > STALE_MINUTES * 60 * 1000

  if (isStale) {
    // Fire-and-forget refresh — don't block the render
    refreshStarCount().catch(() => {})
  }

  return data.github_stars ?? null
}

/**
 * Fetch the current star count from GitHub and store it in app_settings.
 */
export async function refreshStarCount(): Promise<number | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: { Accept: 'application/vnd.github+json' },
      next: { revalidate: 0 },
    })
    if (!res.ok) return null

    const repo = await res.json()
    const stars: number = repo.stargazers_count ?? 0

    const admin = createAdminClient()
    await admin
      .from('app_settings')
      .update({
        github_stars: stars,
        github_stars_checked_at: new Date().toISOString(),
      })
      .not('id', 'is', null) // update the single row

    return stars
  } catch {
    return null
  }
}
