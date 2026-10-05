import { MARK_PATHS, MARK_STROKE, MARK_VIEWBOX } from '@/lib/brand-mark'

/**
 * Hemrock's mark, stroked in currentColor so it follows the text colour and theme. It is a
 * little wider than tall: size it by height with `w-auto`.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox={MARK_VIEWBOX}
      fill="none"
      stroke="currentColor"
      strokeWidth={MARK_STROKE.width}
      strokeLinecap={MARK_STROKE.linecap}
      strokeLinejoin={MARK_STROKE.linejoin}
      className={className}
    >
      {MARK_PATHS.map(p => (
        <path key={p.d} d={p.d} />
      ))}
    </svg>
  )
}
