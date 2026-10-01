import { Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  InvoiceStatus, Role, VoucherDirection, VoucherReferenceType, VoucherType,
} from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { reconcileInvoiceStatuses } from './voucherController';
import {
  CREDIT_NOTE_PREFIX, CREDIT_NOTE_REASONS, creditNoteSplit, effectiveVatRate,
  isCreditNote, splitEnteredAmount,
} from '../utils/creditNotes';
import { generateCreditNotePdfBuffer } from '../utils/creditNotePdf';

// ============================================================================
// CREDIT NOTES against a sales invoice.
//
// Used when a customer disputes a bill and the amount is agreed to be
// reduced. The credit note is booked as a CREDIT_NOTE voucher linked to the
// invoice, so it automatically:
//   - reduces the invoice's outstanding balance (and marks it PAID once the
//     balance reaches zero),
//   - appears as a credit on the customer's account statement / SOA,
//   - reduces Sales and Output VAT in the Job Profit, VAT ledger and
//     financial statements.
// ============================================================================

const r2 = (n: number) => Math.round(n * 100) / 100;

const createSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  amountIncludesVat: z.coerce.boolean().default(false),
  vatPercent: z.coerce.number().min(0).max(100).optional(),
  reason: z.string().min(1, 'Reason is required').max(80),
  remarks: z.string().max(500).optional(),
  date: z.string().optional(),
});

