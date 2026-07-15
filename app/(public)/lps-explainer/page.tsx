import { ogMetadata } from '@/lib/og-metadata'
import { Crown } from 'lucide-react'
import { ExplainerContent } from '../explainer-content'

export const metadata = ogMetadata({
  title: 'LPs',
  description: 'Track LP capital across your vehicles from pasted statements or the ledger, view a live cross-vehicle aggregate as of any date, and print investor report cards.',
})

export default function LPsExplainerPage() {
  return (
    <ExplainerContent
      title="LPs"
      icon={Crown}
      screenshotSrc="/screenshots/lps.png"
      screenshotLabel="LPs snapshot - investor table with metrics, PDF export, and Excel download"
    >
      <p className="text-muted-foreground">
        LPs is where you track and report on your limited partner positions across every vehicle.
        It&apos;s a layered capability, off by default: turn on LP capital tracking to track LP
        capital, and optionally the LP portal and documents on top of it — independent of whether
        you keep full fund accounting.
      </p>
      <p className="text-muted-foreground">
        <strong>Live aggregate</strong> - the LPs page shows every LP across every vehicle, rolled
        up to the investor, as of any date: commitment, paid-in, distributions, NAV, DPI, TVPI, IRR.
        It reads live from the underlying data rather than a frozen snapshot, so it&apos;s never stale.
        Expand an investor to see their per-vehicle lines.
      </p>
      <p className="text-muted-foreground">
        <strong>Capital tracking</strong> - for a vehicle you don&apos;t keep books on, feed it by
        pasting a statement (commitment, called/paid-in, distributions, NAV) — AI maps the columns
        into a dated position, stamped with its as-of date. The set of dates is your history over
        time; the capital account as of any date is the latest position on or before it. Type in or
        edit figures by hand too. When a vehicle is on the ledger, the same page shows the same
        accounts from the books.
      </p>
      <p className="text-muted-foreground">
        <strong>Report cards</strong> - print investor report cards — the per-investor summary
        aggregated across vehicles — straight from the live data, one at a time or the whole list at
        once. Each footnotes when its data was last updated, per vehicle, because vehicles report on
        irregular cadences.
      </p>
      <p className="text-muted-foreground">
        <strong>Snapshots archive</strong> - freeze a point-in-time set of positions and keep it
        exactly as it was, in an admin-only archive with its own bulk PDF printing and Excel export.
        Snapshots stop driving the live numbers but remain the record for anything you&apos;ve already
        sent. Paste-import, inline edit, group investors under a parent, merge duplicates, filter
        portfolio groups, and configure a report header/footer — all still there.
      </p>
    </ExplainerContent>
  )
}
