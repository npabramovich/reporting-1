import { VehicleProvider, VehicleBar } from '@/components/accounting-vehicle'

// Wraps every Accounting page with the vehicle selector + context so the whole
// section operates on one portfolio_group at a time.
export default function AccountingLayout({ children }: { children: React.ReactNode }) {
  return (
    <VehicleProvider>
      <div className="w-full">
        <div className="px-4 md:pl-8 md:pr-4 pt-4 md:pt-8">
          <VehicleBar />
        </div>
        {children}
      </div>
    </VehicleProvider>
  )
}
