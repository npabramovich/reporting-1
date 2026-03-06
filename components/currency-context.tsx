'use client'

import { createContext, useContext } from 'react'
export { getCurrencySymbol } from '@/lib/currency'
import { getCurrencySymbol } from '@/lib/currency'

const CurrencyContext = createContext<string>('USD')

export function CurrencyProvider({ currency, children }: { currency: string; children: React.ReactNode }) {
  return <CurrencyContext.Provider value={currency}>{children}</CurrencyContext.Provider>
}

export function useCurrency() {
  return useContext(CurrencyContext)
}

/** Abbreviated currency format: $1.2M, €500K, ¥1,000 */
export function formatCurrency(value: number, currency: string): string {
  const symbol = getCurrencySymbol(currency)
  if (Math.abs(value) >= 1_000_000) {
    return `${symbol}${(value / 1_000_000).toFixed(1)}M`
  }
  if (Math.abs(value) >= 1_000) {
    return `${symbol}${(value / 1_000).toFixed(0)}K`
  }
  return value.toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 0 })
}

/** Full-precision currency format: $1,234,567 */
export function formatCurrencyFull(value: number, currency: string): string {
  return value.toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 0 })
}

/** Full-precision currency with decimals: $12.50 */
export function formatCurrencyPrice(value: number, currency: string): string {
  return value.toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 2 })
}

