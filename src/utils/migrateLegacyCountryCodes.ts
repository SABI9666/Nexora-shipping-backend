import prisma from '../config/database';

// Project convention: UAE = `DXB` (not the ISO `ARE`). Frontend rewrites
// stored ARE on render, but anything that emits saved rows directly (PDF /
// Word / Account Statement headers, CSV exports) sees the raw value. This
// one-time migration backfills legacy rows on app start so the storage and
// the UI agree.
//
// Safe to run repeatedly: each updateMany is a no-op once the rows are
// migrated.
export async function migrateLegacyCountryCodes(): Promise<void> {
  try {
    const [orderPickup, orderDelivery, invoiceBill, invoiceShip, quotationBill, quotationShip] = await Promise.all([
      prisma.order.updateMany({ where: { pickupCountry: 'ARE' }, data: { pickupCountry: 'DXB' } }),
      prisma.order.updateMany({ where: { deliveryCountry: 'ARE' }, data: { deliveryCountry: 'DXB' } }),
      prisma.invoice.updateMany({ where: { billToCountry: 'ARE' }, data: { billToCountry: 'DXB' } }),
      prisma.invoice.updateMany({ where: { shipFromCountry: 'ARE' }, data: { shipFromCountry: 'DXB' } }),
      prisma.quotation.updateMany({ where: { billToCountry: 'ARE' }, data: { billToCountry: 'DXB' } }),
      prisma.quotation.updateMany({ where: { shipFromCountry: 'ARE' }, data: { shipFromCountry: 'DXB' } }),
    ]);

    const total =
      orderPickup.count + orderDelivery.count +
      invoiceBill.count + invoiceShip.count +
      quotationBill.count + quotationShip.count;

    if (total > 0) {
      console.log(`✅ Migrated ${total} legacy ARE → DXB country codes`);
    }
  } catch (err) {
    console.error('Failed to migrate legacy country codes:', err);
  }
}
