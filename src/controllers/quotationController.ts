import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { QuotationStatus, Role } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { generateQuotationNumber, paginate } from '../utils/helpers';
import {
  brandingBaseUrl,
  brandingHeaderHtml,
  brandingFooterHtml,
  brandingWatermarkHtml,
  brandingHeadStyles,
} from '../utils/docxBranding';

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

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMoney(n: number, currency: string): string {
  return `${currency} ${n.toFixed(2)}`;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
}

export const downloadQuotationDocx = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const isAdmin = req.user!.role === Role.ADMIN;

    const q = await prisma.quotation.findFirst({
      where: { id, ...(isAdmin ? {} : { userId: req.user!.id }) },
      include: {
        items: true,
        orderRef: { select: { orderNumber: true } },
      },
    });
    if (!q) throw new AppError('Quotation not found', 404);

    const baseUrl = brandingBaseUrl(req);

    const rows = q.items
      .map(
        (it) => `
      <tr>
        <td style="padding:8px;border:1px solid #ccc;">${escapeHtml(it.description)}</td>
        <td style="padding:8px;border:1px solid #ccc;text-align:right;">${it.quantity}</td>
        <td style="padding:8px;border:1px solid #ccc;text-align:right;">${fmtMoney(it.unitPrice, q.currency)}</td>
        <td style="padding:8px;border:1px solid #ccc;text-align:right;"><b>${fmtMoney(it.amount, q.currency)}</b></td>
      </tr>`
      )
      .join('');

    const body = `
      ${brandingWatermarkHtml(baseUrl)}
      ${brandingHeaderHtml(baseUrl)}

      <div style="padding:0 24px;">
        <table width="100%" style="margin-bottom:18px;"><tr>
          <td>
            <div style="font-size:11px;color:#64748b;">${escapeHtml(q.shipFromName)}</div>
            <div style="font-size:11px;color:#64748b;">${escapeHtml(q.shipFromAddress)}, ${escapeHtml(q.shipFromCity)}, ${escapeHtml(q.shipFromCountry)}</div>
          </td>
          <td align="right">
            <div style="font-size:24px;font-weight:bold;color:#1e3a5f;">QUOTATION</div>
            <div style="font-size:13px;font-weight:bold;">${escapeHtml(q.quotationNumber)}</div>
            <div style="font-size:11px;color:#64748b;">Date: ${fmtDate(q.quotationDate)}</div>
            <div style="font-size:11px;color:#64748b;">Valid Until: ${fmtDate(q.validUntil)}</div>
            <div style="font-size:11px;color:#64748b;">Status: ${q.status}</div>
          </td>
        </tr></table>

        <hr style="border:0;border-top:2px solid #1e3a5f;margin-bottom:16px;"/>

        <table width="100%" style="margin-bottom:18px;"><tr>
          <td width="50%" valign="top">
            <div style="font-size:10px;color:#94a3b8;font-weight:bold;text-transform:uppercase;margin-bottom:6px;">From</div>
            <div style="font-weight:bold;">${escapeHtml(q.shipFromName)}</div>
            <div style="color:#475569;">${escapeHtml(q.shipFromAddress)}</div>
            <div style="color:#475569;">${escapeHtml(q.shipFromCity)}, ${escapeHtml(q.shipFromCountry)}</div>
          </td>
          <td width="50%" valign="top" style="background:#f8fafc;padding:12px;">
            <div style="font-size:10px;color:#94a3b8;font-weight:bold;text-transform:uppercase;margin-bottom:6px;">Quote To</div>
            <div style="font-weight:bold;">${escapeHtml(q.billToName)}</div>
            <div style="color:#475569;">${escapeHtml(q.billToAddress)}</div>
            <div style="color:#475569;">${escapeHtml(q.billToCity)}, ${escapeHtml(q.billToCountry)}</div>
            ${q.billToEmail ? `<div style="color:#94a3b8;font-size:11px;">${escapeHtml(q.billToEmail)}</div>` : ''}
            ${q.billToPhone ? `<div style="color:#94a3b8;font-size:11px;">${escapeHtml(q.billToPhone)}</div>` : ''}
          </td>
        </tr></table>

        ${q.orderRef ? `<div style="background:#eff6ff;padding:8px 12px;margin-bottom:14px;color:#1d4ed8;font-size:12px;">Order Reference: <b>${escapeHtml(q.orderRef.orderNumber)}</b></div>` : ''}

        <table width="100%" style="border-collapse:collapse;margin-bottom:18px;">
          <thead>
            <tr style="background:#1e3a5f;color:#fff;">
              <th style="padding:10px;text-align:left;font-size:11px;">DESCRIPTION</th>
              <th style="padding:10px;text-align:right;font-size:11px;">QTY</th>
              <th style="padding:10px;text-align:right;font-size:11px;">UNIT PRICE</th>
              <th style="padding:10px;text-align:right;font-size:11px;">AMOUNT</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <table width="100%"><tr><td></td><td width="280">
          <table width="100%">
            <tr><td style="color:#64748b;">Subtotal</td><td align="right">${fmtMoney(q.subtotal, q.currency)}</td></tr>
            ${q.taxRate > 0 ? `<tr><td style="color:#64748b;">Tax (${q.taxRate}%)</td><td align="right">${fmtMoney(q.taxAmount, q.currency)}</td></tr>` : ''}
            ${q.shippingCost > 0 ? `<tr><td style="color:#64748b;">Shipping</td><td align="right">${fmtMoney(q.shippingCost, q.currency)}</td></tr>` : ''}
            <tr style="border-top:2px solid #1e3a5f;">
              <td style="padding-top:8px;font-weight:bold;font-size:14px;">Total (${q.currency})</td>
              <td align="right" style="padding-top:8px;font-weight:bold;font-size:14px;color:#1e3a5f;">${fmtMoney(q.total, q.currency)}</td>
            </tr>
          </table>
        </td></tr></table>

        ${q.terms ? `<div style="margin-top:20px;font-size:11px;color:#64748b;"><b>Terms &amp; Conditions:</b><br/>${escapeHtml(q.terms)}</div>` : ''}
        ${q.notes ? `<div style="margin-top:10px;font-size:11px;color:#64748b;"><b>Notes:</b><br/>${escapeHtml(q.notes)}</div>` : ''}
      </div>

      ${brandingFooterHtml(baseUrl)}
    `;

    const docx = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
  <meta name="ProgId" content="Word.Document"/>
  <meta name="Generator" content="Microsoft Word 15"/>
  <title>${escapeHtml(q.quotationNumber)}</title>
  <!--[if gte mso 9]><xml>
    <w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument>
  </xml><![endif]-->
  ${brandingHeadStyles()}
</head>
<body>${body}</body>
</html>`;

    const buffer = Buffer.from('\ufeff' + docx, 'utf8');
    res.setHeader('Content-Type', 'application/msword');
    res.setHeader('Content-Disposition', `attachment; filename="${q.quotationNumber}.doc"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};
