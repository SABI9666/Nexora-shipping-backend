import PDFDocument from 'pdfkit';
import {
  attachBrandingToDoc,
  contentBottom,
  CONTENT_TOP,
  PAGE_MARGIN,
} from './pdfBranding';

type Doc = InstanceType<typeof PDFDocument>;

const NAVY = '#0a1628';
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
const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

export interface VatLedgerData {
  period: { from: Date | null; to: Date | null };
  output: {
    rows: {
      date: Date | string;
      ref: string;
      particulars: string;
      currency: string;
      taxable: number;
      ratePercent: number;
      vat: number;
      running: number;
    }[];
    totalTaxable: number;
    totalVat: number;
  };
  input: {
    rows: {
      date: Date | string;
      ref: string;
      supplierRef?: string;
      particulars: string;
      currency: string;
      taxable: number;
      ratePercent: number;
      vat: number;
      running: number;
    }[];
    totalTaxable: number;
    totalVat: number;
  };
  netVat: number;
  companyTrn?: string;
}

interface Col {
  label: string;
  w: number;
  align: 'left' | 'right';
  wrap?: boolean;
}

const ROW_PAD_Y = 5;
const MIN_ROW_H = 18;

function drawSectionHeader(doc: Doc, x: number, y: number, w: number, title: string, tint: string) {
  doc.fillColor(tint).rect(x, y, w, 20).fill();
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
  doc.fontSize(8);
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

function drawDataRow(doc: Doc, x: number, y: number, cols: Col[], cells: string[], alt: boolean, vatIdx: number, vatColor: string): number {
  const rowH = measureRowH(doc, cols, cells);
  const w = cols.reduce((s, c) => s + c.w, 0);
  if (alt) doc.fillColor(ROW_ALT).rect(x, y, w, rowH).fill();
  let cx = x;
  doc.fontSize(8);
  cols.forEach((c, i) => {
    const isLast = i === cols.length - 1;
    let color: string = TEXT;
    if (isLast) color = NAVY;
    else if (i === vatIdx && cells[i]) color = vatColor;
    doc.font(isLast || i === vatIdx ? 'Helvetica-Bold' : 'Helvetica').fillColor(color);
    const padLeft = c.align === 'left' ? 4 : 0;
    const padRight = c.align === 'left' ? 8 : 4;
    if (c.wrap) {
      doc.text(cells[i] ?? '', cx + padLeft, y + ROW_PAD_Y, { width: c.w - padRight, align: c.align });
    } else {
      doc.text(cells[i] ?? '', cx + padLeft, y + ROW_PAD_Y, { width: c.w - padRight, align: c.align, lineBreak: false, ellipsis: true });
    }
    cx += c.w;
  });
  return y + rowH;
}

function drawEmptyRow(doc: Doc, x: number, y: number, w: number, msg: string): number {
  doc.fillColor(NAVY_TINT_2).rect(x, y, w, 26).fill();
  doc.fillColor(SUBTLE).font('Helvetica-Oblique').fontSize(9)
    .text(msg, x + 8, y + 8, { width: w - 16, align: 'center', lineBreak: false, ellipsis: true });
  return y + 26;
}

function ensureSpace(doc: Doc, y: number, needed: number): number {
  if (y + needed > contentBottom(doc)) {
    doc.addPage();
    return CONTENT_TOP;
  }
  return y;
}

// Subtotal row that prints Taxable + VAT under their own columns.
function drawVatSubtotal(doc: Doc, x: number, y: number, cols: Col[], label: string, taxable: string, vat: string, vatColor: string): number {
  const w = cols.reduce((s, c) => s + c.w, 0);
  const rowH = 24;
  doc.fillColor(NAVY_TINT).rect(x, y, w, rowH).fill();
  doc.lineWidth(1).strokeColor(NAVY).moveTo(x, y).lineTo(x + w, y).stroke();
  doc.lineWidth(1).strokeColor(NAVY).moveTo(x, y + rowH).lineTo(x + w, y + rowH).stroke();
  // Last two columns are Taxable (2nd-last) and VAT (last).
  const vatCol = cols[cols.length - 1];
  const taxableCol = cols[cols.length - 2];
  const labelW = cols.slice(0, -2).reduce((s, c) => s + c.w, 0);
  const taxableX = x + labelW;
  const vatX = taxableX + taxableCol.w;
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9)
    .text(label, x + 4, y + 8, { width: labelW - 8, align: 'right', lineBreak: false, characterSpacing: 0.6, ellipsis: true });
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9.5)
    .text(taxable, taxableX, y + 8, { width: taxableCol.w - 4, align: 'right', lineBreak: false, ellipsis: true });
  doc.fillColor(vatColor).font('Helvetica-Bold').fontSize(10)
    .text(vat, vatX, y + 7, { width: vatCol.w - 4, align: 'right', lineBreak: false, ellipsis: true });
  return y + rowH;
}

