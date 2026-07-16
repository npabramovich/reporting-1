import { VehicleProvider, VehicleBar } from '@/components/accounting-vehicle'
import { AccountingAnalystShell, AccountingAnalystButton } from '@/components/accounting-analyst'

// Wraps every Accounting page with the vehicle selector + context so the whole
// section operates on one portfolio_group at a time.
export default function AccountingLayout({ children }: { children: React.ReactNode }) {
  return (
    <VehicleProvider>
      {/* The Analyst shell makes room for the assistant panel on the right when it's open,
          shifting the page — the same pattern as /dashboard and /import elsewhere in the app. */}
      <AccountingAnalystShell>
        <div className="w-full">
          {/* The vehicle bar and the page title sit close together on purpose — pages
              add only a small top pad below this, so the header reads as one block. The
              Analyst toggle sits at the right of this row, matching other pages. */}
          <div className="px-4 md:pl-8 md:pr-4 pt-4 md:pt-6 flex items-center justify-between gap-2">
            <VehicleBar />
            <AccountingAnalystButton />
          </div>
          {children}
        </div>
      </AccountingAnalystShell>
    </VehicleProvider>
  )
}
