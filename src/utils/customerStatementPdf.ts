// Customer Outstanding Statement (SOA) PDF generator.
//
// Renders the per-customer outstanding statement in the format used by
// the front-office: invoice-by-invoice with days, balance and a cumulative
// running balance, followed by the total in words.

import PDFDocument from 'pdfkit';
import {
  attachBrandingToDoc,
  contentBottom,
  CONTENT_TOP,
  PAGE_MARGIN,
} from './pdfBranding';

const NAVY = '#0a1628';
const NAVY_SOFT = '#1e293b';
const TEXT = '#0f172a';
const MUTED = '#475569';
const DIVIDER = '#cbd5e1';
const ROW_ALT = '#fafbfc';
const NAVY_TINT = '#eef2f7';

const fmtNum = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDateGB = (d: Date | string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function chunkToWords(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return TENS[t] + (o ? ' ' + ONES[o] : '');
  }
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return ONES[h] + ' Hundred' + (rest ? ' ' + chunkToWords(rest) : '');
}

function wholeToWords(num: number): string {
  if (num === 0) return 'Zero';
  const parts: string[] = [];
  const billions = Math.floor(num / 1_000_000_000);
  const millions = Math.floor((num % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((num % 1_000_000) / 1_000);
  const rest = num % 1_000;
  if (billions) parts.push(chunkToWords(billions) + ' Billion');
  if (millions) parts.push(chunkToWords(millions) + ' Million');
  if (thousands) parts.push(chunkToWords(thousands) + ' Thousand');
  if (rest) parts.push(chunkToWords(rest));
  return parts.join(' ').trim();
}

const MINOR_LABEL: Record<string, string> = {
  AED: 'Fils', USD: 'Cents', EUR: 'Cents', GBP: 'Pence', INR: 'Paise', SAR: 'Halala',
};

// "AED Twenty Nine Thousand Twenty Two and Fils Fourteen Only"
function amountToWordsFull(amount: number, currency = 'AED'): string {
  const safe = Math.max(0, Number.isFinite(amount) ? amount : 0);
  const whole = Math.floor(safe);
  const fractional = Math.round((safe - whole) * 100);
  const minor = MINOR_LABEL[currency.toUpperCase()] ?? 'Cents';
  const major = wholeToWords(whole);
  const minorWords = fractional > 0 ? chunkToWords(fractional) : 'Zero';
  return `${currency.toUpperCase()} ${major} and ${minor} ${minorWords} Only`;
}

export type CustomerStatementRow = {
  invoiceNumber: string;
  invoiceDate: Date | string;
  days: number;
  balance: number;
  cumBalance: number;
};

export type CustomerStatementForPdf = {
  customer: {
    code?: string;
    name: string;
    phone?: string | null;
    mobile?: string | null;
    trn?: string | null;
    address?: string | null;
    email?: string | null;
  };
  asOf: Date | string;
  currency: string;
  totalOutstanding: number;
  rows: CustomerStatementRow[];
  companyTrn?: string;
};

export function generateCustomerStatementPdfBuffer(v: CustomerStatementForPdf): Promise<Buffer> {
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

    // ── Title row ──────────────────────────────────────────────────────────
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13)
      .text(`Customer Outstanding Statement as of ${fmtDateGB(v.asOf)}`, left, y, {
        width: fullW * 0.75, lineBreak: false,
      });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text('Page : 1', left + fullW * 0.75, y + 3, {
        width: fullW * 0.25, align: 'right', lineBreak: false,
      });
    y += 22;

    // ── Customer info bordered box ─────────────────────────────────────────
    const infoH = 60;
    doc.lineWidth(0.7).strokeColor(DIVIDER).rect(left, y, fullW, infoH).stroke();
    // Vertical divider between name and phone columns
    const splitX = left + fullW * 0.62;
    doc.lineWidth(0.7).strokeColor(DIVIDER).moveTo(splitX, y).lineTo(splitX, y + infoH).stroke();

    // Customer name (left column)
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13)
      .text(v.customer.name, left + 10, y + 14, {
        width: splitX - left - 20, lineBreak: false, ellipsis: true,
      });
    // Optional secondary line (code + TRN)
    const sub: string[] = [];
    if (v.customer.code) sub.push(v.customer.code);
    if (v.customer.trn) sub.push(`TRN ${v.customer.trn}`);
    if (sub.length) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
        .text(sub.join('  ·  '), left + 10, y + 34, {
          width: splitX - left - 20, lineBreak: false, ellipsis: true,
        });
    }

    // Phone block (right column)
    const phoneX = splitX + 10;
    const phoneW = right - phoneX - 10;
    doc.fillColor(TEXT).font('Helvetica').fontSize(10)
      .text(`Phone : ${v.customer.phone || ''}`, phoneX, y + 14, {
        width: phoneW, lineBreak: false, ellipsis: true,
      })
      .text(`Mobile : ${v.customer.mobile || ''}`, phoneX, y + 32, {
        width: phoneW, lineBreak: false, ellipsis: true,
      });

    y += infoH;

    // ── Table ──────────────────────────────────────────────────────────────
    const cols = [
      { key: 'sl',    label: 'Sl No',           w: fullW * 0.07,  align: 'center' as const },
      { key: 'inv',   label: 'Invoice No',      w: fullW * 0.22,  align: 'left'   as const },
      { key: 'date',  label: 'Date',            w: fullW * 0.15,  align: 'center' as const },
      { key: 'days',  label: 'Days',            w: fullW * 0.10,  align: 'center' as const },
      { key: 'bal',   label: 'Balance Amount',  w: fullW * 0.23,  align: 'right'  as const },
      { key: 'cum',   label: 'Cum. Balance',    w: fullW * 0.23,  align: 'right'  as const },
    ];
    const colX: number[] = [];
    {
      let x = left;
      for (const c of cols) { colX.push(x); x += c.w; }
    }

    const headRowH = 22;
    const rowH = 18;

    const drawTableHead = (yy: number) => {
      // Outer rect + fill
      doc.fillColor(NAVY).rect(left, yy, fullW, headRowH).fill();
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
      cols.forEach((c, i) => {
        doc.text(c.label, colX[i] + 5, yy + 7, {
          width: c.w - 10, align: c.align, lineBreak: false,
        });
      });
      // Column dividers (subtle white)
      doc.lineWidth(0.3).strokeColor('#ffffff');
      for (let i = 1; i < cols.length; i += 1) {
        doc.moveTo(colX[i], yy + 4).lineTo(colX[i], yy + headRowH - 4).stroke();
      }
    };

    const drawCellBorders = (yy: number) => {
      doc.lineWidth(0.4).strokeColor(DIVIDER);
      // Bottom border for the row
      doc.moveTo(left, yy + rowH).lineTo(right, yy + rowH).stroke();
      // Vertical dividers between columns
      for (let i = 1; i < cols.length; i += 1) {
        doc.moveTo(colX[i], yy).lineTo(colX[i], yy + rowH).stroke();
      }
      // Outer left/right
      doc.moveTo(left, yy).lineTo(left, yy + rowH).stroke();
      doc.moveTo(right, yy).lineTo(right, yy + rowH).stroke();
    };

    drawTableHead(y);
    y += headRowH;

    v.rows.forEach((r, idx) => {
      // Page break with header repeat
      if (y + rowH > contentBottom(doc) - 60) {
        doc.addPage();
        y = CONTENT_TOP;
        drawTableHead(y);
        y += headRowH;
      }
      if (idx % 2 === 1) {
        doc.fillColor(ROW_ALT).rect(left, y, fullW, rowH).fill();
      }
      const cells = [
        { v: String(idx + 1),                   font: 'Helvetica' },
        { v: r.invoiceNumber,                   font: 'Helvetica' },
        { v: fmtDateGB(r.invoiceDate),          font: 'Helvetica' },
        { v: String(r.days),                    font: 'Helvetica' },
        { v: fmtNum(r.balance),                 font: 'Helvetica' },
        { v: fmtNum(r.cumBalance),              font: 'Helvetica-Bold' },
      ];
      doc.fillColor(TEXT).fontSize(9);
      cells.forEach((cell, i) => {
        doc.font(cell.font);
        const padLeft = cols[i].align === 'left' ? 5 : 0;
        const padRight = cols[i].align === 'right' ? 5 : 0;
        doc.text(cell.v, colX[i] + padLeft, y + 5, {
          width: cols[i].w - padLeft - padRight,
          align: cols[i].align,
          lineBreak: false,
          ellipsis: true,
        });
      });
      drawCellBorders(y);
      y += rowH;
    });

    if (v.rows.length === 0) {
      doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(9)
        .text('No outstanding invoices for this customer.', left + 6, y + 5, {
          width: fullW - 12, lineBreak: false,
        });
      drawCellBorders(y);
      y += rowH;
    }

    // ── Total row ──────────────────────────────────────────────────────────
    const totH = 24;
    doc.fillColor(NAVY_TINT).rect(left, y, fullW, totH).fill();
    doc.lineWidth(0.6).strokeColor(NAVY)
      .moveTo(left, y).lineTo(right, y).stroke()
      .moveTo(left, y + totH).lineTo(right, y + totH).stroke();
    // Vertical dividers (carry through)
    doc.lineWidth(0.4).strokeColor(DIVIDER);
    for (let i = 1; i < cols.length; i += 1) {
      doc.moveTo(colX[i], y).lineTo(colX[i], y + totH).stroke();
    }
    doc.moveTo(left, y).lineTo(left, y + totH).stroke();
    doc.moveTo(right, y).lineTo(right, y + totH).stroke();

    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10)
      .text('Total Outstanding', colX[0] + 5, y + 7, {
        width: cols[0].w + cols[1].w + cols[2].w + cols[3].w - 10,
        align: 'right', lineBreak: false,
      });
    doc.text(fmtNum(v.totalOutstanding), colX[4] + 5, y + 7, {
      width: cols[4].w - 10, align: 'right', lineBreak: false,
    });
    doc.text(fmtNum(v.totalOutstanding), colX[5] + 5, y + 7, {
      width: cols[5].w - 10, align: 'right', lineBreak: false,
    });
    y += totH;

    // ── Amount in words ────────────────────────────────────────────────────
    const wordsY = y + 4;
    const wordsH = 22;
    doc.lineWidth(0.4).strokeColor(DIVIDER).rect(left, wordsY, fullW, wordsH).stroke();
    doc.fillColor(NAVY_SOFT).font('Helvetica').fontSize(9.5)
      .text(amountToWordsFull(v.totalOutstanding, v.currency), left + 8, wordsY + 6, {
        width: fullW - 16, lineBreak: false, ellipsis: true,
      });
    y = wordsY + wordsH;

    // Footer note tucked above the brand footer band
    const footY = contentBottom(doc) - 24;
    if (y < footY) {
      doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8)
        .text(`Generated on ${fmtDateGB(new Date())}.  ·  This statement is computer-generated.`,
          left, footY, { width: fullW, align: 'center', lineBreak: false });
    }

    doc.end();
  });
}
