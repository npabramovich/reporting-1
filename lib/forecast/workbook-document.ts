// A forecast as the Excel file the Forecast page downloads — built once, served two ways: by the
// page's export route (app/api/accounting/forecast/export) and by the assistant's signed link
// (forecast_workbook; app/api/agent/reports/[token]). Kept apart from lib/reports/documents.ts so
// the export route does not pull in the PDF renderer.

import * as XLSX from 'xlsx'
import { getSeriesWithRules, type ForecastServiceContext, type SeriesInput } from './service'
import { buildForecastWorkbook } from './workbook'

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const

/**
 * A plan (or the bare actuals) as the Excel model the Forecast page downloads
 * (lib/forecast/workbook.ts): the statements, the balance sheet and the Assumptions sheet, with every
 * formula written at the monthly grain and a quarterly or annual sheet on top. The forecast service
 * checks accounting, the entity and, for a management company, its own grant — so unlike the other
 * builders this one takes the caller's access, and throws ForecastError when it is short.
 */
export async function forecastWorkbookDocument(
  ctx: ForecastServiceContext, input: Omit<SeriesInput, 'interval'> & { interval: 'month' | 'quarter' | 'year' },
): Promise<{ body: Buffer; fileName: string; contentType: typeof XLSX_TYPE }> {
  const { series, rules, accounts } = await getSeriesWithRules(ctx, { ...input, interval: 'month' })
  const wb = buildForecastWorkbook({
    monthly: series, rules, accounts, interval: input.interval,
    meta: { fundName: await fundName(ctx), generatedAt: new Date().toISOString() },
  })
  const name = `${series.vehicle}-${series.plan?.name ?? 'actuals'}-${input.start}-${input.end}`.replace(/[^A-Za-z0-9._-]+/g, '-')
  return { body: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, fileName: `${name}.xlsx`, contentType: XLSX_TYPE }
}

async function fundName(ctx: ForecastServiceContext): Promise<string> {
  const { data } = await (ctx.admin as any).from('funds').select('name').eq('id', ctx.fundId).maybeSingle()
  return (data as { name: string } | null)?.name ?? 'Fund'
}
