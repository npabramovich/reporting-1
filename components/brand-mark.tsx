import { MARK_PATHS, MARK_VIEWBOX } from '@/lib/brand-mark'

/**
 * The Welden mark, filled with currentColor so it follows the text colour and theme. It is
 * about three times as wide as it is tall: size it by height with `w-auto`.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox={MARK_VIEWBOX} fill="currentColor" className={className}>
      {MARK_PATHS.map(p => (
        <path key={p.d} d={p.d} fillRule={p.fillRule} />
      ))}
    </svg>
  )
}
