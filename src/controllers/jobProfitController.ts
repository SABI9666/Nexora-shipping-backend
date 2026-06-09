import { Response, NextFunction } from 'express';
import { VoucherType, VoucherDirection, Role } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { generateJobProfitPdfBuffer, JobProfitData } from '../utils/jobProfitPdf';

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
      vouchers: { select: { amount: true, direction: true } },
      voucherAllocations: { select: { allocatedAmount: true } },
    },
    orderBy: { invoiceDate: 'asc' },
  });

  const purchaseRows = purchaseVouchers.map((v) => {
    const paid = v.paymentAllocations.reduce((s, a) => s + a.allocatedAmount, 0);
    // Net vs VAT split. Tax (input VAT) is treated as a recoverable
    // pass-through and excluded from the cost figure used for profit.
    // Falls back to amount-as-net for legacy vouchers booked before the
    // tax fields were added, so old jobs still total correctly.
    const inputVat = Math.round((v.inputVatAmount || 0) * 100) / 100;
    const net = Math.round(((v.netAmount && v.netAmount > 0)
      ? v.netAmount
      : (v.amount - inputVat)) * 100) / 100;
    return {
      voucherNumber: v.voucherNumber,
      voucherDate: v.voucherDate,
      supplierCode: v.account?.code || '',
      supplierName: v.account?.name || v.partyName || '—',
      ref: v.allocations[0]?.invoiceNumber || v.allocations[0]?.refNo || '',
      narration: v.narration || '',
      currency: v.currency,
      net,
      vat: inputVat,
      amount: v.amount,
      paid: Math.round(paid * 100) / 100,
      outstanding: Math.round((v.amount - paid) * 100) / 100,
    };
  });

  const salesRows = invoices.map((i) => {
    const credits = i.vouchers
      .filter((v) => v.direction === VoucherDirection.CREDIT)
      .reduce((s, v) => s + v.amount, 0);
    const allocated = i.voucherAllocations.reduce((s, a) => s + a.allocatedAmount, 0);
    const paid = credits + allocated;
    // Output VAT (the tax collected from the customer) sits in the
    // taxAmount column on the Invoice — pulled out so profit is computed
    // on the net (taxable) sale.
    const outputVat = Math.round((i.taxAmount || 0) * 100) / 100;
    const net = Math.round((i.subtotal ?? (i.total - outputVat)) * 100) / 100;
    return {
      invoiceNumber: i.invoiceNumber,
      invoiceDate: i.invoiceDate,
      billToName: i.billToName,
      currency: i.currency,
      net,
      vat: outputVat,
      total: i.total,
      paid,
      outstanding: Math.round((i.total - paid) * 100) / 100,
      status: i.status,
    };
  });

  // Profit is computed on the net side so the recoverable / payable VAT
  // is not mistaken for revenue or cost. The VAT position (Output −
  // Input) is what's actually due to / claimable from the tax authority.
  const totalPurchaseNet = Math.round(purchaseRows.reduce((s, r) => s + r.net, 0) * 100) / 100;
  const totalPurchaseVat = Math.round(purchaseRows.reduce((s, r) => s + r.vat, 0) * 100) / 100;
  const totalPurchase = purchaseRows.reduce((s, r) => s + r.amount, 0);
  const totalPurchasePaid = purchaseRows.reduce((s, r) => s + r.paid, 0);
  const totalPurchaseOutstanding = Math.round((totalPurchase - totalPurchasePaid) * 100) / 100;
  const totalSalesNet = Math.round(salesRows.reduce((s, r) => s + r.net, 0) * 100) / 100;
  const totalSalesVat = Math.round(salesRows.reduce((s, r) => s + r.vat, 0) * 100) / 100;
  const totalSales = salesRows.reduce((s, r) => s + r.total, 0);
  const totalOutstanding = salesRows.reduce((s, r) => s + r.outstanding, 0);
  const netProfit = Math.round((totalSalesNet - totalPurchaseNet) * 100) / 100;
  const vatNetPosition = Math.round((totalSalesVat - totalPurchaseVat) * 100) / 100;

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
    purchaseRows,
    salesRows,
    totals: {
      totalPurchase, totalPurchaseNet, totalPurchaseVat,
      totalPurchasePaid, totalPurchaseOutstanding,
      totalSales, totalSalesNet, totalSalesVat,
      netProfit, vatNetPosition, totalOutstanding,
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
