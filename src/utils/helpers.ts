import prisma from '../config/database';

export function generateInvoiceNumber(): string {
  const date = new Date();
  const year = String(date.getFullYear()).slice(2);
  const seq = Math.floor(Math.random() * 90000) + 10000;
  return `NEX${year}-${String(seq).padStart(5, '0')}`;
}

export function generateQuotationNumber(): string {
  const date = new Date();
  const year = String(date.getFullYear()).slice(2);
  const seq = Math.floor(Math.random() * 90000) + 10000;
  return `QT${year}-${String(seq).padStart(5, '0')}`;
}

const ORDER_PREFIX = 'NEXDX';
const ORDER_SEQ_PAD = 5;

export async function generateOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `${ORDER_PREFIX}-${year}-`;

  const last = await prisma.order.findFirst({
    where: { orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: 'desc' },
    select: { orderNumber: true },
  });

  const lastSeq = last
    ? parseInt(last.orderNumber.slice(prefix.length), 10) || 0
    : 0;
  const next = lastSeq + 1;
  return `${prefix}${String(next).padStart(ORDER_SEQ_PAD, '0')}`;
}

export function generateTrackingNumber(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'NEX';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  result += 'US';
  return result;
}

export function paginate(page: number, limit: number) {
  const skip = (page - 1) * limit;
  return { skip, take: limit };
}

export function calculateShippingPrice(weight: number, originCountry: string, destCountry: string): number {
  const baseRate = 5.99;
  const weightRate = weight * 2.5;
  const isInternational = originCountry !== destCountry;
  const internationalSurcharge = isInternational ? 25 : 0;
  return Math.round((baseRate + weightRate + internationalSurcharge) * 100) / 100;
}
