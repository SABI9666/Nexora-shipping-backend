import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { InvoiceStatus, Role } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { generateInvoiceNumber, deriveJobNumber, paginate } from '../utils/helpers';
import { generateInvoiceWordBuffer } from '../utils/wordGenerator';
import { generateInvoicePdfBuffer } from '../utils/invoicePdfGenerator';
import { amountToWords } from '../utils/numberToWords';

const invoiceItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  lineCurrency: z.string().optional(),
  exchangeRate: z.number().positive().optional(),
  vatPercent: z.number().min(0).max(100).optional(),
  remarks: z.string().optional(),
});

const SHIPMENT_FIELDS = {
  companyTrn: z.string().optional(),
  jobNo: z.string().optional(),
  originPort: z.string().optional(),
  destPort: z.string().optional(),
  masterBl: z.string().optional(),
  houseBl: z.string().optional(),
  commodity: z.string().optional(),
  boeNumber: z.string().optional(),
  grossWeight: z.string().optional(),
  volume: z.string().optional(),
  packages: z.string().optional(),
  shipperName: z.string().optional(),
  consigneeName: z.string().optional(),
  customerRef: z.string().optional(),
  bankName: z.string().optional(),
  bankAddress: z.string().optional(),
  accountName: z.string().optional(),
  accountNumber: z.string().optional(),
  iban: z.string().optional(),
  swiftCode: z.string().optional(),
};

const createInvoiceSchema = z.object({
  orderId: z.string().uuid().optional(),
  billToName: z.string().min(2),
  billToAddress: z.string().min(5),
  billToCity: z.string().min(2),
  billToCountry: z.string().min(2),
  billToEmail: z.string().email().optional().or(z.literal('')),
  billToPhone: z.string().optional(),
  shipFromName: z.string().optional(),
  shipFromAddress: z.string().optional(),
  shipFromCity: z.string().optional(),
  shipFromCountry: z.string().optional(),
  currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'AED', 'SAR']).default('AED'),
  taxRate: z.number().min(0).max(100).default(0),
  shippingCost: z.number().min(0).default(0),
  paymentTerms: z.string().optional(),
  notes: z.string().optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  status: z.nativeEnum(InvoiceStatus).optional(),
  items: z.array(invoiceItemSchema).min(1, 'At least one line item required'),
  ...SHIPMENT_FIELDS,
});

const updateInvoiceSchema = z.object({
  status: z.nativeEnum(InvoiceStatus).optional(),
  billToName: z.string().min(2).optional(),
  billToAddress: z.string().min(5).optional(),
  billToCity: z.string().min(2).optional(),
  billToCountry: z.string().min(2).optional(),
  billToEmail: z.string().email().optional().or(z.literal('')),
  billToPhone: z.string().optional(),
  paymentTerms: z.string().optional(),
  notes: z.string().optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  taxRate: z.number().min(0).max(100).optional(),
  shippingCost: z.number().min(0).optional(),
  items: z.array(invoiceItemSchema).min(1).optional(),
  ...SHIPMENT_FIELDS,
});

type ItemInput = {
  description: string;
  quantity: number;
  unitPrice: number;
  lineCurrency?: string;
  exchangeRate?: number;
  vatPercent?: number;
  remarks?: string;
};

