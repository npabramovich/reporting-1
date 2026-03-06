/** Get the currency symbol for a given ISO 4217 code */
export function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    USD: '$', EUR: '€', GBP: '£', CHF: 'CHF ', CAD: 'C$', AUD: 'A$',
    JPY: '¥', CNY: '¥', INR: '₹', SGD: 'S$', HKD: 'HK$', SEK: 'kr ',
    NOK: 'kr ', DKK: 'kr ', NZD: 'NZ$', BRL: 'R$', ZAR: 'R ', ILS: '₪', KRW: '₩',
  }
  return symbols[currency] ?? `${currency} `
}
