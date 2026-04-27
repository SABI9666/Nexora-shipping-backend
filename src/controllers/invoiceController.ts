import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { InvoiceStatus, Role } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { generateInvoiceNumber, paginate } from '../utils/helpers';
import { generateInvoiceWordBuffer } from '../utils/wordGenerator';
import { generateInvoicePdfBuffer } from '../utils/invoicePdfGenerator';

const invoiceItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
});

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
  currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR']).default('USD'),
  taxRate: z.number().min(0).max(100).default(0),
  shippingCost: z.number().min(0).default(0),
  paymentTerms: z.string().optional(),
  notes: z.string().optional(),
  dueDate: z.string().optional(),
  status: z.nativeEnum(InvoiceStatus).optional(),
  items: z.array(invoiceItemSchema).min(1, 'At least one line item required'),
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
  dueDate: z.string().optional(),
  taxRate: z.number().min(0).max(100).optional(),
  shippingCost: z.number().min(0).optional(),
  items: z.array(invoiceItemSchema).min(1).optional(),
});

function calcTotals(items: { quantity: number; unitPrice: number }[], taxRate: number, shippingCost: number) {
  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  const total = Math.round((subtotal + taxAmount + shippingCost) * 100) / 100;
  return { subtotal: Math.round(subtotal * 100) / 100, taxAmount, total };
}

export const createInvoice = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = createInvoiceSchema.parse(req.body);
    const isAdmin = req.user!.role === Role.ADMIN;

    if (data.orderId) {
      const order = await prisma.order.findFirst({
        where: { id: data.orderId, ...(isAdmin ? {} : { userId: req.user!.id }) },
      });
      if (!order) throw new AppError('Order not found or access denied', 404);
    }

    const { subtotal, taxAmount, total } = calcTotals(data.items, data.taxRate, data.shippingCost);

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: generateInvoiceNumber(),
        status: data.status ?? 'DRAFT',
        invoiceDate: new Date(),
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
        currency: data.currency,
        taxRate: data.taxRate,
        taxAmount,
        shippingCost: data.shippingCost,
        subtotal,
        total,
        paymentTerms: data.paymentTerms || null,
        notes: data.notes || null,
        orderId: data.orderId || null,
        userId: req.user!.id,
        items: {
          create: data.items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: Math.round(item.quantity * item.unitPrice * 100) / 100,
          })),
        },
      },
      include: { items: true, orderRef: { select: { orderNumber: true } } },
    });

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

    const newItems = data.items ?? invoice.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    }));
    const newTaxRate = data.taxRate ?? invoice.taxRate;
    const newShippingCost = data.shippingCost ?? invoice.shippingCost;
    const { subtotal, taxAmount, total } = calcTotals(newItems, newTaxRate, newShippingCost);

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
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate ? new Date(data.dueDate) : null } : {}),
        taxRate: newTaxRate,
        shippingCost: newShippingCost,
        subtotal,
        taxAmount,
        total,
        ...(data.items ? {
          items: {
            deleteMany: {},
            create: data.items.map((item) => ({
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              amount: Math.round(item.quantity * item.unitPrice * 100) / 100,
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
