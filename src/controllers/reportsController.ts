import { Response, NextFunction } from 'express';
import { Role, VoucherDirection, VoucherType, InvoiceStatus, OrderStatus } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';

function parseDateRange(req: AuthRequest): { from: Date | null; to: Date | null } {
  const fromStr = req.query.from as string | undefined;
  const toStr = req.query.to as string | undefined;
  const from = fromStr ? new Date(fromStr) : null;
  const to = toStr ? new Date(toStr) : null;
  if (to) {
    to.setHours(23, 59, 59, 999);
  }
  return { from, to };
}

function dateRangeWhere(field: string, from: Date | null, to: Date | null) {
  if (!from && !to) return {};
  const cond: { gte?: Date; lte?: Date } = {};
  if (from) cond.gte = from;
  if (to) cond.lte = to;
  return { [field]: cond };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// =====================================================================
// 1. SALES SUMMARY  —  invoices by period
// =====================================================================
export const salesSummary = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const isAdmin = req.user!.role === Role.ADMIN;
    const { from, to } = parseDateRange(req);

    const where = {
      ...(isAdmin ? {} : { userId: req.user!.id }),
      ...dateRangeWhere('invoiceDate', from, to),
    };

    const invoices = await prisma.invoice.findMany({
      where,
      orderBy: { invoiceDate: 'desc' },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        billToName: true,
        status: true,
        currency: true,
        subtotal: true,
        taxAmount: true,
        shippingCost: true,
        total: true,
      },
    });

    const byStatus: Record<string, { count: number; amount: number }> = {};
    const byCurrency: Record<string, { count: number; amount: number }> = {};
    const byMonth: Record<string, { count: number; amount: number }> = {};
    const byCustomer: Record<string, { count: number; amount: number }> = {};

    let totalAmount = 0;
    let paidAmount = 0;
    let outstandingAmount = 0;

    for (const inv of invoices) {
      totalAmount += inv.total;
      const isPaid = inv.status === InvoiceStatus.PAID;
      const isCancelled = inv.status === InvoiceStatus.CANCELLED;
      if (isPaid) paidAmount += inv.total;
      if (!isPaid && !isCancelled) outstandingAmount += inv.total;

      byStatus[inv.status] = byStatus[inv.status] || { count: 0, amount: 0 };
      byStatus[inv.status].count += 1;
      byStatus[inv.status].amount += inv.total;

      byCurrency[inv.currency] = byCurrency[inv.currency] || { count: 0, amount: 0 };
      byCurrency[inv.currency].count += 1;
      byCurrency[inv.currency].amount += inv.total;

      const m = inv.invoiceDate.toISOString().slice(0, 7);
      byMonth[m] = byMonth[m] || { count: 0, amount: 0 };
      byMonth[m].count += 1;
      byMonth[m].amount += inv.total;

      const cust = inv.billToName || '—';
      byCustomer[cust] = byCustomer[cust] || { count: 0, amount: 0 };
      byCustomer[cust].count += 1;
      byCustomer[cust].amount += inv.total;
    }

    const topCustomers = Object.entries(byCustomer)
      .map(([name, v]) => ({ name, count: v.count, amount: round2(v.amount) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);

    res.json({
      success: true,
      data: {
        period: { from, to },
        totals: {
          invoiceCount: invoices.length,
          totalAmount: round2(totalAmount),
          paidAmount: round2(paidAmount),
          outstandingAmount: round2(outstandingAmount),
        },
        byStatus: Object.entries(byStatus).map(([k, v]) => ({
          status: k, count: v.count, amount: round2(v.amount),
        })),
        byCurrency: Object.entries(byCurrency).map(([k, v]) => ({
          currency: k, count: v.count, amount: round2(v.amount),
        })),
        byMonth: Object.entries(byMonth)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => ({ month: k, count: v.count, amount: round2(v.amount) })),
        topCustomers,
        invoices,
      },
    });
  } catch (error) {
    next(error);
  }
};

