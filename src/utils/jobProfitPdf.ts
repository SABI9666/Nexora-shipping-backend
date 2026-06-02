import PDFDocument from 'pdfkit';
import {
  attachBrandingToDoc,
  contentBottom,
  CONTENT_TOP,
  PAGE_MARGIN,
} from './pdfBranding';

type Doc = InstanceType<typeof PDFDocument>;

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
const WHITE = '#ffffff';
const EMERALD = '#047857';
const ROSE = '#be123c';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

export interface JobProfitData {
  order: {
    orderNumber: string;
    createdAt: Date | string;
    status?: string;
    customer?: string | null;
    salesperson?: string | null;
    pickupCity?: string | null;
    deliveryCity?: string | null;
  };
  purchaseRows: {
    voucherNumber: string;
    voucherDate: Date | string;
    supplierCode?: string;
    supplierName: string;
    ref: string;
    narration: string;
    currency: string;
    amount: number;
    paid?: number;
    outstanding?: number;
  }[];
  salesRows: {
    invoiceNumber: string;
    invoiceDate: Date | string;
    billToName: string;
    currency: string;
    total: number;
    paid: number;
    outstanding: number;
    status: string;
  }[];
  totals: {
    totalPurchase: number;
    totalPurchasePaid?: number;
    totalPurchaseOutstanding?: number;
    totalSales: number;
    netProfit: number;
    totalOutstanding: number;
  };
}

interface Col {
  label: string;
  w: number;
  align: 'left' | 'right';
  wrap?: boolean;
}

const ROW_PAD_Y = 5;
const MIN_ROW_H = 18;

function drawSectionHeader(doc: Doc, x: number, y: number, w: number, title: string) {
  doc.fillColor(NAVY).rect(x, y, w, 20).fill();
  doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(9.5)
    .text(title, x + 8, y + 6, { width: w - 16, lineBreak: false, characterSpacing: 1.2, ellipsis: true });
}

function drawTableHead(doc: Doc, x: number, y: number, cols: Col[]): number {
  const w = cols.reduce((s, c) => s + c.w, 0);
  doc.fillColor(NAVY_TINT_2).rect(x, y, w, 20).fill();
  let cx = x;
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(7.5);
  cols.forEach((c) => {
    doc.text(c.label, cx + 4, y + 7, {
      width: c.w - 8, align: c.align, lineBreak: false, characterSpacing: 0.3, ellipsis: true,
    });
    cx += c.w;
  });
  doc.lineWidth(0.7).strokeColor(NAVY).moveTo(x, y + 20).lineTo(x + w, y + 20).stroke();
  return y + 20;
}

function measureRowH(doc: Doc, cols: Col[], cells: string[]): number {
  doc.fontSize(8.5);
  let maxContentH = MIN_ROW_H - ROW_PAD_Y * 2;
  cols.forEach((c, i) => {
    const text = cells[i];
    if (!text || !c.wrap) return;
    const padX = c.align === 'left' ? 8 : 4;
    doc.font('Helvetica');
    const h = doc.heightOfString(text, { width: c.w - padX, align: c.align });
    if (h > maxContentH) maxContentH = h;
  });
  return Math.max(MIN_ROW_H, maxContentH + ROW_PAD_Y * 2);
}

function drawDataRow(doc: Doc, x: number, y: number, cols: Col[], cells: string[], alt: boolean): number {
  const rowH = measureRowH(doc, cols, cells);
  const w = cols.reduce((s, c) => s + c.w, 0);
  if (alt) doc.fillColor(ROW_ALT).rect(x, y, w, rowH).fill();
  let cx = x;
  doc.fontSize(8.5);
  cols.forEach((c, i) => {
    const last = i === cols.length - 1;
    doc.font(last ? 'Helvetica-Bold' : 'Helvetica').fillColor(last ? NAVY : TEXT);
    const padLeft = c.align === 'left' ? 4 : 0;
    const padRight = c.align === 'left' ? 8 : 4;
    if (c.wrap) {
      doc.text(cells[i] ?? '', cx + padLeft, y + ROW_PAD_Y, {
        width: c.w - padRight, align: c.align,
      });
    } else {
      doc.text(cells[i] ?? '', cx + padLeft, y + ROW_PAD_Y, {
        width: c.w - padRight, align: c.align, lineBreak: false, ellipsis: true,
      });
    }
    cx += c.w;
  });
  return y + rowH;
}

