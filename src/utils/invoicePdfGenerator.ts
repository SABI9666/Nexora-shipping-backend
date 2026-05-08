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

// Palette — modern, restrained
const NAVY = '#0a1628';
const TEXT = '#0f172a';
const MUTED = '#64748b';
const SUBTLE = '#94a3b8';
const DIVIDER = '#e2e8f0';
const ACCENT_BG = '#f8fafc';
const ROW_ALT = '#fafbfc';

const fmtNum = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

interface KV { label: string; value: string }
function nonEmpty(label: string, value: string | null | undefined): KV | null {
  const v = (value ?? '').toString().trim();
  return v ? { label, value: v } : null;
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
    // Top accent rule
    doc.lineWidth(2).strokeColor(NAVY).moveTo(left, y).lineTo(left + 60, y).stroke();
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left + 64, y).lineTo(right, y).stroke();
    y += 18;

    // ===================================================================
    //  BILL TO  +  JOB DETAILS  (two columns)
    // ===================================================================
    const colGap = 24;
    const colW = (fullW - colGap) / 2;
    const billX = left;
    const jobX = left + colW + colGap;

    // BILL TO
    doc.fillColor(SUBTLE).font('Helvetica-Bold').fontSize(8)
      .text('BILL TO', billX, y, { width: colW, characterSpacing: 1, lineBreak: false });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12)
      .text(invoice.billToName, billX, y + 14, { width: colW, lineBreak: false, ellipsis: true });
    doc.fillColor(TEXT).font('Helvetica').fontSize(9.5)
      .text(invoice.billToAddress, billX, y + 32, { width: colW, lineBreak: false, ellipsis: true });
    const cityCountry = [invoice.billToCity, invoice.billToCountry].filter(Boolean).join(', ');
    if (cityCountry) {
      doc.text(cityCountry, billX, y + 46, { width: colW, lineBreak: false, ellipsis: true });
    }
    let billLine = 60;
    if (invoice.billToEmail) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
        .text(invoice.billToEmail, billX, y + billLine, { width: colW, lineBreak: false, ellipsis: true });
      billLine += 12;
    }
    if (invoice.billToPhone) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
        .text(invoice.billToPhone, billX, y + billLine, { width: colW, lineBreak: false, ellipsis: true });
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

    doc.fillColor(SUBTLE).font('Helvetica-Bold').fontSize(8)
      .text('JOB DETAILS', jobX, y, { width: colW, characterSpacing: 1, lineBreak: false });
    const jobLabelW = 76;
    let jy = y + 16;
    const jobLineH = 13;
    jobRows.slice(0, 8).forEach((r) => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
        .text(r.label, jobX, jy, { width: jobLabelW, lineBreak: false });
      doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(9)
        .text(r.value, jobX + jobLabelW, jy, {
          width: colW - jobLabelW, lineBreak: false, ellipsis: true,
        });
      jy += jobLineH;
    });

    // Both columns must end at the same baseline
    const blockBottom = Math.max(y + 80, jy + 4);
    y = blockBottom;
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left, y).lineTo(right, y).stroke();
    y += 14;

    // ===================================================================
    //  ITEMS TABLE  (Description / Qty / Rate / VAT% / Amount)
    // ===================================================================
    const cols = [
      { key: 'desc', label: 'DESCRIPTION', w: fullW * 0.50, align: 'left' as const },
      { key: 'qty', label: 'QTY', w: fullW * 0.08, align: 'right' as const },
      { key: 'rate', label: 'RATE', w: fullW * 0.13, align: 'right' as const },
      { key: 'vat', label: 'VAT %', w: fullW * 0.09, align: 'right' as const },
      { key: 'amt', label: 'AMOUNT', w: fullW * 0.20, align: 'right' as const },
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
      doc.fillColor(SUBTLE).font('Helvetica-Bold').fontSize(8);
      cols.forEach((c, i) => {
        doc.text(c.label, colX[i] + (c.align === 'left' ? 0 : 0), yy + 7, {
          width: c.w, align: c.align, characterSpacing: 0.6, lineBreak: false,
        });
      });
      doc.lineWidth(0.7).strokeColor(NAVY)
        .moveTo(left, yy + headRowH).lineTo(right, yy + headRowH).stroke();
    };

    drawTableHead(y);
    y += headRowH;

    // Plan how many items each page receives. Goal: avoid the empty-bottom-of-
    // page-1 problem by filling each page completely except the last, which
    // also has to fit the totals/bank/signature footer. The split is computed
    // up-front so the per-row loop just reads from `pageBreaks`.
    const items = invoice.items;
    const pageCapFull = Math.max(1, Math.floor((contentBottom(doc) - CONTENT_TOP - headRowH) / rowH));
    const firstPageCapFull = Math.max(1, Math.floor((contentBottom(doc) - y - 0) / rowH));
    const lastPageCapWithFooter = Math.max(1, Math.floor((contentBottom(doc) - CONTENT_TOP - headRowH - FOOTER_BLOCK_H) / rowH));
    const firstPageCapWithFooter = Math.max(1, Math.floor((contentBottom(doc) - y - FOOTER_BLOCK_H) / rowH));

    const breakAfter = new Set<number>(); // 0-based item indices after which to add a page

    if (items.length <= firstPageCapWithFooter) {
      // Everything (items + footer) fits on a single page.
    } else {
      // Multi-page invoice. Fill page 1 to first-page full capacity, then
      // continuation pages, and ensure the LAST page has at least 3 items
      // alongside the footer (avoids a near-empty footer-only page).
      let placed = 0;
      let onPage = 0;
      const pages: number[] = [];
      pages.push(Math.min(items.length, firstPageCapFull));
      placed += pages[0];
      while (placed < items.length) {
        const remaining = items.length - placed;
        if (remaining <= lastPageCapWithFooter) {
          pages.push(remaining);
          placed += remaining;
          break;
        }
        const take = Math.min(remaining, pageCapFull);
        pages.push(take);
        placed += take;
      }
      // If last page got 0 items (footer alone), borrow 3 from previous page.
      if (pages[pages.length - 1] === 0 && pages.length >= 2) {
        const borrow = Math.min(3, pages[pages.length - 2]);
        pages[pages.length - 2] -= borrow;
        pages[pages.length - 1] = borrow;
      }
      // Translate page sizes to break-after indices.
      let cursor = 0;
      for (let p = 0; p < pages.length - 1; p++) {
        cursor += pages[p];
        breakAfter.add(cursor - 1);
      }
      void onPage;
    }

    items.forEach((it, idx) => {
      // Hard fallback: still page-break if the row genuinely won't fit
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
      const cells = [
        it.description,
        String(it.quantity),
        fmtNum(it.unitPrice),
        vatPct ? fmtNum(vatPct) : '—',
        fmtNum(it.amount),
      ];
      doc.fillColor(TEXT).font('Helvetica').fontSize(10);
      cells.forEach((v, i) => {
        const isAmount = i === cells.length - 1;
        doc.font(isAmount ? 'Helvetica-Bold' : 'Helvetica').fillColor(isAmount ? NAVY : TEXT);
        doc.text(v, colX[i], y + 6, {
          width: cols[i].w, align: cols[i].align, lineBreak: false, ellipsis: true,
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

    // Closing rule under the table
    doc.lineWidth(0.6).strokeColor(DIVIDER)
      .moveTo(left, y).lineTo(right, y).stroke();
    y += 14;

    // ===================================================================
    //  TOTALS  (right-aligned card)
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
    // Emphasized Total — top divider + bigger font
    doc.lineWidth(1).strokeColor(NAVY)
      .moveTo(totalsX, y - 2).lineTo(right, y - 2).stroke();
    y += 4;
    drawTotalsRow('TOTAL DUE', `${invoice.currency} ${fmtNum(invoice.total)}`, { strong: true });

    // Amount in words
    if (invoice.amountInWords) {
      doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(9)
        .text(invoice.amountInWords, left, y, {
          width: fullW * 0.55, lineBreak: false, ellipsis: true,
        });
    }
    y += 18;
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

      doc.fillColor(SUBTLE).font('Helvetica-Bold').fontSize(8)
        .text('PAYMENT TERMS', billX, y, { width: leftColW, characterSpacing: 1, lineBreak: false });
      doc.fillColor(SUBTLE).font('Helvetica-Bold').fontSize(8)
        .text('BANK DETAILS', jobX, y, { width: rightColW, characterSpacing: 1, lineBreak: false });

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
        doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
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
    if (y + 38 > contentBottom(doc)) {
      // shouldn't happen with the FOOTER_BLOCK_H reserve; safety net only
      doc.addPage();
      y = CONTENT_TOP;
    }
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left, y).lineTo(right, y).stroke();
    y += 12;
    doc.fillColor(SUBTLE).font('Helvetica-Bold').fontSize(8)
      .text(`FOR ${invoice.shipFromName.toUpperCase()}`, left, y, {
        width: fullW, characterSpacing: 1, lineBreak: false, ellipsis: true,
      });
    y += 14;
    const sigW = (fullW - colGap) / 2;
    doc.lineWidth(0.5).strokeColor(SUBTLE)
      .moveTo(left, y + 14).lineTo(left + sigW, y + 14).stroke();
    doc.moveTo(left + sigW + colGap, y + 14).lineTo(right, y + 14).stroke();
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
      .text('Prepared By', left, y + 16, { width: sigW, lineBreak: false })
      .text('Approved By', left + sigW + colGap, y + 16, { width: sigW, lineBreak: false });

    doc.end();
  });
}
