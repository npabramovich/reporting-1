export type FeatureKey = 'interactions' | 'investments' | 'notes' | 'lp_letters' | 'imports' | 'asks' | 'lps' | 'lp_tracking' | 'lp_associates' | 'lp_portal_access' | 'lp_portal' | 'lp_activity' | 'compliance' | 'deals' | 'diligence' | 'accounting'

export type FeatureVisibility = 'everyone' | 'admin' | 'hidden' | 'off'

export type FeatureVisibilityMap = Record<FeatureKey, FeatureVisibility>

export const DEFAULT_FEATURE_VISIBILITY: FeatureVisibilityMap = {
  interactions: 'everyone',
  investments: 'everyone',
  // NOTE: there is deliberately no `funds` key any more. The Funds page moved INTO the
  // accounting section (it is now /funds, the section's landing page) and its numbers are
  // derived from the ledger — so it is gated by `accounting`, and a fund with accounting off
  // has no books to derive them from. The old `funds` key gated a page that no longer exists;
  // leaving it would have been a settings toggle that silently controlled nothing.
  notes: 'everyone',
  lp_letters: 'everyone',
  imports: 'everyone',
  asks: 'everyone',
  lps: 'admin',
  // Capital tracking: per-vehicle LP capital accounts from pasted/manual dated positions
  // (or the ledger when accounting is on). Off by default — a fund turns it on to start
  // tracking LP capital without committing to full fund accounting.
  lp_tracking: 'off',
  lp_associates: 'admin',
  lp_portal_access: 'admin',
  lp_portal: 'admin',
  lp_activity: 'admin',
  compliance: 'admin',
  deals: 'admin',
  diligence: 'off',
  accounting: 'off',
}

/** Features that support the "off" level (functionally disabled) */
export const FEATURES_WITH_OFF: FeatureKey[] = ['interactions', 'diligence', 'accounting', 'lp_tracking']

/**
 * Returns true if the feature should be visible to the current user.
 * - "everyone": always visible
 * - "admin": visible only to admins
 * - "hidden": removed from navigation (feature still works if accessed directly)
 * - "off": functionally disabled, hidden from everyone
 */
export function isFeatureVisible(
  featureVisibility: FeatureVisibilityMap | null | undefined,
  key: FeatureKey,
  isAdmin: boolean
): boolean {
  const level = featureVisibility?.[key] ?? DEFAULT_FEATURE_VISIBILITY[key]
  switch (level) {
    case 'everyone':
      return true
    case 'admin':
      return isAdmin
    case 'hidden':
    case 'off':
      return false
  }
}
