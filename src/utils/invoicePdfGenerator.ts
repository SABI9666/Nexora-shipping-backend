import PDFDocument from 'pdfkit';
import {
  attachBrandingToDoc,
  contentBottom,
  CONTENT_TOP,
  PAGE_MARGIN,
} from './pdfBranding';

type InvoiceItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  lineCurrency?: string | null;
  exchangeRate?: number | null;
  vatPercent?: number | null;
  vatAmount?: number | null;
  totalInBase?: number | null;
  remarks?: string | null;
};

export type InvoiceForPdf = {
  invoiceNumber: string;
  status: string;
  invoiceDate: Date;
  dueDate: Date | null;
  billToName: string;
  billToAddress: string;
  billToCity: string;
  billToCountry: string;
  billToEmail: string | null;
  billToPhone: string | null;
  shipFromName: string;
  shipFromAddress: string;
  shipFromCity: string;
  shipFromCountry: string;
  companyTrn?: string | null;
  jobNo?: string | null;
  originPort?: string | null;
  destPort?: string | null;
  masterBl?: string | null;
  houseBl?: string | null;
  commodity?: string | null;
  boeNumber?: string | null;
  grossWeight?: string | null;
  volume?: string | null;
  packages?: string | null;
  shipperName?: string | null;
  consigneeName?: string | null;
  customerRef?: string | null;
  bankName?: string | null;
  bankAddress?: string | null;
  accountName?: string | null;
  accountNumber?: string | null;
  iban?: string | null;
  swiftCode?: string | null;
  amountInWords?: string | null;
  currency: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  shippingCost: number;
  total: number;
  paymentTerms: string | null;
  notes: string | null;
  items: InvoiceItem[];
  orderRef?: { orderNumber: string } | null;
};

// Palette — Nexora brand: navy + red, with soft tint backgrounds.
const NAVY = '#0a1628';
const NAVY_SOFT = '#1e293b';   // slightly lighter navy for body labels
const BRAND_RED = '#dc2626';   // accent dot / divider start
const TEXT = '#0f172a';
const MUTED = '#475569';
const SUBTLE = '#94a3b8';
const DIVIDER = '#e2e8f0';
const NAVY_TINT = '#eef2f7';   // very light navy panel background (TOTAL DUE, headers)
const NAVY_TINT_2 = '#f4f7fb'; // even softer navy tint (table head, words box)
const ROW_ALT = '#fafbfc';
const ACCENT_BG = '#f8fafc';
void ACCENT_BG;

const fmtNum = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

interface KV { label: string; value: string }
function nonEmpty(label: string, value: string | null | undefined): KV | null {
  const v = inline(value);
  return v ? { label, value: v } : null;
}

// Collapse user-supplied multi-line strings (addresses, names) into a single
// line so pdfkit's text() never wraps them across rows even when lineBreak:
// false is set — embedded \n still cause line breaks.
function inline(s: string | null | undefined): string {
  return (s ?? '').toString().replace(/\s*[\r\n]+\s*/g, ', ').trim();
}

