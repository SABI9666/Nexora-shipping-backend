import PDFDocument from 'pdfkit';
import {
  attachBrandingToDoc,
  contentBottom,
  CONTENT_TOP,
  PAGE_MARGIN,
} from './pdfBranding';

type QuotationItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type QuotationForPdf = {
  quotationNumber: string;
  status: string;
  quotationDate: Date;
  validUntil: Date | null;
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
  terms: string | null;
  notes: string | null;
  items: QuotationItem[];
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

export function generateQuotationPdfBuffer(quotation: QuotationForPdf): Promise<Buffer> {
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
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(18).text(quotation.shipFromName, left, TOP + 5);
    doc.fillColor(GREY).font('Helvetica').fontSize(9)
      .text(quotation.shipFromAddress, left, TOP + 28, { width: 280 })
      .text(`${quotation.shipFromCity}, ${quotation.shipFromCountry}`, left, TOP + 41);

    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(26)
      .text('QUOTATION', left, TOP + 5, { align: 'right', width: fullW });
    doc.fillColor(GREY).font('Courier-Bold').fontSize(11)
      .text(quotation.quotationNumber, left, TOP + 38, { align: 'right', width: fullW });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9)
      .text(quotation.status.toUpperCase(), left, TOP + 55, { align: 'right', width: fullW });

    doc.moveTo(left, TOP + 78).lineTo(right, TOP + 78).strokeColor(LIGHT).lineWidth(0.5).stroke();

    // Quote To + Meta
    const boxY = TOP + 92;
    const colW = (fullW - 20) / 2;
    const metaX = left + colW + 20;

    doc.fillColor(GREY).font('Helvetica-Bold').fontSize(8).text('QUOTE TO', left, boxY);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(quotation.billToName, left, boxY + 14, { width: colW });
    doc.fillColor(GREY).font('Helvetica').fontSize(9)
      .text(quotation.billToAddress, left, boxY + 30, { width: colW })
      .text(`${quotation.billToCity}, ${quotation.billToCountry}`, left, boxY + 44, { width: colW });
    let by = boxY + 60;
    if (quotation.billToEmail) { doc.text(quotation.billToEmail, left, by, { width: colW }); by += 12; }
    if (quotation.billToPhone) { doc.text(quotation.billToPhone, left, by, { width: colW }); }

    const halfMeta = colW / 2;
    let my = boxY;
    doc.fillColor(GREY).font('Helvetica-Bold').fontSize(8).text('QUOTATION DATE', metaX, my);
    doc.fillColor(NAVY).font('Helvetica').fontSize(10).text(fmtDate(quotation.quotationDate), metaX, my + 12);
    doc.fillColor(GREY).font('Helvetica-Bold').fontSize(8).text('VALID UNTIL', metaX + halfMeta, my);
    doc.fillColor(NAVY).font('Helvetica').fontSize(10).text(fmtDate(quotation.validUntil), metaX + halfMeta, my + 12);

    my += 36;
    doc.fillColor(GREY).font('Helvetica-Bold').fontSize(8).text('CURRENCY', metaX, my);
    doc.fillColor(NAVY).font('Helvetica').fontSize(10).text(quotation.currency, metaX, my + 12);

    let cursor = boxY + 110;
    if (quotation.orderRef?.orderNumber) {
      doc.fillColor(GREY).font('Helvetica').fontSize(9)
        .text('Linked to order: ', left, cursor, { continued: true })
        .fillColor(NAVY).font('Helvetica-Bold').text(quotation.orderRef.orderNumber);
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

    quotation.items.forEach((item, i) => {
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
        .text(fmt(item.unitPrice, quotation.currency), colUnit, rowY + 6, { width: 70, align: 'right' })
        .font('Helvetica-Bold').text(fmt(item.amount, quotation.currency), right - 86, rowY + 6, { width: 80, align: 'right' });
      rowY += rowH;
    });
    doc.moveTo(left, rowY).lineTo(right, rowY).strokeColor(LIGHT).lineWidth(0.5).stroke();

    // Totals
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

    totalRow('Subtotal', fmt(quotation.subtotal, quotation.currency));
    if (quotation.taxRate > 0) totalRow(`Tax (${quotation.taxRate}%)`, fmt(quotation.taxAmount, quotation.currency));
    if (quotation.shippingCost > 0) totalRow('Shipping', fmt(quotation.shippingCost, quotation.currency));

    rowY += 4;
    doc.moveTo(labelX, rowY).lineTo(right, rowY).strokeColor(NAVY).lineWidth(1).stroke();
    rowY += 8;
    totalRow('TOTAL', fmt(quotation.total, quotation.currency), true);

    // Terms + notes
    if (quotation.terms) {
      rowY += 20;
      if (rowY + 60 > contentBottom(doc)) {
        doc.addPage();
        rowY = CONTENT_TOP;
      }
      doc.fillColor(GREY).font('Helvetica-Bold').fontSize(8).text('TERMS & CONDITIONS', left, rowY);
      doc.fillColor(NAVY).font('Helvetica').fontSize(9).text(quotation.terms, left, rowY + 12, { width: fullW });
      rowY = doc.y + 6;
    }
    if (quotation.notes) {
      rowY += 14;
      if (rowY + 50 > contentBottom(doc)) {
        doc.addPage();
        rowY = CONTENT_TOP;
      }
      doc.fillColor(GREY).font('Helvetica-Bold').fontSize(8).text('NOTES', left, rowY);
      doc.fillColor(NAVY).font('Helvetica').fontSize(9).text(quotation.notes, left, rowY + 12, { width: fullW });
    }

    doc.end();
  });
}
