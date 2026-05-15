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
const ROW_ALT = '#fafbfc';

const fmtNum = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

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

    // ── Header ─────────────────────────────────────────────────────────────
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(20)
      .text('SUPPLIER PAYMENT VOUCHER', left, y, { width: fullW * 0.7, lineBreak: false });
    if (v.companyTrn) {
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10)
        .text(`TRN: ${v.companyTrn}`, left, y + 26, { width: fullW * 0.7, lineBreak: false });
    }

    const metaX = left + fullW * 0.7;
    const metaW = fullW * 0.3;
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text('Ref No.', metaX, y, { width: metaW, align: 'right', lineBreak: false });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13)
      .text(v.voucherNumber, metaX, y + 11, { width: metaW, align: 'right', lineBreak: false });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text(`${fmtDate(v.voucherDate)}  ·  ${v.currency}`, metaX, y + 30, {
        width: metaW, align: 'right', lineBreak: false,
      });

    y += 50;
    doc.fillColor(BRAND_RED).circle(left + 3, y, 2.6).fill();
    doc.lineWidth(2.5).strokeColor(NAVY).moveTo(left + 10, y).lineTo(left + 86, y).stroke();
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left + 92, y).lineTo(right, y).stroke();
    y += 14;

    // ── Payment info grid ─────────────────────────────────────────────────
    const drawKV = (label: string, value: string, x: number, yy: number, w: number, valueColor = TEXT) => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
        .text(label.toUpperCase(), x, yy, { width: w, characterSpacing: 0.6, lineBreak: false });
      doc.fillColor(valueColor).font('Helvetica-Bold').fontSize(10.5)
        .text(value || '—', x, yy + 11, { width: w, lineBreak: false, ellipsis: true });
    };

    const colW = (fullW - 16) / 3;
    // Row 1: By, Voucher No., A/c
    drawKV('By', v.paymentMethod ? (PAYMENT_METHOD_LABEL[v.paymentMethod] || v.paymentMethod) : '', left, y, colW);
    drawKV('Date', fmtDate(v.voucherDate), left + colW + 8, y, colW);
    drawKV('A/c', v.contraAccount ? `${v.contraAccount.code} · ${v.contraAccount.name}` : '', left + (colW + 8) * 2, y, colW);
    y += 30;

    // Row 2: Party Code, Collected Rep, Cheque No
    drawKV('Party', v.account ? `${v.account.code} · ${v.account.name}` : (v.issuedTo || ''), left, y, colW, NAVY);
    drawKV('Collected Rep', v.collectedRep ? `${v.collectedRep.code} · ${v.collectedRep.name}` : '', left + colW + 8, y, colW);
    drawKV('Cheque No.', v.chequeNumber || '', left + (colW + 8) * 2, y, colW);
    y += 30;

    // Row 3: Chq Date, Present On, Cleared On
    drawKV('Cheque Date', fmtDate(v.chequeDate), left, y, colW);
    drawKV('Present On', fmtDate(v.presentOn), left + colW + 8, y, colW);
    drawKV('Cleared On', fmtDate(v.clearedOn), left + (colW + 8) * 2, y, colW);
    y += 32;

    // Party / Issued To panel
    if (v.account || v.issuedTo) {
      doc.fillColor(NAVY_TINT_2).rect(left, y, fullW, 56).fill();
      doc.fillColor(NAVY).rect(left, y, 2.5, 56).fill();
      doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
        .text('ISSUED TO', left + 10, y + 8, { width: fullW - 20, characterSpacing: 0.6, lineBreak: false });
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12)
        .text(v.issuedTo || (v.account ? v.account.name : ''), left + 10, y + 19, {
          width: fullW - 20, lineBreak: false, ellipsis: true,
        });
      const sub: string[] = [];
      if (v.account?.address) sub.push(v.account.address);
      if (v.account?.mobile1) sub.push(v.account.mobile1);
      if (v.account?.trn) sub.push(`TRN ${v.account.trn}`);
      if (sub.length) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(9)
          .text(sub.join('  ·  '), left + 10, y + 37, {
            width: fullW - 20, lineBreak: false, ellipsis: true,
          });
      }
      if (v.accountPayee) {
        doc.fillColor(BRAND_RED).font('Helvetica-Bold').fontSize(9)
          .text('A/C PAYEE ONLY', right - 110, y + 8, {
            width: 100, align: 'right', characterSpacing: 0.6, lineBreak: false,
          });
      }
      y += 66;
    }

    // ── Allocations table ─────────────────────────────────────────────────
    const cols = [
      { key: 'job',   label: 'JOB NO',     w: fullW * 0.20, align: 'left' as const },
      { key: 'ref',   label: 'REF NO',     w: fullW * 0.12, align: 'left' as const },
      { key: 'inv',   label: 'INV. NO.',   w: fullW * 0.16, align: 'left' as const },
      { key: 'date',  label: 'DATE',       w: fullW * 0.12, align: 'left' as const },
      { key: 'bill',  label: 'AMOUNT',     w: fullW * 0.13, align: 'right' as const },
      { key: 'recd',  label: 'RECD. AMT.', w: fullW * 0.13, align: 'right' as const },
      { key: 'bal',   label: 'BAL. AMT.',  w: fullW * 0.14, align: 'right' as const },
    ];
    const colX: number[] = [];
    {
      let x = left;
      for (const c of cols) { colX.push(x); x += c.w; }
    }

    const headRowH = 22;
    const rowH = 18;

    const drawTableHead = (yy: number) => {
      doc.fillColor(NAVY_TINT_2).rect(left, yy, fullW, headRowH).fill();
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8);
      cols.forEach((c, i) => {
        doc.text(c.label, colX[i] + 4, yy + 7, {
          width: c.w - 8, align: c.align, characterSpacing: 0.6, lineBreak: false,
        });
      });
      doc.lineWidth(1).strokeColor(NAVY)
        .moveTo(left, yy + headRowH).lineTo(right, yy + headRowH).stroke();
    };

    drawTableHead(y);
    y += headRowH;

    const allocations = v.allocations ?? [];
    let totalBill = 0;
    let totalRecd = 0;
    let totalBal = 0;

    allocations.forEach((a, idx) => {
      if (y + rowH > contentBottom(doc) - 80) {
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
        { v: a.jobNo || '',          font: 'Helvetica',      color: TEXT },
        { v: a.refNo || '',          font: 'Helvetica',      color: TEXT },
        { v: a.invoiceNumber || '',  font: 'Helvetica',      color: TEXT },
        { v: fmtDate(a.invoiceDate), font: 'Helvetica',      color: MUTED },
        { v: fmtNum(a.billAmount),   font: 'Helvetica',      color: a.billAmount < 0 ? BRAND_RED : TEXT },
        { v: fmtNum(a.allocatedAmount), font: 'Helvetica-Bold', color: a.allocatedAmount > 0 ? NAVY : SUBTLE },
        { v: fmtNum(a.balanceAfter), font: 'Helvetica',      color: a.balanceAfter === 0 ? '#047857' : TEXT },
      ];
      doc.fontSize(9);
      cells.forEach((cell, i) => {
        doc.font(cell.font).fillColor(cell.color);
        doc.text(cell.v, colX[i] + (cols[i].align === 'left' ? 4 : 0), y + 5, {
          width: cols[i].w - (cols[i].align === 'left' ? 8 : 4),
          align: cols[i].align,
          lineBreak: false,
          ellipsis: true,
        });
      });
      y += rowH;
    });

    // Totals row
    doc.fillColor(NAVY_TINT).rect(left, y, fullW, 24).fill();
    doc.lineWidth(0.8).strokeColor(NAVY).moveTo(left, y).lineTo(right, y).stroke();
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9.5)
      .text('TOTAL', colX[0] + 4, y + 7, { width: cols[0].w + cols[1].w + cols[2].w + cols[3].w - 8, lineBreak: false });
    doc.text(fmtNum(totalBill), colX[4], y + 7, { width: cols[4].w - 4, align: 'right', lineBreak: false });
    doc.text(fmtNum(totalRecd), colX[5], y + 7, { width: cols[5].w - 4, align: 'right', lineBreak: false });
    doc.text(fmtNum(totalBal),  colX[6], y + 7, { width: cols[6].w - 4, align: 'right', lineBreak: false });
    y += 30;

    // ── Amount paid + words ────────────────────────────────────────────────
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10.5)
      .text('Amount Paid', left, y, { width: fullW * 0.6, lineBreak: false });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(15)
      .text(`${v.currency} ${fmtNum(v.amount)}`, left + fullW * 0.6, y - 3, {
        width: fullW * 0.4, align: 'right', lineBreak: false,
      });
    y += 22;

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
        doc.fillColor(NAVY_SOFT).font('Helvetica-Bold').fontSize(9)
          .text(`Against: ${v.againstType}`, left, y, { width: fullW, lineBreak: false });
        y += 14;
      }
      if (v.narration) {
        doc.fillColor(NAVY_SOFT).font('Helvetica-Bold').fontSize(9)
          .text('Narration', left, y, { width: fullW, lineBreak: false });
        y += 11;
        doc.fillColor(TEXT).font('Helvetica').fontSize(10)
          .text(v.narration, left, y, { width: fullW, height: 40, ellipsis: true });
        y += 30;
      }
    }

    // ── Signatures ─────────────────────────────────────────────────────────────
    const bottom = contentBottom(doc);
    let sigY = Math.max(y + 30, bottom - 90);
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left, sigY).lineTo(right, sigY).stroke();
    sigY += 18;
    const colGap = 24;
    const sigW = (fullW - colGap * 2) / 3;
    const xs = [left, left + sigW + colGap, left + (sigW + colGap) * 2];
    xs.forEach((x) => {
      doc.lineWidth(0.5).strokeColor(NAVY_SOFT)
        .moveTo(x, sigY + 22).lineTo(x + sigW, sigY + 22).stroke();
    });
    doc.fillColor(NAVY_SOFT).font('Helvetica-Bold').fontSize(8.5)
      .text('Prepared By', xs[0], sigY + 26, { width: sigW, lineBreak: false })
      .text('Approved By', xs[1], sigY + 26, { width: sigW, lineBreak: false })
      .text('Received By', xs[2], sigY + 26, { width: sigW, lineBreak: false });

    const footerY = bottom - 28;
    doc.fillColor(NAVY_TINT_2).rect(left, footerY, fullW, 24).fill();
    doc.fillColor(NAVY_SOFT).font('Helvetica').fontSize(8.5)
      .text(`Generated on ${fmtDate(new Date())}`, left, footerY + 5, {
        width: fullW, align: 'center', lineBreak: false,
      });
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8)
      .text('This is a computer-generated voucher and does not require a signature.',
        left, footerY + 14, { width: fullW, align: 'center', lineBreak: false });

    doc.end();
  });
}
