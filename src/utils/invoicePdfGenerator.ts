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
const GREY = '#64748b';
const LIGHT = '#e2e8f0';
const ALT_ROW = '#fafbfc';
const HEAD_BG = '#f1f5f9';

const fmt = (n: number, currency: string) => `${currency} ${n.toFixed(2)}`;
const fmtDate = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

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
    const TOP = CONTENT_TOP;

    // Title block
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(18).text(invoice.shipFromName, left, TOP + 5);
    doc.fillColor(GREY).font('Helvetica').fontSize(9)
      .text(invoice.shipFromAddress, left, TOP + 28, { width: 280 })
      .text(`${invoice.shipFromCity}, ${invoice.shipFromCountry}`, left, TOP + 41);

    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(26)
      .text('INVOICE', left, TOP + 5, { align: 'right', width: fullW });
    doc.fillColor(GREY).font('Courier-Bold').fontSize(11)
      .text(invoice.invoiceNumber, left, TOP + 38, { align: 'right', width: fullW });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9)
      .text(invoice.status.toUpperCase(), left, TOP + 55, { align: 'right', width: fullW });

    doc.moveTo(left, TOP + 78).lineTo(right, TOP + 78).strokeColor(LIGHT).lineWidth(0.5).stroke();

    // Bill To + Meta
    const boxY = TOP + 92;
    const colW = (fullW - 20) / 2;
    const metaX = left + colW + 20;

    doc.fillColor(GREY).font('Helvetica-Bold').fontSize(8).text('BILL TO', left, boxY);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(invoice.billToName, left, boxY + 14, { width: colW });
    doc.fillColor(GREY).font('Helvetica').fontSize(9)
      .text(invoice.billToAddress, left, boxY + 30, { width: colW })
      .text(`${invoice.billToCity}, ${invoice.billToCountry}`, left, boxY + 44, { width: colW });
    let by = boxY + 60;
    if (invoice.billToEmail) { doc.text(invoice.billToEmail, left, by, { width: colW }); by += 12; }
    if (invoice.billToPhone) { doc.text(invoice.billToPhone, left, by, { width: colW }); }

    const halfMeta = colW / 2;
    let my = boxY;
    doc.fillColor(GREY).font('Helvetica-Bold').fontSize(8).text('INVOICE DATE', metaX, my);
    doc.fillColor(NAVY).font('Helvetica').fontSize(10).text(fmtDate(invoice.invoiceDate), metaX, my + 12);
    doc.fillColor(GREY).font('Helvetica-Bold').fontSize(8).text('DUE DATE', metaX + halfMeta, my);
    doc.fillColor(NAVY).font('Helvetica').fontSize(10).text(fmtDate(invoice.dueDate), metaX + halfMeta, my + 12);

    my += 36;
    doc.fillColor(GREY).font('Helvetica-Bold').fontSize(8).text('CURRENCY', metaX, my);
    doc.fillColor(NAVY).font('Helvetica').fontSize(10).text(invoice.currency, metaX, my + 12);
    if (invoice.paymentTerms) {
      doc.fillColor(GREY).font('Helvetica-Bold').fontSize(8).text('PAYMENT TERMS', metaX + halfMeta, my);
      doc.fillColor(NAVY).font('Helvetica').fontSize(10).text(invoice.paymentTerms, metaX + halfMeta, my + 12, { width: halfMeta });
    }

    let cursor = boxY + 110;
    if (invoice.orderRef?.orderNumber) {
      doc.fillColor(GREY).font('Helvetica').fontSize(9)
        .text('Linked to order: ', left, cursor, { continued: true })
        .fillColor(NAVY).font('Helvetica-Bold').text(invoice.orderRef.orderNumber);
      cursor += 18;
    }

    // Items table
    const tableTop = cursor + 10;
    const colQty = left + 290;
    const colUnit = left + 350;
    const rowH = 22;

    const drawTableHeader = (y: number) => {
      doc.rect(left, y, fullW, rowH).fill(HEAD_BG);
      doc.fillColor(GREY).font('Helvetica-Bold').fontSize(8)
        .text('DESCRIPTION', left + 6, y + 7)
        .text('QTY', colQty, y + 7, { width: 40, align: 'right' })
        .text('UNIT PRICE', colUnit, y + 7, { width: 70, align: 'right' })
        .text('AMOUNT', right - 86, y + 7, { width: 80, align: 'right' });
    };

    drawTableHeader(tableTop);
    let rowY = tableTop + rowH;

    invoice.items.forEach((item, i) => {
      // Auto-paginate so the table never overlaps the footer band
      if (rowY + rowH > contentBottom(doc)) {
        doc.addPage();
        rowY = CONTENT_TOP;
        drawTableHeader(rowY);
        rowY += rowH;
      }
      if (i % 2 === 1) doc.rect(left, rowY, fullW, rowH).fill(ALT_ROW);
      doc.fillColor(NAVY).font('Helvetica').fontSize(10)
        .text(item.description, left + 6, rowY + 6, { width: 280 })
        .text(String(item.quantity), colQty, rowY + 6, { width: 40, align: 'right' })
        .text(fmt(item.unitPrice, invoice.currency), colUnit, rowY + 6, { width: 70, align: 'right' })
        .font('Helvetica-Bold').text(fmt(item.amount, invoice.currency), right - 86, rowY + 6, { width: 80, align: 'right' });
      rowY += rowH;
    });
    doc.moveTo(left, rowY).lineTo(right, rowY).strokeColor(LIGHT).lineWidth(0.5).stroke();

    // Totals — break to a new page if there isn't room
    rowY += 15;
    if (rowY + 100 > contentBottom(doc)) {
      doc.addPage();
      rowY = CONTENT_TOP;
    }
    const labelX = right - 220;
    const valueX = right - 100;

    const totalRow = (label: string, value: string, bold = false) => {
      doc.fillColor(GREY).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 10)
        .text(label, labelX, rowY, { width: 110, align: 'right' });
      doc.fillColor(NAVY).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10)
        .text(value, valueX, rowY, { width: 100, align: 'right' });
      rowY += bold ? 22 : 17;
    };

    totalRow('Subtotal', fmt(invoice.subtotal, invoice.currency));
    if (invoice.taxRate > 0) totalRow(`Tax (${invoice.taxRate}%)`, fmt(invoice.taxAmount, invoice.currency));
    if (invoice.shippingCost > 0) totalRow('Shipping', fmt(invoice.shippingCost, invoice.currency));

    rowY += 4;
    doc.moveTo(labelX, rowY).lineTo(right, rowY).strokeColor(NAVY).lineWidth(1).stroke();
    rowY += 8;
    totalRow('TOTAL', fmt(invoice.total, invoice.currency), true);

    // Notes
    if (invoice.notes) {
      rowY += 20;
      if (rowY + 50 > contentBottom(doc)) {
        doc.addPage();
        rowY = CONTENT_TOP;
      }
      doc.fillColor(GREY).font('Helvetica-Bold').fontSize(8).text('NOTES', left, rowY);
      doc.fillColor(NAVY).font('Helvetica').fontSize(9).text(invoice.notes, left, rowY + 12, { width: fullW });
    }

    doc.end();
  });
}
