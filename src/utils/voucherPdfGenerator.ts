import PDFDocument from 'pdfkit';
import {
  attachBrandingToDoc,
  contentBottom,
  CONTENT_TOP,
  PAGE_MARGIN,
} from './pdfBranding';
import { amountToWords } from './numberToWords';

const NAVY = '#0a1628';
const NAVY_SOFT = '#1e293b';
const BRAND_RED = '#dc2626';
const TEXT = '#0f172a';
const MUTED = '#475569';
const SUBTLE = '#94a3b8';
const DIVIDER = '#e2e8f0';
const NAVY_TINT = '#eef2f7';
const NAVY_TINT_2 = '#f4f7fb';
const GREEN = '#047857';
const RED = '#b91c1c';

const fmtNum = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: Date | string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';
const inline = (s: string | null | undefined): string =>
  (s ?? '').toString().replace(/\s*[\r\n]+\s*/g, ', ').trim();

export type VoucherForPdf = {
  voucherNumber: string;
  type: string;
  direction: string;
  voucherDate: Date | string;
  amount: number;
  currency: string;
  referenceType: string;
  partyName: string | null;
  narration: string | null;
  account: {
    code: string;
    name: string;
    address: string | null;
    mobile1: string | null;
    trn: string | null;
    accountGroup?: { name: string } | null;
  } | null;
  contraAccount: {
    code: string;
    name: string;
    accountGroup?: { name: string } | null;
  } | null;
  invoice: {
    invoiceNumber: string;
    total: number;
    currency: string;
    billToName: string;
  } | null;
  order: {
    orderNumber: string;
    price: number | null;
  } | null;
  user: { firstName: string; lastName: string; email: string } | null;
  companyName?: string;
  companyTrn?: string;
};

const TYPE_TITLE: Record<string, string> = {
  CASH: 'CASH VOUCHER',
  PURCHASE: 'PURCHASE VOUCHER',
  PAYMENT: 'PAYMENT VOUCHER',
  BANK: 'BANK VOUCHER',
  JOURNAL: 'JOURNAL VOUCHER',
  RECEIPT: 'CUSTOMER RECEIPT',
  SUPPLIER_PAYMENT: 'SUPPLIER PAYMENT',
  CREDIT_NOTE: 'CREDIT NOTE',
  DEBIT_NOTE: 'DEBIT NOTE',
};

const PARTY_LABEL: Record<string, string> = {
  CASH: 'PARTY',
  PURCHASE: 'SUPPLIER',
  PAYMENT: 'PAID TO',
  BANK: 'COUNTERPARTY',
  JOURNAL: 'PARTY',
  RECEIPT: 'RECEIVED FROM',
  SUPPLIER_PAYMENT: 'SUPPLIER',
  CREDIT_NOTE: 'ISSUED TO',
  DEBIT_NOTE: 'ISSUED TO',
};

