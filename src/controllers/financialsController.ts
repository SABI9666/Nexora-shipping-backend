import { Response, NextFunction } from 'express';
import { Role, VoucherType, InvoiceStatus, AccountGroupType } from '@prisma/client';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { toAed } from '../utils/aedRates';

// ============================================================================
// FINANCIAL STATEMENTS — Trial Balance, Profit & Loss, Balance Sheet,
// General Ledger. All figures in AED (foreign-currency documents converted
// with the fixed rate table in utils/aedRates).
//
// The app is not a formal double-entry ledger, so this module derives
// balanced Dr/Cr postings from the operational data with a documented
// mapping:
//
//   Opening balances  → each Account.opBalance (Dr/Cr per opBalanceType)
//   Sales invoice      → Dr Customer (total)  Cr Sales (net)  Cr Output VAT
//   Receipt voucher    → Dr Bank/Cash         Cr Customer
//   Payment voucher    → Dr Supplier          Cr Bank/Cash
//   Purchase voucher   → Dr Purchases (net) + Dr Input VAT   Cr Supplier
//   Credit note        → Dr Sales Returns     Cr Customer
//   Debit note         → Dr Supplier          Cr Purchase Returns
//   Cash/Bank/Journal  → uses the voucher's account + contra account
//
// Legs without a real ledger account post to a synthetic "control" account
// so every statement still balances (total Dr == total Cr).
// ============================================================================

function round2(n: number): number { return Math.round(n * 100) / 100; }

type GT = AccountGroupType; // ASSET | LIABILITIES | PL | TRADING

interface Posting {
  date: Date;
  accountKey: string;
  code: string;
  name: string;
  groupType: GT;
  ref: string;
  narration: string;
  debit: number;  // AED
  credit: number; // AED
}

// Synthetic control accounts for legs with no real ledger account.
const SYS = {
  BANK:      { key: 'SYS:BANK',      code: 'CTL-BANK',  name: 'Bank & Cash (control)',      groupType: 'ASSET' as GT },
  DEBTORS:   { key: 'SYS:DEBTORS',   code: 'CTL-AR',    name: 'Sundry Debtors (control)',   groupType: 'ASSET' as GT },
  CREDITORS: { key: 'SYS:CREDITORS', code: 'CTL-AP',    name: 'Sundry Creditors (control)', groupType: 'LIABILITIES' as GT },
  SALES:     { key: 'SYS:SALES',     code: 'CTL-SALES', name: 'Sales Revenue',              groupType: 'PL' as GT },
  OUTVAT:    { key: 'SYS:OUTVAT',    code: 'CTL-OVAT',  name: 'Output VAT Payable',         groupType: 'LIABILITIES' as GT },
  INVAT:     { key: 'SYS:INVAT',     code: 'CTL-IVAT',  name: 'Input VAT Recoverable',      groupType: 'ASSET' as GT },
  PURCHASES: { key: 'SYS:PURCHASES', code: 'CTL-PUR',   name: 'Purchases',                  groupType: 'TRADING' as GT },
  SALESRET:  { key: 'SYS:SALESRET',  code: 'CTL-SRET',  name: 'Sales Returns',              groupType: 'PL' as GT },
  PURRET:    { key: 'SYS:PURRET',    code: 'CTL-PRET',  name: 'Purchase Returns',           groupType: 'TRADING' as GT },
} as const;

type AccountMeta = { key: string; code: string; name: string; groupType: GT };