export function generateVatLedgerPdfBuffer(data: VatLedgerData): Promise<Buffer> {
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

    // ---- Title -------------------------------------------------------
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(22)
      .text('VAT LEDGER', left, y, { width: fullW * 0.6, lineBreak: false });
    const trn = data.companyTrn || '105413106300003';
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10)
      .text(`TRN: ${trn}`, left + fullW * 0.6, y + 4, { width: fullW * 0.4, align: 'right', lineBreak: false });
    y += 30;
    const periodLabel = (data.period.from || data.period.to)
      ? `${data.period.from ? fmtDate(data.period.from) : '—'}  to  ${data.period.to ? fmtDate(data.period.to) : '—'}`
      : 'All dates';
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text(`Period: ${periodLabel}`, left, y, { width: fullW, lineBreak: false });
    doc.fillColor(BRAND_RED).circle(left + 3, y + 16, 2.4).fill();
    doc.lineWidth(2.2).strokeColor(NAVY).moveTo(left + 10, y + 16).lineTo(left + 70, y + 16).stroke();
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left + 76, y + 16).lineTo(right, y + 16).stroke();
    y += 28;

    // ---- OUTPUT VAT --------------------------------------------------
    y = ensureSpace(doc, y, 80);
    drawSectionHeader(doc, left, y, fullW, `OUTPUT VAT  ·  Collected on sales  ·  ${data.output.rows.length} invoice${data.output.rows.length === 1 ? '' : 's'}`, EMERALD);
    y += 24;

    const oFixed = 56 + 82 + 44 + 88 + 88; // Date + Ref + Rate + Taxable + VAT
    const oCols: Col[] = [
      { label: 'Date',            w: 56,                            align: 'left'               },
      { label: 'Invoice #',       w: 82,                            align: 'left'               },
      { label: 'Customer',        w: Math.max(120, fullW - oFixed), align: 'left', wrap: true   },
      { label: 'Rate %',          w: 44,                            align: 'right'              },
      { label: 'Taxable Value',   w: 88,                            align: 'right'              },
      { label: 'Output VAT (Cr)', w: 88,                            align: 'right'              },
    ];
    y = drawTableHead(doc, left, y, oCols);
    if (data.output.rows.length === 0) {
      y = drawEmptyRow(doc, left, y, fullW, 'No sales VAT in this period.');
    } else {
      for (let i = 0; i < data.output.rows.length; i++) {
        const r = data.output.rows[i];
        const cells = [fmtDate(r.date), r.ref, r.particulars, `${fmt(r.ratePercent)}%`, fmt(r.taxable), fmt(r.vat)];
        const needed = measureRowH(doc, oCols, cells) + 2;
        y = ensureSpace(doc, y, needed);
        y = drawDataRow(doc, left, y, oCols, cells, i % 2 === 1, 5, EMERALD);
      }
      y = ensureSpace(doc, y, 26);
      y = drawVatSubtotal(doc, left, y, oCols, 'Total Output VAT', fmt(data.output.totalTaxable), fmt(data.output.totalVat), EMERALD);
    }
    y += 16;

    // ---- INPUT VAT ---------------------------------------------------
    y = ensureSpace(doc, y, 80);
    drawSectionHeader(doc, left, y, fullW, `INPUT VAT  ·  Paid on purchases (recoverable)  ·  ${data.input.rows.length} voucher${data.input.rows.length === 1 ? '' : 's'}`, ROSE);
    y += 24;

    const iFixed = 56 + 72 + 72 + 44 + 84 + 84; // Date + Vch + SupInv + Rate + Taxable + VAT
    const iCols: Col[] = [
      { label: 'Date',           w: 56,                            align: 'left'               },
      { label: 'Voucher #',      w: 72,                            align: 'left'               },
      { label: 'Sup. Inv #',     w: 72,                            align: 'left'               },
      { label: 'Supplier',       w: Math.max(110, fullW - iFixed), align: 'left', wrap: true   },
      { label: 'Rate %',         w: 44,                            align: 'right'              },
      { label: 'Taxable Value',  w: 84,                            align: 'right'              },
      { label: 'Input VAT (Dr)', w: 84,                            align: 'right'              },
    ];
    y = drawTableHead(doc, left, y, iCols);
    if (data.input.rows.length === 0) {
      y = drawEmptyRow(doc, left, y, fullW, 'No purchase VAT in this period.');
    } else {
      for (let i = 0; i < data.input.rows.length; i++) {
        const r = data.input.rows[i];
        const cells = [fmtDate(r.date), r.ref, r.supplierRef || '—', r.particulars, `${fmt(r.ratePercent)}%`, fmt(r.taxable), fmt(r.vat)];
        const needed = measureRowH(doc, iCols, cells) + 2;
        y = ensureSpace(doc, y, needed);
        y = drawDataRow(doc, left, y, iCols, cells, i % 2 === 1, 6, ROSE);
      }
      y = ensureSpace(doc, y, 26);
      y = drawVatSubtotal(doc, left, y, iCols, 'Total Input VAT', fmt(data.input.totalTaxable), fmt(data.input.totalVat), ROSE);
    }
    y += 18;

    // ---- NET VAT POSITION -------------------------------------------
    y = ensureSpace(doc, y, 110);
    const panelH = 96;
    doc.fillColor(NAVY_TINT_2).rect(left, y, fullW, panelH).fill();
    doc.fillColor(NAVY).rect(left, y, 4, panelH).fill();
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10)
      .text('NET VAT POSITION', left + 14, y + 10, { width: 260, lineBreak: false, characterSpacing: 1.4 });

    const sx = left + 16;
    const sw = fullW - 32;
    const labelW = sw * 0.62;
    const valW = sw * 0.38;
    let sy = y + 30;
    const row = (label: string, value: string, color: string, strong = false) => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(strong ? 11 : 9.5)
        .text(label, sx, sy + (strong ? 1 : 0), { width: labelW, lineBreak: false });
      doc.fillColor(color).font('Helvetica-Bold').fontSize(strong ? 13 : 10.5)
        .text(value, sx + labelW, sy, { width: valW, align: 'right', lineBreak: false, ellipsis: true });
      sy += strong ? 22 : 15;
    };
    row('Output VAT (collected from customers)', fmt(data.output.totalVat), EMERALD);
    row('Input VAT (paid to suppliers, recoverable)', `(${fmt(data.input.totalVat)})`, MUTED);
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(sx, sy - 2).lineTo(sx + sw, sy - 2).stroke();
    sy += 4;
    const payable = data.netVat >= 0;
    row(payable ? 'Net VAT PAYABLE to FTA' : 'Net VAT REFUNDABLE from FTA',
      fmt(Math.abs(data.netVat)), payable ? BRAND_RED : EMERALD, true);

    y += panelH + 10;
    doc.fillColor(SUBTLE).font('Helvetica-Oblique').fontSize(8)
      .text(`Generated ${fmtDate(new Date())}  ·  Output VAT from sales invoices · Input VAT from purchase vouchers  ·  Computer-generated statement.`,
        left, y, { width: fullW, align: 'center', lineBreak: false });

    doc.end();
  });
}
