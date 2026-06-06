import { Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  VoucherType, VoucherDirection, VoucherReferenceType,
  VoucherPaymentMethod, InvoiceStatus, Role,
} from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { uploadFileToGCS, deleteFileFromGCS } from '../config/gcs';
import { generateVoucherPdfBuffer } from '../utils/voucherPdfGenerator';
import { generateSupplierPaymentVoucherPdfBuffer } from '../utils/supplierPaymentVoucherPdf';

const VOUCHER_PREFIX = 'VCH';
const VOUCHER_SEQ_PAD = 5;

async function generateVoucherNumber(): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(2);
  const prefix = `${VOUCHER_PREFIX}${yy}-`;
  const last = await prisma.voucher.findFirst({
    where: { voucherNumber: { startsWith: prefix } },
    orderBy: { voucherNumber: 'desc' },
    select: { voucherNumber: true },
  });
  const lastSeq = last ? parseInt(last.voucherNumber.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(VOUCHER_SEQ_PAD, '0')}`;
}

const allocationSchema = z.object({
  invoiceId: z.string().uuid().optional().or(z.literal('')),
  purchaseVoucherId: z.string().uuid().optional().or(z.literal('')),
  jobNo: z.string().optional(),
  refNo: z.string().optional(),
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  billAmount: z.coerce.number().default(0),
  allocatedAmount: z.coerce.number().default(0),
  remarks: z.string().optional(),
});

const createSchema = z.object({
  type: z.nativeEnum(VoucherType),
  direction: z.nativeEnum(VoucherDirection).optional(),
  voucherDate: z.string().optional(),
  amount: z.coerce.number().nonnegative(),
  // Optional tax breakdown — populated by the Purchase Voucher form.
  // amount is treated as the gross total (net + input VAT) so existing
  // reports / ledgers continue to read the right number.
  netAmount: z.coerce.number().nonnegative().optional(),
  inputVatPercent: z.coerce.number().nonnegative().optional(),
  inputVatAmount: z.coerce.number().nonnegative().optional(),
  outputVatPercent: z.coerce.number().nonnegative().optional(),
  outputVatAmount: z.coerce.number().nonnegative().optional(),
  currency: z.string().default('AED'),
  referenceType: z.nativeEnum(VoucherReferenceType).default(VoucherReferenceType.NONE),
  invoiceId: z.string().uuid().optional().or(z.literal('')),
  orderId: z.string().uuid().optional().or(z.literal('')),
  accountId: z.string().uuid().optional().or(z.literal('')),
  contraAccountId: z.string().uuid().optional().or(z.literal('')),
  bankAccountId: z.string().uuid().optional().or(z.literal('')),
  collectedRepId: z.string().uuid().optional().or(z.literal('')),
  partyName: z.string().optional(),
  issuedTo: z.string().optional(),
  narration: z.string().optional(),
  paymentMethod: z.nativeEnum(VoucherPaymentMethod).optional(),
  chequeNumber: z.string().optional(),
  chequeDate: z.string().optional(),
  presentOn: z.string().optional(),
  clearedOn: z.string().optional(),
  accountPayee: z.coerce.boolean().optional(),
  printCheque: z.coerce.boolean().optional(),
  againstType: z.string().optional(),
  allocations: z.array(allocationSchema).optional(),
});

const DEFAULT_DIRECTION: Record<VoucherType, VoucherDirection> = {
  CASH: VoucherDirection.CREDIT,
  PURCHASE: VoucherDirection.DEBIT,
  PAYMENT: VoucherDirection.DEBIT,
  BANK: VoucherDirection.CREDIT,
  JOURNAL: VoucherDirection.DEBIT,
  RECEIPT: VoucherDirection.CREDIT,
  SUPPLIER_PAYMENT: VoucherDirection.DEBIT,
  CREDIT_NOTE: VoucherDirection.CREDIT,
  DEBIT_NOTE: VoucherDirection.DEBIT,
};

type FileMeta = {
  fileUrl?: string;
  fileName?: string;
  fileMimeType?: string;
  fileSize?: number;
  gcsPath?: string;
};

const ACCOUNT_INCLUDE = {
  accountGroup: { select: { id: true, code: true, name: true, groupType: true } },
} as const;

const VOUCHER_INCLUDE = {
  invoice: { select: { id: true, invoiceNumber: true, total: true, currency: true, billToName: true } },
  order: { select: { id: true, orderNumber: true, price: true } },
  account: { include: ACCOUNT_INCLUDE },
  contraAccount: { include: ACCOUNT_INCLUDE },
  bankAccount: { select: { id: true, label: true, bankName: true, accountName: true, accountNumber: true, iban: true, swiftCode: true, currency: true } },
  collectedRep: { select: { id: true, code: true, name: true, phone: true, email: true } },
  allocations: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      purchaseVoucher: { select: { id: true, voucherNumber: true, type: true, amount: true, voucherDate: true } },
    },
  },
  user: { select: { firstName: true, lastName: true, email: true } },
} as const;

function parseDate(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

async function reconcileInvoiceStatuses(invoiceIds: string[]): Promise<void> {
  const unique = Array.from(new Set(invoiceIds.filter(Boolean)));
  for (const id of unique) {
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: {
        id: true, total: true, status: true,
        vouchers: { select: { amount: true, direction: true } },
        voucherAllocations: { select: { allocatedAmount: true } },
      },
    });
    if (!invoice) continue;

    const credit = invoice.vouchers
      .filter((v) => v.direction === VoucherDirection.CREDIT)
      .reduce((s, v) => s + v.amount, 0);
    const allocated = invoice.voucherAllocations.reduce((s, a) => s + a.allocatedAmount, 0);
    const totalPaid = credit + allocated;

    const isFullyPaid = totalPaid + 0.005 >= invoice.total;
    const wasPaid = invoice.status === InvoiceStatus.PAID;

    if (isFullyPaid && !wasPaid && invoice.status !== InvoiceStatus.CANCELLED) {
      await prisma.invoice.update({ where: { id }, data: { status: InvoiceStatus.PAID } });
    } else if (!isFullyPaid && wasPaid) {
      await prisma.invoice.update({ where: { id }, data: { status: InvoiceStatus.SENT } });
    }
  }
}

// Shared resolver: validates FK references against the schema + ownership.
async function resolveReferences(
  parsed: z.infer<typeof createSchema>,
  userId: string,
  isAdmin: boolean,
): Promise<{ invoiceId: string | null; orderId: string | null }> {
  let invoiceId: string | null = parsed.invoiceId || null;
  let orderId: string | null = parsed.orderId || null;

  if (parsed.referenceType === VoucherReferenceType.INVOICE) {
    if (!invoiceId) throw new AppError('invoiceId is required when referenceType is INVOICE', 400);
    const inv = await prisma.invoice.findFirst({
      where: { id: invoiceId, ...(isAdmin ? {} : { userId }) },
    });
    if (!inv) throw new AppError('Invoice not found or access denied', 404);
    orderId = null;
  } else if (parsed.referenceType === VoucherReferenceType.ORDER) {
    if (!orderId) throw new AppError('orderId is required when referenceType is ORDER', 400);
    const ord = await prisma.order.findFirst({
      where: { id: orderId, ...(isAdmin ? {} : { userId }) },
    });
    if (!ord) throw new AppError('Order not found or access denied', 404);
    invoiceId = null;
  } else {
    invoiceId = null;
    orderId = null;
  }

  if (parsed.accountId) {
    const acc = await prisma.account.findUnique({ where: { id: parsed.accountId } });
    if (!acc) throw new AppError('Party account not found', 404);
  }
  if (parsed.contraAccountId) {
    const acc = await prisma.account.findUnique({ where: { id: parsed.contraAccountId } });
    if (!acc) throw new AppError('Contra account not found', 404);
  }
  if (parsed.bankAccountId) {
    const bank = await prisma.bankAccount.findUnique({ where: { id: parsed.bankAccountId } });
    if (!bank) throw new AppError('Bank account not found', 404);
  }
  if (parsed.collectedRepId) {
    const rep = await prisma.salesperson.findUnique({ where: { id: parsed.collectedRepId } });
    if (!rep) throw new AppError('Collected rep not found', 404);
  }

  return { invoiceId, orderId };
}

function buildAllocationRows(parsed: z.infer<typeof createSchema>) {
  const allocations = (parsed.allocations ?? []).filter((a) =>
    a.allocatedAmount !== 0 || a.billAmount !== 0,
  );
  let runningRecd = 0;
  const rows = allocations.map((a) => {
    runningRecd += a.allocatedAmount;
    return {
      invoiceId: a.invoiceId || null,
      purchaseVoucherId: a.purchaseVoucherId || null,
      jobNo: a.jobNo || null,
      refNo: a.refNo || null,
      invoiceNumber: a.invoiceNumber || null,
      invoiceDate: parseDate(a.invoiceDate),
      billAmount: a.billAmount,
      allocatedAmount: a.allocatedAmount,
      balanceAfter: a.billAmount - a.allocatedAmount,
      remarks: a.remarks || null,
    };
  });
  return { rows, runningRecd };
}

export const createVoucher = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (typeof req.body.allocations === 'string') {
      try { req.body.allocations = JSON.parse(req.body.allocations); } catch { /* leave to fail validation */ }
    }
    const parsed = createSchema.parse(req.body);
    const direction = parsed.direction ?? DEFAULT_DIRECTION[parsed.type];
    const isAdmin = req.user!.role === Role.ADMIN;

    const { invoiceId, orderId } = await resolveReferences(parsed, req.user!.id, isAdmin);
    const accountId: string | null = parsed.accountId || null;
    const contraAccountId: string | null = parsed.contraAccountId || null;
    const bankAccountId: string | null = parsed.bankAccountId || null;
    const collectedRepId: string | null = parsed.collectedRepId || null;

    const fileMeta: FileMeta = {};
    if (req.file) {
      const { url, gcsPath } = await uploadFileToGCS(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        `vouchers/${req.user!.id}`,
      );
      fileMeta.fileUrl = url;
      fileMeta.fileName = req.file.originalname;
      fileMeta.fileMimeType = req.file.mimetype;
      fileMeta.fileSize = req.file.size;
      fileMeta.gcsPath = gcsPath;
    }

    const { rows: allocationRows, runningRecd } = buildAllocationRows(parsed);
    const finalAmount = parsed.amount || runningRecd;

    let voucher;
    let attempt = 0;
    while (true) {
      const voucherNumber = await generateVoucherNumber();
      try {
        voucher = await prisma.voucher.create({
          data: {
            voucherNumber,
            type: parsed.type,
            direction,
            voucherDate: parseDate(parsed.voucherDate) ?? new Date(),
            amount: finalAmount,
            netAmount: parsed.netAmount ?? 0,
            inputVatPercent: parsed.inputVatPercent ?? 0,
            inputVatAmount: parsed.inputVatAmount ?? 0,
            outputVatPercent: parsed.outputVatPercent ?? 0,
            outputVatAmount: parsed.outputVatAmount ?? 0,
            currency: parsed.currency,
            referenceType: parsed.referenceType,
            invoiceId,
            orderId,
            accountId,
            contraAccountId,
            bankAccountId,
            collectedRepId,
            partyName: parsed.partyName || null,
            issuedTo: parsed.issuedTo || null,
            narration: parsed.narration || null,
            paymentMethod: parsed.paymentMethod ?? null,
            chequeNumber: parsed.chequeNumber || null,
            chequeDate: parseDate(parsed.chequeDate),
            presentOn: parseDate(parsed.presentOn),
            clearedOn: parseDate(parsed.clearedOn),
            accountPayee: parsed.accountPayee ?? false,
            printCheque: parsed.printCheque ?? false,
            againstType: parsed.againstType || null,
            fileUrl: fileMeta.fileUrl ?? null,
            fileName: fileMeta.fileName ?? null,
            fileMimeType: fileMeta.fileMimeType ?? null,
            fileSize: fileMeta.fileSize ?? null,
            gcsPath: fileMeta.gcsPath ?? null,
            userId: req.user!.id,
            ...(allocationRows.length ? { allocations: { create: allocationRows } } : {}),
          },
          include: VOUCHER_INCLUDE,
        });
        break;
      } catch (e: unknown) {
        const code = (e as { code?: string }).code;
        if (code === 'P2002' && attempt < 4) { attempt += 1; continue; }
        throw e;
      }
    }

    const invoiceIdsToReconcile: string[] = [];
    if (voucher.invoiceId) invoiceIdsToReconcile.push(voucher.invoiceId);
    allocationRows.forEach((a) => { if (a.invoiceId) invoiceIdsToReconcile.push(a.invoiceId); });
    if (invoiceIdsToReconcile.length > 0) {
      await reconcileInvoiceStatuses(invoiceIdsToReconcile);
    }

    res.status(201).json({ success: true, message: 'Voucher created', data: voucher });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

// Edit an existing voucher. Allocations are replaced wholesale; invoice
// statuses are reconciled for both the previously-linked invoices and the
// newly-linked ones so the SOA / receivables reports stay correct.
export const updateVoucher = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (typeof req.body.allocations === 'string') {
      try { req.body.allocations = JSON.parse(req.body.allocations); } catch { /* leave to fail validation */ }
    }
    const parsed = createSchema.parse(req.body);
    const direction = parsed.direction ?? DEFAULT_DIRECTION[parsed.type];
    const isAdmin = req.user!.role === Role.ADMIN;

    const existing = await prisma.voucher.findFirst({
      where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user!.id }) },
      include: { allocations: { select: { invoiceId: true } } },
    });
    if (!existing) throw new AppError('Voucher not found', 404);

    const { invoiceId, orderId } = await resolveReferences(parsed, req.user!.id, isAdmin);
    const accountId: string | null = parsed.accountId || null;
    const contraAccountId: string | null = parsed.contraAccountId || null;
    const bankAccountId: string | null = parsed.bankAccountId || null;
    const collectedRepId: string | null = parsed.collectedRepId || null;

    // Optional new attachment — replaces the old one if provided.
    const fileMeta: FileMeta = {};
    let replacedFile = false;
    if (req.file) {
      const { url, gcsPath } = await uploadFileToGCS(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        `vouchers/${req.user!.id}`,
      );
      fileMeta.fileUrl = url;
      fileMeta.fileName = req.file.originalname;
      fileMeta.fileMimeType = req.file.mimetype;
      fileMeta.fileSize = req.file.size;
      fileMeta.gcsPath = gcsPath;
      replacedFile = true;
    }

    const { rows: allocationRows, runningRecd } = buildAllocationRows(parsed);
    const finalAmount = parsed.amount || runningRecd;

    // Capture invoice IDs touched BEFORE the edit so removed links still reconcile.
    const invoiceIdsToReconcile = new Set<string>();
    if (existing.invoiceId) invoiceIdsToReconcile.add(existing.invoiceId);
    existing.allocations.forEach((a) => { if (a.invoiceId) invoiceIdsToReconcile.add(a.invoiceId); });

    const updated = await prisma.$transaction(async (tx) => {
      await tx.voucherAllocation.deleteMany({ where: { voucherId: existing.id } });
      return tx.voucher.update({
        where: { id: existing.id },
        data: {
          type: parsed.type,
          direction,
          voucherDate: parseDate(parsed.voucherDate) ?? existing.voucherDate,
          amount: finalAmount,
          netAmount: parsed.netAmount ?? 0,
          inputVatPercent: parsed.inputVatPercent ?? 0,
          inputVatAmount: parsed.inputVatAmount ?? 0,
          outputVatPercent: parsed.outputVatPercent ?? 0,
          outputVatAmount: parsed.outputVatAmount ?? 0,
          currency: parsed.currency,
          referenceType: parsed.referenceType,
          invoiceId,
          orderId,
          accountId,
          contraAccountId,
          bankAccountId,
          collectedRepId,
          partyName: parsed.partyName || null,
          issuedTo: parsed.issuedTo || null,
          narration: parsed.narration || null,
          paymentMethod: parsed.paymentMethod ?? null,
          chequeNumber: parsed.chequeNumber || null,
          chequeDate: parseDate(parsed.chequeDate),
          presentOn: parseDate(parsed.presentOn),
          clearedOn: parseDate(parsed.clearedOn),
          accountPayee: parsed.accountPayee ?? false,
          printCheque: parsed.printCheque ?? false,
          againstType: parsed.againstType || null,
          ...(replacedFile ? {
            fileUrl: fileMeta.fileUrl ?? null,
            fileName: fileMeta.fileName ?? null,
            fileMimeType: fileMeta.fileMimeType ?? null,
            fileSize: fileMeta.fileSize ?? null,
            gcsPath: fileMeta.gcsPath ?? null,
          } : {}),
          ...(allocationRows.length ? { allocations: { create: allocationRows } } : {}),
        },
        include: VOUCHER_INCLUDE,
      });
    });

    // Drop the old GCS object after the DB commit if it was replaced.
    if (replacedFile && existing.gcsPath) {
      try { await deleteFileFromGCS(existing.gcsPath); } catch { /* ignore */ }
    }

    if (updated.invoiceId) invoiceIdsToReconcile.add(updated.invoiceId);
    allocationRows.forEach((a) => { if (a.invoiceId) invoiceIdsToReconcile.add(a.invoiceId); });
    if (invoiceIdsToReconcile.size > 0) {
      await reconcileInvoiceStatuses(Array.from(invoiceIdsToReconcile));
    }

    res.json({ success: true, message: 'Voucher updated', data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const getVouchers = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const type = req.query.type as VoucherType | undefined;
    const invoiceId = req.query.invoiceId as string | undefined;
    const orderId = req.query.orderId as string | undefined;
    const accountId = req.query.accountId as string | undefined;
    const search = req.query.search as string | undefined;
    const isAdmin = req.user!.role === Role.ADMIN;

    const where = {
      ...(isAdmin ? {} : { userId: req.user!.id }),
      ...(type ? { type } : {}),
      ...(invoiceId ? { invoiceId } : {}),
      ...(orderId ? { orderId } : {}),
      ...(accountId ? { accountId } : {}),
      ...(search ? {
        OR: [
          { voucherNumber: { contains: search, mode: 'insensitive' as const } },
          { partyName: { contains: search, mode: 'insensitive' as const } },
          { narration: { contains: search, mode: 'insensitive' as const } },
          { chequeNumber: { contains: search, mode: 'insensitive' as const } },
        ],
      } : {}),
    };

    const skip = (page - 1) * limit;
    const [vouchers, total] = await prisma.$transaction([
      prisma.voucher.findMany({
        where, skip, take: limit,
        orderBy: { voucherDate: 'desc' },
        include: VOUCHER_INCLUDE,
      }),
      prisma.voucher.count({ where }),
    ]);

    res.json({
      success: true,
      data: vouchers,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

export const getVoucher = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const isAdmin = req.user!.role === Role.ADMIN;
    const voucher = await prisma.voucher.findFirst({
      where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user!.id }) },
      include: VOUCHER_INCLUDE,
    });
    if (!voucher) throw new AppError('Voucher not found', 404);
    res.json({ success: true, data: voucher });
  } catch (error) {
    next(error);
  }
};

export const deleteVoucher = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const isAdmin = req.user!.role === Role.ADMIN;
    const voucher = await prisma.voucher.findFirst({
      where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user!.id }) },
      include: { allocations: { select: { invoiceId: true } } },
    });
    if (!voucher) throw new AppError('Voucher not found', 404);

    if (voucher.gcsPath) {
      try { await deleteFileFromGCS(voucher.gcsPath); } catch { /* ignore */ }
    }

    const invoiceIds: string[] = [];
    if (voucher.invoiceId) invoiceIds.push(voucher.invoiceId);
    voucher.allocations.forEach((a) => { if (a.invoiceId) invoiceIds.push(a.invoiceId); });

    await prisma.voucher.delete({ where: { id: voucher.id } });

    if (invoiceIds.length > 0) {
      await reconcileInvoiceStatuses(invoiceIds);
    }

    res.json({ success: true, message: 'Voucher deleted' });
  } catch (error) {
    next(error);
  }
};

function sumByDirection(items: { amount: number; direction: VoucherDirection }[]) {
  const credit = items.filter((v) => v.direction === VoucherDirection.CREDIT).reduce((s, v) => s + v.amount, 0);
  const debit = items.filter((v) => v.direction === VoucherDirection.DEBIT).reduce((s, v) => s + v.amount, 0);
  return { credit, debit };
}

export const getReferenceValue = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const type = req.query.type as 'INVOICE' | 'ORDER' | undefined;
    const id = req.query.id as string | undefined;
    if (!type || !id) throw new AppError('type and id query params are required', 400);
    const isAdmin = req.user!.role === Role.ADMIN;

    if (type === 'INVOICE') {
      const invoice = await prisma.invoice.findFirst({
        where: { id, ...(isAdmin ? {} : { userId: req.user!.id }) },
        select: { id: true, invoiceNumber: true, total: true, currency: true, status: true, billToName: true },
      });
      if (!invoice) throw new AppError('Invoice not found', 404);

      const vouchers = await prisma.voucher.findMany({
        where: { invoiceId: id },
        select: { amount: true, direction: true },
      });
      const allocations = await prisma.voucherAllocation.findMany({
        where: { invoiceId: id },
        select: { allocatedAmount: true },
      });
      const { credit, debit } = sumByDirection(vouchers);
      const allocated = allocations.reduce((s, a) => s + a.allocatedAmount, 0);
      const outstanding = invoice.total + debit - credit - allocated;

      res.json({
        success: true,
        data: {
          reference: { type: 'INVOICE', id: invoice.id, number: invoice.invoiceNumber, party: invoice.billToName, status: invoice.status },
          baseValue: invoice.total,
          creditTotal: credit + allocated,
          debitTotal: debit,
          outstanding,
          currency: invoice.currency,
        },
      });
      return;
    }

    if (type === 'ORDER') {
      const order = await prisma.order.findFirst({
        where: { id, ...(isAdmin ? {} : { userId: req.user!.id }) },
        select: { id: true, orderNumber: true, price: true, status: true, user: { select: { firstName: true, lastName: true } } },
      });
      if (!order) throw new AppError('Order not found', 404);

      const vouchers = await prisma.voucher.findMany({
        where: { orderId: id },
        select: { amount: true, direction: true },
      });
      const { credit, debit } = sumByDirection(vouchers);
      const baseValue = order.price ?? 0;
      const outstanding = baseValue + debit - credit;

      res.json({
        success: true,
        data: {
          reference: { type: 'ORDER', id: order.id, number: order.orderNumber, party: order.user ? `${order.user.firstName} ${order.user.lastName}` : null, status: order.status },
          baseValue, creditTotal: credit, debitTotal: debit, outstanding, currency: 'AED',
        },
      });
      return;
    }

    throw new AppError('Invalid type. Use INVOICE or ORDER', 400);
  } catch (error) {
    next(error);
  }
};

export const getOpenBills = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const accountId = req.query.accountId as string | undefined;
    if (!accountId) throw new AppError('accountId is required', 400);
    // Optional Job filter — when the voucher modal has a Job (order)
    // selected, narrow open bills to only the invoices linked to that
    // order. Keeps the receipt/purchase voucher focused on one job.
    const orderId = req.query.orderId as string | undefined;

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new AppError('Account not found', 404);

    const invoices = await prisma.invoice.findMany({
      where: {
        AND: [
          {
            OR: [
              { accountId },
              { AND: [{ accountId: null }, { billToName: { equals: account.name, mode: 'insensitive' } }] },
            ],
          },
          ...(orderId ? [{ orderId }] : []),
        ],
      },
      orderBy: { invoiceDate: 'asc' },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        currency: true,
        total: true,
        jobNo: true,
        customerRef: true,
        status: true,
        vouchers: { select: { amount: true, direction: true } },
        voucherAllocations: { select: { allocatedAmount: true } },
      },
    });

    const rows = invoices.map((inv) => {
      const { credit, debit } = sumByDirection(inv.vouchers);
      const allocated = inv.voucherAllocations.reduce((s, a) => s + a.allocatedAmount, 0);
      const balance = inv.total + debit - credit - allocated;
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        currency: inv.currency,
        jobNo: inv.jobNo,
        refNo: inv.customerRef,
        status: inv.status,
        billAmount: inv.total,
        paidAmount: credit + allocated,
        balance: Math.round(balance * 100) / 100,
      };
    }).filter((r) => Math.abs(r.balance) > 0.005);

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
};

// Open Purchase Vouchers for a supplier — used by the Payment / Supplier-
// Payment / Debit-Note modal so the user can pick the exact supplier bill
// they are settling. Outstanding = purchase amount minus every payment
// allocation already linked to that Purchase Voucher.
export const getOpenPurchases = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const accountId = req.query.accountId as string | undefined;
    if (!accountId) throw new AppError('accountId is required', 400);
    // Optional Job filter — when a Job is selected on the voucher, only the
    // purchase bills booked against that order are shown.
    const orderId = req.query.orderId as string | undefined;

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new AppError('Account not found', 404);

    const purchases = await prisma.voucher.findMany({
      where: {
        type: VoucherType.PURCHASE,
        accountId,
        ...(orderId ? { orderId } : {}),
      },
      orderBy: { voucherDate: 'asc' },
      select: {
        id: true,
        voucherNumber: true,
        voucherDate: true,
        currency: true,
        amount: true,
        narration: true,
        order: { select: { orderNumber: true } },
        allocations: { select: { refNo: true, invoiceNumber: true } },
        paymentAllocations: { select: { allocatedAmount: true } },
      },
    });

    const rows = purchases.map((p) => {
      const paid = p.paymentAllocations.reduce((s, a) => s + a.allocatedAmount, 0);
      const balance = Math.round((p.amount - paid) * 100) / 100;
      return {
        id: p.id,
        voucherNumber: p.voucherNumber,
        voucherDate: p.voucherDate,
        currency: p.currency,
        jobNo: p.order?.orderNumber || null,
        refNo: p.allocations[0]?.refNo || p.allocations[0]?.invoiceNumber || null,
        narration: p.narration,
        billAmount: p.amount,
        paidAmount: Math.round(paid * 100) / 100,
        balance,
      };
    }).filter((r) => Math.abs(r.balance) > 0.005);

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
};

export const downloadVoucherPdf = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const isAdmin = req.user!.role === Role.ADMIN;
    const v = await prisma.voucher.findFirst({
      where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user!.id }) },
      include: VOUCHER_INCLUDE,
    });
    if (!v) throw new AppError('Voucher not found', 404);

    const defaultBank = await prisma.bankAccount.findFirst({
      where: { isDefault: true },
      select: { companyTrn: true },
    });

    // Receipt and Credit vouchers reuse the same polished bill-allocation
    // PDF layout that Purchase / Supplier-Payment / Payment vouchers use.
    const useBillAllocationPdf =
      v.type === VoucherType.SUPPLIER_PAYMENT ||
      v.type === VoucherType.PURCHASE ||
      v.type === VoucherType.PAYMENT ||
      v.type === VoucherType.RECEIPT ||
      v.type === VoucherType.CREDIT_NOTE;

    const acDisplay = v.bankAccount
      ? { code: v.bankAccount.label || v.bankAccount.bankName, name: `${v.bankAccount.bankName} · ${v.bankAccount.accountNumber}` }
      : v.contraAccount
      ? { code: v.contraAccount.code, name: v.contraAccount.name }
      : null;

    let buffer: Buffer;
    if (useBillAllocationPdf && (v.allocations.length > 0 || v.paymentMethod || v.chequeNumber)) {
      buffer = await generateSupplierPaymentVoucherPdfBuffer({
        voucherType: v.type,
        voucherNumber: v.voucherNumber,
        voucherDate: v.voucherDate,
        paymentMethod: v.paymentMethod,
        amount: v.amount,
        currency: v.currency,
        accountPayee: v.accountPayee,
        chequeNumber: v.chequeNumber,
        chequeDate: v.chequeDate,
        presentOn: v.presentOn,
        clearedOn: v.clearedOn,
        againstType: v.againstType,
        narration: v.narration,
        issuedTo: v.issuedTo,
        account: v.account ? {
          code: v.account.code,
          name: v.account.name,
          address: v.account.address || v.account.deliveryAddress || null,
          mobile1: v.account.mobile1 || null,
          trn: v.account.trn || null,
          email: v.account.email || null,
        } : null,
        contraAccount: acDisplay,
        collectedRep: v.collectedRep ? { code: v.collectedRep.code, name: v.collectedRep.name } : null,
        allocations: v.allocations.map((a) => ({
          jobNo: a.jobNo, refNo: a.refNo, invoiceNumber: a.invoiceNumber,
          invoiceDate: a.invoiceDate, billAmount: a.billAmount,
          allocatedAmount: a.allocatedAmount, balanceAfter: a.balanceAfter,
          remarks: a.remarks,
        })),
        companyTrn: defaultBank?.companyTrn || undefined,
      });
    } else {
      buffer = await generateVoucherPdfBuffer({
        voucherNumber: v.voucherNumber,
        type: v.type, direction: v.direction, voucherDate: v.voucherDate,
        amount: v.amount, currency: v.currency, referenceType: v.referenceType,
        partyName: v.partyName, narration: v.narration,
        account: v.account ? {
          code: v.account.code, name: v.account.name,
          address: v.account.address || v.account.deliveryAddress || null,
          mobile1: v.account.mobile1 || null, trn: v.account.trn || null,
          accountGroup: v.account.accountGroup ? { name: v.account.accountGroup.name } : null,
        } : null,
        contraAccount: v.contraAccount ? {
          code: v.contraAccount.code, name: v.contraAccount.name,
          accountGroup: v.contraAccount.accountGroup ? { name: v.contraAccount.accountGroup.name } : null,
        } : null,
        invoice: v.invoice ? {
          invoiceNumber: v.invoice.invoiceNumber, total: v.invoice.total,
          currency: v.invoice.currency, billToName: v.invoice.billToName,
        } : null,
        order: v.order ? { orderNumber: v.order.orderNumber, price: v.order.price } : null,
        user: v.user ? { firstName: v.user.firstName, lastName: v.user.lastName, email: v.user.email } : null,
        companyTrn: defaultBank?.companyTrn || undefined,
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${v.voucherNumber}.pdf"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};