type EnrichedItem = ItemInput & {
  exchangeRate: number;
  vatPercent: number;
  amount: number;
  vatAmount: number;
  totalInBase: number;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function enrichItems(items: ItemInput[]): EnrichedItem[] {
  return items.map((it) => {
    const ex = it.exchangeRate ?? 1;
    const vatPct = it.vatPercent ?? 0;
    const amount = round2(it.quantity * it.unitPrice);
    const vatAmount = round2(amount * (vatPct / 100));
    const totalInBase = round2((amount + vatAmount) * ex);
    return { ...it, exchangeRate: ex, vatPercent: vatPct, amount, vatAmount, totalInBase };
  });
}

function calcTotals(enriched: EnrichedItem[], shippingCost: number) {
  const netInBase = enriched.reduce((s, i) => s + i.amount * i.exchangeRate, 0);
  const vatInBase = enriched.reduce((s, i) => s + i.vatAmount * i.exchangeRate, 0);
  const subtotal = round2(netInBase);
  const taxAmount = round2(vatInBase);
  const total = round2(subtotal + taxAmount + shippingCost);
  return { subtotal, taxAmount, total };
}

export const createInvoice = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = createInvoiceSchema.parse(req.body);
    const isAdmin = req.user!.role === Role.ADMIN;

    let linkedOrderNumber: string | null = null;
    if (data.orderId) {
      const order = await prisma.order.findFirst({
        where: { id: data.orderId, ...(isAdmin ? {} : { userId: req.user!.id }) },
        select: { id: true, orderNumber: true },
      });
      if (!order) throw new AppError('Order not found or access denied', 404);
      linkedOrderNumber = order.orderNumber;
    }

    const enriched = enrichItems(data.items);
    const { subtotal, taxAmount, total } = calcTotals(enriched, data.shippingCost);
    const amountInWords = amountToWords(total, data.currency);

    let invoice;
    let attempt = 0;
    while (true) {
      const invoiceNumber = await generateInvoiceNumber();
      const jobNo = data.jobNo || linkedOrderNumber || deriveJobNumber(invoiceNumber);
      try {
        invoice = await prisma.invoice.create({
          data: {
            invoiceNumber,
            status: data.status ?? 'DRAFT',
            invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : new Date(),
            dueDate: data.dueDate ? new Date(data.dueDate) : null,
            billToName: data.billToName,
            billToAddress: data.billToAddress,
            billToCity: data.billToCity,
            billToCountry: data.billToCountry,
            billToEmail: data.billToEmail || null,
            billToPhone: data.billToPhone || null,
            shipFromName: data.shipFromName ?? 'Nexora Express',
            shipFromAddress: data.shipFromAddress ?? '1 Nexora Way',
            shipFromCity: data.shipFromCity ?? 'London',
            shipFromCountry: data.shipFromCountry ?? 'GB',
            companyTrn: data.companyTrn || null,
            jobNo,
            originPort: data.originPort || null,
            destPort: data.destPort || null,
            masterBl: data.masterBl || null,
            houseBl: data.houseBl || null,
            commodity: data.commodity || null,
            boeNumber: data.boeNumber || null,
            grossWeight: data.grossWeight || null,
            volume: data.volume || null,
            packages: data.packages || null,
            shipperName: data.shipperName || null,
            consigneeName: data.consigneeName || null,
            customerRef: data.customerRef || `INV-${invoiceNumber}`,
            bankName: data.bankName || null,
            bankAddress: data.bankAddress || null,
            accountName: data.accountName || null,
            accountNumber: data.accountNumber || null,
            iban: data.iban || null,
            swiftCode: data.swiftCode || null,
            currency: data.currency,
            taxRate: data.taxRate,
            taxAmount,
            shippingCost: data.shippingCost,
            subtotal,
            total,
            amountInWords,
            paymentTerms: data.paymentTerms || null,
            notes: data.notes || null,
            orderId: data.orderId || null,
            userId: req.user!.id,
            items: {
              create: enriched.map((it) => ({
                description: it.description,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                amount: it.amount,
                lineCurrency: it.lineCurrency || data.currency,
                exchangeRate: it.exchangeRate,
                vatPercent: it.vatPercent,
                vatAmount: it.vatAmount,
                totalInBase: it.totalInBase,
                remarks: it.remarks || null,
              })),
            },
          },
          include: { items: true, orderRef: { select: { orderNumber: true } } },
        });
        break;
      } catch (e: unknown) {
        const code = (e as { code?: string }).code;
        if (code === 'P2002' && attempt < 4) { attempt += 1; continue; }
        throw e;
      }
    }

    res.status(201).json({ success: true, message: 'Invoice created', data: invoice });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const getInvoices = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const status = req.query.status as InvoiceStatus | undefined;
    const search = req.query.search as string | undefined;
    const isAdmin = req.user!.role === Role.ADMIN;

    const where = {
      ...(isAdmin ? {} : { userId: req.user!.id }),
      ...(status ? { status } : {}),
      ...(search ? {
        OR: [
          { invoiceNumber: { contains: search, mode: 'insensitive' as const } },
          { billToName: { contains: search, mode: 'insensitive' as const } },
          { billToEmail: { contains: search, mode: 'insensitive' as const } },
        ],
      } : {}),
    };

    const [invoices, total] = await prisma.$transaction([
      prisma.invoice.findMany({
        where,
        ...paginate(page, limit),
        orderBy: { createdAt: 'desc' },
        include: {
          items: true,
          orderRef: { select: { id: true, orderNumber: true } },
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      prisma.invoice.count({ where }),
    ]);

    res.json({
      success: true,
      data: invoices,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

export const getInvoice = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const isAdmin = req.user!.role === Role.ADMIN;

    const invoice = await prisma.invoice.findFirst({
      where: { id, ...(isAdmin ? {} : { userId: req.user!.id }) },
      include: {
        items: true,
        orderRef: { select: { id: true, orderNumber: true, status: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!invoice) throw new AppError('Invoice not found', 404);
    res.json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
};

export const updateInvoice = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const data = updateInvoiceSchema.parse(req.body);
    const isAdmin = req.user!.role === Role.ADMIN;

    const invoice = await prisma.invoice.findFirst({
      where: { id, ...(isAdmin ? {} : { userId: req.user!.id }) },
      include: { items: true },
    });
    if (!invoice) throw new AppError('Invoice not found', 404);

    const sourceItems = data.items ?? invoice.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      lineCurrency: i.lineCurrency ?? invoice.currency,
      exchangeRate: i.exchangeRate ?? 1,
      vatPercent: i.vatPercent ?? 0,
      remarks: i.remarks ?? undefined,
    }));
    const newShippingCost = data.shippingCost ?? invoice.shippingCost;
    const enriched = enrichItems(sourceItems);
    const { subtotal, taxAmount, total } = calcTotals(enriched, newShippingCost);
    const amountInWords = amountToWords(total, invoice.currency);

    const shipmentUpdate: Record<string, string | null | undefined> = {};
    for (const k of Object.keys(SHIPMENT_FIELDS) as (keyof typeof SHIPMENT_FIELDS)[]) {
      const val = (data as Record<string, unknown>)[k];
      if (val !== undefined) shipmentUpdate[k] = (val as string) || null;
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.billToName ? { billToName: data.billToName } : {}),
        ...(data.billToAddress ? { billToAddress: data.billToAddress } : {}),
        ...(data.billToCity ? { billToCity: data.billToCity } : {}),
        ...(data.billToCountry ? { billToCountry: data.billToCountry } : {}),
        ...(data.billToEmail !== undefined ? { billToEmail: data.billToEmail || null } : {}),
        ...(data.billToPhone !== undefined ? { billToPhone: data.billToPhone || null } : {}),
        ...(data.paymentTerms !== undefined ? { paymentTerms: data.paymentTerms || null } : {}),
        ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
        ...(data.invoiceDate !== undefined ? { invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : new Date() } : {}),
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate ? new Date(data.dueDate) : null } : {}),
        ...shipmentUpdate,
        ...(data.taxRate !== undefined ? { taxRate: data.taxRate } : {}),
        shippingCost: newShippingCost,
        subtotal,
        taxAmount,
        total,
        amountInWords,
        ...(data.items ? {
          items: {
            deleteMany: {},
            create: enriched.map((it) => ({
              description: it.description,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              amount: it.amount,
              lineCurrency: it.lineCurrency || invoice.currency,
              exchangeRate: it.exchangeRate,
              vatPercent: it.vatPercent,
              vatAmount: it.vatAmount,
              totalInBase: it.totalInBase,
              remarks: it.remarks || null,
            })),
          },
        } : {}),
      },
      include: { items: true, orderRef: { select: { orderNumber: true } } },
    });

    res.json({ success: true, message: 'Invoice updated', data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const deleteInvoice = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const isAdmin = req.user!.role === Role.ADMIN;

    const invoice = await prisma.invoice.findFirst({
      where: { id, ...(isAdmin ? {} : { userId: req.user!.id }) },
    });
    if (!invoice) throw new AppError('Invoice not found', 404);

    await prisma.invoice.delete({ where: { id } });
    res.json({ success: true, message: 'Invoice deleted' });
  } catch (error) {
    next(error);
  }
};

export const downloadInvoiceWord = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const isAdmin = req.user!.role === Role.ADMIN;

    const invoice = await prisma.invoice.findFirst({
      where: { id, ...(isAdmin ? {} : { userId: req.user!.id }) },
      include: {
        items: true,
        orderRef: { select: { orderNumber: true } },
      },
    });

    if (!invoice) throw new AppError('Invoice not found', 404);

    const buffer = await generateInvoiceWordBuffer(invoice);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.docx"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

export const downloadInvoicePdf = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const isAdmin = req.user!.role === Role.ADMIN;

    const invoice = await prisma.invoice.findFirst({
      where: { id, ...(isAdmin ? {} : { userId: req.user!.id }) },
      include: {
        items: true,
        orderRef: { select: { orderNumber: true } },
      },
    });

    if (!invoice) throw new AppError('Invoice not found', 404);

    const buffer = await generateInvoicePdfBuffer(invoice);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};
