import { VoucherType } from '@prisma/client';

// ============================================================================
// Credit notes — shared helpers.
//
// A customer credit note is stored as a Voucher (type CREDIT_NOTE, direction
// CREDIT) linked to the invoice it reduces:
//
//   amount           — gross credit (taxable + VAT), in the invoice currency
//   netAmount        — taxable value being credited (reduces Sales)
//   outputVatPercent — VAT rate applied
//   outputVatAmount  — Output VAT reversed (reduces VAT payable to the FTA)
//
// Unlike a receipt, a credit note is NOT money received: it reduces the
// value of the sale itself. Reports therefore treat it as a deduction from
// sales / output VAT, never as "paid".
// ============================================================================

export const CREDIT_NOTE_PREFIX = 'CN';

// Reasons offered in the UI; free-text remarks are stored alongside.
export const CREDIT_NOTE_REASONS = [
  'Customer dispute',
  'Pricing / billing error',
  'Service shortfall / delay',
  'Damage or loss claim',
  'Goodwill discount',
  'Duplicate charge',
  'Other',
] as const;

const r2 = (n: number) => Math.round(n * 100) / 100;

export type CreditNoteLike = {
  type: VoucherType;
  amount: number;
  netAmount?: number | null;
  outputVatAmount?: number | null;
};

export function isCreditNote(v: { type: VoucherType }): boolean {
  return v.type === VoucherType.CREDIT_NOTE;
}

// Net / VAT / gross split of a credit note. Legacy credit notes raised from
// the generic voucher form carry no breakdown — the whole amount is then
// treated as taxable value with no VAT reversal (their historic behaviour).
export function creditNoteSplit(v: CreditNoteLike): { net: number; vat: number; gross: number } {
  const gross = r2(v.amount || 0);
  const vat = r2(v.outputVatAmount || 0);
  const net = v.netAmount && v.netAmount > 0 ? r2(v.netAmount) : r2(gross - vat);
  return { net, vat, gross };
}

// Effective VAT rate on an invoice. Lines may carry their own VAT %, so the
// header taxRate can be 0 even when VAT was charged — derive it from the
// actual tax / subtotal instead.
export function effectiveVatRate(inv: { subtotal: number; taxAmount: number; taxRate?: number | null }): number {
  if (inv.subtotal > 0 && inv.taxAmount > 0) return r2((inv.taxAmount / inv.subtotal) * 100);
  return r2(inv.taxRate || 0);
}

// Work out net + VAT from what the user typed. `amountIncludesVat` lets the
// user enter the figure the customer asked to knock off the bill (gross),
// or the taxable value (net) — both are common in disputes.
export function splitEnteredAmount(amount: number, vatPercent: number, amountIncludesVat: boolean) {
  if (amountIncludesVat) {
    const net = r2(amount / (1 + vatPercent / 100));
    return { net, vat: r2(amount - net), gross: r2(amount) };
  }
  const net = r2(amount);
  const vat = r2(net * vatPercent / 100);
  return { net, vat, gross: r2(net + vat) };
}