async function buildPostings(
  isAdmin: boolean,
  userId: string,
  upTo: Date | null,
): Promise<Posting[]> {
  const scope = isAdmin ? {} : { userId };
  const dateCap = upTo ? { lte: upTo } : undefined;

  const [accounts, vouchers, invoices] = await Promise.all([
    prisma.account.findMany({
      select: {
        id: true, code: true, name: true, opBalance: true, opBalanceType: true,
        accountGroup: { select: { groupType: true } },
      },
    }),
    prisma.voucher.findMany({
      where: { ...scope, ...(dateCap ? { voucherDate: dateCap } : {}) },
      select: {
        id: true, voucherNumber: true, type: true, direction: true, amount: true,
        netAmount: true, inputVatAmount: true, currency: true, voucherDate: true,
        narration: true, accountId: true, contraAccountId: true,
        account: { select: { id: true, code: true, name: true, accountGroup: { select: { groupType: true } } } },
        contraAccount: { select: { id: true, code: true, name: true, accountGroup: { select: { groupType: true } } } },
      },
    }),
    prisma.invoice.findMany({
      where: {
        ...scope,
        status: { not: InvoiceStatus.CANCELLED },
        ...(dateCap ? { invoiceDate: dateCap } : {}),
      },
      select: {
        id: true, invoiceNumber: true, invoiceDate: true, currency: true,
        total: true, taxAmount: true, billToName: true,
        account: { select: { id: true, code: true, name: true, accountGroup: { select: { groupType: true } } } },
      },
    }),
  ]);

  const postings: Posting[] = [];
  const accMeta = (a: { id: string; code: string; name: string; accountGroup: { groupType: GT } } | null, fallback: AccountMeta): AccountMeta =>
    a ? { key: a.id, code: a.code, name: a.name, groupType: a.accountGroup.groupType } : fallback;

  const push = (date: Date, m: AccountMeta, ref: string, narration: string, debit: number, credit: number) => {
    if (debit === 0 && credit === 0) return;
    postings.push({ date, accountKey: m.key, code: m.code, name: m.name, groupType: m.groupType, ref, narration, debit, credit });
  };

  // ---- Opening balances (dated at epoch so they precede every period) ----
  const OPENING = new Date(0);
  for (const a of accounts) {
    if (!a.opBalance) continue;
    const m: AccountMeta = { key: a.id, code: a.code, name: a.name, groupType: a.accountGroup.groupType };
    if (a.opBalanceType === 'Debit') push(OPENING, m, 'Opening', 'Opening balance', round2(a.opBalance), 0);
    else push(OPENING, m, 'Opening', 'Opening balance', 0, round2(a.opBalance));
  }

  // ---- Sales invoices → Dr Customer / Cr Sales + Cr Output VAT -----------
  for (const inv of invoices) {
    const totalAed = toAed(inv.total, inv.currency);
    const vatAed = toAed(inv.taxAmount || 0, inv.currency);
    const salesAed = round2(totalAed - vatAed);
    const customer = accMeta(inv.account, { ...SYS.DEBTORS });
    const ref = `INV ${inv.invoiceNumber}`;
    push(inv.invoiceDate, customer, ref, `Sales — ${inv.billToName}`, round2(totalAed), 0);
    push(inv.invoiceDate, { ...SYS.SALES }, ref, 'Sales revenue', 0, salesAed);
    if (vatAed) push(inv.invoiceDate, { ...SYS.OUTVAT }, ref, 'Output VAT', 0, round2(vatAed));
  }

  // ---- Vouchers ---------------------------------------------------------
  for (const v of vouchers) {
    const amt = toAed(v.amount, v.currency);
    if (!amt) continue;
    const ref = v.voucherNumber;
    const narr = v.narration || '';
    const party = accMeta(v.account, v.type === VoucherType.RECEIPT || v.type === VoucherType.CREDIT_NOTE ? { ...SYS.DEBTORS } : { ...SYS.CREDITORS });
    const contra = v.contraAccount ? accMeta(v.contraAccount, { ...SYS.BANK }) : { ...SYS.BANK };

    switch (v.type) {
      case VoucherType.RECEIPT:
        push(v.voucherDate, contra, ref, narr || 'Receipt', amt, 0);   // Dr Bank
        push(v.voucherDate, party, ref, narr || 'Receipt', 0, amt);    // Cr Customer
        break;
      case VoucherType.PAYMENT:
      case VoucherType.SUPPLIER_PAYMENT:
        push(v.voucherDate, party, ref, narr || 'Payment', amt, 0);    // Dr Supplier
        push(v.voucherDate, contra, ref, narr || 'Payment', 0, amt);   // Cr Bank
        break;
      case VoucherType.PURCHASE: {
        const net = toAed(v.netAmount || 0, v.currency);
        const vat = toAed(v.inputVatAmount || 0, v.currency);
        const purch = round2(net || (amt - vat));
        push(v.voucherDate, { ...SYS.PURCHASES }, ref, narr || 'Purchase', purch, 0); // Dr Purchases (net)
        if (vat) push(v.voucherDate, { ...SYS.INVAT }, ref, 'Input VAT', round2(vat), 0); // Dr Input VAT
        push(v.voucherDate, party, ref, narr || 'Purchase', 0, amt);   // Cr Supplier (gross)
        break;
      }
      case VoucherType.CREDIT_NOTE:
        push(v.voucherDate, { ...SYS.SALESRET }, ref, narr || 'Credit note', amt, 0); // Dr Sales Returns
        push(v.voucherDate, party, ref, narr || 'Credit note', 0, amt);               // Cr Customer
        break;
      case VoucherType.DEBIT_NOTE:
        push(v.voucherDate, party, ref, narr || 'Debit note', amt, 0);                // Dr Supplier
        push(v.voucherDate, { ...SYS.PURRET }, ref, narr || 'Debit note', 0, amt);    // Cr Purchase Returns
        break;
      default: {
        // CASH / BANK / JOURNAL — direction drives the party leg.
        const partyDr = v.direction === 'DEBIT';
        if (partyDr) {
          push(v.voucherDate, party, ref, narr, amt, 0);
          push(v.voucherDate, contra, ref, narr, 0, amt);
        } else {
          push(v.voucherDate, party, ref, narr, 0, amt);
          push(v.voucherDate, contra, ref, narr, amt, 0);
        }
      }
    }
  }

  return postings;
}

