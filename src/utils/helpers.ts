export function generateInvoiceNumber(): string {
  const date = new Date();
  const year = String(date.getFullYear()).slice(2);
  const seq = Math.floor(Math.random() * 90000) + 10000;
  return `NEX${year}-${String(seq).padStart(5, '0')}`;
}

export function generateOrderNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const random = Math.floor(Math.random() * 900000) + 100000;
  return `NEX-${year}-${random}`;
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
