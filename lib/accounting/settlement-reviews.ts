import type { SupabaseClient } from '@supabase/supabase-js'
import type { SettlementReview } from './settlement'

export async function loadSettlementReviews(admin: SupabaseClient, fundId: string, vehicleId: string | null, kind: 'call' | 'distribution'): Promise<SettlementReview[]> {
  if (!vehicleId) return []
  const { data, error } = await admin.from('capital_settlement_reviews' as any)
    .select('line_id, manual_amount, manual_date, links, separate_remainder')
    .eq('fund_id', fundId).eq('vehicle_id', vehicleId).eq('kind', kind)
  if (error) throw error
  return ((data ?? []) as any[]).map(row => ({ lineId: row.line_id, manualAmount: Number(row.manual_amount), manualDate: row.manual_date, links: row.links, separateRemainder: row.separate_remainder }))
}
