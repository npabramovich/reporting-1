'use client'

import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'

interface FiltersSheetProps {
  children: React.ReactNode
  activeCount?: number
}

export function FiltersSheet({ children, activeCount }: FiltersSheetProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="outline" size="sm" className="text-muted-foreground" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="h-4 w-4 mr-1.5" />
        Filters
        {!!activeCount && activeCount > 0 && (
          <span className="ml-1.5 rounded-full bg-foreground text-background text-[10px] px-1.5 py-0.5 leading-none font-medium">{activeCount}</span>
        )}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-[320px] max-w-[85vw]">
          <h3 className="text-lg font-semibold mb-6">Filters</h3>
          <div className="space-y-4">
            {children}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
