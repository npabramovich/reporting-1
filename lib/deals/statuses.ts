// Deal pipeline statuses.
//
// Lives outside the 'use client' component on purpose: the Deals server component
// needs the default set to scope its first query, and a client module's exports come
// across as proxies, not values — a plain array read as one throws
// "Cannot read Symbol exports".

export type DealStatus = 'new' | 'reviewing' | 'advancing' | 'met' | 'diligence' | 'invested' | 'passed'

export const STATUS_OPTIONS: DealStatus[] = ['new', 'reviewing', 'advancing', 'met', 'diligence', 'invested', 'passed']

/**
 * What the pipeline shows before you touch anything: the deals still needing a
 * decision. `diligence` is already a whole section of its own, and `invested` /
 * `passed` are settled — they'd otherwise pile up and bury the live pitches.
 *
 * The server component applies this same default, so the first paint matches what
 * the filter says rather than flashing every deal and then hiding half of them.
 */
export const DEFAULT_STATUSES: DealStatus[] = ['new', 'reviewing', 'advancing', 'met']

export const STATUS_ORDER: Record<DealStatus, number> = {
  new: 0,
  reviewing: 1,
  advancing: 2,
  met: 3,
  diligence: 4,
  invested: 5,
  passed: 6,
}