// Aggregate postings up to (and including) a date into per-account balances.
interface AccBalance { key: string; code: string; name: string; groupType: GT; debit: number; credit: number }
function aggregate(postings: Posting[], from: Date | null, to: Date | null): Map<string, AccBalance> {
  const map = new Map<string, AccBalance>();
  for (const p of postings) {
    if (from && p.date < from) continue;
    if (to && p.date > to) continue;
    let b = map.get(p.accountKey);
    if (!b) { b = { key: p.accountKey, code: p.code, name: p.name, groupType: p.groupType, debit: 0, credit: 0 }; map.set(p.accountKey, b); }
    b.debit += p.debit;
    b.credit += p.credit;
  }
  return map;
}

function parseDate(s: unknown): Date | null {
  if (!s || typeof s !== 'string') return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function endOfDay(d: Date): Date { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

// ---------------------------------------------------------------------------
// TRIAL BALANCE — every account's net Dr/Cr as of a date. Balances by design.
// ---------------------------------------------------------------------------
export const trialBalance = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const isAdmin = req.user!.role === Role.ADMIN;
    const asOf = endOfDay(parseDate(req.query.asOf) || new Date());
    const postings = await buildPostings(isAdmin, req.user!.id, asOf);
    const balances = aggregate(postings, null, asOf);

    const rows = Array.from(balances.values())
      .map((b) => {
        const net = round2(b.debit - b.credit);
        return {
          code: b.code, name: b.name, groupType: b.groupType,
          debit: net > 0 ? net : 0,
          credit: net < 0 ? -net : 0,
        };
      })
      .filter((r) => r.debit > 0.005 || r.credit > 0.005)
      .sort((a, b) => a.groupType.localeCompare(b.groupType) || a.code.localeCompare(b.code));

    const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
    const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));

    res.json({
      success: true,
      data: {
        asOf,
        currency: 'AED',
        rows,
        totals: { totalDebit, totalCredit, difference: round2(totalDebit - totalCredit) },
      },
    });
  } catch (error) { next(error); }
};

// ---------------------------------------------------------------------------
// PROFIT & LOSS — income vs expense (PL + TRADING groups) for a period, AED.
// ---------------------------------------------------------------------------
export const profitAndLoss = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const isAdmin = req.user!.role === Role.ADMIN;
    const from = parseDate(req.query.from);
    const to = endOfDay(parseDate(req.query.to) || new Date());
    const postings = await buildPostings(isAdmin, req.user!.id, to);
    const balances = aggregate(postings, from, to);

    const income: { code: string; name: string; amount: number }[] = [];
    const expense: { code: string; name: string; amount: number }[] = [];
    for (const b of balances.values()) {
      if (b.groupType !== 'PL' && b.groupType !== 'TRADING') continue;
      const net = round2(b.debit - b.credit);
      if (net < -0.005) income.push({ code: b.code, name: b.name, amount: -net });   // credit balance → income
      else if (net > 0.005) expense.push({ code: b.code, name: b.name, amount: net }); // debit balance → expense
    }
    income.sort((a, b) => b.amount - a.amount);
    expense.sort((a, b) => b.amount - a.amount);

    const totalIncome = round2(income.reduce((s, r) => s + r.amount, 0));
    const totalExpense = round2(expense.reduce((s, r) => s + r.amount, 0));
    const netProfit = round2(totalIncome - totalExpense);

    res.json({
      success: true,
      data: {
        period: { from, to }, currency: 'AED',
        income, expense,
        totals: { totalIncome, totalExpense, netProfit },
      },
    });
  } catch (error) { next(error); }
};

