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
    companyTrn: '105413106300003',
    isDefault: true,
  },
];

export async function ensureSeedBankAccounts(): Promise<void> {
  try {
    for (const seed of SEED_BANKS) {
      // Upsert by label so re-runs refresh stale fields (notably companyTrn
      // for instances seeded before that column existed).
      await prisma.bankAccount.upsert({
        where: { label: seed.label },
        update: {
          bankName: seed.bankName,
          bankAddress: seed.bankAddress,
          accountName: seed.accountName,
          accountNumber: seed.accountNumber,
          iban: seed.iban,
          swiftCode: seed.swiftCode,
          currency: seed.currency,
          companyTrn: seed.companyTrn,
        },
        create: seed,
      });
    }
    console.log(`✅ Ensured ${SEED_BANKS.length} default bank account preset(s)`);
  } catch (err) {
    console.error('Failed to bootstrap bank accounts:', err);
  }
}