function drawSubtotalRow(doc: Doc, x: number, y: number, cols: Col[], label: string, total: string, color: string): number {
  const w = cols.reduce((s, c) => s + c.w, 0);
  const rowH = 24;
  doc.fillColor(NAVY_TINT).rect(x, y, w, rowH).fill();
  doc.lineWidth(1).strokeColor(NAVY).moveTo(x, y).lineTo(x + w, y).stroke();
  doc.lineWidth(1).strokeColor(NAVY).moveTo(x, y + rowH).lineTo(x + w, y + rowH).stroke();
  const labelW = cols.slice(0, -1).reduce((s, c) => s + c.w, 0);
  const valueW = cols[cols.length - 1].w;
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9)
    .text(label, x + 4, y + 8, { width: labelW - 8, align: 'right', lineBreak: false, characterSpacing: 0.6, ellipsis: true });
  doc.fillColor(color).font('Helvetica-Bold').fontSize(10)
    .text(total, x + labelW, y + 7, { width: valueW - 4, align: 'right', lineBreak: false, ellipsis: true });
  return y + rowH;
}

// Subtotal row for the Purchase table — prints three right-aligned
// values (Amount / Paid / Outstanding) under their own columns, with the
// "Total Purchase" label spanning the descriptive columns to the left.
function drawPurchaseSubtotal(
  doc: Doc, x: number, y: number, cols: Col[],
  amount: string, paid: string, outstanding: string,
): number {
  const w = cols.reduce((s, c) => s + c.w, 0);
  const rowH = 24;
  doc.fillColor(NAVY_TINT).rect(x, y, w, rowH).fill();
  doc.lineWidth(1).strokeColor(NAVY).moveTo(x, y).lineTo(x + w, y).stroke();
  doc.lineWidth(1).strokeColor(NAVY).moveTo(x, y + rowH).lineTo(x + w, y + rowH).stroke();
  // Label spans everything left of the three numeric columns.
  const labelW = cols.slice(0, -3).reduce((s, c) => s + c.w, 0);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9)
    .text('Total Purchase', x + 4, y + 8, { width: labelW - 8, align: 'right', lineBreak: false, characterSpacing: 0.6, ellipsis: true });
  const amountCol = cols[cols.length - 3];
  const paidCol = cols[cols.length - 2];
  const outCol = cols[cols.length - 1];
  const amountX = x + labelW;
  const paidX = amountX + amountCol.w;
  const outX = paidX + paidCol.w;
  doc.fillColor(ROSE).font('Helvetica-Bold').fontSize(10)
    .text(amount, amountX, y + 7, { width: amountCol.w - 4, align: 'right', lineBreak: false, ellipsis: true });
  doc.fillColor(EMERALD).font('Helvetica-Bold').fontSize(10)
    .text(paid, paidX, y + 7, { width: paidCol.w - 4, align: 'right', lineBreak: false, ellipsis: true });
  doc.fillColor(ROSE).font('Helvetica-Bold').fontSize(10)
    .text(outstanding, outX, y + 7, { width: outCol.w - 4, align: 'right', lineBreak: false, ellipsis: true });
  return y + rowH;
}

function drawEmptyRow(doc: Doc, x: number, y: number, w: number, msg: string): number {
  doc.fillColor(NAVY_TINT_2).rect(x, y, w, 28).fill();
  doc.fillColor(SUBTLE).font('Helvetica-Oblique').fontSize(9.5)
    .text(msg, x + 8, y + 9, { width: w - 16, align: 'center', lineBreak: false, ellipsis: true });
  return y + 28;
}

function ensureSpace(doc: Doc, y: number, needed: number): number {
  if (y + needed > contentBottom(doc)) {
    doc.addPage();
    return CONTENT_TOP;
  }
  return y;
}

