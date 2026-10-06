'use client'

import type { ImportReview } from '@/lib/accounting/import-review'
import { useCurrency, formatCurrencyFull } from '@/components/currency-context'

export function ImportReviewPanel({ review }: { review: ImportReview | null }) {
  const currency = useCurrency()
  if (!review) return null
  return <div className="rounded-lg border p-3 space-y-3 text-sm">
    <p className="font-medium">Comparison with existing records</p>
    <p className="text-muted-foreground">Checked {review.checked.investments} investment positions and {review.checked.lpPositions} LP positions. Existing investment and LP records are preserved. Journal comparisons include posted books plus this import; other unposted drafts are excluded.</p>
    {review.checked.lpComparisonAvailable === false && <p className="text-muted-foreground">LP balances require LP capital access and were not included in this comparison.</p>}
    {review.differences.length === 0 ? <p>No differences found in the records this import could compare. Unmapped activity still needs review.</p> : <>
      <p className="text-warning">{review.differences.length} differences or possible overlaps need review. Imported values below show projected books for journal imports, or individual cash movements for bank imports.</p>
      <div className="overflow-auto max-h-96"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Record / date</th><th className="p-2">Measure</th><th className="p-2 text-right">Existing record</th><th className="p-2 text-right">Import / projected</th><th className="p-2 text-right">Difference</th></tr></thead><tbody>
        {review.differences.map((d, i) => <tr key={i} className="border-b align-top"><td className="p-2">{d.name}<div className="text-xs text-muted-foreground">{d.date}</div></td><td className="p-2">{d.metric}<p className="text-xs text-muted-foreground max-w-md mt-1">{d.message}</p></td><td className="p-2 text-right tabular-nums">{formatCurrencyFull(d.recorded, currency)}</td><td className="p-2 text-right tabular-nums">{formatCurrencyFull(d.imported, currency)}</td><td className="p-2 text-right tabular-nums">{formatCurrencyFull(d.difference, currency)}</td></tr>)}
      </tbody></table></div>
    </>}
  </div>
}
