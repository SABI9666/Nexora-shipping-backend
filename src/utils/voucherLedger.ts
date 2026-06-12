import { VoucherType, VoucherDirection } from '@prisma/client';

// ============================================================================
// Account-statement ledger side for vouchers.
//
// A voucher's `direction` field encodes the bank/cash counter-account side,
// not the side that should land on the PARTY's ledger card. On a supplier
// statement, naively reading `direction` puts both Purchase and Payment in
// the Debit column — so paying a supplier appears to *increase* the balance
// instead of reducing it. From the party's perspective:
//
//   PURCHASE              — supplier becomes a creditor       → CREDIT
//   SUPPLIER_PAYMENT      — we pay them, reducing payable     → DEBIT
//   PAYMENT               — same as Supplier Payment          → DEBIT
//   DEBIT_NOTE            — debit raised against the supplier → DEBIT
//   RECEIPT               — customer pays, reducing receivable→ CREDIT
//   CREDIT_NOTE           — credit issued to customer         → CREDIT
//   CASH / BANK / JOURNAL — generic; fall back to direction
//
// Returns the amount split into debit / credit from the party's perspective.
// ============================================================================
export function partyLedgerSide(
  type: VoucherType,
  direction: VoucherDirection,
  amount: number,
): { debit: number; credit: number } {
  switch (type) {
    // Supplier-side increases payable balance on the credit side.
    case VoucherType.PURCHASE:
      return { debit: 0, credit: amount };
    // Supplier-side decreases payable balance on the debit side.
    case VoucherType.SUPPLIER_PAYMENT:
    case VoucherType.PAYMENT:
    case VoucherType.DEBIT_NOTE:
      return { debit: amount, credit: 0 };
    // Customer-side decreases receivable balance on the credit side.
    case VoucherType.RECEIPT:
    case VoucherType.CREDIT_NOTE:
      return { debit: 0, credit: amount };
    // Generic vouchers — fall back to the stored direction.
    case VoucherType.CASH:
    case VoucherType.BANK:
    case VoucherType.JOURNAL:
    default:
      return direction === VoucherDirection.DEBIT
        ? { debit: amount, credit: 0 }
        : { debit: 0, credit: amount };
  }
}
