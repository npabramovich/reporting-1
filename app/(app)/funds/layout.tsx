import { VehicleProvider, VehicleBar } from '@/components/accounting-vehicle'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'
import { AnalystVehicleSync } from '@/components/analyst-scope'

// Wraps every Accounting page with the vehicle selector + context so the whole section operates
// on one portfolio_group at a time. The Analyst here is the app's ONE shared Analyst (same
// component as /dashboard, /import) — AnalystVehicleSync scopes it to the selected vehicle, and
// the server decides whether this user is entitled to those books at all.
export default function AccountingLayout({ children }: { children: React.ReactNode }) {
  return (
    <VehicleProvider>
      <AnalystVehicleSync />
      {/* The horizontal padding lives HERE, wrapping the header row and the body together,
          because the Analyst panel is in the body: with the padding on each page instead, the
          panel had nothing between it and the viewport and sat flush against the right edge
          while the page content stopped 16px short. /dashboard has always done it this way. */}
      <div className="w-full px-4 md:pl-8 md:pr-4">
        {/* The Analyst toggle sits TOP RIGHT — the same place on every page in the app, whatever
            else is or isn't on the page. It shares this row with the vehicle bar only because that
            is what happens to be at the top here; it is not anchored to it.

            Each class earns its place:
              ml-auto     — hard right even when VehicleBar renders nothing (/funds). `justify-between`
                            was the original bug: with one child it aligns to the START, so the
                            toggle jumped to the left on exactly the page with no vehicle bar.
              items-start — top, regardless of how tall the row's other content grows. With
                            items-center, opening "New vehicle" (a 2-row bar) dragged the toggle
                            down to the middle.
              md:pt-8     — matches /dashboard's `md:py-8`, so the toggle lands at the same 32px as
                            everywhere else. At pt-6 it rendered 8px high on every accounting page.
              pb-6        — the gap below, matching /dashboard's header `mb-6`: the Analyst panel
                            opens directly beneath this row, and at pb-4 it crowded the toggle.
                            Owned by the row rather than by VehicleBar's old `mb-4`, which also
                            shifted the bar's own alignment. */}
        <div className="pt-4 md:pt-8 pb-6 flex items-start gap-2">
          <VehicleBar />
          <div className="ml-auto shrink-0"><AnalystToggleButton /></div>
        </div>
        {/* Body: the page content, with the Analyst panel as a flex sibling so it shifts the
            page and sits alongside the content — the same pattern as /dashboard and /import. */}
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          <div className="flex-1 min-w-0 w-full">{children}</div>
          <AnalystPanel />
        </div>
      </div>
    </VehicleProvider>
  )
}