export function generateVoucherPdfBuffer(v: VoucherForPdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: PAGE_MARGIN });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    attachBrandingToDoc(doc);

    const left = PAGE_MARGIN.left;
    const right = doc.page.width - PAGE_MARGIN.right;
    const fullW = right - left;
    let y = CONTENT_TOP;

    // ── Header ──────────────────────────────────────────────────────
    const title = TYPE_TITLE[v.type] || 'VOUCHER';
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(24)
      .text(title, left, y, { width: fullW * 0.6, lineBreak: false });
    if (v.companyTrn) {
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10)
        .text(`TRN: ${v.companyTrn}`, left, y + 30, { width: fullW * 0.6, lineBreak: false });
    }

    const metaX = left + fullW * 0.6;
    const metaW = fullW * 0.4;
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text('Voucher No.', metaX, y, { width: metaW, align: 'right', lineBreak: false });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13)
      .text(v.voucherNumber, metaX, y + 11, { width: metaW, align: 'right', lineBreak: false });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text(`${fmtDate(v.voucherDate)}  ·  ${v.currency}`, metaX, y + 30, {
        width: metaW, align: 'right', lineBreak: false,
      });

    y += 56;
    doc.fillColor(BRAND_RED).circle(left + 3, y, 2.6).fill();
    doc.lineWidth(2.5).strokeColor(NAVY).moveTo(left + 10, y).lineTo(left + 86, y).stroke();
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left + 92, y).lineTo(right, y).stroke();
    y += 18;

    // ── Party + Contra columns ──────────────────────────────────────
    const colGap = 24;
    const colW = (fullW - colGap) / 2;
    const partyX = left;
    const contraX = left + colW + colGap;

    doc.fillColor(BRAND_RED).rect(partyX, y + 1, 2, 9).fill();
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8.5)
      .text(PARTY_LABEL[v.type] || 'PARTY', partyX + 6, y, {
        width: colW - 6, characterSpacing: 1.2, lineBreak: false,
      });
    let py = y + 16;
    if (v.account) {
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11)
        .text(`${v.account.code} · ${v.account.name}`, partyX, py, {
          width: colW, lineBreak: false, ellipsis: true,
        });
      py += 16;
      if (v.account.accountGroup?.name) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
          .text(v.account.accountGroup.name, partyX, py, {
            width: colW, lineBreak: false, ellipsis: true,
          });
        py += 11;
      }
      if (v.account.address) {
        doc.fillColor(TEXT).font('Helvetica').fontSize(9)
          .text(inline(v.account.address), partyX, py, {
            width: colW, height: 22, ellipsis: true,
          });
        py += 22;
      }
      if (v.account.mobile1) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(9)
          .text(v.account.mobile1, partyX, py, {
            width: colW, lineBreak: false, ellipsis: true,
          });
        py += 12;
      }
      if (v.account.trn) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(9)
          .text(`TRN: ${v.account.trn}`, partyX, py, {
            width: colW, lineBreak: false, ellipsis: true,
          });
        py += 12;
      }
    } else if (v.partyName) {
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11)
        .text(v.partyName, partyX, py, {
          width: colW, lineBreak: false, ellipsis: true,
        });
      py += 16;
    } else {
      doc.fillColor(SUBTLE).font('Helvetica-Oblique').fontSize(10)
        .text('—', partyX, py, { width: colW, lineBreak: false });
      py += 14;
    }

    doc.fillColor(BRAND_RED).rect(contraX, y + 1, 2, 9).fill();
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8.5)
      .text('CONTRA ACCOUNT', contraX + 6, y, {
        width: colW - 6, characterSpacing: 1.2, lineBreak: false,
      });
    let cy = y + 16;
    if (v.contraAccount) {
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11)
        .text(`${v.contraAccount.code} · ${v.contraAccount.name}`, contraX, cy, {
          width: colW, lineBreak: false, ellipsis: true,
        });
      cy += 16;
      if (v.contraAccount.accountGroup?.name) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
          .text(v.contraAccount.accountGroup.name, contraX, cy, {
            width: colW, lineBreak: false, ellipsis: true,
          });
        cy += 11;
      }
    } else {
      doc.fillColor(SUBTLE).font('Helvetica-Oblique').fontSize(10)
        .text('—', contraX, cy, { width: colW, lineBreak: false });
      cy += 14;
    }

    y = Math.max(py, cy) + 8;
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left, y).lineTo(right, y).stroke();
    y += 14;

    // ── Amount panel ────────────────────────────────────────────────
    doc.fillColor(NAVY_TINT).rect(left, y, fullW, 62).fill();
    doc.fillColor(MUTED).font('Helvetica').fontSize(9.5)
      .text('AMOUNT', left + 14, y + 10, { width: fullW - 28, lineBreak: false });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(26)
      .text(`${v.currency} ${fmtNum(v.amount)}`, left + 14, y + 22, {
        width: fullW - 28, lineBreak: false,
      });
    doc.fillColor(v.direction === 'CREDIT' ? GREEN : RED).font('Helvetica-Bold').fontSize(10)
      .text(
        v.direction === 'CREDIT'
          ? 'CREDIT  ·  deducted from outstanding'
          : 'DEBIT  ·  added to outstanding',
        left + 14, y + 50,
        { width: fullW - 28, lineBreak: false },
      );
    y += 72;

    // ── Amount in words ─────────────────────────────────────────────
    let words = '';
    try {
      words = amountToWords(v.amount, v.currency);
    } catch {
      words = '';
    }
    if (words) {
      const wordsH = 24;
      doc.fillColor(NAVY_TINT_2).rect(left, y, fullW, wordsH).fill();
      doc.fillColor(NAVY).rect(left, y, 2.5, wordsH).fill();
      doc.fillColor(NAVY_SOFT).font('Helvetica-Oblique').fontSize(9.5)
        .text(words, left + 10, y + 6, {
          width: fullW - 16, lineBreak: false, ellipsis: true,
        });
      y += wordsH + 8;
    }

    // ── Reference + Narration ───────────────────────────────────────
    if (v.invoice || v.order || v.narration) {
      doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left, y).lineTo(right, y).stroke();
      y += 12;
      if (v.invoice) {
        doc.fillColor(NAVY_SOFT).font('Helvetica-Bold').fontSize(9)
          .text('Reference invoice', left, y, { width: fullW, lineBreak: false });
        y += 12;
        doc.fillColor(TEXT).font('Helvetica').fontSize(10)
          .text(
            `${v.invoice.invoiceNumber}  ·  ${v.invoice.billToName}  ·  ${v.invoice.currency} ${fmtNum(v.invoice.total)}`,
            left, y, { width: fullW, lineBreak: false, ellipsis: true },
          );
        y += 18;
      }
      if (v.order) {
        doc.fillColor(NAVY_SOFT).font('Helvetica-Bold').fontSize(9)
          .text('Reference order', left, y, { width: fullW, lineBreak: false });
        y += 12;
        doc.fillColor(TEXT).font('Helvetica').fontSize(10)
          .text(
            `${v.order.orderNumber}${
              v.order.price ? `  ·  ${v.currency} ${fmtNum(v.order.price)}` : ''
            }`,
            left, y, { width: fullW, lineBreak: false, ellipsis: true },
          );
        y += 18;
      }
      if (v.narration) {
        doc.fillColor(NAVY_SOFT).font('Helvetica-Bold').fontSize(9)
          .text('Narration', left, y, { width: fullW, lineBreak: false });
        y += 12;
        doc.fillColor(TEXT).font('Helvetica').fontSize(10)
          .text(v.narration, left, y, { width: fullW, height: 50, ellipsis: true });
        y += 50;
      }
    }

    // ── Signatures pinned near the bottom ───────────────────────────
    const bottom = contentBottom(doc);
    let sigY = Math.max(y + 30, bottom - 90);
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left, sigY).lineTo(right, sigY).stroke();
    sigY += 18;
    const sigW = (fullW - colGap * 2) / 3;
    const xs = [left, left + sigW + colGap, left + (sigW + colGap) * 2];
    xs.forEach((x) => {
      doc.lineWidth(0.5).strokeColor(NAVY_SOFT)
        .moveTo(x, sigY + 22).lineTo(x + sigW, sigY + 22).stroke();
    });
    doc.fillColor(NAVY_SOFT).font('Helvetica-Bold').fontSize(8.5)
      .text('Prepared By', xs[0], sigY + 26, { width: sigW, lineBreak: false })
      .text('Approved By', xs[1], sigY + 26, { width: sigW, lineBreak: false })
      .text(
        v.direction === 'CREDIT' ? 'Received By' : 'Authorised Signature',
        xs[2], sigY + 26, { width: sigW, lineBreak: false },
      );

    // ── Disclaimer footer band ──────────────────────────────────────
    const footerY = bottom - 28;
    doc.fillColor(NAVY_TINT_2).rect(left, footerY, fullW, 24).fill();
    doc.fillColor(NAVY_SOFT).font('Helvetica').fontSize(8.5)
      .text(`Generated on ${fmtDate(new Date())}`, left, footerY + 5, {
        width: fullW, align: 'center', lineBreak: false,
      });
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8)
      .text(
        'This is a computer-generated voucher and does not require a signature.',
        left, footerY + 14,
        { width: fullW, align: 'center', lineBreak: false },
      );

    doc.end();
  });
}