async function generateCreditNoteNumber(): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(2);
  const prefix = `${CREDIT_NOTE_PREFIX}${yy}-`;
  const last = await prisma.voucher.findFirst({
    where: { voucherNumber: { startsWith: prefix } },
    orderBy: { voucherNumber: 'desc' },
    select: { voucherNumber: true },
  });
  const lastSeq = last ? parseInt(last.voucherNumber.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(5, '0')}`;
}

async function loadInvoice(invoiceId: string, req: AuthRequest) {
  const isAdmin = req.user!.role === Role.ADMIN;
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, ...(isAdmin ? {} : { userId: req.user!.id }) },
    include: {
      account: { select: { id: true, code: true, name: true, trn: true } },
      orderRef: { select: { orderNumber: true } },
      vouchers: { orderBy: { voucherDate: 'asc' } },
      voucherAllocations: { select: { allocatedAmount: true } },
    },
  });
  if (!invoice) throw new AppError('Invoice not found', 404);
  return invoice;
}

type LoadedInvoice = Awaited<ReturnType<typeof loadInvoice>>;

// Balance of the invoice in its own currency, with credit notes separated
// from money actually received.
function invoiceBalance(inv: LoadedInvoice) {
  let received = 0;
  let creditNotes = 0;
  let debits = 0;
  for (const v of inv.vouchers) {
    if (v.direction === VoucherDirection.CREDIT) {
      if (isCreditNote(v)) creditNotes += v.amount; else received += v.amount;
    } else {
      debits += v.amount;
    }
  }
  received += inv.voucherAllocations.reduce((s, a) => s + a.allocatedAmount, 0);
  return {
    invoiceTotal: r2(inv.total),
    creditNotes: r2(creditNotes),
    netInvoiceTotal: r2(inv.total - creditNotes),
    received: r2(received),
    adjustments: r2(debits),
    outstanding: r2(inv.total + debits - creditNotes - received),
  };
}

function presentCreditNote(v: LoadedInvoice['vouchers'][number]) {
  const { net, vat, gross } = creditNoteSplit(v);
  return {
    id: v.id,
    creditNoteNumber: v.voucherNumber,
    date: v.voucherDate,
    currency: v.currency,
    netAmount: net,
    vatPercent: r2(v.outputVatPercent || 0),
    vatAmount: vat,
    amount: gross,
    reason: v.againstType || null,
    remarks: v.narration || null,
    createdAt: v.createdAt,
  };
}

function summary(inv: LoadedInvoice) {
  return {
    invoice: {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate,
      billToName: inv.billToName,
      currency: inv.currency,
      subtotal: r2(inv.subtotal),
      taxAmount: r2(inv.taxAmount),
      total: r2(inv.total),
      status: inv.status,
      vatPercent: effectiveVatRate(inv),
    },
    balance: invoiceBalance(inv),
    reasons: CREDIT_NOTE_REASONS,
    creditNotes: inv.vouchers.filter(isCreditNote).map(presentCreditNote),
  };
}

export const listCreditNotes = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const inv = await loadInvoice(req.params.id, req);
    res.json({ success: true, data: summary(inv) });
  } catch (e) { next(e); }
};

export const createCreditNote = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createSchema.parse(req.body);
    const inv = await loadInvoice(req.params.id, req);
    if (inv.status === InvoiceStatus.CANCELLED) {
      throw new AppError('Cannot issue a credit note on a cancelled invoice', 400);
    }

    const vatPercent = parsed.vatPercent ?? effectiveVatRate(inv);
    const { net, vat, gross } = splitEnteredAmount(parsed.amount, vatPercent, parsed.amountIncludesVat);
    const balance = invoiceBalance(inv);
    if (gross > balance.outstanding + 0.005) {
      throw new AppError(
        `Credit note (${inv.currency} ${gross.toFixed(2)} incl. VAT) exceeds the invoice outstanding balance of ${inv.currency} ${balance.outstanding.toFixed(2)}`,
        400,
      );
    }

    // Post against the customer's ledger account so the credit shows on the
    // account statement. Legacy invoices without an account are matched by
    // customer name, the same way the statements match them.
    let accountId = inv.accountId;
    if (!accountId) {
      const acc = await prisma.account.findFirst({
        where: { name: { equals: inv.billToName.trim(), mode: 'insensitive' } },
        select: { id: true },
      });
      accountId = acc?.id ?? null;
    }

    const date = parsed.date ? new Date(parsed.date) : new Date();
    if (isNaN(date.getTime())) throw new AppError('Invalid credit note date', 400);

    let voucher;
    for (let attempt = 0; ; attempt++) {
      try {
        voucher = await prisma.voucher.create({
          data: {
            voucherNumber: await generateCreditNoteNumber(),
            type: VoucherType.CREDIT_NOTE,
            direction: VoucherDirection.CREDIT,
            voucherDate: date,
            amount: gross,
            netAmount: net,
            outputVatPercent: vatPercent,
            outputVatAmount: vat,
            currency: inv.currency,
            referenceType: VoucherReferenceType.INVOICE,
            invoiceId: inv.id,
            accountId,
            partyName: inv.billToName,
            issuedTo: inv.billToName,
            againstType: parsed.reason,
            narration: parsed.remarks?.trim() || null,
            userId: req.user!.id,
          },
        });
        break;
      } catch (e: unknown) {
        if ((e as { code?: string }).code === 'P2002' && attempt < 4) continue;
        throw e;
      }
    }

    await reconcileInvoiceStatuses([inv.id]);
    const fresh = await loadInvoice(inv.id, req);
    res.status(201).json({
      success: true,
      message: `Credit note ${voucher.voucherNumber} issued`,
      data: summary(fresh),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const creditNotePdf = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const inv = await loadInvoice(req.params.id, req);
    const cn = inv.vouchers.find((v) => v.id === req.params.creditNoteId && isCreditNote(v));
    if (!cn) throw new AppError('Credit note not found on this invoice', 404);

    const defaultBank = await prisma.bankAccount.findFirst({
      where: { isDefault: true },
      select: { companyTrn: true },
    });
    const c = presentCreditNote(cn);
    // Balance position immediately after this credit note, for the footer.
    const priorCredits = inv.vouchers
      .filter((v) => isCreditNote(v) && (v.voucherDate < cn.voucherDate
        || (v.voucherDate.getTime() === cn.voucherDate.getTime() && v.createdAt <= cn.createdAt)))
      .reduce((s, v) => s + v.amount, 0);

    const buffer = await generateCreditNotePdfBuffer({
      creditNoteNumber: c.creditNoteNumber,
      date: c.date,
      currency: c.currency,
      reason: c.reason,
      remarks: c.remarks,
      netAmount: c.netAmount,
      vatPercent: c.vatPercent,
      vatAmount: c.vatAmount,
      amount: c.amount,
      companyTrn: inv.companyTrn || defaultBank?.companyTrn || null,
      customer: {
        name: inv.account?.name || inv.billToName,
        code: inv.account?.code || null,
        trn: inv.account?.trn || null,
        address: [inv.billToAddress, inv.billToCity, inv.billToCountry].filter(Boolean).join(', '),
        email: inv.billToEmail,
        phone: inv.billToPhone,
      },
      invoice: {
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        jobNo: inv.jobNo || inv.orderRef?.orderNumber || null,
        total: r2(inv.total),
        creditedToDate: r2(priorCredits),
        netAfterCredit: r2(inv.total - priorCredits),
      },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="CreditNote_${c.creditNoteNumber}.pdf"`);
    res.send(buffer);
  } catch (e) { next(e); }
};