export function generateInvoicePdfBuffer(invoice: InvoiceForPdf): Promise<Buffer> {
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

    // ===================================================================
    //  HEADER  ·  INVOICE title + meta on the right
    // ===================================================================
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(28)
      .text('INVOICE', left, y, { width: fullW * 0.6, lineBreak: false });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text(`TRN ${invoice.companyTrn || '105413106300003'}`, left, y + 32, {
        width: fullW * 0.6, lineBreak: false,
      });

    // Right-side meta block: number + date + currency
    const metaX = left + fullW * 0.6;
    const metaW = fullW * 0.4;
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text('Invoice No.', metaX, y, { width: metaW, align: 'right', lineBreak: false });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13)
      .text(invoice.invoiceNumber, metaX, y + 11, { width: metaW, align: 'right', lineBreak: false });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text(`${fmtDate(invoice.invoiceDate)}  ·  ${invoice.currency}`, metaX, y + 30, {
        width: metaW, align: 'right', lineBreak: false,
      });

    y += 56;
    // Top accent rule: red dot · navy bar · light divider
    doc.fillColor(BRAND_RED).circle(left + 3, y, 2.6).fill();
    doc.lineWidth(2.5).strokeColor(NAVY).moveTo(left + 10, y).lineTo(left + 86, y).stroke();
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left + 92, y).lineTo(right, y).stroke();
    y += 18;

    // ===================================================================
    //  BILL TO  +  JOB DETAILS  (two columns)
    // ===================================================================
    const colGap = 24;
    const colW = (fullW - colGap) / 2;
    const billX = left;
    const jobX = left + colW + colGap;

    // BILL TO
    doc.fillColor(BRAND_RED).rect(billX, y + 1, 2, 9).fill();
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8.5)
      .text('BILL TO', billX + 6, y, { width: colW - 6, characterSpacing: 1.2, lineBreak: false });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12)
      .text(inline(invoice.billToName), billX, y + 14, { width: colW, lineBreak: false, ellipsis: true });
    // Allow address up to 2 lines so long addresses (POB:..., DOHA, QATAR)
    // don't wrap into the row that holds city/country.
    doc.fillColor(TEXT).font('Helvetica').fontSize(9.5)
      .text(inline(invoice.billToAddress), billX, y + 32, {
        width: colW, height: 24, ellipsis: true,
      });
    const cityCountry = [inline(invoice.billToCity), inline(invoice.billToCountry)].filter(Boolean).join(', ');
    if (cityCountry) {
      doc.fillColor(TEXT).font('Helvetica').fontSize(9.5)
        .text(cityCountry, billX, y + 58, { width: colW, lineBreak: false, ellipsis: true });
    }
    let billLine = 74;
    if (invoice.billToEmail) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
        .text(inline(invoice.billToEmail), billX, y + billLine, { width: colW, lineBreak: false, ellipsis: true });
      billLine += 12;
    }
    if (invoice.billToPhone) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
        .text(inline(invoice.billToPhone), billX, y + billLine, { width: colW, lineBreak: false, ellipsis: true });
    }

    // JOB DETAILS — assemble only fields that have a value (no blank rows)
    const jobRows: KV[] = [
      nonEmpty('Job No', invoice.jobNo ?? invoice.orderRef?.orderNumber ?? ''),
      nonEmpty('Customer Ref', invoice.customerRef ?? ''),
      nonEmpty('Origin', invoice.originPort),
      nonEmpty('Destination', invoice.destPort),
      nonEmpty('MB/L', invoice.masterBl),
      nonEmpty('HB/L', invoice.houseBl),
      nonEmpty('BOE No.', invoice.boeNumber),
      nonEmpty('Commodity', invoice.commodity),
      nonEmpty('Gross Weight', invoice.grossWeight),
      nonEmpty('Volume', invoice.volume),
      nonEmpty('Packages', invoice.packages),
      nonEmpty('Shipper', invoice.shipperName),
      nonEmpty('Consignee', invoice.consigneeName),
    ].filter((r): r is KV => !!r);

    doc.fillColor(BRAND_RED).rect(jobX, y + 1, 2, 9).fill();
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8.5)
      .text('JOB DETAILS', jobX + 6, y, { width: colW - 6, characterSpacing: 1.2, lineBreak: false });
    const jobLabelW = 76;
    let jy = y + 16;
    const jobLineH = 13;
    jobRows.slice(0, 8).forEach((r) => {
      doc.fillColor(NAVY_SOFT).font('Helvetica-Bold').fontSize(8.5)
        .text(r.label, jobX, jy, { width: jobLabelW, lineBreak: false });
      doc.fillColor(TEXT).font('Helvetica').fontSize(9)
        .text(r.value, jobX + jobLabelW, jy, {
          width: colW - jobLabelW, lineBreak: false, ellipsis: true,
        });
      jy += jobLineH;
    });

    // Both columns must end at the same baseline
    const blockBottom = Math.max(y + 100, jy + 4);
    y = blockBottom;
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left, y).lineTo(right, y).stroke();
    y += 14;

    // ===================================================================
    //  ITEMS TABLE  (Description / Qty / Rate / VAT% / Amount / Remarks)
    // ===================================================================
    const cols = [
      { key: 'desc',    label: 'DESCRIPTION', w: fullW * 0.38, align: 'left' as const },
      { key: 'qty',     label: 'QTY',         w: fullW * 0.07, align: 'right' as const },
      { key: 'rate',    label: 'RATE',        w: fullW * 0.11, align: 'right' as const },
      { key: 'vat',     label: 'VAT %',       w: fullW * 0.07, align: 'right' as const },
      { key: 'amt',     label: 'AMOUNT',      w: fullW * 0.16, align: 'right' as const },
      { key: 'remarks', label: 'REMARKS',     w: fullW * 0.21, align: 'left' as const },
    ];
    const colX: number[] = [];
    {
      let x = left;
      for (const c of cols) { colX.push(x); x += c.w; }
    }

    const headRowH = 22;
    const rowH = 20;

    const FOOTER_BLOCK_H =
      // totals strip + amount-in-words + bank/payment + signature  + extra slack
      96 + 14 + 84 + 38 + 20;

    const drawTableHead = (yy: number) => {
      // Soft navy tinted background panel for the head row
      doc.fillColor(NAVY_TINT_2).rect(left, yy, fullW, headRowH).fill();
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8);
      cols.forEach((c, i) => {
        doc.text(c.label, colX[i] + 4, yy + 7, {
          width: c.w - 8, align: c.align, characterSpacing: 0.8, lineBreak: false,
        });
      });
      // Bold navy underline beneath the head
      doc.lineWidth(1).strokeColor(NAVY)
        .moveTo(left, yy + headRowH).lineTo(right, yy + headRowH).stroke();
    };

    drawTableHead(y);
    y += headRowH;

    // Plan how many items each page receives. The trick: the footer reserve
    // only applies to the LAST page (it doesn't render on earlier pages), so
    // page 1 can pack items up to the full page height when more pages will
    // follow. We pre-compute break points up-front so the per-row loop is
    // dumb.
    const items = invoice.items;
    const pageCapFull = Math.max(1, Math.floor((contentBottom(doc) - CONTENT_TOP - headRowH) / rowH));
    const firstPageCapFull = Math.max(1, Math.floor((contentBottom(doc) - y) / rowH));
    const lastPageCapWithFooter = Math.max(1, Math.floor((contentBottom(doc) - CONTENT_TOP - headRowH - FOOTER_BLOCK_H) / rowH));
    const firstPageCapWithFooter = Math.max(1, Math.floor((contentBottom(doc) - y - FOOTER_BLOCK_H) / rowH));

    const breakAfter = new Set<number>(); // 0-based item indices after which to add a page
    let footerOnNewPage = false;          // page-break ONCE more after items finish

    if (items.length > firstPageCapWithFooter) {
      // Multi-page invoice. The user's #1 ask is "fill page 1" — so we pack
      // page 1 to its full capacity (no footer reserve) and accept the
      // footer landing on a fresh sheet if it doesn't fit below the items.
      if (items.length <= firstPageCapFull) {
        // All items fit on page 1; just push the footer to a new page.
        footerOnNewPage = true;
      } else {
        // Items overflow page 1 → continuation pages are needed.
        let cursor = firstPageCapFull;
        breakAfter.add(cursor - 1);
        let remaining = items.length - cursor;
        while (remaining > lastPageCapWithFooter) {
          const take = Math.min(remaining, pageCapFull);
          cursor += take;
          breakAfter.add(cursor - 1);
          remaining -= take;
        }
        if (remaining === 0) {
          footerOnNewPage = true;
        }
      }
    }

    items.forEach((it, idx) => {
      // Hard fallback: still page-break if a row genuinely won't fit
      if (y + rowH > contentBottom(doc)) {
        doc.addPage();
        y = CONTENT_TOP;
        drawTableHead(y);
        y += headRowH;
      }
      // Subtle alternating row background for readability
      if (idx % 2 === 1) {
        doc.rect(left, y, fullW, rowH).fillColor(ROW_ALT).fill();
      }
      const vatPct = it.vatPercent ?? 0;
      const remarks = inline(it.remarks);
      const cells = [
        { v: it.description,                 font: 'Helvetica',      color: TEXT },
        { v: String(it.quantity),            font: 'Helvetica',      color: TEXT },
        { v: fmtNum(it.unitPrice),           font: 'Helvetica',      color: TEXT },
        { v: vatPct ? fmtNum(vatPct) : '—',  font: 'Helvetica',      color: vatPct ? TEXT : SUBTLE },
        { v: fmtNum(it.amount),              font: 'Helvetica-Bold', color: NAVY },
        // Remarks render italic & muted so the line still reads "amount-led"
        // but the side note is clearly visible on the right.
        { v: remarks,                        font: 'Helvetica-Oblique', color: MUTED },
      ];
      doc.fontSize(10);
      cells.forEach((cell, i) => {
        doc.font(cell.font).fillColor(cell.color);
        doc.text(cell.v, colX[i] + (cols[i].align === 'left' ? 4 : 0), y + 6, {
          width: cols[i].w - (cols[i].align === 'left' ? 8 : 4),
          align: cols[i].align,
          lineBreak: false,
          ellipsis: true,
        });
      });
      y += rowH;

      // Planned page break (from layout planner above). Skip break after the
      // very last item — footer renders next, in flow.
      if (breakAfter.has(idx) && idx !== items.length - 1) {
        doc.addPage();
        y = CONTENT_TOP;
        drawTableHead(y);
        y += headRowH;
      }
    });

    // Helper: open a fresh page if `needed` pts won't fit on the current
    // page. Used before bank/signature/disclaimer so a stray text() never
    // lands in the brand footer band.
    const ensureSpace = (needed: number) => {
      if (y + needed > contentBottom(doc)) {
        doc.addPage();
        y = CONTENT_TOP;
      }
    };
    void ensureSpace; // kept for emergency use; footer block reserves space up-front now

    void footerOnNewPage; // kept for backward compatibility; no longer triggers a page break

    // === Compute the entire footer block height up front ================
    // pdfkit auto-paginates the moment our cursor crosses contentBottom, so
    // if we let multiple footer text() calls happen one-by-one near the end
    // of the page each of them spawns its own near-empty page (the symptom
    // the user reported: amount-in-words alone on page 2, bank alone on
    // page 3). Pre-computing the total height lets us decide ONCE whether
    // the footer fits below the items or has to start on a fresh sheet,
    // and then we render every section in sequence with no further breaks.
    const _bankRowsForHeight: KV[] = [
      nonEmpty('Bank', invoice.bankName),
      nonEmpty('Address', invoice.bankAddress),
      nonEmpty('Account', invoice.accountName),
      nonEmpty('A/C No.', invoice.accountNumber),
      nonEmpty('IBAN', invoice.iban),
      nonEmpty('SWIFT', invoice.swiftCode),
    ].filter((r): r is KV => !!r);
    const _showPayment = !!invoice.paymentTerms;
    const _showBank = _bankRowsForHeight.length > 0;
    const _bankBlockH = (_showPayment || _showBank)
      ? (14 /* labels */ + Math.max(_showPayment ? 14 : 0, _bankRowsForHeight.length * 12) + 12 /* slack */)
      : 0;
    const _totalsRowsH = 16
      + (invoice.taxAmount > 0 ? 16 : 0)
      + (invoice.shippingCost > 0 ? 16 : 0);
    const _amountWordsH = invoice.amountInWords ? 22 : 18;
    const FOOTER_TOTAL_H =
      14   /* closing rule */ +
      _totalsRowsH + 2 + 26 + 6 + 22 + 6 /* TOTAL DUE panel */ +
      _amountWordsH +
      14   /* divider */ +
      _bankBlockH +
      12 + 14 + 16 /* signature: divider + label + sig area */ +
      36 + 28 /* disclaimer: gap + two lines */;

    // If the entire footer doesn't fit below the items, start a fresh page.
    if (y + FOOTER_TOTAL_H > contentBottom(doc)) {
      doc.addPage();
      y = CONTENT_TOP;
    }

    // Closing rule under the table
    doc.lineWidth(0.6).strokeColor(DIVIDER)
      .moveTo(left, y).lineTo(right, y).stroke();
    y += 14;

    // ===================================================================
    //  TOTALS  (right-aligned card) — renders inline after items
    // ===================================================================
    const totalsW = fullW * 0.42;
    const totalsX = right - totalsW;

    const drawTotalsRow = (label: string, value: string, opts?: { strong?: boolean; gap?: number }) => {
      const strong = !!opts?.strong;
      const fontSize = strong ? 12 : 9.5;
      doc.fillColor(strong ? NAVY : MUTED).font('Helvetica').fontSize(strong ? 9.5 : 9.5)
        .text(label, totalsX, y + (strong ? 2 : 0), {
          width: totalsW * 0.55, lineBreak: false,
        });
      doc.fillColor(strong ? NAVY : TEXT).font('Helvetica-Bold').fontSize(fontSize)
        .text(value, totalsX + totalsW * 0.55, y, {
          width: totalsW * 0.45, align: 'right', lineBreak: false,
        });
      y += opts?.gap ?? (strong ? 22 : 16);
    };

    drawTotalsRow('Subtotal', `${invoice.currency} ${fmtNum(invoice.subtotal)}`);
    if (invoice.taxAmount > 0) {
      drawTotalsRow(`VAT${invoice.taxRate ? ` (${invoice.taxRate}%)` : ''}`,
        `${invoice.currency} ${fmtNum(invoice.taxAmount)}`);
    }
    if (invoice.shippingCost > 0) {
      drawTotalsRow('Shipping', `${invoice.currency} ${fmtNum(invoice.shippingCost)}`);
    }
    // Emphasized Total — navy tinted background panel + bigger font
    y += 2;
    doc.fillColor(NAVY_TINT).rect(totalsX - 6, y, totalsW + 6, 26).fill();
    doc.lineWidth(0.7).strokeColor(NAVY).moveTo(totalsX - 6, y).lineTo(right, y).stroke();
    doc.lineWidth(0.7).strokeColor(NAVY).moveTo(totalsX - 6, y + 26).lineTo(right, y + 26).stroke();
    y += 6;
    drawTotalsRow('TOTAL DUE', `${invoice.currency} ${fmtNum(invoice.total)}`, { strong: true });
    y += 6;

    // Amount in words — italic muted, with a soft tint panel and a navy
    // left bar so it reads as a single distinct callout.
    if (invoice.amountInWords) {
      const wordsW = fullW * 0.58;
      const wordsH = 22;
      doc.fillColor(NAVY_TINT_2).rect(left, y - 4, wordsW, wordsH).fill();
      doc.fillColor(NAVY).rect(left, y - 4, 2.5, wordsH).fill();
      doc.fillColor(NAVY_SOFT).font('Helvetica-Oblique').fontSize(9)
        .text(invoice.amountInWords, left + 8, y + 1, {
          width: wordsW - 12, lineBreak: false, ellipsis: true,
        });
      y += wordsH;
    } else {
      y += 18;
    }
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left, y).lineTo(right, y).stroke();
    y += 14;

    // ===================================================================
    //  PAYMENT TERMS  +  BANK DETAILS  (two columns, only if data exists)
    // ===================================================================
    const bankRows: KV[] = [
      nonEmpty('Bank', invoice.bankName),
      nonEmpty('Address', invoice.bankAddress),
      nonEmpty('Account', invoice.accountName),
      nonEmpty('A/C No.', invoice.accountNumber),
      nonEmpty('IBAN', invoice.iban),
      nonEmpty('SWIFT', invoice.swiftCode),
    ].filter((r): r is KV => !!r);

    const showPayment = !!invoice.paymentTerms;
    const showBank = bankRows.length > 0;

    if (showPayment || showBank) {
      // Left: Payment Terms · Right: Bank Details
      const leftColW = colW;
      const rightColW = colW;

      // (Footer height was reserved up-front, so no ensureSpace here.)

      doc.fillColor(BRAND_RED).rect(billX, y + 1, 2, 9).fill();
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8.5)
        .text('PAYMENT TERMS', billX + 6, y, { width: leftColW - 6, characterSpacing: 1.2, lineBreak: false });
      doc.fillColor(BRAND_RED).rect(jobX, y + 1, 2, 9).fill();
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8.5)
        .text('BANK DETAILS', jobX + 6, y, { width: rightColW - 6, characterSpacing: 1.2, lineBreak: false });

      let py = y + 14;

      if (showPayment) {
        doc.fillColor(TEXT).font('Helvetica').fontSize(10)
          .text(invoice.paymentTerms!, billX, py, {
            width: leftColW, lineBreak: false, ellipsis: true,
          });
      } else {
        doc.fillColor(SUBTLE).font('Helvetica-Oblique').fontSize(9)
          .text('—', billX, py, { width: leftColW, lineBreak: false });
      }

      let by = y + 14;
      const bankLabelW = 60;
      bankRows.forEach((r) => {
        doc.fillColor(NAVY_SOFT).font('Helvetica-Bold').fontSize(8.5)
          .text(r.label, jobX, by, { width: bankLabelW, lineBreak: false });
        doc.fillColor(TEXT).font('Helvetica').fontSize(8.5)
          .text(r.value, jobX + bankLabelW, by, {
            width: rightColW - bankLabelW, lineBreak: false, ellipsis: true,
          });
        by += 12;
      });

      y = Math.max(py + 18, by + 6);
    }

    // ===================================================================
    //  SIGNATURE  ·  Prepared / Approved
    // ===================================================================
    // (Footer height was reserved up-front, so no ensureSpace here.)
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left, y).lineTo(right, y).stroke();
    y += 12;
    doc.fillColor(BRAND_RED).rect(left, y + 1, 2, 9).fill();
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9)
      .text(`FOR ${invoice.shipFromName.toUpperCase()}`, left + 6, y, {
        width: fullW - 6, characterSpacing: 1.2, lineBreak: false, ellipsis: true,
      });
    y += 14;
    const sigW = (fullW - colGap) / 2;
    doc.lineWidth(0.5).strokeColor(NAVY_SOFT)
      .moveTo(left, y + 14).lineTo(left + sigW, y + 14).stroke();
    doc.moveTo(left + sigW + colGap, y + 14).lineTo(right, y + 14).stroke();
    doc.fillColor(NAVY_SOFT).font('Helvetica-Bold').fontSize(8.5)
      .text('Prepared By', left, y + 16, { width: sigW, lineBreak: false })
      .text('Approved By', left + sigW + colGap, y + 16, { width: sigW, lineBreak: false });

    // ===================================================================
    //  DISCLAIMER  ·  fine-print at the very bottom
    // ===================================================================
    y += 36;
    // (Footer height was reserved up-front, so no ensureSpace here.)
    // Soft tint band for the disclaimer so it visually closes off the page
    doc.fillColor(NAVY_TINT_2).rect(left, y - 3, fullW, 26).fill();
    doc.fillColor(NAVY_SOFT).font('Helvetica').fontSize(8.5)
      .text(
        'In case of any discrepancy in the invoice, kindly inform immediately or within seven days.',
        left, y,
        { width: fullW, align: 'center', lineBreak: false, ellipsis: true },
      );
    y += 12;
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8)
      .text(
        'This is a computer-generated document and does not require a signature.',
        left, y,
        { width: fullW, align: 'center', lineBreak: false, ellipsis: true },
      );

    doc.end();
  });
}
