import { Response, NextFunction } from 'express';
import { VoucherType, Role } from '@prisma/client';
import prisma from '../config/database';
import { AuthRequest } from '../types';

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// =====================================================================
// OUTSTANDING PAYABLES — money owed to suppliers per supplier account.
// Sums Purchase Vouchers and subtracts Supplier Payment / Payment /
// Debit Note vouchers to compute Net Outstanding per supplier.
// =====================================================================
export const outstandingPayables = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const isAdmin = req.user!.role === Role.ADMIN;
    const asOfStr = req.query.asOf as string | undefined;
    const asOf = asOfStr ? new Date(asOfStr) : new Date();
    asOf.setHours(23, 59, 59, 999);

    // Pull every voucher whose type contributes to a supplier's balance.
    const vouchers = await prisma.voucher.findMany({
      where: {
        ...(isAdmin ? {} : { userId: req.user!.id }),
        voucherDate: { lte: asOf },
        accountId: { not: null },
        type: {
          in: [
            VoucherType.PURCHASE,
            VoucherType.SUPPLIER_PAYMENT,
            VoucherType.PAYMENT,
            VoucherType.DEBIT_NOTE,
          ],
        },
      },
      select: {
        amount: true,
        currency: true,
        type: true,
        accountId: true,
        account: {
          select: {
            id: true,
            code: true,
            name: true,
            trn: true,
            mobile1: true,
            email: true,
            accountGroup: { select: { name: true, groupType: true } },
          },
        },
      },
    });

    type Bucket = {
      accountId: string;
      code: string;
      name: string;
      trn: string | null;
      mobile: string | null;
      email: string | null;
      accountGroup: string | null;
      currency: string;
      purchases: number;
      payments: number;
      debitNotes: number;
    };
    const map = new Map<string, Bucket>();

    for (const v of vouchers) {
      if (!v.accountId || !v.account) continue;
      const existing = map.get(v.accountId);
      const b: Bucket = existing ?? {
        accountId: v.accountId,
        code: v.account.code,
        name: v.account.name,
        trn: v.account.trn,
        mobile: v.account.mobile1,
        email: v.account.email,
        accountGroup: v.account.accountGroup?.name ?? null,
        currency: v.currency,
        purchases: 0,
        payments: 0,
        debitNotes: 0,
      };
      if (v.type === VoucherType.PURCHASE) b.purchases += v.amount;
      else if (v.type === VoucherType.SUPPLIER_PAYMENT) b.payments += v.amount;
      else if (v.type === VoucherType.PAYMENT) b.payments += v.amount;
      else if (v.type === VoucherType.DEBIT_NOTE) b.debitNotes += v.amount;
      map.set(v.accountId, b);
    }

    const rows = Array.from(map.values())
      .map((b) => {
        const outstanding = round2(b.purchases - b.payments - b.debitNotes);
        return {
          accountId: b.accountId,
          code: b.code,
          name: b.name,
          trn: b.trn,
          mobile: b.mobile,
          email: b.email,
          accountGroup: b.accountGroup,
          currency: b.currency,
          totalPurchase: round2(b.purchases),
          totalPaid: round2(b.payments),
          adjustments: round2(b.debitNotes),
          outstanding,
        };
      })
      .filter((r) => r.outstanding > 0.005)
      .sort((a, b) => b.outstanding - a.outstanding);

    const totalOutstanding = round2(rows.reduce((s, r) => s + r.outstanding, 0));

    // Group by currency for summary tiles.
    const byCurrency: Record<string, { count: number; outstanding: number }> = {};
    for (const r of rows) {
      byCurrency[r.currency] = byCurrency[r.currency] || { count: 0, outstanding: 0 };
      byCurrency[r.currency].count += 1;
      byCurrency[r.currency].outstanding += r.outstanding;
    }

    res.json({
      success: true,
      data: {
        asOf,
        totals: { supplierCount: rows.length, totalOutstanding },
        byCurrency: Object.entries(byCurrency).map(([k, v]) => ({
          currency: k, count: v.count, outstanding: round2(v.outstanding),
        })),
        rows,
      },
    });
  } catch (error) {
    next(error);
  }
};