export function generateJobProfitPdfBuffer(data: JobProfitData): Promise<Buffer> {
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

    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(22)
      .text('JOB PROFIT STATEMENT', left, y, { width: fullW, lineBreak: false });
    y += 28;
    doc.fillColor(BRAND_RED).circle(left + 3, y, 2.6).fill();
    doc.lineWidth(2.5).strokeColor(NAVY).moveTo(left + 10, y).lineTo(left + 86, y).stroke();
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left + 92, y).lineTo(right, y).stroke();
    y += 14;

    const infoH = 76;
    doc.fillColor(NAVY_TINT_2).rect(left, y, fullW, infoH).fill();
    doc.fillColor(NAVY).rect(left, y, 3, infoH).fill();
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text('JOB NO', left + 12, y + 8, { width: 80, lineBreak: false, characterSpacing: 1 });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16)
      .text(data.order.orderNumber, left + 12, y + 20, { width: fullW * 0.45, lineBreak: false });
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text('STATUS', left + 12, y + 46, { width: 80, lineBreak: false, characterSpacing: 0.6 });
    doc.fillColor(NAVY_SOFT).font('Helvetica-Bold').fontSize(10)
      .text(data.order.status || '-', left + 12, y + 56, { width: 180, lineBreak: false });

    const rightX = left + fullW * 0.5;
    const rightW = fullW * 0.5 - 12;
    let ry = y + 8;
    const drawKv = (label: string, value: string) => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(8)
        .text(label.toUpperCase(), rightX, ry, { width: 90, lineBreak: false, characterSpacing: 0.6 });
      doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(9.5)
        .text(value, rightX + 90, ry, { width: rightW - 90, lineBreak: false, ellipsis: true });
      ry += 13;
    };
    drawKv('Date', fmtDate(new Date(data.order.createdAt)));
    drawKv('Customer', data.order.customer || '-');
    if (data.order.salesperson) drawKv('Salesperson', data.order.salesperson);
    const route = [data.order.pickupCity, data.order.deliveryCity].filter(Boolean).join(' -> ');
    if (route) drawKv('Route', route);

    y += infoH + 14;

    y = ensureSpace(doc, y, 70);
    const pCur = data.purchaseRows[0]?.currency || 'AED';
    drawSectionHeader(doc, left, y, fullW, `PURCHASE  ·  Costs against this Job  ·  ${pCur}`);
    y += 24;

    // Tighter fixed columns, dynamic-height Supplier / Narration. The
    // three financial columns (Amount / Paid / Outstanding) are
    // right-aligned numeric only so a supplier bill shows what it cost,
    // how much has been settled by Payment vouchers, and what is still
    // owed — the same paid/outstanding breakdown the Sales side gets.
    const pFixed = 20 + 60 + 52 + 70 + 70 + 70; // # + Voucher + Date + Amount + Paid + Outstanding
    const pRest = fullW - pFixed;
    const pCols: Col[] = [
      { label: '#',             w: 20,           align: 'left'                 },
      { label: 'Voucher #',     w: 60,           align: 'left'                 },
      { label: 'Date',          w: 52,           align: 'left'                 },
      { label: 'Supplier',      w: pRest * 0.46, align: 'left',  wrap: true   },
      { label: 'Ref / Sup Inv', w: pRest * 0.24, align: 'left'                 },
      { label: 'Narration',     w: pRest * 0.30, align: 'left',  wrap: true   },
      { label: 'Amount',        w: 70,           align: 'right'                },
      { label: 'Paid',          w: 70,           align: 'right'                },
      { label: 'Outstanding',   w: 70,           align: 'right'                },
    ];

    y = drawTableHead(doc, left, y, pCols);
    if (data.purchaseRows.length === 0) {
      y = drawEmptyRow(doc, left, y, fullW, 'No purchase vouchers recorded against this Job.');
    } else {
      for (let i = 0; i < data.purchaseRows.length; i++) {
        const r = data.purchaseRows[i];
        const paid = r.paid ?? 0;
        const outstanding = r.outstanding ?? (r.amount - paid);
        const cells = [
          String(i + 1),
          r.voucherNumber,
          fmtDate(new Date(r.voucherDate)),
          (r.supplierCode ? r.supplierCode + ' - ' : '') + r.supplierName,
          r.ref || '-',
          r.narration || '-',
          fmt(r.amount),
          fmt(paid),
          fmt(outstanding),
        ];
        const needed = measureRowH(doc, pCols, cells) + 2;
        y = ensureSpace(doc, y, needed);
        y = drawDataRow(doc, left, y, pCols, cells, i % 2 === 1);
      }
      y = ensureSpace(doc, y, 26);
      // Multi-value subtotal: Amount / Paid / Outstanding under their
      // own columns so the bottom line mirrors the column layout.
      const pPaid = data.totals.totalPurchasePaid ?? 0;
      const pOut = data.totals.totalPurchaseOutstanding ?? (data.totals.totalPurchase - pPaid);
      y = drawPurchaseSubtotal(doc, left, y, pCols,
        fmt(data.totals.totalPurchase), fmt(pPaid), fmt(pOut));
    }
    y += 14;

    y = ensureSpace(doc, y, 70);
    const sCur = data.salesRows[0]?.currency || pCur;
    drawSectionHeader(doc, left, y, fullW, `SALES  ·  Invoices issued on this Job  ·  ${sCur}`);
    y += 24;

    const sFixed = 20 + 78 + 56 + 60 + 70 + 70 + 80;
    const sCustomerW = fullW - sFixed;
    const sCols: Col[] = [
      { label: '#',           w: 20,                            align: 'left'                },
      { label: 'Invoice #',   w: 78,                            align: 'left'                },
      { label: 'Date',        w: 56,                            align: 'left'                },
      { label: 'Customer',    w: Math.max(120, sCustomerW),     align: 'left', wrap: true   },
      { label: 'Status',      w: 60,                            align: 'left'                },
      { label: 'Paid',        w: 70,                            align: 'right'               },
      { label: 'Outstanding', w: 70,                            align: 'right'               },
      { label: 'Total',       w: 80,                            align: 'right'               },
    ];

    y = drawTableHead(doc, left, y, sCols);
    if (data.salesRows.length === 0) {
      y = drawEmptyRow(doc, left, y, fullW, 'No invoices issued on this Job.');
    } else {
      for (let i = 0; i < data.salesRows.length; i++) {
        const r = data.salesRows[i];
        const cells = [
          String(i + 1),
          r.invoiceNumber,
          fmtDate(new Date(r.invoiceDate)),
          r.billToName,
          r.status,
          fmt(r.paid),
          fmt(r.outstanding),
          fmt(r.total),
        ];
        const needed = measureRowH(doc, sCols, cells) + 2;
        y = ensureSpace(doc, y, needed);
        y = drawDataRow(doc, left, y, sCols, cells, i % 2 === 1);
      }
      y = ensureSpace(doc, y, 26);
      y = drawSubtotalRow(doc, left, y, sCols, 'Total Sales', fmt(data.totals.totalSales), EMERALD);
    }
    y += 16;

    y = ensureSpace(doc, y, 120);
    const cur = sCur;
    const panelH = 100;
    doc.fillColor(NAVY_TINT_2).rect(left, y, fullW, panelH).fill();
    doc.fillColor(NAVY).rect(left, y, 4, panelH).fill();
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10)
      .text('SUMMARY', left + 14, y + 10, { width: 200, lineBreak: false, characterSpacing: 1.4 });

    const sumX = left + 16;
    const sumW = fullW - 32;
    const sumLabelW = sumW * 0.55;
    const sumValueW = sumW * 0.45;
    let sy = y + 30;
    const drawSumRow = (label: string, value: string, color: string, strong = false) => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(strong ? 11 : 9.5)
        .text(label, sumX, sy + (strong ? 1 : 0), { width: sumLabelW, lineBreak: false });
      doc.fillColor(color).font('Helvetica-Bold').fontSize(strong ? 13 : 10.5)
        .text(value, sumX + sumLabelW, sy, { width: sumValueW, align: 'right', lineBreak: false, ellipsis: true });
      sy += strong ? 22 : 14;
    };
    drawSumRow('Total Sales (S)', `${cur} ${fmt(data.totals.totalSales)}`, EMERALD);
    drawSumRow('Total Purchase (P)', `${cur} ${fmt(data.totals.totalPurchase)}`, ROSE);
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(sumX, sy - 2).lineTo(sumX + sumW, sy - 2).stroke();
    sy += 4;
    const profitColor = data.totals.netProfit >= 0 ? EMERALD : ROSE;
    drawSumRow('NET PROFIT (S - P)', `${cur} ${fmt(data.totals.netProfit)}`, profitColor, true);

    y += panelH + 12;

    if (data.totals.totalOutstanding > 0.005) {
      y = ensureSpace(doc, y, 26);
      doc.fillColor(BRAND_RED).rect(left, y, 3, 18).fill();
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
        .text('Customer Outstanding on this Job (receivable)', left + 10, y + 5, { width: fullW * 0.6, lineBreak: false });
      doc.fillColor(BRAND_RED).font('Helvetica-Bold').fontSize(11)
        .text(`${cur} ${fmt(data.totals.totalOutstanding)}`, left, y + 4, { width: fullW, align: 'right', lineBreak: false });
      y += 22;
    }

    const purchaseOutstanding = data.totals.totalPurchaseOutstanding ?? 0;
    if (purchaseOutstanding > 0.005) {
      y = ensureSpace(doc, y, 26);
      doc.fillColor(ROSE).rect(left, y, 3, 18).fill();
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
        .text('Supplier Bills Outstanding on this Job (payable)', left + 10, y + 5, { width: fullW * 0.6, lineBreak: false });
      doc.fillColor(ROSE).font('Helvetica-Bold').fontSize(11)
        .text(`${cur} ${fmt(purchaseOutstanding)}`, left, y + 4, { width: fullW, align: 'right', lineBreak: false });
      y += 22;
    }

    y += 6;
    doc.fillColor(SUBTLE).font('Helvetica-Oblique').fontSize(8)
      .text(`Generated ${fmtDate(new Date())}  ·  Profit = Sales - Purchase  ·  Computer-generated statement.`,
        left, y, { width: fullW, align: 'center', lineBreak: false });

    doc.end();
  });
}
