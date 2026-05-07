import prisma from '../config/database';

const STANDARD_CHARGE_ITEMS: { code: string; name: string }[] = [
  { code: '001', name: 'FREIGHT CHARGES' },
  { code: '002', name: 'DOOR TO DOOR CHARGES' },
  { code: '003', name: 'DOCUMENTATION CHARGES' },
  { code: '004', name: 'SERVICE CHARGES' },
  { code: '005', name: 'TRANSPORTATION CHARGES' },
  { code: '006', name: 'LICENSE USAGE CHARGES' },
  { code: '007', name: 'BILL OF ENTRY CHARGES' },
  { code: '008', name: 'TERMINAL HANDLING CHARGES' },
  { code: '009', name: 'TLUC' },
  { code: '010', name: 'DPC' },
  { code: '011', name: 'CUSTOMS DUTY' },
  { code: '012', name: 'SHIPMENT VAT' },
  { code: '013', name: 'DELIVERY ORDER CHARGES' },
  { code: '014', name: 'WAREHOUSE HANDLING CHARGES' },
  { code: '015', name: 'EDAS ATTESTATION' },
  { code: '016', name: 'MISSING DOCUMENTS CHARGES' },
  { code: '017', name: 'GATE PASS' },
  { code: '018', name: 'CLAIM SUBMISSION' },
  { code: '019', name: 'STORAGE CHARGES' },
  { code: '020', name: 'PACKING CHARGES' },
  { code: '021', name: 'AIR FREIGHT CHARGES' },
  { code: '022', name: 'COMMISSION' },
  { code: '023', name: 'INDIVIDUAL PASS' },
  { code: '024', name: 'AE CODE REGISTRATION/RENEWAL' },
  { code: '025', name: 'FINAL STAMP' },
  { code: '026', name: 'INSPECTION CHARGES' },
  { code: '027', name: 'LOADING AND UNLOADING' },
  { code: '028', name: 'LABOUR CHARGES' },
  { code: '029', name: 'FREIGHT CHARGE' },
  { code: '030', name: 'SURRENDER BL FEE' },
  { code: '031', name: 'AMENDMENT CHARGES BL' },
  { code: '032', name: 'EJARI' },
  { code: '033', name: 'CERTIFICATE OF ORIGIN' },
  { code: '034', name: 'EXIT PAPER' },
  { code: '035', name: 'CLEARANCE CHARGES' },
  { code: '036', name: 'TOKEN AND VGM' },
  { code: '037', name: 'BORDER CLEARANCE-BATHAH' },
  { code: '038', name: 'BORDER CLEARANCE-SILA' },
  { code: '039', name: 'EX-WORK' },
  { code: '040', name: 'INSURANCE' },
  { code: '041', name: 'LOCAL CHARGES' },
  { code: '042', name: 'BILL OF LADING' },
  { code: '043', name: 'DETENTION CHARGES' },
  { code: '044', name: 'CROSS STUFFING CHARGES' },
  { code: '045', name: 'BONDED CLEARANCE' },
  { code: '046', name: 'BONDED CLEARANCE CHARGES' },
  { code: '047', name: 'ATLP IMPORT REQUEST FEE' },
  { code: '048', name: 'ZAD CHARGES' },
  { code: '049', name: 'VAT PAYMENT SERVICE CHARGES' },
  { code: '050', name: 'DESTINATION CHARGES' },
  { code: '051', name: 'DDO CHARGES' },
  { code: '052', name: 'CONTAINER REPAIR' },
  { code: '053', name: 'CUSTOM CHARGES' },
  { code: '054', name: 'PCFC CHARGES' },
  { code: '055', name: 'TOLL' },
  { code: '056', name: 'EXIT/ENTRY' },
  { code: '057', name: 'CUSTOMS DEPOSIT' },
  { code: '058', name: 'CONTAINER WASHING CHARGES' },
  { code: '059', name: 'SWITCH BL CHARGES' },
  { code: '060', name: 'PORT STORAGE CHARGES' },
  { code: '061', name: 'DO EXTENSION CHARGES' },
  { code: '062', name: 'AMENDMENT CHARGE' },
  { code: '063', name: 'B/L EXCHANGE FEE' },
  { code: '064', name: 'TOKEN CANCELLATION CHARGE' },
  { code: '065', name: 'FORKLIFT CHARGES' },
  { code: '066', name: 'CONTAINER PASSING CHARGE' },
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