// =====================================================================
// 2. ORDERS SUMMARY
// =====================================================================
export const ordersSummary = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const isAdmin = req.user!.role === Role.ADMIN;
    const { from, to } = parseDateRange(req);

    const where = {
      ...(isAdmin ? {} : { userId: req.user!.id }),
      ...dateRangeWhere('createdAt', from, to),
    };

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        salesperson: { select: { id: true, code: true, name: true } },
        user: { select: { firstName: true, lastName: true } },
        shipment: { select: { trackingNumber: true, status: true } },
      },
    });

    const byStatus: Record<string, { count: number; amount: number }> = {};
    const bySalesperson: Record<string, { count: number; amount: number; name: string }> = {};
    const byDestination: Record<string, { count: number; amount: number }> = {};

    let totalValue = 0;
    let cbmTotal = 0;
    let weightTotal = 0;

    for (const o of orders) {
      const value = o.price ?? 0;
      totalValue += value;
      cbmTotal += o.cbm ?? 0;
      weightTotal += o.weight ?? 0;

      byStatus[o.status] = byStatus[o.status] || { count: 0, amount: 0 };
      byStatus[o.status].count += 1;
      byStatus[o.status].amount += value;

      const repKey = o.salesperson ? `${o.salesperson.code} · ${o.salesperson.name}` : (o.repName || 'Unassigned');
      bySalesperson[repKey] = bySalesperson[repKey] || { count: 0, amount: 0, name: repKey };
      bySalesperson[repKey].count += 1;
      bySalesperson[repKey].amount += value;

      const dest = o.deliveryCountry || '—';
      byDestination[dest] = byDestination[dest] || { count: 0, amount: 0 };
      byDestination[dest].count += 1;
      byDestination[dest].amount += value;
    }

    res.json({
      success: true,
      data: {
        period: { from, to },
        totals: {
          orderCount: orders.length,
          totalValue: round2(totalValue),
          totalCbm: round2(cbmTotal),
          totalWeight: round2(weightTotal),
        },
        byStatus: Object.entries(byStatus).map(([k, v]) => ({
          status: k, count: v.count, amount: round2(v.amount),
        })),
        bySalesperson: Object.entries(bySalesperson)
          .map(([_k, v]) => ({ name: v.name, count: v.count, amount: round2(v.amount) }))
          .sort((a, b) => b.amount - a.amount),
        byDestination: Object.entries(byDestination)
          .map(([k, v]) => ({ country: k, count: v.count, amount: round2(v.amount) }))
          .sort((a, b) => b.amount - a.amount),
        orders,
      },
    });
  } catch (error) {
    next(error);
  }
};

// =====================================================================
// 3. VOUCHER REGISTER
// =====================================================================
export const voucherRegister = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const isAdmin = req.user!.role === Role.ADMIN;
    const { from, to } = parseDateRange(req);
    const type = req.query.type as VoucherType | undefined;
    const accountId = req.query.accountId as string | undefined;

    const where = {
      ...(isAdmin ? {} : { userId: req.user!.id }),
      ...(type ? { type } : {}),
      ...(accountId ? { accountId } : {}),
      ...dateRangeWhere('voucherDate', from, to),
    };

    const vouchers = await prisma.voucher.findMany({
      where,
      orderBy: { voucherDate: 'desc' },
      include: {
        invoice: { select: { invoiceNumber: true, total: true, currency: true, billToName: true } },
        order: { select: { orderNumber: true, price: true } },
        account: { select: { id: true, code: true, name: true, accountGroup: { select: { name: true, groupType: true } } } },
        contraAccount: { select: { id: true, code: true, name: true } },
      },
    });

    const byType: Record<string, { count: number; credit: number; debit: number }> = {};
    let totalCredit = 0;
    let totalDebit = 0;

    for (const v of vouchers) {
      byType[v.type] = byType[v.type] || { count: 0, credit: 0, debit: 0 };
      byType[v.type].count += 1;
      if (v.direction === VoucherDirection.CREDIT) {
        byType[v.type].credit += v.amount;
        totalCredit += v.amount;
      } else {
        byType[v.type].debit += v.amount;
        totalDebit += v.amount;
      }
    }

    res.json({
      success: true,
      data: {
        period: { from, to },
        filters: { type: type || null, accountId: accountId || null },
        totals: {
          voucherCount: vouchers.length,
          totalCredit: round2(totalCredit),
          totalDebit: round2(totalDebit),
          net: round2(totalDebit - totalCredit),
        },
        byType: Object.entries(byType).map(([k, v]) => ({
          type: k, count: v.count,
          credit: round2(v.credit),
          debit: round2(v.debit),
          net: round2(v.debit - v.credit),
        })),
        vouchers,
      },
    });
  } catch (error) {
    next(error);
  }
};

