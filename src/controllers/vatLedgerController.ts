import { Response, NextFunction } from 'express';
import { Role, VoucherType } from '@prisma/client';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { generateVatLedgerPdfBuffer, VatLedgerData } from '../utils/vatLedgerPdf';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseRange(req: AuthRequest): { from: Date | null; to: Date | null } {
  const fromStr = req.query.from as string | undefined;
  const toStr = req.query.to as string | undefined;
  const from = fromStr ? new Date(fromStr) : null;
  const to = toStr ? new Date(toStr) : null;
  if (to) to.setHours(23, 59, 59, 999);
  return { from, to };
}

function rangeWhere(field: string, from: Date | null, to: Date | null) {
  if (!from && !to) return {};
  const cond: { gte?: Date; lte?: Date } = {};
  if (from) cond.gte = from;
  if (to) cond.lte = to;
  return { [field]: cond };
}

// ============================================================================
// VAT LEDGER
//
// Two ledgers for VAT-return preparation, mirroring the legacy accounting
// system's OUTPUT VAT / INPUT VAT ledger cards:
//
//   OUTPUT VAT — VAT collected from customers. Sourced from invoice.taxAmount.
//                A liability owed to the FTA → shown on the CREDIT side, so the
//                running balance grows as a credit (Cr).
//   INPUT VAT  — VAT paid to suppliers (recoverable). Sourced from a Purchase
//                Voucher's inputVatAmount. An asset → shown on the DEBIT side,
//                running balance grows as a debit (Dr).
//
// Net VAT position = Output VAT − Input VAT (positive = payable to FTA).
// ============================================================================
async function buildVatLedger(req: AuthRequest): Promise<VatLedgerData> {
  const isAdmin = req.user!.role === Role.ADMIN;
  const scope = isAdmin ? {} : { userId: req.user!.id };
  const { from, to } = parseRange(req);

  // ---- OUTPUT VAT (sales invoices) -------------------------------------
  const invoices = await prisma.invoice.findMany({
    where: { ...scope, ...rangeWhere('invoiceDate', from, to), taxAmount: { gt: 0 } },
    orderBy: { invoiceDate: 'asc' },
    select: {
      invoiceNumber: true,
      invoiceDate: true,
      billToName: true,
      currency: true,
      subtotal: true,
      taxRate: true,
      taxAmount: true,
    },
  });

  let outRunning = 0;
  const outputRows = invoices.map((inv) => {
    outRunning = round2(outRunning + inv.taxAmount);
    return {
      date: inv.invoiceDate,
      ref: inv.invoiceNumber,
      particulars: inv.billToName,
      currency: inv.currency,
      taxable: round2(inv.subtotal),
      ratePercent: round2(inv.taxRate),
      vat: round2(inv.taxAmount),
      running: outRunning,
    };
  });

  // ---- INPUT VAT (purchase vouchers) -----------------------------------
  const purchases = await prisma.voucher.findMany({
    where: {
      ...scope,
      type: VoucherType.PURCHASE,
      ...rangeWhere('voucherDate', from, to),
      inputVatAmount: { gt: 0 },
    },
    orderBy: { voucherDate: 'asc' },
    include: {
      account: { select: { code: true, name: true } },
      allocations: { select: { invoiceNumber: true, refNo: true }, orderBy: { createdAt: 'asc' } },
    },
  });

  let inRunning = 0;
  const inputRows = purchases.map((v) => {
    inRunning = round2(inRunning + v.inputVatAmount);
    const supInv = v.allocations[0]?.invoiceNumber || v.allocations[0]?.refNo || '';
    return {
      date: v.voucherDate,
      ref: v.voucherNumber,
      supplierRef: supInv,
      particulars: v.account?.name || v.partyName || '—',
      currency: v.currency,
      taxable: round2(v.netAmount || 0),
      ratePercent: round2(v.inputVatPercent || 0),
      vat: round2(v.inputVatAmount),
      running: inRunning,
    };
  });

  const totalOutputVat = round2(outputRows.reduce((s, r) => s + r.vat, 0));
  const totalInputVat = round2(inputRows.reduce((s, r) => s + r.vat, 0));
  const netVat = round2(totalOutputVat - totalInputVat);

  return {
    period: { from, to },
    output: { rows: outputRows, totalTaxable: round2(outputRows.reduce((s, r) => s + r.taxable, 0)), totalVat: totalOutputVat },
    input: { rows: inputRows, totalTaxable: round2(inputRows.reduce((s, r) => s + r.taxable, 0)), totalVat: totalInputVat },
    netVat,
  };
}

export const vatLedger = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await buildVatLedger(req);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const vatLedgerPdf = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await buildVatLedger(req);
    const defaultBank = await prisma.bankAccount.findFirst({
      where: { isDefault: true },
      select: { companyTrn: true },
    });
    const buffer = await generateVatLedgerPdfBuffer({ ...data, companyTrn: defaultBank?.companyTrn || undefined });

    const fromStamp = data.period.from ? data.period.from.toISOString().slice(0, 10).replace(/-/g, '') : 'all';
    const toStamp = data.period.to ? data.period.to.toISOString().slice(0, 10).replace(/-/g, '') : 'all';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="VAT_Ledger_${fromStamp}_${toStamp}.pdf"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};
