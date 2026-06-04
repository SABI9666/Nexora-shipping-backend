import { Response, NextFunction } from 'express';
import { Role, VoucherDirection } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { generateAccountStatementPdfBuffer } from '../utils/accountStatementPdf';

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export const accountStatementPdf = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const accountId = req.query.accountId as string | undefined;
    if (!accountId) throw new AppError('accountId is required', 400);

    const isAdmin = req.user!.role === Role.ADMIN;
    void isAdmin;

    const fromStr = req.query.from as string | undefined;
    const toStr = req.query.to as string | undefined;
    const from = fromStr ? new Date(fromStr) : null;
    const to = toStr ? new Date(toStr) : null;
    if (to) to.setHours(23, 59, 59, 999);

    const dateRangeWhere = (field: string) => {
      if (!from && !to) return {};
      const cond: { gte?: Date; lte?: Date } = {};
      if (from) cond.gte = from;
      if (to) cond.lte = to;
      return { [field]: cond };
    };

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      include: { accountGroup: true },
    });
    if (!account) throw new AppError('Account not found', 404);

    const nameMatch = account.name.trim();
    const invoices = await prisma.invoice.findMany({
      where: {
        AND: [
          dateRangeWhere('invoiceDate'),
          {
            OR: [
              { accountId },
              { AND: [{ accountId: null }, { billToName: { equals: nameMatch, mode: 'insensitive' } }] },
            ],
          },
        ],
      },
      orderBy: { invoiceDate: 'asc' },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        currency: true,
        total: true,
        jobNo: true,
        billToName: true,
        orderRef: { select: { orderNumber: true } },
      },
    });

    const vouchers = await prisma.voucher.findMany({
      where: { accountId, ...dateRangeWhere('voucherDate') },
      orderBy: { voucherDate: 'asc' },
      include: {
        invoice: { select: { invoiceNumber: true, currency: true } },
        order: { select: { orderNumber: true } },
        // Purchase Vouchers this payment settles — surfaced in the
        // Reference column so a supplier ledger reader can trace each
        // payment back to the exact bill it cleared.
        allocations: {
          select: { purchaseVoucher: { select: { voucherNumber: true } } },
        },
      },
    });

    const openingDr = account.opBalanceType === 'Debit' ? account.opBalance : 0;
    const openingCr = account.opBalanceType === 'Credit' ? account.opBalance : 0;

    type Row = {
      date: Date;
      voucherNumber: string;
      type: string;
      reference: string | null;
      dueDate: Date | null;
      narration: string | null;
      currency: string;
      debit: number;
      credit: number;
      runningBalance: number;
      runningSide: 'Dr' | 'Cr';
    };
    const allRows: Row[] = [];

    for (const inv of invoices) {
      allRows.push({
        date: inv.invoiceDate,
        voucherNumber: `INV ${inv.invoiceNumber}`,
        type: 'INVOICE',
        reference: inv.orderRef ? `ORD ${inv.orderRef.orderNumber}` : (inv.jobNo || null),
        dueDate: inv.dueDate ?? null,
        narration: 'Sales invoice',
        currency: inv.currency,
        debit: inv.total,
        credit: 0,
        runningBalance: 0,
        runningSide: 'Dr',
      });
    }
    for (const v of vouchers) {
      const debit = v.direction === VoucherDirection.DEBIT ? v.amount : 0;
      const credit = v.direction === VoucherDirection.CREDIT ? v.amount : 0;
      // Prefer the linked Purchase Voucher(s) on supplier-side payments,
      // then fall back to the invoice / order reference.
      const linkedPurchases = Array.from(new Set(
        (v.allocations || [])
          .map((a) => a.purchaseVoucher?.voucherNumber)
          .filter((n): n is string => !!n),
      ));
      const ref = linkedPurchases.length > 0
        ? `VCH ${linkedPurchases.join(', ')}`
        : v.invoice ? `INV ${v.invoice.invoiceNumber}` : v.order ? `ORD ${v.order.orderNumber}` : null;
      allRows.push({
        date: v.voucherDate,
        voucherNumber: v.voucherNumber,
        type: v.type,
        reference: ref,
        dueDate: null,
        narration: v.narration,
        currency: v.currency,
        debit,
        credit,
        runningBalance: 0,
        runningSide: 'Dr',
      });
    }

    allRows.sort((a, b) => a.date.getTime() - b.date.getTime());
    let runningDr = openingDr;
    let runningCr = openingCr;
    for (const r of allRows) {
      runningDr += r.debit;
      runningCr += r.credit;
      const net = runningDr - runningCr;
      r.runningBalance = round2(Math.abs(net));
      r.runningSide = net >= 0 ? 'Dr' : 'Cr';
      r.debit = round2(r.debit);
      r.credit = round2(r.credit);
    }

    const closingNet = runningDr - runningCr;

    const defaultBank = await prisma.bankAccount.findFirst({
      where: { isDefault: true },
      select: { companyTrn: true },
    });

    const buffer = await generateAccountStatementPdfBuffer({
      account: {
        code: account.code,
        name: account.name,
        accountGroup: account.accountGroup?.name || null,
        trn: account.trn,
        mobile: account.mobile1,
        email: account.email,
        address: account.address,
      },
      period: { from, to },
      opening: { debit: round2(openingDr), credit: round2(openingCr) },
      totals: {
        totalDebit: round2(runningDr - openingDr),
        totalCredit: round2(runningCr - openingCr),
      },
      closing: { balance: round2(Math.abs(closingNet)), side: closingNet >= 0 ? 'Dr' : 'Cr' },
      rows: allRows,
      companyTrn: defaultBank?.companyTrn || undefined,
    });

    const safeName = (account.name || 'ACCOUNT').replace(/[^A-Z0-9_-]+/gi, '_').slice(0, 40);
    const fromStamp = from ? from.toISOString().slice(0, 10).replace(/-/g, '') : 'all';
    const toStamp = to ? to.toISOString().slice(0, 10).replace(/-/g, '') : 'all';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Statement_${safeName}_${fromStamp}_${toStamp}.pdf"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};
