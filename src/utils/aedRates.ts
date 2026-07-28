// ============================================================================
// AED conversion rates — single source of truth for the financial reports.
//
// Every accounting statement (Trial Balance, P&L, Balance Sheet, General
// Ledger) is presented in AED. Documents entered in a foreign currency are
// converted with these fixed rates. USD uses the UAE dirham peg; the rest
// are standing approximations that can be edited here in one place.
//
// Rate = "how many AED for 1 unit of the currency".
// ============================================================================
export const AED_RATES: Record<string, number> = {
  AED: 1,
  USD: 3.6725, // UAE Central Bank peg
  EUR: 4.00,
  GBP: 4.70,
  SAR: 0.98,
  INR: 0.044,
  CAD: 2.70,
  AUD: 2.40,
  JPY: 0.025,
};

// Convert an amount in `currency` to AED. Unknown currencies fall back to
// 1:1 so a stray code never silently zeroes a figure (it just isn't scaled).
export function toAed(amount: number, currency: string | null | undefined): number {
  const cur = (currency || 'AED').toUpperCase();
  const rate = AED_RATES[cur] ?? 1;
  return Math.round(amount * rate * 10000) / 10000;
}
