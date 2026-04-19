import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { InvoiceStatus, Role } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { generateInvoiceNumber, paginate } from '../utils/helpers';
import {
  brandingBaseUrl,
  brandingHeaderHtml,
  brandingFooterHtml,
  brandingWatermarkHtml,
  brandingHeadStyles,
} from '../utils/docxBranding';

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

export const downloadInvoiceDocx = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const isAdmin = req.user!.role === Role.ADMIN;

    const inv = await prisma.invoice.findFirst({
      where: { id, ...(isAdmin ? {} : { userId: req.user!.id }) },
      include: { items: true, orderRef: { select: { orderNumber: true } } },
    });
    if (!inv) throw new AppError('Invoice not found', 404);

    const baseUrl = brandingBaseUrl(req);

    const rows = inv.items
      .map(
        (it) => `
      <tr>
        <td style="padding:8px;border:1px solid #ccc;">${escapeHtml(it.description)}</td>
        <td style="padding:8px;border:1px solid #ccc;text-align:right;">${it.quantity}</td>
        <td style="padding:8px;border:1px solid #ccc;text-align:right;">${fmtMoney(it.unitPrice, inv.currency)}</td>
        <td style="padding:8px;border:1px solid #ccc;text-align:right;"><b>${fmtMoney(it.amount, inv.currency)}</b></td>
      </tr>`
      )
      .join('');

    const body = `
      ${brandingWatermarkHtml(baseUrl)}
      ${brandingHeaderHtml(baseUrl)}

      <div style="padding:0 24px;">
        <table width="100%" style="margin-bottom:18px;"><tr>
          <td>
            <div style="font-size:11px;color:#64748b;">${escapeHtml(inv.shipFromName)}</div>
            <div style="font-size:11px;color:#64748b;">${escapeHtml(inv.shipFromAddress)}, ${escapeHtml(inv.shipFromCity)}, ${escapeHtml(inv.shipFromCountry)}</div>
          </td>
          <td align="right">
            <div style="font-size:24px;font-weight:bold;color:#1e3a5f;">INVOICE</div>
            <div style="font-size:13px;font-weight:bold;">${escapeHtml(inv.invoiceNumber)}</div>
            <div style="font-size:11px;color:#64748b;">Date: ${fmtDate(inv.invoiceDate)}</div>
            ${inv.dueDate ? `<div style="font-size:11px;color:#64748b;">Due: ${fmtDate(inv.dueDate)}</div>` : ''}
            <div style="font-size:11px;color:#64748b;">Status: ${inv.status}</div>
          </td>
        </tr></table>

        <hr style="border:0;border-top:2px solid #1e3a5f;margin-bottom:16px;"/>

        <table width="100%" style="margin-bottom:18px;"><tr>
          <td width="50%" valign="top">
            <div style="font-size:10px;color:#94a3b8;font-weight:bold;text-transform:uppercase;margin-bottom:6px;">From</div>
            <div style="font-weight:bold;">${escapeHtml(inv.shipFromName)}</div>
            <div style="color:#475569;">${escapeHtml(inv.shipFromAddress)}</div>
            <div style="color:#475569;">${escapeHtml(inv.shipFromCity)}, ${escapeHtml(inv.shipFromCountry)}</div>
          </td>
          <td width="50%" valign="top" style="background:#f8fafc;padding:12px;">
            <div style="font-size:10px;color:#94a3b8;font-weight:bold;text-transform:uppercase;margin-bottom:6px;">Bill To</div>
            <div style="font-weight:bold;">${escapeHtml(inv.billToName)}</div>
            <div style="color:#475569;">${escapeHtml(inv.billToAddress)}</div>
            <div style="color:#475569;">${escapeHtml(inv.billToCity)}, ${escapeHtml(inv.billToCountry)}</div>
            ${inv.billToEmail ? `<div style="color:#94a3b8;font-size:11px;">${escapeHtml(inv.billToEmail)}</div>` : ''}
            ${inv.billToPhone ? `<div style="color:#94a3b8;font-size:11px;">${escapeHtml(inv.billToPhone)}</div>` : ''}
          </td>
        </tr></table>

        ${inv.orderRef ? `<div style="background:#eff6ff;padding:8px 12px;margin-bottom:14px;color:#1d4ed8;font-size:12px;">Order Reference: <b>${escapeHtml(inv.orderRef.orderNumber)}</b></div>` : ''}

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
            <tr><td style="color:#64748b;">Subtotal</td><td align="right">${fmtMoney(inv.subtotal, inv.currency)}</td></tr>
            ${inv.taxRate > 0 ? `<tr><td style="color:#64748b;">Tax (${inv.taxRate}%)</td><td align="right">${fmtMoney(inv.taxAmount, inv.currency)}</td></tr>` : ''}
            ${inv.shippingCost > 0 ? `<tr><td style="color:#64748b;">Shipping</td><td align="right">${fmtMoney(inv.shippingCost, inv.currency)}</td></tr>` : ''}
            <tr style="border-top:2px solid #1e3a5f;">
              <td style="padding-top:8px;font-weight:bold;font-size:14px;">Total (${inv.currency})</td>
              <td align="right" style="padding-top:8px;font-weight:bold;font-size:14px;color:#1e3a5f;">${fmtMoney(inv.total, inv.currency)}</td>
            </tr>
          </table>
        </td></tr></table>

        ${inv.paymentTerms ? `<div style="margin-top:20px;font-size:11px;color:#64748b;"><b>Payment Terms:</b> ${escapeHtml(inv.paymentTerms)}</div>` : ''}
        ${inv.notes ? `<div style="margin-top:10px;font-size:11px;color:#64748b;"><b>Notes:</b><br/>${escapeHtml(inv.notes)}</div>` : ''}
      </div>

      ${brandingFooterHtml(baseUrl)}
    `;

    const docx = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
  <meta name="ProgId" content="Word.Document"/>
  <meta name="Generator" content="Microsoft Word 15"/>
  <title>${escapeHtml(inv.invoiceNumber)}</title>
  <!--[if gte mso 9]><xml>
    <w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument>
  </xml><![endif]-->
  ${brandingHeadStyles()}
</head>
<body>${body}</body>
</html>`;

    const buffer = Buffer.from('\ufeff' + docx, 'utf8');
    res.setHeader('Content-Type', 'application/msword');
    res.setHeader('Content-Disposition', `attachment; filename="${inv.invoiceNumber}.doc"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};
