import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { VoucherType, VoucherDirection, VoucherReferenceType, Role } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { uploadFileToGCS, deleteFileFromGCS } from '../config/gcs';

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

const createSchema = z.object({
  type: z.nativeEnum(VoucherType),
  direction: z.nativeEnum(VoucherDirection).optional(),
  voucherDate: z.string().optional(),
  amount: z.coerce.number().positive(),
  currency: z.string().default('AED'),
  referenceType: z.nativeEnum(VoucherReferenceType).default(VoucherReferenceType.NONE),
  invoiceId: z.string().uuid().optional().or(z.literal('')),
  orderId: z.string().uuid().optional().or(z.literal('')),
  partyName: z.string().optional(),
  narration: z.string().optional(),
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

export const createVoucher = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createSchema.parse(req.body);
    const direction = parsed.direction ?? DEFAULT_DIRECTION[parsed.type];
    const isAdmin = req.user!.role === Role.ADMIN;

    let invoiceId: string | null = parsed.invoiceId || null;
    let orderId: string | null = parsed.orderId || null;

    if (parsed.referenceType === VoucherReferenceType.INVOICE) {
      if (!invoiceId) throw new AppError('invoiceId is required when referenceType is INVOICE', 400);
      const inv = await prisma.invoice.findFirst({
        where: { id: invoiceId, ...(isAdmin ? {} : { userId: req.user!.id }) },
      });
      if (!inv) throw new AppError('Invoice not found or access denied', 404);
      orderId = null;
    } else if (parsed.referenceType === VoucherReferenceType.ORDER) {
      if (!orderId) throw new AppError('orderId is required when referenceType is ORDER', 400);
      const ord = await prisma.order.findFirst({
        where: { id: orderId, ...(isAdmin ? {} : { userId: req.user!.id }) },
      });
      if (!ord) throw new AppError('Order not found or access denied', 404);
      invoiceId = null;
    } else {
      invoiceId = null;
      orderId = null;
    }

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
            voucherDate: parsed.voucherDate ? new Date(parsed.voucherDate) : new Date(),
            amount: parsed.amount,
            currency: parsed.currency,
            referenceType: parsed.referenceType,
            invoiceId,
            orderId,
            partyName: parsed.partyName || null,
            narration: parsed.narration || null,
            fileUrl: fileMeta.fileUrl ?? null,
            fileName: fileMeta.fileName ?? null,
            fileMimeType: fileMeta.fileMimeType ?? null,
            fileSize: fileMeta.fileSize ?? null,
            gcsPath: fileMeta.gcsPath ?? null,
            userId: req.user!.id,
          },
          include: {
            invoice: { select: { id: true, invoiceNumber: true, total: true, currency: true, billToName: true } },
            order: { select: { id: true, orderNumber: true, price: true } },
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        });
        break;
      } catch (e: unknown) {
        const code = (e as { code?: string }).code;
        if (code === 'P2002' && attempt < 4) { attempt += 1; continue; }
        throw e;
      }
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

export const getVouchers = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const type = req.query.type as VoucherType | undefined;
    const invoiceId = req.query.invoiceId as string | undefined;
    const orderId = req.query.orderId as string | undefined;
    const search = req.query.search as string | undefined;
    const isAdmin = req.user!.role === Role.ADMIN;

    const where = {
      ...(isAdmin ? {} : { userId: req.user!.id }),
      ...(type ? { type } : {}),
      ...(invoiceId ? { invoiceId } : {}),
      ...(orderId ? { orderId } : {}),
      ...(search ? {
        OR: [
          { voucherNumber: { contains: search, mode: 'insensitive' as const } },
          { partyName: { contains: search, mode: 'insensitive' as const } },
          { narration: { contains: search, mode: 'insensitive' as const } },
        ],
      } : {}),
    };

    const skip = (page - 1) * limit;
    const [vouchers, total] = await prisma.$transaction([
      prisma.voucher.findMany({
        where,
        skip,
        take: limit,
        orderBy: { voucherDate: 'desc' },
        include: {
          invoice: { select: { id: true, invoiceNumber: true, total: true, currency: true, billToName: true } },
          order: { select: { id: true, orderNumber: true, price: true } },
          user: { select: { firstName: true, lastName: true, email: true } },
        },
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
      include: {
        invoice: { select: { id: true, invoiceNumber: true, total: true, currency: true, billToName: true } },
        order: { select: { id: true, orderNumber: true, price: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
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
    });
    if (!voucher) throw new AppError('Voucher not found', 404);

    if (voucher.gcsPath) {
      try { await deleteFileFromGCS(voucher.gcsPath); } catch { /* ignore - record cleanup is priority */ }
    }

    await prisma.voucher.delete({ where: { id: voucher.id } });
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
      const { credit, debit } = sumByDirection(vouchers);
      const outstanding = invoice.total + debit - credit;

      res.json({
        success: true,
        data: {
          reference: {
            type: 'INVOICE',
            id: invoice.id,
            number: invoice.invoiceNumber,
            party: invoice.billToName,
            status: invoice.status,
          },
          baseValue: invoice.total,
          creditTotal: credit,
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
        select: {
          id: true,
          orderNumber: true,
          price: true,
          status: true,
          user: { select: { firstName: true, lastName: true } },
        },
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
          reference: {
            type: 'ORDER',
            id: order.id,
            number: order.orderNumber,
            party: order.user ? `${order.user.firstName} ${order.user.lastName}` : null,
            status: order.status,
          },
          baseValue,
          creditTotal: credit,
          debitTotal: debit,
          outstanding,
          currency: 'AED',
        },
      });
      return;
    }

    throw new AppError('Invalid type. Use INVOICE or ORDER', 400);
  } catch (error) {
    next(error);
  }
};
