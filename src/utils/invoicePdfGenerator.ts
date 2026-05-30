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
  customerTrn?: string | null;
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
const NAVY_TINT = '#eef2f7';   // very light navy panel background
const NAVY_TINT_2 = '#f4f7fb'; // even softer navy tint (table head, words box)
const ROW_ALT = '#fafbfc';
const WHITE = '#ffffff';
void NAVY_TINT;

const fmtNum = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

// Reference AED conversion rates. AED is pegged to USD at 3.6725 by the
// UAE Central Bank (fixed peg — that IS the latest rate). Other rates are
// reasonable defaults; swap to a live feed if needed.
const AED_RATES: Record<string, number> = {
  USD: 3.6725,
  EUR: 4.00,
  GBP: 4.70,
  SAR: 0.98,
  INR: 0.044,
  CAD: 2.70,
  AUD: 2.40,
  JPY: 0.025,
};
function toAed(amount: number, currency: string): number | null {
  const cur = (currency || '').toUpperCase();
  if (cur === 'AED') return null;
  const rate = AED_RATES[cur];
  if (!rate) return null;
  return Math.round(amount * rate * 100) / 100;
}

interface KV { label: string; value: string }
function nonEmpty(label: string, value: string | null | undefined): KV | null {
  const v = inline(value);
  return v ? { label, value: v } : null;
}

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
    const trnValue = invoice.companyTrn || '105413106300003';
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10.5)
      .text(`TRN: ${trnValue}`, left, y + 34, {
        width: fullW * 0.6, lineBreak: false,
      });

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
    doc.fillColor(BRAND_RED).circle(left + 3, y, 2.6).fill();
    doc.lineWidth(2.5).strokeColor(NAVY).moveTo(left + 10, y).lineTo(left + 86, y).stroke();
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left + 92, y).lineTo(right, y).stroke();
    y += 18;

    // ===================================================================
    //  BILL TO  +  JOB DETAILS
    // ===================================================================
    const colGap = 24;
    const colW = (fullW - colGap) / 2;
    const billX = left;
    const jobX = left + colW + colGap;

    doc.fillColor(BRAND_RED).rect(billX, y + 1, 2, 9).fill();
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8.5)
      .text('BILL TO', billX + 6, y, { width: colW - 6, characterSpacing: 1.2, lineBreak: false });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12)
      .text(inline(invoice.billToName), billX, y + 14, { width: colW, lineBreak: false, ellipsis: true });
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
      billLine += 12;
    }
    if (invoice.customerTrn) {
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9.5)
        .text(`TRN: ${inline(invoice.customerTrn)}`, billX, y + billLine, { width: colW, lineBreak: false, ellipsis: true });
      billLine += 12;
    }

    const jobRows: KV[] = [
      nonEmpty('Job No', invoice.jobNo ?? invoice.orderRef?.orderNumber ?? ''),
      nonEmpty('Customer Ref', invoice.customerRef ?? ''),
      nonEmpty('Origin', invoice.originPort),
      nonEmpty('Destination', invoice.destPort),
      nonEmpty('Volume', invoice.volume),
      nonEmpty('Gross Weight', invoice.grossWeight),
      nonEmpty('Packages', invoice.packages),
      nonEmpty('Commodity', invoice.commodity),
      nonEmpty('MB/L', invoice.masterBl),
      nonEmpty('HB/L', invoice.houseBl),
      nonEmpty('BOE No.', invoice.boeNumber),
      nonEmpty('Shipper', invoice.shipperName),
      nonEmpty('Consignee', invoice.consigneeName),
    ].filter((r): r is KV => !!r);

    doc.fillColor(BRAND_RED).rect(jobX, y + 1, 2, 9).fill();
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8.5)
      .text('JOB DETAILS', jobX + 6, y, { width: colW - 6, characterSpacing: 1.2, lineBreak: false });
    const jobLabelW = 76;
    let jy = y + 16;
    const jobLineH = 13;
    jobRows.slice(0, 10).forEach((r) => {
      doc.fillColor(NAVY_SOFT).font('Helvetica-Bold').fontSize(8.5)
        .text(r.label, jobX, jy, { width: jobLabelW, lineBreak: false });
      doc.fillColor(TEXT).font('Helvetica').fontSize(9)
        .text(r.value, jobX + jobLabelW, jy, {
          width: colW - jobLabelW, lineBreak: false, ellipsis: true,
        });
      jy += jobLineH;
    });

    const blockBottom = Math.max(y + 116, jy + 4);
    y = blockBottom;
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left, y).lineTo(right, y).stroke();
    y += 14;

    // ===================================================================
    //  ITEMS TABLE
    // ===================================================================
    const cols = [
      { key: 'desc',    label: 'DESCRIPTION', w: fullW * 0.32, align: 'left' as const },
      { key: 'qty',     label: 'QTY',         w: fullW * 0.06, align: 'right' as const },
      { key: 'rate',    label: 'RATE',        w: fullW * 0.10, align: 'right' as const },
      { key: 'vat',     label: 'VAT%',        w: fullW * 0.07, align: 'right' as const },
      { key: 'vatAmt',  label: 'VAT AMT',     w: fullW * 0.10, align: 'right' as const },
      { key: 'amt',     label: 'AMOUNT',      w: fullW * 0.14, align: 'right' as const },
      { key: 'remarks', label: 'REMARKS',     w: fullW * 0.21, align: 'left' as const },
    ];
    const colX: number[] = [];
    {
      let x = left;
      for (const c of cols) { colX.push(x); x += c.w; }
    }

    const headRowH = 22;
    const rowH = 20;

    // Reserve roughly the footer height (totals + bank + signature)
    // so item-row pagination doesn't push the footer block into the
    // brand band on long invoices.
    const FOOTER_BLOCK_H = 96 + 14 + 84 + 38 + 20
      + ((toAed(invoice.total, invoice.currency) !== null) ? 46 : 0);

    const drawTableHead = (yy: number) => {
      doc.fillColor(NAVY_TINT_2).rect(left, yy, fullW, headRowH).fill();
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8);
      cols.forEach((c, i) => {
        doc.text(c.label, colX[i] + 4, yy + 7, {
          width: c.w - 8, align: c.align, characterSpacing: 0.4, lineBreak: false,
        });
      });
      doc.lineWidth(1).strokeColor(NAVY)
        .moveTo(left, yy + headRowH).lineTo(right, yy + headRowH).stroke();
    };

    drawTableHead(y);
    y += headRowH;

    const items = invoice.items;
    const pageCapFull = Math.max(1, Math.floor((contentBottom(doc) - CONTENT_TOP - headRowH) / rowH));
    const firstPageCapFull = Math.max(1, Math.floor((contentBottom(doc) - y) / rowH));
    const lastPageCapWithFooter = Math.max(1, Math.floor((contentBottom(doc) - CONTENT_TOP - headRowH - FOOTER_BLOCK_H) / rowH));
    const firstPageCapWithFooter = Math.max(1, Math.floor((contentBottom(doc) - y - FOOTER_BLOCK_H) / rowH));

    const breakAfter = new Set<number>();
    let footerOnNewPage = false;

    if (items.length > firstPageCapWithFooter) {
      if (items.length <= firstPageCapFull) {
        footerOnNewPage = true;
      } else {
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
      if (y + rowH > contentBottom(doc)) {
        doc.addPage();
        y = CONTENT_TOP;
        drawTableHead(y);
        y += headRowH;
      }
      if (idx % 2 === 1) {
        doc.rect(left, y, fullW, rowH).fillColor(ROW_ALT).fill();
      }
      const vatPct = it.vatPercent ?? 0;
      const vatAmt = it.vatAmount ?? (vatPct ? (it.amount * vatPct) / 100 : 0);
      const remarks = inline(it.remarks);
      const cells = [
        { v: it.description,                 font: 'Helvetica',         color: TEXT },
        { v: String(it.quantity),            font: 'Helvetica',         color: TEXT },
        { v: fmtNum(it.unitPrice),           font: 'Helvetica',         color: TEXT },
        { v: fmtNum(vatPct),                 font: 'Helvetica',         color: vatPct ? TEXT : SUBTLE },
        { v: fmtNum(vatAmt),                 font: 'Helvetica',         color: vatAmt ? TEXT : SUBTLE },
        { v: fmtNum(it.amount),              font: 'Helvetica-Bold',    color: NAVY },
        { v: remarks,                        font: 'Helvetica-Oblique', color: MUTED },
      ];
      doc.fontSize(9.5);
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

      if (breakAfter.has(idx) && idx !== items.length - 1) {
        doc.addPage();
        y = CONTENT_TOP;
        drawTableHead(y);
        y += headRowH;
      }
    });
    void footerOnNewPage;

    // Footer height reservation — kept generous so the signature/disclaimer
    // never collides with the brand band at the bottom of the page.
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
      ? (14 + Math.max(_showPayment ? 14 : 0, _bankRowsForHeight.length * 12) + 12)
      : 0;
    const _aedHere = toAed(invoice.total, invoice.currency) !== null;
    const _totalsRowsH = 18 + 18 + (invoice.shippingCost > 0 ? 18 : 0);
    const _aedBlockH = _aedHere ? 46 : 0;
    const _amountWordsH = invoice.amountInWords ? 22 : 18;
    const FOOTER_TOTAL_H =
      14 +
      _totalsRowsH + 6 + 28 + _aedBlockH + 8 +
      _amountWordsH +
      14 +
      _bankBlockH +
      12 + 14 + 16 +
      36 + 28;

    if (y + FOOTER_TOTAL_H > contentBottom(doc)) {
      doc.addPage();
      y = CONTENT_TOP;
    }

    doc.lineWidth(0.6).strokeColor(DIVIDER)
      .moveTo(left, y).lineTo(right, y).stroke();
    y += 14;

    // ===================================================================
    //  TOTALS  ·  right-aligned panel, prominent navy TOTAL DUE band,
    //  single AED equivalent line below with reference rate.
    // ===================================================================
    const totalsW = fullW * 0.48;
    const totalsX = right - totalsW;
    const labelColW = totalsW * 0.50;
    const valueColW = totalsW * 0.50;

    const drawTotalsRow = (label: string, value: string) => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(10)
        .text(label, totalsX, y, { width: labelColW, lineBreak: false });
      doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(10)
        .text(value, totalsX + labelColW, y, {
          width: valueColW, align: 'right', lineBreak: false,
        });
      y += 18;
    };

    drawTotalsRow('Subtotal', `${invoice.currency} ${fmtNum(invoice.subtotal)}`);
    drawTotalsRow(
      `VAT${invoice.taxRate ? ` (${invoice.taxRate}%)` : ' (0%)'}`,
      `${invoice.currency} ${fmtNum(invoice.taxAmount)}`,
    );
    if (invoice.shippingCost > 0) {
      drawTotalsRow('Shipping', `${invoice.currency} ${fmtNum(invoice.shippingCost)}`);
    }

    // Thin divider before TOTAL DUE band.
    doc.lineWidth(0.6).strokeColor(DIVIDER)
      .moveTo(totalsX, y - 2).lineTo(right, y - 2).stroke();
    y += 6;

    // TOTAL DUE — solid navy band, white bold text. Unmistakable.
    const totalBandH = 28;
    doc.fillColor(NAVY).rect(totalsX - 8, y, totalsW + 8, totalBandH).fill();
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(10.5)
      .text('TOTAL DUE', totalsX, y + 10, {
        width: labelColW, characterSpacing: 1.4, lineBreak: false,
      });
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(13)
      .text(`${invoice.currency} ${fmtNum(invoice.total)}`,
        totalsX + labelColW, y + 8, {
          width: valueColW, align: 'right', lineBreak: false,
        });
    y += totalBandH;

    // AED equivalent — single line beneath the TOTAL band when the invoice
    // is in a non-AED currency. Shows the converted amount and the
    // reference rate so the recipient sees exactly how it was calculated.
    const aedTotal = toAed(invoice.total, invoice.currency);
    if (aedTotal !== null) {
      const rate = AED_RATES[invoice.currency.toUpperCase()];
      y += 8;
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
        .text('Equivalent in AED', totalsX, y, {
          width: labelColW, lineBreak: false,
        });
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11)
        .text(`AED ${fmtNum(aedTotal)}`,
          totalsX + labelColW, y - 1, {
            width: valueColW, align: 'right', lineBreak: false,
          });
      y += 14;
      doc.fillColor(SUBTLE).font('Helvetica-Oblique').fontSize(8)
        .text(`Rate: 1 ${invoice.currency.toUpperCase()} = ${rate} AED`,
          totalsX, y, {
            width: totalsW, align: 'right', lineBreak: false,
          });
      y += 12;
    }
    y += 8;

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
    //  PAYMENT TERMS  +  BANK DETAILS
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
      const leftColW = colW;
      const rightColW = colW;

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
          .text('-', billX, py, { width: leftColW, lineBreak: false });
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
    //  SIGNATURE
    // ===================================================================
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
    //  DISCLAIMER
    // ===================================================================
    y += 36;
    doc.fillColor(NAVY_TINT_2).rect(left, y - 3, fullW, 26).fill();
    doc.fillColor(NAVY_SOFT).font('Helvetica').fontSize(8.5)
      .text(
        'In case of any discrepancy in the invoice, kindly inform immediately or within 24hrs.',
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
