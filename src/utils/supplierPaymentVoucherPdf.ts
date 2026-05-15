import PDFDocument from 'pdfkit';
import {
  attachBrandingToDoc,
  contentBottom,
  CONTENT_TOP,
  PAGE_MARGIN,
} from './pdfBranding';
import { amountToWords } from './numberToWords';

// ── Palette ────────────────────────────────────────────────────────────────
const NAVY = '#0a1628';
const NAVY_SOFT = '#1e293b';
const BRAND_RED = '#dc2626';
const TEXT = '#0f172a';
const MUTED = '#475569';
const SUBTLE = '#94a3b8';
const DIVIDER = '#e2e8f0';
const NAVY_TINT = '#eef2f7';
const NAVY_TINT_2 = '#f4f7fb';
const ROW_ALT = '#fafbfc';
const GREEN = '#047857';

const fmtNum = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const safe = (s: string | null | undefined) => (s ?? '').toString().trim();

export type SupplierPaymentVoucherForPdf = {
  voucherNumber: string;
  voucherDate: Date | string;
  paymentMethod: string | null;
  amount: number;
  currency: string;
  accountPayee: boolean;
  chequeNumber: string | null;
  chequeDate: Date | string | null;
  presentOn: Date | string | null;
  clearedOn: Date | string | null;
  againstType: string | null;
  narration: string | null;
  issuedTo: string | null;
  account: {
    code: string;
    name: string;
    address: string | null;
    mobile1: string | null;
    trn: string | null;
    email: string | null;
  } | null;
  contraAccount: { code: string; name: string } | null;
  collectedRep: { code: string; name: string } | null;
  allocations: Array<{
    jobNo: string | null;
    refNo: string | null;
    invoiceNumber: string | null;
    invoiceDate: Date | string | null;
    billAmount: number;
    allocatedAmount: number;
    balanceAfter: number;
    remarks: string | null;
  }>;
  companyName?: string;
  companyTrn?: string;
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash',
  CHEQUE: 'Cheque',
  BANK_TRANSFER: 'Bank Transfer',
  CONTRA: 'Contra',
};

