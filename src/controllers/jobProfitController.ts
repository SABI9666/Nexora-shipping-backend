import { Response, NextFunction } from 'express';
import { VoucherType, VoucherDirection, Role } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { generateJobProfitPdfBuffer, JobProfitData } from '../utils/jobProfitPdf';
import { AED_RATES, toAed } from '../utils/aedRates';

// Job Profit is always reported in AED (the company's functional currency).
// Each row keeps its original document currency figures for reference and
// carries AED equivalents; every total, the profit and the VAT position are
// summed on the AED figures only, so a USD invoice is never netted against
// AED purchase costs at face value.
const BASE_CURRENCY = 'AED';
const r2 = (n: number) => Math.round(n * 100) / 100;
const rateOf = (currency: string | null | undefined) =>
  AED_RATES[(currency || BASE_CURRENCY).toUpperCase()] ?? 1;

async function buildJobProfit(orderId: string, userId: string, isAdmin: boolean): Promise<JobProfitData> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...(isAdmin ? {} : { userId }) },
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
      salesperson: { select: { name: true, code: true } },
    },
  });
  if (!order) throw new AppError('Job (order) not found', 404);

  const purchaseVouchers = await prisma.voucher.findMany({
    where: { orderId, type: VoucherType.PURCHASE },
    include: {
      account: { select: { code: true, name: true } },
      allocations: { orderBy: { createdAt: 'asc' } },
      // Payments / Supplier-Payments / Debit-Notes settling this bill.
      paymentAllocations: { select: { allocatedAmount: true } },
    },
    orderBy: { voucherDate: 'asc' },
  });

  const invoices = await prisma.invoice.findMany({
    where: { orderId },
    include: {
      vouchers: { select: { amount: true, direction: true, currency: true } },
      voucherAllocations: { select: { allocatedAmount: true } },
    },
    orderBy: { invoiceDate: 'asc' },
  });

  const purchaseRows = purchaseVouchers.map((v) => {
    const currency = (v.currency || BASE_CURRENCY).toUpperCase();
    const rate = rateOf(currency);
    // Allocations settle the bill in the bill's own currency.
    const paid = r2(v.paymentAllocations.reduce((s, a) => s + a.allocatedAmount, 0));
    // Net vs VAT split. Tax (input VAT) is treated as a recoverable
    // pass-through and excluded from the cost figure used for profit.
    // Falls back to amount-as-net for legacy vouchers booked before the
    // tax fields were added, so old jobs still total correctly.
    const inputVat = r2(v.inputVatAmount || 0);
    const net = r2((v.netAmount && v.netAmount > 0) ? v.netAmount : (v.amount - inputVat));
    const outstanding = r2(v.amount - paid);
    return {
      voucherNumber: v.voucherNumber,
      voucherDate: v.voucherDate,
      supplierCode: v.account?.code || '',
      supplierName: v.account?.name || v.partyName || '—',
      ref: v.allocations[0]?.invoiceNumber || v.allocations[0]?.refNo || '',
      narration: v.narration || '',
      // Original document currency
      currency,
      exchangeRate: rate,
      net,
      vat: inputVat,
      amount: v.amount,
      paid,
      outstanding,
      // AED equivalents
      netAed: r2(toAed(net, currency)),
      vatAed: r2(toAed(inputVat, currency)),
      amountAed: r2(toAed(v.amount, currency)),
      paidAed: r2(toAed(paid, currency)),
      outstandingAed: r2(toAed(outstanding, currency)),
    };
  });

  const salesRows = invoices.map((i) => {
    const currency = (i.currency || BASE_CURRENCY).toUpperCase();
    const rate = rateOf(currency);
    // Receipts / credit notes may be booked in a different currency to the
    // invoice — bring each to AED first, then express in invoice currency.
    const creditsAed = i.vouchers
      .filter((v) => v.direction === VoucherDirection.CREDIT)
      .reduce((s, v) => s + toAed(v.amount, v.currency), 0);
    const allocated = i.voucherAllocations.reduce((s, a) => s + a.allocatedAmount, 0);
    const paidAed = r2(creditsAed + toAed(allocated, currency));
    const paid = r2(paidAed / rate);
    // Output VAT (the tax collected from the customer) sits in the
    // taxAmount column on the Invoice — pulled out so profit is computed
    // on the net (taxable) sale.
    const outputVat = r2(i.taxAmount || 0);
    const net = r2(i.subtotal ?? (i.total - outputVat));
    const totalAed = r2(toAed(i.total, currency));
    return {
      invoiceNumber: i.invoiceNumber,
      invoiceDate: i.invoiceDate,
      billToName: i.billToName,
      // Original document currency
      currency,
      exchangeRate: rate,
      net,
      vat: outputVat,
      total: i.total,
      paid,
      outstanding: r2(i.total - paid),
      // AED equivalents
      netAed: r2(toAed(net, currency)),
      vatAed: r2(toAed(outputVat, currency)),
      totalAed,
      paidAed,
      outstandingAed: r2(totalAed - paidAed),
      status: i.status,
    };
  });

  // All totals are in AED. Profit is computed on the net side so the
  // recoverable / payable VAT is not mistaken for revenue or cost. The VAT
  // position (Output − Input) is what's due to / claimable from the FTA.
  const sum = <T>(rows: T[], f: (r: T) => number) => r2(rows.reduce((s, r) => s + f(r), 0));
  const totalPurchaseNet = sum(purchaseRows, (r) => r.netAed);
  const totalPurchaseVat = sum(purchaseRows, (r) => r.vatAed);
  const totalPurchase = sum(purchaseRows, (r) => r.amountAed);
  const totalPurchasePaid = sum(purchaseRows, (r) => r.paidAed);
  const totalPurchaseOutstanding = r2(totalPurchase - totalPurchasePaid);
  const totalSalesNet = sum(salesRows, (r) => r.netAed);
  const totalSalesVat = sum(salesRows, (r) => r.vatAed);
  const totalSales = sum(salesRows, (r) => r.totalAed);
  const totalSalesPaid = sum(salesRows, (r) => r.paidAed);
  const totalOutstanding = sum(salesRows, (r) => r.outstandingAed);
  const netProfit = r2(totalSalesNet - totalPurchaseNet);
  const vatNetPosition = r2(totalSalesVat - totalPurchaseVat);
  const profitMargin = totalSalesNet > 0 ? r2((netProfit / totalSalesNet) * 100) : null;

  // Rates actually applied on this Job (foreign currencies only), so the
  // statement can disclose the conversion basis.
  const fxRates = Array.from(new Set([...purchaseRows, ...salesRows].map((r) => r.currency)))
    .filter((c) => c !== BASE_CURRENCY)
    .sort()
    .map((currency) => ({ currency, rate: rateOf(currency) }));

  return {
    order: {
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      status: order.status,
      pickupCity: order.pickupCity,
      deliveryCity: order.deliveryCity,
      customer: order.user
        ? `${order.user.firstName ?? ''} ${order.user.lastName ?? ''}`.trim() || null
        : null,
      salesperson: order.salesperson?.name || null,
    },
    baseCurrency: BASE_CURRENCY,
    fxRates,
    purchaseRows,
    salesRows,
    totals: {
      totalPurchase, totalPurchaseNet, totalPurchaseVat,
      totalPurchasePaid, totalPurchaseOutstanding,
      totalSales, totalSalesNet, totalSalesVat, totalSalesPaid,
      netProfit, profitMargin, vatNetPosition, totalOutstanding,
    },
  };
}

export const jobProfit = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orderId = req.query.orderId as string;
    if (!orderId) throw new AppError('orderId is required', 400);
    const data = await buildJobProfit(orderId, req.user!.id, req.user!.role === Role.ADMIN);
    res.json({ success: true, data });
  } catch (e) { next(e); }
};

export const jobProfitPdf = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orderId = req.query.orderId as string;
    if (!orderId) throw new AppError('orderId is required', 400);
    const data = await buildJobProfit(orderId, req.user!.id, req.user!.role === Role.ADMIN);
    const buffer = await generateJobProfitPdfBuffer(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="JobProfit_${data.order.orderNumber}.pdf"`);
    res.send(buffer);
  } catch (e) { next(e); }
};
