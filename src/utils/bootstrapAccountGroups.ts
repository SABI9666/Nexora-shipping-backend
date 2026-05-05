import { AccountGroupType } from '@prisma/client';
import prisma from '../config/database';

const STANDARD_ACCOUNT_GROUPS: { code: string; name: string; groupType: AccountGroupType; printOrder: number }[] = [
  { code: 'BRA',   name: 'BRANCH',             groupType: AccountGroupType.ASSET,       printOrder: 10 },
  { code: 'CAP',   name: 'CAPITAL',            groupType: AccountGroupType.LIABILITIES, printOrder: 20 },
  { code: 'CASH',  name: 'CASH ACCOUNT',       groupType: AccountGroupType.ASSET,       printOrder: 30 },
  { code: 'COS',   name: 'COST OF SALES',      groupType: AccountGroupType.TRADING,     printOrder: 40 },
  { code: 'CA',    name: 'CURRENT ASSET',      groupType: AccountGroupType.ASSET,       printOrder: 50 },
  { code: 'CL',    name: 'CURRENT LIABILITY',  groupType: AccountGroupType.LIABILITIES, printOrder: 60 },
  { code: 'DEP',   name: 'DEPOSITS',           groupType: AccountGroupType.ASSET,       printOrder: 70 },
  { code: 'DEX',   name: 'DIRECT EXPENSES',    groupType: AccountGroupType.PL,          printOrder: 80 },
  { code: 'EMP',   name: 'EMPLOYEES',          groupType: AccountGroupType.ASSET,       printOrder: 90 },
  { code: 'EQU',   name: 'EQUITY',             groupType: AccountGroupType.LIABILITIES, printOrder: 100 },
  { code: 'FA',    name: 'FIXED ASSETS',       groupType: AccountGroupType.ASSET,       printOrder: 110 },
  { code: 'INC',   name: 'INCOME',             groupType: AccountGroupType.PL,          printOrder: 120 },
  { code: 'IEX',   name: 'INDIRECT EXPENSES',  groupType: AccountGroupType.PL,          printOrder: 130 },
  { code: 'IIN',   name: 'INDIRECT INCOMES',   groupType: AccountGroupType.PL,          printOrder: 140 },
  { code: 'ITADV', name: 'IT-ADV',             groupType: AccountGroupType.ASSET,       printOrder: 150 },
  { code: 'LADV',  name: 'LOANS & ADV.',       groupType: AccountGroupType.ASSET,       printOrder: 160 },
  { code: 'LAA',   name: 'LOANS AND ADVANCES', groupType: AccountGroupType.ASSET,       printOrder: 170 },
  { code: 'OPS',   name: 'OP. STOCK',          groupType: AccountGroupType.TRADING,     printOrder: 180 },
  { code: 'OTH',   name: 'OTHERS',             groupType: AccountGroupType.ASSET,       printOrder: 190 },
  { code: 'RNT',   name: 'RENT',               groupType: AccountGroupType.PL,          printOrder: 200 },
  { code: 'SADV',  name: 'SALARY ADVANCE',     groupType: AccountGroupType.ASSET,       printOrder: 210 },
  { code: 'SAL',   name: 'SALES',              groupType: AccountGroupType.TRADING,     printOrder: 220 },
  { code: 'STAX',  name: 'SALES TAX',          groupType: AccountGroupType.LIABILITIES, printOrder: 230 },
  { code: 'SHP',   name: 'SHIPPER',            groupType: AccountGroupType.ASSET,       printOrder: 240 },
  { code: 'STF',   name: 'STAFF',              groupType: AccountGroupType.ASSET,       printOrder: 250 },
  { code: 'SCR',   name: 'SUNDRY CREDITORS',   groupType: AccountGroupType.LIABILITIES, printOrder: 260 },
  { code: 'SDR',   name: 'SUNDRY DEBTORS',     groupType: AccountGroupType.ASSET,       printOrder: 270 },
  { code: 'TRD',   name: 'TRADING',            groupType: AccountGroupType.TRADING,     printOrder: 280 },
  { code: 'VATP',  name: 'VAT PAYABLE',        groupType: AccountGroupType.LIABILITIES, printOrder: 290 },
  { code: 'VATR',  name: 'VAT RECEIVABLE',     groupType: AccountGroupType.ASSET,       printOrder: 300 },
];

export async function ensureStandardAccountGroups(): Promise<void> {
  try {
    const existing = await prisma.accountGroup.findMany({ select: { code: true } });
    const have = new Set(existing.map((g) => g.code));
    const missing = STANDARD_ACCOUNT_GROUPS.filter((g) => !have.has(g.code));
    if (missing.length === 0) return;
    await prisma.accountGroup.createMany({ data: missing, skipDuplicates: true });
    console.log(`✅ Bootstrapped ${missing.length} standard account groups`);
  } catch (err) {
    console.error('Failed to bootstrap account groups:', err);
  }
}
