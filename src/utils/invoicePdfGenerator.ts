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

const NAVY = '#0a1628';
const TEXT = '#0f172a';
const GREY = '#475569';
const LIGHT = '#cbd5e1';
const HEAD_BG = '#e5e7eb';

const fmt = (n: number) => n.toFixed(2);
const fmtDate = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

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

    // ===== Header: INVOICE title + TRN (right-aligned) =====
    doc.fillColor(NAVY).font('Helvetica-BoldOblique').fontSize(20)
      .text('INVOICE', left, y, { align: 'right', width: fullW });
    if (invoice.companyTrn) {
      doc.fillColor(NAVY).font('Helvetica-Oblique').fontSize(11)
        .text(`TRN:${invoice.companyTrn}`, left, y + 24, { align: 'right', width: fullW });
    }

    // ===== Bill To + Invoice Meta (two-column box) =====
    y += 50;
    const billW = fullW * 0.55;
    const metaX = left + billW;
    const metaW = fullW - billW;
    const metaLabelW = 70;
    const metaValW = metaW - metaLabelW;

    const headerH = 70;
    // outer box
    doc.lineWidth(0.7).strokeColor(TEXT)
      .rect(left, y, fullW, headerH).stroke();
    // vertical splitter between bill-to and meta
    doc.moveTo(metaX, y).lineTo(metaX, y + headerH).stroke();

    // Bill-To content
    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(10)
      .text(invoice.billToName, left + 6, y + 6, { width: billW - 12 });
    doc.fillColor(TEXT).font('Helvetica').fontSize(9)
      .text(invoice.billToAddress, left + 6, y + 22, { width: billW - 12 })
      .text(`${invoice.billToCity}${invoice.billToCity && invoice.billToCountry ? ', ' : ''}${invoice.billToCountry}`,
            left + 6, y + 36, { width: billW - 12 });

    // Meta rows: Invoice No, Invoice Date, Currency, Job No
    const metaRowH = headerH / 4;
    const drawMetaRow = (idx: number, label: string, value: string) => {
      const ry = y + idx * metaRowH;
      if (idx > 0) doc.moveTo(metaX, ry).lineTo(right, ry).strokeColor(LIGHT).stroke();
      doc.moveTo(metaX + metaLabelW, ry).lineTo(metaX + metaLabelW, ry + metaRowH).strokeColor(LIGHT).stroke();
      doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(9)
        .text(label, metaX + 4, ry + 4, { width: metaLabelW - 6 });
      doc.fillColor(TEXT).font('Helvetica').fontSize(9)
        .text(value, metaX + metaLabelW + 4, ry + 4, { width: metaValW - 8 });
    };
    drawMetaRow(0, 'Invoice No', invoice.invoiceNumber);
    drawMetaRow(1, 'Invoice Date', fmtDate(invoice.invoiceDate));
    drawMetaRow(2, 'Currency', invoice.currency);
    drawMetaRow(3, 'Job No', invoice.jobNo ?? (invoice.orderRef?.orderNumber ?? ''));

    y += headerH;

    // ===== Shipment header strip =====
    const shipH = 70;
    doc.lineWidth(0.7).strokeColor(TEXT).rect(left, y, fullW, shipH).stroke();
    const colA = left + 6;
    const colB = left + fullW * 0.5 + 6;
    const labelW = 80;

    const drawShipPair = (col: number, idx: number, label: string, value: string) => {
      const ry = y + idx * 14 + 4;
      doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8.5)
        .text(label, col, ry, { width: labelW, continued: false });
      doc.fillColor(TEXT).font('Helvetica').fontSize(8.5)
        .text(': ' + (value || ''), col + labelW, ry);
    };

    drawShipPair(colA, 0, 'Origin/POR', invoice.originPort ?? '');
    drawShipPair(colA, 1, 'Dest Port', invoice.destPort ?? '');
    drawShipPair(colA, 2, 'MB/L', invoice.masterBl ?? '');
    drawShipPair(colA, 3, 'Commodity', invoice.commodity ?? '');
    drawShipPair(colA, 4, 'Gross Weight', invoice.grossWeight ?? '');

    drawShipPair(colB, 0, 'Shipper', invoice.shipperName ?? '');
    drawShipPair(colB, 1, 'Consignee', invoice.consigneeName ?? '');
    drawShipPair(colB, 2, 'HB/L', invoice.houseBl ?? '');
    drawShipPair(colB, 3, 'BOE No.', invoice.boeNumber ?? '');
    drawShipPair(colB, 4, 'Volume / Pkgs',
      `${invoice.volume ?? ''}${invoice.volume && invoice.packages ? '  ' : ''}${invoice.packages ? 'Packages: ' + invoice.packages : ''}`);

    y += shipH;

    // ===== Line items table =====
    // Columns (relative widths sum ~= fullW)
    const cols = [
      { key: 'desc', label: 'Charge Description', w: fullW * 0.27, align: 'left' as const },
      { key: 'qty', label: 'Qty', w: fullW * 0.05, align: 'right' as const },
      { key: 'rate', label: 'Rate', w: fullW * 0.08, align: 'right' as const },
      { key: 'amt', label: 'Amount', w: fullW * 0.09, align: 'right' as const },
      { key: 'cur', label: 'Curr', w: fullW * 0.05, align: 'center' as const },
      { key: 'ex', label: 'Ex Rate', w: fullW * 0.07, align: 'right' as const },
      { key: 'vp', label: 'Vat%', w: fullW * 0.06, align: 'right' as const },
      { key: 'va', label: 'VAT Amt', w: fullW * 0.08, align: 'right' as const },
      { key: 'tot', label: `Total ${invoice.currency}`, w: fullW * 0.10, align: 'right' as const },
      { key: 'rem', label: 'Remarks', w: fullW * 0.15, align: 'left' as const },
    ];
    const colX: number[] = [];
    {
      let x = left;
      for (const c of cols) { colX.push(x); x += c.w; }
    }

    // Tighter row metrics so up to ~25 lines fit on a single A4 page.
    const headRowH = 20;
    const rowH = 16;

    // Reserve enough space below the items table for the rest of the
    // invoice (cust-ref strip + totals + bank block + signature). The
    // numbers below mirror the heights drawn after the items loop.
    const TOTALS_STRIP_H = 16 * 3;       // 3 strips of 16pt
    const BANK_HEADER_H = 16;
    const BANK_BODY_H = 96;              // 6 rows × 16pt
    const SIG_HEADER_H = 16;
    const SIG_BODY_H = 28;
    const FOOTER_BLOCK_H =
      TOTALS_STRIP_H + BANK_HEADER_H + BANK_BODY_H + SIG_HEADER_H + SIG_BODY_H;

    const drawTableHead = (yy: number) => {
      doc.lineWidth(0.6).strokeColor(TEXT).rect(left, yy, fullW, headRowH).fillAndStroke(HEAD_BG, TEXT);
      doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8);
      cols.forEach((c, i) => {
        doc.text(c.label, colX[i] + 3, yy + 5, { width: c.w - 6, align: c.align });
        if (i > 0) doc.moveTo(colX[i], yy).lineTo(colX[i], yy + headRowH).strokeColor(TEXT).stroke();
      });
    };

    drawTableHead(y);
    let tableTopForBorders = y;
    y += headRowH;

    invoice.items.forEach((it) => {
      // Page-break only when this row genuinely won't fit ABOVE the reserved
      // footer block. With small invoices this never triggers and everything
      // stays on a single page.
      if (y + rowH > contentBottom(doc) - FOOTER_BLOCK_H) {
        // Close the body box on the page we're leaving
        doc.lineWidth(0.6).strokeColor(TEXT)
          .rect(left, tableTopForBorders, fullW, y - tableTopForBorders).stroke();
        cols.forEach((_c, i) => {
          if (i > 0) doc.moveTo(colX[i], tableTopForBorders).lineTo(colX[i], y).stroke();
        });
        doc.addPage();
        y = CONTENT_TOP;
        drawTableHead(y);
        tableTopForBorders = y;
        y += headRowH;
      }
      const ex = it.exchangeRate ?? 1;
      const vatPct = it.vatPercent ?? 0;
      const vat = it.vatAmount ?? 0;
      const totBase = it.totalInBase ?? (it.amount + vat) * ex;
      const cur = it.lineCurrency ?? invoice.currency;
      const cells = [
        it.description,
        String(it.quantity),
        fmt(it.unitPrice),
        fmt(it.amount),
        cur,
        ex.toFixed(3),
        fmt(vatPct),
        fmt(vat),
        fmt(totBase),
        it.remarks ?? '',
      ];
      doc.fillColor(TEXT).font('Helvetica').fontSize(8.5);
      cells.forEach((v, i) => {
        doc.text(v, colX[i] + 3, y + 3, { width: cols[i].w - 6, align: cols[i].align });
      });
      y += rowH;
    });

    // Pad the items area only enough to push the footer block to the page
    // bottom — never beyond. If the table is short, the footer rises so the
    // whole invoice still occupies one A4 page.
    const targetBodyBottom = contentBottom(doc) - FOOTER_BLOCK_H;
    if (y < targetBodyBottom) y = targetBodyBottom;

    // Border the entire body block
    doc.lineWidth(0.6).strokeColor(TEXT).rect(left, tableTopForBorders, fullW, y - tableTopForBorders).stroke();
    cols.forEach((_c, i) => {
      if (i > 0) doc.moveTo(colX[i], tableTopForBorders).lineTo(colX[i], y).stroke();
    });

    // ===== Cust Ref strip =====
    const refRowH = 16;
    doc.lineWidth(0.6).rect(left, y, fullW, refRowH).stroke();
    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8.5)
      .text(`Cust Ref: ${invoice.customerRef ?? `INV- ${invoice.invoiceNumber}`}`,
        left, y + 3, { width: fullW * 0.7, align: 'center' });
    // Right block: Net / Vat / Grand
    const totalsX = left + fullW * 0.7;
    const totalsLabelW = fullW * 0.18;
    const totalsValW = fullW - 0.7 * fullW - totalsLabelW;
    doc.moveTo(totalsX, y).lineTo(totalsX, y + refRowH).stroke();
    doc.moveTo(totalsX + totalsLabelW, y).lineTo(totalsX + totalsLabelW, y + refRowH).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT)
      .text('Net Amount', totalsX + 3, y + 3, { width: totalsLabelW - 6, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(9)
      .text(fmt(invoice.subtotal), totalsX + totalsLabelW + 3, y + 3, { width: totalsValW - 6, align: 'right' });
    y += refRowH;

    // VAT row
    doc.lineWidth(0.6).rect(left, y, fullW, refRowH).stroke();
    if (invoice.amountInWords) {
      doc.font('Helvetica').fontSize(8.5).fillColor(TEXT)
        .text(invoice.amountInWords, left, y + 3, { width: fullW * 0.7, align: 'center' });
    }
    doc.moveTo(totalsX, y).lineTo(totalsX, y + refRowH).stroke();
    doc.moveTo(totalsX + totalsLabelW, y).lineTo(totalsX + totalsLabelW, y + refRowH).stroke();
    doc.font('Helvetica-Bold').fontSize(9)
      .text('Vat Amount', totalsX + 3, y + 3, { width: totalsLabelW - 6, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(9)
      .text(invoice.taxAmount ? fmt(invoice.taxAmount) : '', totalsX + totalsLabelW + 3, y + 3,
        { width: totalsValW - 6, align: 'right' });
    y += refRowH;

    // Grand Total row
    doc.lineWidth(0.6).rect(left, y, fullW, refRowH).stroke();
    doc.moveTo(totalsX, y).lineTo(totalsX, y + refRowH).stroke();
    doc.moveTo(totalsX + totalsLabelW, y).lineTo(totalsX + totalsLabelW, y + refRowH).stroke();
    doc.font('Helvetica-Bold').fontSize(10)
      .text('Grand Total', totalsX + 3, y + 3, { width: totalsLabelW - 6, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(10)
      .text(fmt(invoice.total), totalsX + totalsLabelW + 3, y + 3, { width: totalsValW - 6, align: 'right' });
    y += refRowH;

    // ===== Bank Details / Payment Terms two-column block =====
    if (y + BANK_HEADER_H + BANK_BODY_H + SIG_HEADER_H + SIG_BODY_H > contentBottom(doc)) {
      doc.addPage();
      y = CONTENT_TOP;
    }
    const bankHeaderH = BANK_HEADER_H;
    const bankBodyH = BANK_BODY_H;
    doc.rect(left, y, fullW, bankHeaderH).fillAndStroke(HEAD_BG, TEXT);
    doc.moveTo(left + fullW / 2, y).lineTo(left + fullW / 2, y + bankHeaderH).stroke();
    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(10)
      .text('Bank Details', left, y + 3, { width: fullW / 2, align: 'center' });
    doc.text('Payment Terms', left + fullW / 2, y + 3, { width: fullW / 2, align: 'center' });
    y += bankHeaderH;

    doc.rect(left, y, fullW, bankBodyH).stroke();
    doc.moveTo(left + fullW / 2, y).lineTo(left + fullW / 2, y + bankBodyH).stroke();

    const bankRowH = BANK_BODY_H / 6; // = 16pt, matches reserved height
    const bankLabelW = 110;
    const bankRows: [string, string | null | undefined][] = [
      ['Bank Name', invoice.bankName],
      ['Bank Address', invoice.bankAddress],
      ['Account Name', invoice.accountName],
      ['Account Number', invoice.accountNumber],
      ['IBAN Number', invoice.iban],
      ['Swift Code', invoice.swiftCode],
    ];
    bankRows.forEach((r, i) => {
      const ry = y + i * bankRowH;
      if (i > 0) doc.moveTo(left, ry).lineTo(left + fullW / 2, ry).strokeColor(LIGHT).stroke();
      doc.moveTo(left + bankLabelW, ry).lineTo(left + bankLabelW, ry + bankRowH).strokeColor(LIGHT).stroke();
      doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(9)
        .text(r[0], left + 4, ry + 5, { width: bankLabelW - 6 });
      doc.fillColor(TEXT).font('Helvetica').fontSize(9)
        .text(r[1] ?? '', left + bankLabelW + 4, ry + 5, { width: fullW / 2 - bankLabelW - 8 });
    });

    if (invoice.paymentTerms) {
      doc.fillColor(TEXT).font('Helvetica').fontSize(9)
        .text(invoice.paymentTerms, left + fullW / 2 + 4, y + 4, { width: fullW / 2 - 8 });
    }

    y += bankBodyH;

    // ===== Footer signature block =====
    const sigHeaderH = SIG_HEADER_H;
    const sigBodyH = SIG_BODY_H;
    doc.rect(left, y, fullW, sigHeaderH).stroke();
    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(9)
      .text(`For ${invoice.shipFromName.toUpperCase()}`, left + 4, y + 4);
    y += sigHeaderH;

    doc.rect(left, y, fullW, sigBodyH).stroke();
    doc.moveTo(left + fullW / 2, y).lineTo(left + fullW / 2, y + sigBodyH).stroke();
    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(9)
      .text('Prepared By', left + 4, y + 4)
      .text('Approved By', left + fullW / 2 + 4, y + 4);

    // Notes (if any) below
    if (invoice.notes) {
      y += sigBodyH + 14;
      if (y + 30 > contentBottom(doc)) { doc.addPage(); y = CONTENT_TOP; }
      doc.fillColor(GREY).font('Helvetica-Bold').fontSize(8).text('NOTES', left, y);
      doc.fillColor(TEXT).font('Helvetica').fontSize(9)
        .text(invoice.notes, left, y + 12, { width: fullW });
    }

    doc.end();
  });
}
