import prisma from '../config/database';

const STANDARD_CHARGE_ITEMS: { code: string; name: string }[] = [
  { code: '001', name: 'FREIGHT CHARGES' },
  { code: '004', name: 'SERVICE CHARGES' },
  { code: '005', name: 'TRANSPORTATION CHARGES' },
  { code: '006', name: 'LICENSE USAGE CHARGES' },
  { code: '008', name: 'TERMINAL HANDLING CHARGES' },
  { code: '009', name: 'TLUC' },
  { code: '012', name: 'SHIPMENT VAT' },
  { code: '014', name: 'WAREHOUSE HANDLING CHARGES' },
  { code: '016', name: 'MISSING DOCUMENTS CHARGES' },
  { code: '017', name: 'GATE PASS' },
  { code: '019', name: 'STORAGE CHARGES' },
  { code: '020', name: 'PACKING CHARGES' },
  { code: '023', name: 'INDIVIDUAL PASS' },
  { code: '025', name: 'FINAL STAMP' },
  { code: '026', name: 'INSPECTION CHARGES' },
  { code: '027', name: 'LOADING AND UNLOADING' },
  { code: '028', name: 'LABOUR CHARGES' },
  { code: '029', name: 'FREIGHT CHARGE' },
  { code: '030', name: 'SURRENDER BL FEE' },
  { code: '034', name: 'EXIT PAPER' },
  { code: '036', name: 'TOKEN AND VGM' },
  { code: '039', name: 'EX-WORK' },
  { code: '040', name: 'INSURANCE' },
  { code: '041', name: 'LOCAL CHARGES' },
  { code: '048', name: 'ZAD CHARGES' },
  { code: '049', name: 'VAT PAYMENT SERVICE CHARGES' },
  { code: '054', name: 'PCFC CHARGES' },
  { code: '055', name: 'TOLL' },
  { code: '056', name: 'EXIT/ENTRY' },
  { code: '059', name: 'SWITCH BL CHARGES' },
  { code: '060', name: 'PORT STORAGE CHARGES' },
  { code: '064', name: 'TOKEN CANCELLATION CHARGE' },
  { code: '065', name: 'FORKLIFT CHARGES' },
  { code: '067', name: 'WAITING CHARGE' },
  { code: '068', name: 'WAITING CHARGE (HDMU2460650)' },
  { code: '069', name: 'WAITING CHARGE (CNID1153467)' },
  { code: '070', name: 'WAITING CHARGE (UESU2446176)' },
];

export async function ensureStandardChargeItems(): Promise<void> {
  try {
    const existing = await prisma.chargeItem.findMany({ select: { code: true } });
    const have = new Set(existing.map((c) => c.code));
    const missing = STANDARD_CHARGE_ITEMS.filter((c) => !have.has(c.code));
    if (missing.length === 0) return;
    await prisma.chargeItem.createMany({ data: missing, skipDuplicates: true });
    console.log(`✅ Bootstrapped ${missing.length} standard charge items`);
  } catch (err) {
    console.error('Failed to bootstrap charge items:', err);
  }
}
