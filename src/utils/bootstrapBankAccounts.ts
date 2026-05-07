import prisma from '../config/database';

const SEED_BANKS = [
  {
    label: 'ADCB AED — Nexora Shipping LLC',
    bankName: 'Abu Dhabi Commercial Bank PJSC',
    bankAddress: 'AL RIGGAH ROAD',
    accountName: 'NEXORA SHIPPING LLC',
    accountNumber: '14505966920001',
    iban: 'AE060030014505966920001',
    swiftCode: 'ADCBAEAA',
    currency: 'AED',
    isDefault: true,
  },
];

export async function ensureSeedBankAccounts(): Promise<void> {
  try {
    const count = await prisma.bankAccount.count();
    if (count > 0) return;
    await prisma.bankAccount.createMany({ data: SEED_BANKS, skipDuplicates: true });
    console.log(`✅ Bootstrapped ${SEED_BANKS.length} default bank account(s)`);
  } catch (err) {
    console.error('Failed to bootstrap bank accounts:', err);
  }
}
