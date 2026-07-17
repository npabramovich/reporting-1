import { VehicleProvider } from '@/components/accounting-vehicle'
import { AccountingChrome } from '@/components/accounting-chrome'
import { AnalystVehicleSync } from '@/components/analyst-scope'

// Wraps every Accounting page with the vehicle selector + context so the whole section operates
// on one portfolio_group at a time. The Analyst here is the app's ONE shared Analyst (same
// component as /dashboard, /import) — AnalystVehicleSync scopes it to the selected vehicle, and
// the server decides whether this user is entitled to those books at all.
//
// The chrome (vehicle bar, Analyst toggle, Analyst panel) lives in AccountingChrome, which needs
// the pathname to know whether it's on the overview or a subpage — hence a client component rather
// than more markup here.
export default function AccountingLayout({ children }: { children: React.ReactNode }) {
  return (
    <VehicleProvider>
      <AnalystVehicleSync />
      {/* The horizontal padding wraps the header row and the body together, because the Analyst
          panel is in the body: with the padding on each page instead, the panel had nothing between
          it and the viewport and sat flush against the right edge while the content stopped 16px
          short. /dashboard has always done it this way. */}
      <div className="w-full px-4 md:pl-8 md:pr-4">
        <AccountingChrome>{children}</AccountingChrome>
      </div>
    </VehicleProvider>
  )
}