// ---------------------------------------------------------------------------
// BALANCE SHEET — Assets vs Liabilities + Equity (+ period profit) as of date.
// ---------------------------------------------------------------------------
export const balanceSheet = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const isAdmin = req.user!.role === Role.ADMIN;
    const asOf = endOfDay(parseDate(req.query.asOf) || new Date());
    const postings = await buildPostings(isAdmin, req.user!.id, asOf);
    const balances = aggregate(postings, null, asOf);

    const assets: { code: string; name: string; amount: number }[] = [];
    const liabilities: { code: string; name: string; amount: number }[] = [];
    let plNet = 0; // credit-positive net of P&L + TRADING = retained profit
    for (const b of balances.values()) {
      const net = round2(b.debit - b.credit);
      if (b.groupType === 'ASSET') { if (Math.abs(net) > 0.005) assets.push({ code: b.code, name: b.name, amount: net }); }
      else if (b.groupType === 'LIABILITIES') { if (Math.abs(net) > 0.005) liabilities.push({ code: b.code, name: b.name, amount: -net }); }
      else plNet += -net; // PL/TRADING credit balance adds to profit
    }
    assets.sort((a, b) => b.amount - a.amount);
    liabilities.sort((a, b) => b.amount - a.amount);
    const retainedProfit = round2(plNet);

    const totalAssets = round2(assets.reduce((s, r) => s + r.amount, 0));
    const totalLiabilities = round2(liabilities.reduce((s, r) => s + r.amount, 0));
    const totalEquityAndLiabilities = round2(totalLiabilities + retainedProfit);

    res.json({
      success: true,
      data: {
        asOf, currency: 'AED',
        assets, liabilities, retainedProfit,
        totals: { totalAssets, totalLiabilities, totalEquityAndLiabilities, difference: round2(totalAssets - totalEquityAndLiabilities) },
      },
    });
  } catch (error) { next(error); }
};

// ---------------------------------------------------------------------------
// GENERAL LEDGER — per account: opening b/f, movements in period, closing.
// Optional accountId (real account) narrows to one; otherwise all accounts.
// ---------------------------------------------------------------------------
export const generalLedger = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const isAdmin = req.user!.role === Role.ADMIN;
    const from = parseDate(req.query.from);
    const to = endOfDay(parseDate(req.query.to) || new Date());
    const onlyAccount = (req.query.accountId as string | undefined) || null;
    const postings = await buildPostings(isAdmin, req.user!.id, to);

    // Group postings by account.
    const byAccount = new Map<string, Posting[]>();
    for (const p of postings) {
      if (onlyAccount && p.accountKey !== onlyAccount) continue;
      if (!byAccount.has(p.accountKey)) byAccount.set(p.accountKey, []);
      byAccount.get(p.accountKey)!.push(p);
    }

    const accounts = Array.from(byAccount.entries()).map(([key, ps]) => {
      const meta = ps[0];
      const opening = ps.filter((p) => !from || p.date < from).reduce((s, p) => s + p.debit - p.credit, 0);
      const inRange = ps
        .filter((p) => (!from || p.date >= from) && p.date <= to)
        .sort((a, b) => a.date.getTime() - b.date.getTime());
      let running = round2(opening);
      const rows = inRange.map((p) => {
        running = round2(running + p.debit - p.credit);
        return {
          date: p.date, ref: p.ref, narration: p.narration,
          debit: round2(p.debit), credit: round2(p.credit),
          balance: Math.abs(running), side: running >= 0 ? 'Dr' : 'Cr',
        };
      });
      const totalDebit = round2(inRange.reduce((s, p) => s + p.debit, 0));
      const totalCredit = round2(inRange.reduce((s, p) => s + p.credit, 0));
      return {
        key, code: meta.code, name: meta.name, groupType: meta.groupType,
        opening: { balance: Math.abs(round2(opening)), side: opening >= 0 ? 'Dr' : 'Cr' },
        rows, totalDebit, totalCredit,
        closing: { balance: Math.abs(running), side: running >= 0 ? 'Dr' : 'Cr' },
      };
    })
      .filter((a) => a.rows.length > 0 || a.opening.balance > 0.005)
      .sort((a, b) => a.groupType.localeCompare(b.groupType) || a.code.localeCompare(b.code));

    res.json({ success: true, data: { period: { from, to }, currency: 'AED', accounts } });
  } catch (error) { next(error); }
};