// =====================================================================
// 4. OUTSTANDING RECEIVABLES
// =====================================================================
export const outstandingReceivables = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const isAdmin = req.user!.role === Role.ADMIN;
    const asOfStr = req.query.asOf as string | undefined;
    const asOf = asOfStr ? new Date(asOfStr) : new Date();
    asOf.setHours(23, 59, 59, 999);

    const invoices = await prisma.invoice.findMany({
      where: {
        ...(isAdmin ? {} : { userId: req.user!.id }),
        status: { notIn: [InvoiceStatus.PAID, InvoiceStatus.CANCELLED] },
        invoiceDate: { lte: asOf },
      },
      orderBy: { invoiceDate: 'asc' },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        billToName: true,
        status: true,
        currency: true,
        total: true,
        vouchers: {
          where: { voucherDate: { lte: asOf } },
          select: { id: true, amount: true, direction: true, voucherDate: true, type: true },
        },
      },
    });

    const rows = invoices.map((inv) => {
      let credit = 0;
      let debit = 0;
      for (const v of inv.vouchers) {
        if (v.direction === VoucherDirection.CREDIT) credit += v.amount;
        else debit += v.amount;
      }
      const outstanding = inv.total + debit - credit;
      const daysOverdue = inv.dueDate
        ? Math.max(0, Math.floor((asOf.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24)))
        : 0;
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        billToName: inv.billToName,
        status: inv.status,
        currency: inv.currency,
        total: round2(inv.total),
        paid: round2(credit),
        adjustments: round2(debit),
        outstanding: round2(outstanding),
        daysOverdue,
      };
    }).filter((r) => r.outstanding > 0.005);

    const byCurrency: Record<string, { count: number; outstanding: number }> = {};
    let totalOutstandingAed = 0;
    for (const r of rows) {
      byCurrency[r.currency] = byCurrency[r.currency] || { count: 0, outstanding: 0 };
      byCurrency[r.currency].count += 1;
      byCurrency[r.currency].outstanding += r.outstanding;
      if (r.currency === 'AED') totalOutstandingAed += r.outstanding;
    }

    res.json({
      success: true,
      data: {
        asOf,
        totals: {
          invoiceCount: rows.length,
          outstandingAed: round2(totalOutstandingAed),
        },
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

// =====================================================================
// 5. ACCOUNT STATEMENT (per-account ledger from vouchers)
// =====================================================================
export const accountStatement = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const accountId = req.query.accountId as string | undefined;
    if (!accountId) throw new AppError('accountId is required', 400);
    const { from, to } = parseDateRange(req);

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      include: { accountGroup: true },
    });
    if (!account) throw new AppError('Account not found', 404);

    const vouchers = await prisma.voucher.findMany({
      where: {
        accountId,
        ...dateRangeWhere('voucherDate', from, to),
      },
      orderBy: { voucherDate: 'asc' },
      include: {
        invoice: { select: { invoiceNumber: true, total: true, currency: true } },
        order: { select: { orderNumber: true } },
        contraAccount: { select: { code: true, name: true } },
      },
    });

    // Opening balance: account.opBalance with type Debit/Credit.
    // Standard convention: party balance is shown as Debit (the party owes
    // us) when positive; Credit when we owe the party.
    const openingDr = account.opBalanceType === 'Debit' ? account.opBalance : 0;
    const openingCr = account.opBalanceType === 'Credit' ? account.opBalance : 0;

    let runningDr = openingDr;
    let runningCr = openingCr;

    const rows: Array<{
      date: Date;
      voucherNumber: string;
      type: VoucherType;
      direction: VoucherDirection;
      reference: string | null;
      narration: string | null;
      currency: string;
      debit: number;
      credit: number;
      runningBalance: number;
      runningSide: 'Dr' | 'Cr';
    }> = [];

    for (const v of vouchers) {
      const debit = v.direction === VoucherDirection.DEBIT ? v.amount : 0;
      const credit = v.direction === VoucherDirection.CREDIT ? v.amount : 0;
      runningDr += debit;
      runningCr += credit;
      const net = runningDr - runningCr;
      const ref = v.invoice
        ? `INV ${v.invoice.invoiceNumber}`
        : v.order ? `ORD ${v.order.orderNumber}`
        : null;
      rows.push({
        date: v.voucherDate,
        voucherNumber: v.voucherNumber,
        type: v.type,
        direction: v.direction,
        reference: ref,
        narration: v.narration,
        currency: v.currency,
        debit: round2(debit),
        credit: round2(credit),
        runningBalance: round2(Math.abs(net)),
        runningSide: net >= 0 ? 'Dr' : 'Cr',
      });
    }

    const closingNet = runningDr - runningCr;

    res.json({
      success: true,
      data: {
        account: {
          id: account.id,
          code: account.code,
          name: account.name,
          accountGroup: account.accountGroup ? { name: account.accountGroup.name, groupType: account.accountGroup.groupType } : null,
          mobile1: account.mobile1,
          trn: account.trn,
          email: account.email,
          address: account.address,
        },
        period: { from, to },
        opening: { debit: round2(openingDr), credit: round2(openingCr) },
        totals: {
          totalDebit: round2(runningDr - openingDr),
          totalCredit: round2(runningCr - openingCr),
        },
        closing: {
          balance: round2(Math.abs(closingNet)),
          side: closingNet >= 0 ? 'Dr' : 'Cr',
        },
        rows,
      },
    });
  } catch (error) {
    next(error);
  }
};