export function generateSupplierPaymentVoucherPdfBuffer(v: SupplierPaymentVoucherForPdf): Promise<Buffer> {
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

    // ── Header strip ───────────────────────────────────────────────────────
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(20)
      .text('SUPPLIER PAYMENT VOUCHER', left, y, { width: fullW * 0.65, lineBreak: false });
    if (v.companyTrn) {
      doc.fillColor(NAVY_SOFT).font('Helvetica').fontSize(9)
        .text(`TRN: ${v.companyTrn}`, left, y + 26, { width: fullW * 0.65, lineBreak: false });
    }

    // Top-right meta block
    const metaX = left + fullW * 0.65;
    const metaW = fullW * 0.35;
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
      .text('REF NO.', metaX, y, { width: metaW, align: 'right', characterSpacing: 0.6, lineBreak: false });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(14)
      .text(v.voucherNumber, metaX, y + 10, { width: metaW, align: 'right', lineBreak: false });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text(`${fmtDate(v.voucherDate)}  ·  ${v.currency}`, metaX, y + 28, {
        width: metaW, align: 'right', lineBreak: false,
      });

    y += 50;

    // Accent rule
    doc.fillColor(BRAND_RED).circle(left + 3, y, 2.6).fill();
    doc.lineWidth(2.5).strokeColor(NAVY).moveTo(left + 10, y).lineTo(left + 96, y).stroke();
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left + 102, y).lineTo(right, y).stroke();
    y += 16;

    // ── PAYMENT INFORMATION ─────────────────────────────────────────────────
    // Two-column key-value layout. Each value may span multiple lines, so we
    // measure height explicitly per row before advancing y.
    const labelW = 110;          // fixed label column width
    const gapXY = 14;            // gap between label and value
    const colGap = 28;           // gap between the two columns
    const halfW = (fullW - colGap) / 2;
    const valueW_full = fullW - labelW - gapXY;
    const valueW_half = halfW - labelW - gapXY;

    type Field = { label: string; value: string; full?: boolean; valueColor?: string; muted?: boolean };

    const partyVal = v.account
      ? `${v.account.code} · ${v.account.name}`
      : (v.issuedTo || '—');

    // Bank info can be long; split into bank-line + account number line for
    // graceful wrapping.
    const bankPrimary = v.contraAccount ? v.contraAccount.code : '';
    const bankSecondary = v.contraAccount ? v.contraAccount.name : '';
    const acFieldValue = bankPrimary && bankSecondary
      ? `${bankPrimary}\n${bankSecondary}`
      : (bankPrimary || bankSecondary || '—');

    // Build row list — cheque rows only included if paymentMethod === CHEQUE.
    const isChequePayment = v.paymentMethod === 'CHEQUE';

    const leftFields: Field[] = [
      { label: 'By', value: v.paymentMethod ? (PAYMENT_METHOD_LABEL[v.paymentMethod] || v.paymentMethod) : '—' },
      { label: 'Party', value: partyVal, valueColor: NAVY },
      { label: 'Collected Rep', value: v.collectedRep ? `${v.collectedRep.code} · ${v.collectedRep.name}` : '—' },
    ];
    const rightFields: Field[] = [
      { label: 'Date', value: fmtDate(v.voucherDate) },
      { label: 'A/c (Bank/Cash)', value: acFieldValue, full: true },
    ];

    if (isChequePayment) {
      leftFields.push({ label: 'Cheque No.', value: v.chequeNumber || '—' });
      leftFields.push({ label: 'Present On', value: fmtDate(v.presentOn) || '—' });
      rightFields.push({ label: 'Cheque Date', value: fmtDate(v.chequeDate) || '—' });
      rightFields.push({ label: 'Cleared On', value: fmtDate(v.clearedOn) || '—' });
    }

    const rowGap = 8;
    const drawField = (f: Field, x: number, yy: number, w: number): number => {
      // Label
      doc.fillColor(MUTED).font('Helvetica').fontSize(8)
        .text(f.label.toUpperCase(), x, yy + 1, {
          width: labelW, characterSpacing: 0.5, lineBreak: false,
        });
      // Value — allow wrapping for multi-line content
      doc.fillColor(f.valueColor || TEXT).font('Helvetica-Bold').fontSize(10);
      const valueX = x + labelW + gapXY;
      const valueWidth = w - labelW - gapXY;
      doc.text(f.value, valueX, yy, {
        width: valueWidth,
        lineGap: 1,
        ellipsis: true,
      });
      // Measure how tall the value column ended up
      const valueH = doc.heightOfString(f.value, { width: valueWidth, lineGap: 1 });
      return Math.max(valueH, 12);
    };

    // Walk the two columns in parallel; each row uses max(left, right) height
    const maxRows = Math.max(leftFields.length, rightFields.length);
    for (let i = 0; i < maxRows; i += 1) {
      const lf = leftFields[i];
      const rf = rightFields[i];
      const isFullRow = rf?.full && !lf;
      if (isFullRow && rf) {
        const h = drawField(rf, left, y, fullW);
        y += h + rowGap;
        continue;
      }
      const lh = lf ? drawField(lf, left, y, halfW) : 0;
      const rh = rf ? drawField(rf, left + halfW + colGap, y, halfW) : 0;
      y += Math.max(lh, rh, 12) + rowGap;
    }

    void valueW_full; void valueW_half; // (kept for clarity, intentionally unused)

    y += 4;

    // ── Issued To panel ────────────────────────────────────────────────────
    if (v.account || v.issuedTo) {
      const panelH = 56;
      doc.fillColor(NAVY_TINT_2).rect(left, y, fullW, panelH).fill();
      doc.fillColor(NAVY).rect(left, y, 2.5, panelH).fill();
      doc.fillColor(MUTED).font('Helvetica').fontSize(8)
        .text('ISSUED TO', left + 10, y + 8, {
          width: fullW - 20, characterSpacing: 0.6, lineBreak: false,
        });
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12)
        .text(v.issuedTo || (v.account ? v.account.name : ''), left + 10, y + 19, {
          width: fullW - 130, lineBreak: false, ellipsis: true,
        });
      const sub: string[] = [];
      if (v.account?.address) sub.push(safe(v.account.address).replace(/\n/g, ', '));
      if (v.account?.mobile1) sub.push(v.account.mobile1);
      if (v.account?.trn) sub.push(`TRN ${v.account.trn}`);
      if (sub.length) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(9)
          .text(sub.join('  ·  '), left + 10, y + 37, {
            width: fullW - 130, lineBreak: false, ellipsis: true,
          });
      }
      if (v.accountPayee) {
        doc.fillColor(BRAND_RED).font('Helvetica-Bold').fontSize(9)
          .text('A/C PAYEE ONLY', right - 110, y + 21, {
            width: 100, align: 'right', characterSpacing: 0.6, lineBreak: false,
          });
      }
      y += panelH + 12;
    }

    // ── Allocations table ───────────────────────────────────────────────────
    // Column widths re-balanced so invoice / ref / job columns fit typical
    // codes without clipping.
    const cols = [
      { key: 'job',   label: 'JOB NO',     w: fullW * 0.20, align: 'left' as const },
      { key: 'ref',   label: 'REF NO',     w: fullW * 0.18, align: 'left' as const },
      { key: 'inv',   label: 'INV. NO.',   w: fullW * 0.18, align: 'left' as const },
      { key: 'date',  label: 'DATE',       w: fullW * 0.10, align: 'left' as const },
      { key: 'bill',  label: 'AMOUNT',     w: fullW * 0.10, align: 'right' as const },
      { key: 'recd',  label: 'RECD. AMT.', w: fullW * 0.11, align: 'right' as const },
      { key: 'bal',   label: 'BAL. AMT.',  w: fullW * 0.13, align: 'right' as const },
    ];
    const colX: number[] = [];
    {
      let x = left;
      for (const c of cols) { colX.push(x); x += c.w; }
    }

    const headRowH = 22;
    const rowH = 18;

    const drawTableHead = (yy: number) => {
      doc.fillColor(NAVY).rect(left, yy, fullW, headRowH).fill();
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);
      cols.forEach((c, i) => {
        doc.text(c.label, colX[i] + 5, yy + 7, {
          width: c.w - 10, align: c.align, characterSpacing: 0.6, lineBreak: false,
        });
      });
    };

    drawTableHead(y);
    y += headRowH;

    const allocations = v.allocations ?? [];
    let totalBill = 0;
    let totalRecd = 0;
    let totalBal = 0;

    allocations.forEach((a, idx) => {
      if (y + rowH > contentBottom(doc) - 110) {
        doc.addPage();
        y = CONTENT_TOP;
        drawTableHead(y);
        y += headRowH;
      }
      if (idx % 2 === 1) {
        doc.rect(left, y, fullW, rowH).fillColor(ROW_ALT).fill();
      }
      totalBill += a.billAmount;
      totalRecd += a.allocatedAmount;
      totalBal += a.balanceAfter;

      const cells = [
        { v: safe(a.jobNo),               font: 'Helvetica',      color: TEXT },
        { v: safe(a.refNo),               font: 'Helvetica',      color: TEXT },
        { v: safe(a.invoiceNumber),       font: 'Helvetica',      color: TEXT },
        { v: fmtDate(a.invoiceDate),      font: 'Helvetica',      color: MUTED },
        { v: fmtNum(a.billAmount),        font: 'Helvetica',      color: a.billAmount < 0 ? BRAND_RED : TEXT },
        { v: fmtNum(a.allocatedAmount),   font: 'Helvetica-Bold', color: a.allocatedAmount > 0 ? NAVY : SUBTLE },
        { v: fmtNum(a.balanceAfter),      font: 'Helvetica',      color: a.balanceAfter === 0 ? GREEN : TEXT },
      ];
      doc.fontSize(9);
      cells.forEach((cell, i) => {
        doc.font(cell.font).fillColor(cell.color);
        const padLeft = cols[i].align === 'left' ? 5 : 0;
        const padRight = cols[i].align === 'right' ? 5 : 0;
        doc.text(cell.v || '', colX[i] + padLeft, y + 5, {
          width: cols[i].w - padLeft - padRight,
          align: cols[i].align,
          lineBreak: false,
          ellipsis: true,
        });
      });
      y += rowH;
    });

    if (allocations.length === 0) {
      doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(9)
        .text('No bill allocations.', left + 6, y + 5, {
          width: fullW - 12, lineBreak: false,
        });
      y += rowH;
    }

    // Totals row
    doc.fillColor(NAVY_TINT).rect(left, y, fullW, 24).fill();
    doc.lineWidth(0.8).strokeColor(NAVY).moveTo(left, y).lineTo(right, y).stroke();
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9.5)
      .text('TOTAL', colX[0] + 5, y + 7, {
        width: cols[0].w + cols[1].w + cols[2].w + cols[3].w - 10, lineBreak: false,
      });
    doc.text(fmtNum(totalBill), colX[4], y + 7, { width: cols[4].w - 5, align: 'right', lineBreak: false });
    doc.text(fmtNum(totalRecd), colX[5], y + 7, { width: cols[5].w - 5, align: 'right', lineBreak: false });
    doc.text(fmtNum(totalBal),  colX[6], y + 7, { width: cols[6].w - 5, align: 'right', lineBreak: false });
    y += 32;

    // ── Amount paid panel ──────────────────────────────────────────────────
    doc.fillColor(NAVY).rect(left, y, fullW, 36).fill();
    doc.fillColor('#ffffff').font('Helvetica').fontSize(9)
      .text('AMOUNT PAID', left + 14, y + 6, {
        width: fullW - 28, characterSpacing: 0.6, lineBreak: false,
      });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18)
      .text(`${v.currency} ${fmtNum(v.amount)}`, left + 14, y + 14, {
        width: fullW - 28, align: 'right', lineBreak: false,
      });
    y += 42;

    let words = '';
    try { words = amountToWords(v.amount, v.currency); } catch { words = ''; }
    if (words) {
      doc.fillColor(NAVY_TINT_2).rect(left, y, fullW, 22).fill();
      doc.fillColor(NAVY).rect(left, y, 2.5, 22).fill();
      doc.fillColor(NAVY_SOFT).font('Helvetica-Oblique').fontSize(9)
        .text(words, left + 10, y + 5, { width: fullW - 16, lineBreak: false, ellipsis: true });
      y += 28;
    }

    // Against + narration
    if (v.againstType || v.narration) {
      doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left, y).lineTo(right, y).stroke();
      y += 10;
      if (v.againstType) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
          .text('AGAINST', left, y, { width: fullW, characterSpacing: 0.5, lineBreak: false });
        doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(10)
          .text(v.againstType, left + 60, y - 1, { width: fullW - 60, lineBreak: false });
        y += 16;
      }
      if (v.narration) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
          .text('NARRATION', left, y, { width: fullW, characterSpacing: 0.5, lineBreak: false });
        y += 11;
        doc.fillColor(TEXT).font('Helvetica').fontSize(10)
          .text(v.narration, left, y, { width: fullW, height: 40, ellipsis: true });
        y += 32;
      }
    }

    // ── Signatures pinned near bottom ──────────────────────────────────────
    const bottom = contentBottom(doc);
    let sigY = Math.max(y + 30, bottom - 90);
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left, sigY).lineTo(right, sigY).stroke();
    sigY += 22;
    const sigGap = 24;
    const sigW = (fullW - sigGap * 2) / 3;
    const xs = [left, left + sigW + sigGap, left + (sigW + sigGap) * 2];
    xs.forEach((x) => {
      doc.lineWidth(0.5).strokeColor(NAVY_SOFT)
        .moveTo(x, sigY + 22).lineTo(x + sigW, sigY + 22).stroke();
    });
    doc.fillColor(NAVY_SOFT).font('Helvetica-Bold').fontSize(8.5)
      .text('Prepared By', xs[0], sigY + 26, { width: sigW, lineBreak: false })
      .text('Approved By', xs[1], sigY + 26, { width: sigW, lineBreak: false })
      .text('Received By', xs[2], sigY + 26, { width: sigW, lineBreak: false });

    const footerY = bottom - 26;
    doc.fillColor(NAVY_TINT_2).rect(left, footerY, fullW, 22).fill();
    doc.fillColor(NAVY_SOFT).font('Helvetica').fontSize(8.5)
      .text(`Generated on ${fmtDate(new Date())}`, left, footerY + 4, {
        width: fullW, align: 'center', lineBreak: false,
      });
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(7.5)
      .text('Computer-generated voucher · does not require a signature.',
        left, footerY + 13, { width: fullW, align: 'center', lineBreak: false });

    doc.end();
  });
}
