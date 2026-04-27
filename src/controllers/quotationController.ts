import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { QuotationStatus, Role } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { generateQuotationNumber, paginate } from '../utils/helpers';
import { generateQuotationWordBuffer } from '../utils/quotationWordGenerator';
import { generateQuotationPdfBuffer } from '../utils/quotationPdfGenerator';

const quotationItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
});

const createQuotationSchema = z.object({
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
  terms: z.string().optional(),
  notes: z.string().optional(),
  validUntil: z.string().optional(),
  status: z.nativeEnum(QuotationStatus).optional(),
  items: z.array(quotationItemSchema).min(1, 'At least one line item required'),
});

const updateQuotationSchema = z.object({
  status: z.nativeEnum(QuotationStatus).optional(),
  billToName: z.string().min(2).optional(),
  billToAddress: z.string().min(5).optional(),
  billToCity: z.string().min(2).optional(),
  billToCountry: z.string().min(2).optional(),
  billToEmail: z.string().email().optional().or(z.literal('')),
  billToPhone: z.string().optional(),
  terms: z.string().optional(),
  notes: z.string().optional(),
  validUntil: z.string().optional(),
  taxRate: z.number().min(0).max(100).optional(),
  shippingCost: z.number().min(0).optional(),
  items: z.array(quotationItemSchema).min(1).optional(),
});

function calcTotals(items: { quantity: number; unitPrice: number }[], taxRate: number, shippingCost: number) {
  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  const total = Math.round((subtotal + taxAmount + shippingCost) * 100) / 100;
  return { subtotal: Math.round(subtotal * 100) / 100, taxAmount, total };
}

export const createQuotation = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = createQuotationSchema.parse(req.body);
    const isAdmin = req.user!.role === Role.ADMIN;

    if (data.orderId) {
      const order = await prisma.order.findFirst({
        where: { id: data.orderId, ...(isAdmin ? {} : { userId: req.user!.id }) },
      });
      if (!order) throw new AppError('Order not found or access denied', 404);
    }

    const { subtotal, taxAmount, total } = calcTotals(data.items, data.taxRate, data.shippingCost);

    const quotation = await prisma.quotation.create({
      data: {
        quotationNumber: generateQuotationNumber(),
        status: data.status ?? 'DRAFT',
        quotationDate: new Date(),
        validUntil: data.validUntil ? new Date(data.validUntil) : null,
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
        terms: data.terms || null,
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

    res.status(201).json({ success: true, message: 'Quotation created', data: quotation });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const getQuotations = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const status = req.query.status as QuotationStatus | undefined;
    const search = req.query.search as string | undefined;
    const isAdmin = req.user!.role === Role.ADMIN;

    const where = {
      ...(isAdmin ? {} : { userId: req.user!.id }),
      ...(status ? { status } : {}),
      ...(search ? {
        OR: [
          { quotationNumber: { contains: search, mode: 'insensitive' as const } },
          { billToName: { contains: search, mode: 'insensitive' as const } },
          { billToEmail: { contains: search, mode: 'insensitive' as const } },
        ],
      } : {}),
    };

    const [quotations, total] = await prisma.$transaction([
      prisma.quotation.findMany({
        where,
        ...paginate(page, limit),
        orderBy: { createdAt: 'desc' },
        include: {
          items: true,
          orderRef: { select: { id: true, orderNumber: true } },
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      prisma.quotation.count({ where }),
    ]);

    res.json({
      success: true,
      data: quotations,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

export const getQuotation = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const isAdmin = req.user!.role === Role.ADMIN;

    const quotation = await prisma.quotation.findFirst({
      where: { id, ...(isAdmin ? {} : { userId: req.user!.id }) },
      include: {
        items: true,
        orderRef: { select: { id: true, orderNumber: true, status: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!quotation) throw new AppError('Quotation not found', 404);
    res.json({ success: true, data: quotation });
  } catch (error) {
    next(error);
  }
};

export const updateQuotation = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const data = updateQuotationSchema.parse(req.body);
    const isAdmin = req.user!.role === Role.ADMIN;

    const quotation = await prisma.quotation.findFirst({
      where: { id, ...(isAdmin ? {} : { userId: req.user!.id }) },
      include: { items: true },
    });
    if (!quotation) throw new AppError('Quotation not found', 404);

    const newItems = data.items ?? quotation.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    }));
    const newTaxRate = data.taxRate ?? quotation.taxRate;
    const newShippingCost = data.shippingCost ?? quotation.shippingCost;
    const { subtotal, taxAmount, total } = calcTotals(newItems, newTaxRate, newShippingCost);

    const updated = await prisma.quotation.update({
      where: { id },
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.billToName ? { billToName: data.billToName } : {}),
        ...(data.billToAddress ? { billToAddress: data.billToAddress } : {}),
        ...(data.billToCity ? { billToCity: data.billToCity } : {}),
        ...(data.billToCountry ? { billToCountry: data.billToCountry } : {}),
        ...(data.billToEmail !== undefined ? { billToEmail: data.billToEmail || null } : {}),
        ...(data.billToPhone !== undefined ? { billToPhone: data.billToPhone || null } : {}),
        ...(data.terms !== undefined ? { terms: data.terms || null } : {}),
        ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
        ...(data.validUntil !== undefined ? { validUntil: data.validUntil ? new Date(data.validUntil) : null } : {}),
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

    res.json({ success: true, message: 'Quotation updated', data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const deleteQuotation = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const isAdmin = req.user!.role === Role.ADMIN;

    const quotation = await prisma.quotation.findFirst({
      where: { id, ...(isAdmin ? {} : { userId: req.user!.id }) },
    });
    if (!quotation) throw new AppError('Quotation not found', 404);

    await prisma.quotation.delete({ where: { id } });
    res.json({ success: true, message: 'Quotation deleted' });
  } catch (error) {
    next(error);
  }
};

export const downloadQuotationWord = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const isAdmin = req.user!.role === Role.ADMIN;

    const quotation = await prisma.quotation.findFirst({
      where: { id, ...(isAdmin ? {} : { userId: req.user!.id }) },
      include: { items: true, orderRef: { select: { orderNumber: true } } },
    });

    if (!quotation) throw new AppError('Quotation not found', 404);

    const buffer = await generateQuotationWordBuffer(quotation);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${quotation.quotationNumber}.docx"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

export const downloadQuotationPdf = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const isAdmin = req.user!.role === Role.ADMIN;

    const quotation = await prisma.quotation.findFirst({
      where: { id, ...(isAdmin ? {} : { userId: req.user!.id }) },
      include: { items: true, orderRef: { select: { orderNumber: true } } },
    });

    if (!quotation) throw new AppError('Quotation not found', 404);

    const buffer = await generateQuotationPdfBuffer(quotation);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${quotation.quotationNumber}.pdf"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};