// =====================================================================
// 6. DASHBOARD SNAPSHOT — used by the Reports landing cards.
//    Returns minimal counts/totals across all reports.
// =====================================================================
export const dashboardSnapshot = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const isAdmin = req.user!.role === Role.ADMIN;
    const userFilter = isAdmin ? {} : { userId: req.user!.id };

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      invCount, invThisMonth, orderCount, ordersThisMonth,
      voucherCount, vouchersThisMonth, openInvoices,
    ] = await prisma.$transaction([
      prisma.invoice.count({ where: userFilter }),
      prisma.invoice.aggregate({
        where: { ...userFilter, invoiceDate: { gte: monthStart } },
        _sum: { total: true }, _count: { _all: true },
      }),
      prisma.order.count({ where: userFilter }),
      prisma.order.aggregate({
        where: { ...userFilter, createdAt: { gte: monthStart } },
        _sum: { price: true }, _count: { _all: true },
      }),
      prisma.voucher.count({ where: userFilter }),
      prisma.voucher.aggregate({
        where: { ...userFilter, voucherDate: { gte: monthStart } },
        _sum: { amount: true }, _count: { _all: true },
      }),
      prisma.invoice.count({
        where: { ...userFilter, status: { notIn: [InvoiceStatus.PAID, InvoiceStatus.CANCELLED] } },
      }),
    ]);

    res.json({
      success: true,
      data: {
        invoices: {
          total: invCount,
          monthCount: invThisMonth._count._all,
          monthAmount: round2(invThisMonth._sum.total || 0),
          open: openInvoices,
        },
        orders: {
          total: orderCount,
          monthCount: ordersThisMonth._count._all,
          monthValue: round2(ordersThisMonth._sum.price || 0),
        },
        vouchers: {
          total: voucherCount,
          monthCount: vouchersThisMonth._count._all,
          monthAmount: round2(vouchersThisMonth._sum.amount || 0),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// Reference the enums so tsc doesn't strip unused imports in transpile.
void OrderStatus;
