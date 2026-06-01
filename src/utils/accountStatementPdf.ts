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
void NAVY_SOFT;

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

export interface AccountStatementPdfData {
  account: {
    code: string;
    name: string;
    accountGroup: string | null;
    trn: string | null;
    mobile: string | null;
    email: string | null;
    address: string | null;
  };
  period: { from: Date | null; to: Date | null };
  opening: { debit: number; credit: number };
  totals: { totalDebit: number; totalCredit: number };
  closing: { balance: number; side: 'Dr' | 'Cr' };
  rows: {
    date: Date | string;
    voucherNumber: string;
    type: string;
    reference: string | null;
    narration: string | null;
    currency: string;
    debit: number;
    credit: number;
    runningBalance: number;
    runningSide: 'Dr' | 'Cr';
  }[];
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

// Per-row height measured from wrap columns. Non-wrap cells contribute
// MIN_ROW_H baseline; wrap cells contribute their actual measured height.
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

function drawDataRow(doc: Doc, x: number, y: number, cols: Col[], cells: string[], alt: boolean): number {
  const rowH = measureRowH(doc, cols, cells);
  const w = cols.reduce((s, c) => s + c.w, 0);
  if (alt) doc.fillColor(ROW_ALT).rect(x, y, w, rowH).fill();
  let cx = x;
  doc.fontSize(8);
  cols.forEach((c, i) => {
    const isLast = i === cols.length - 1;
    let color: string = TEXT;
    if (isLast) color = NAVY;
    else if (i === 5 && cells[i]) color = ROSE;     // Debit
    else if (i === 6 && cells[i]) color = EMERALD;  // Credit
    doc.font(isLast ? 'Helvetica-Bold' : 'Helvetica').fillColor(color);
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

export function generateAccountStatementPdfBuffer(data: AccountStatementPdfData): Promise<Buffer> {
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

    // ===== HEADER =====
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(22)
      .text('ACCOUNT STATEMENT', left, y, { width: fullW, lineBreak: false });
    y += 28;
    doc.fillColor(BRAND_RED).circle(left + 3, y, 2.6).fill();
    doc.lineWidth(2.5).strokeColor(NAVY).moveTo(left + 10, y).lineTo(left + 86, y).stroke();
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left + 92, y).lineTo(right, y).stroke();
    y += 14;

    // ============================================================
    // ACCOUNT INFO PANEL — content is measured first so the panel
    // background can be sized to actually contain it. Both the left
    // (account details) and right (period / KPIs) columns advance
    // their own Y as content is drawn, so long names or wrapped
    // contact strings never overlap the row below.
    // ============================================================
    const PAD_X = 12;
    const leftColW = fullW * 0.50 - PAD_X * 2;
    const rightColW = fullW * 0.45;
    const rightX = left + fullW * 0.55;

    // Pre-measure left column
    doc.font('Helvetica-Bold').fontSize(14);
    const nameH = doc.heightOfString(data.account.name, { width: leftColW });
    const codeGroup = data.account.code + (data.account.accountGroup ? `  ·  ${data.account.accountGroup}` : '');
    doc.font('Helvetica').fontSize(9);
    const codeGroupH = doc.heightOfString(codeGroup, { width: leftColW, lineBreak: false });
    const contactBits = [
      data.account.trn ? `TRN ${data.account.trn}` : null,
      data.account.mobile,
      data.account.email,
    ].filter(Boolean).join('  ·  ');
    doc.font('Helvetica').fontSize(8.5);
    const contactH = contactBits ? doc.heightOfString(contactBits, { width: leftColW }) : 0;
    doc.font('Helvetica').fontSize(8);
    const addressH = data.account.address ? doc.heightOfString(data.account.address, { width: leftColW }) : 0;

    const leftContentH = 12 /* ACCOUNT label */
      + nameH + 4
      + codeGroupH + 6
      + (contactBits ? contactH + 4 : 0)
      + (data.account.address ? addressH : 0);

    // Right column has 4 KPI rows (Period, Total Debit, Total Credit) at
    // 14pt each plus Closing Balance at 20pt = 62pt + 8pt top padding.
    const rightContentH = 12 + 14 * 3 + 20;

    const panelH = Math.max(leftContentH, rightContentH) + 20;

    // Now draw the panel background then the content
    doc.fillColor(NAVY_TINT_2).rect(left, y, fullW, panelH).fill();
    doc.fillColor(NAVY).rect(left, y, 3, panelH).fill();

    // LEFT column — flowing Y based on actual rendered heights.
    let ly = y + 10;
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text('ACCOUNT', left + PAD_X, ly, { width: 80, lineBreak: false, characterSpacing: 1 });
    ly += 12;

    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(14)
      .text(data.account.name, left + PAD_X, ly, { width: leftColW });
    ly += nameH + 4;

    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text(codeGroup, left + PAD_X, ly, { width: leftColW, lineBreak: false, ellipsis: true });
    ly += codeGroupH + 6;

    if (contactBits) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
        .text(contactBits, left + PAD_X, ly, { width: leftColW });
      ly += contactH + 4;
    }
    if (data.account.address) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(8)
        .text(data.account.address, left + PAD_X, ly, { width: leftColW });
      ly += addressH;
    }

    // RIGHT column — KPIs. Arrow replaced with ASCII "to" so PDFKit's
    // Helvetica encoding doesn't render it as garbage (U+2192 isn't in
    // WinAnsi — that's why the old "→" came out as "!'").
    let ry = y + 10;
    const KV_LABEL_W = 110;
    const drawKv = (label: string, value: string, color: string, bold = false) => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(8)
        .text(label.toUpperCase(), rightX, ry, { width: KV_LABEL_W, lineBreak: false, characterSpacing: 0.6 });
      doc.fillColor(color).font('Helvetica-Bold').fontSize(bold ? 13 : 10)
        .text(value, rightX + KV_LABEL_W, ry - (bold ? 2 : 0), {
          width: rightColW - KV_LABEL_W - PAD_X,
          align: 'right', lineBreak: false, ellipsis: true,
        });
      ry += bold ? 22 : 14;
    };
    const periodStr = data.period.from || data.period.to
      ? `${data.period.from ? fmtDate(data.period.from) : '-'}  to  ${data.period.to ? fmtDate(data.period.to) : '-'}`
      : 'All Time';
    drawKv('Period', periodStr, TEXT);
    drawKv('Total Debit', fmt(data.totals.totalDebit), ROSE);
    drawKv('Total Credit', fmt(data.totals.totalCredit), EMERALD);
    drawKv('Closing Balance', `${fmt(data.closing.balance)} ${data.closing.side}`, NAVY, true);

    y += panelH + 14;

    // ============================================================
    // LEDGER TABLE — Reference and Narration are wrap columns so
    // long values like "ORD NEXDX-2026-00005" or full invoice
    // narrations get their own multi-line cell instead of crossing
    // the row border into the next entry.
    // ============================================================
    y = ensureSpace(doc, y, 70);
    drawSectionHeader(doc, left, y, fullW, `LEDGER  ·  ${data.rows.length} transaction${data.rows.length === 1 ? '' : 's'}`);
    y += 24;

    // Fixed widths for compact columns; Narration takes the rest. The
    // financial columns are sized for "999,999.99" comfortably.
    const fixedCols = 62 + 78 + 56 + 72 + 70 + 70 + 78; // Date+Vch+Type+Ref+Dr+Cr+Bal
    const cols: Col[] = [
      { label: 'Date',       w: 62, align: 'left'                 },
      { label: 'Voucher #',  w: 78, align: 'left'                 },
      { label: 'Type',       w: 56, align: 'left'                 },
      { label: 'Reference',  w: 72, align: 'left', wrap: true     },
      { label: 'Narration',  w: fullW - fixedCols, align: 'left', wrap: true },
      { label: 'Debit',      w: 70, align: 'right'                },
      { label: 'Credit',     w: 70, align: 'right'                },
      { label: 'Balance',    w: 78, align: 'right'                },
    ];

    y = drawTableHead(doc, left, y, cols);

    // Opening Balance row (highlighted, no alt-row stripe)
    if (data.opening.debit > 0 || data.opening.credit > 0) {
      const openingBalance = Math.abs(data.opening.debit - data.opening.credit);
      const openingSide = data.opening.debit >= data.opening.credit ? 'Dr' : 'Cr';
      y = ensureSpace(doc, y, 20);
      const w = cols.reduce((s, c) => s + c.w, 0);
      doc.fillColor(NAVY_TINT).rect(left, y, w, 18).fill();
      let cx = left;
      doc.fontSize(8);
      const cells = [
        '', '', '', '', 'Opening Balance',
        data.opening.debit > 0 ? fmt(data.opening.debit) : '',
        data.opening.credit > 0 ? fmt(data.opening.credit) : '',
        `${fmt(openingBalance)} ${openingSide}`,
      ];
      cols.forEach((c, i) => {
        const isLast = i === cols.length - 1;
        const isLabel = i === 4;
        doc.font(isLabel || isLast ? 'Helvetica-Bold' : 'Helvetica');
        const color: string = isLast ? NAVY : (isLabel ? NAVY : (i === 5 ? ROSE : i === 6 ? EMERALD : MUTED));
        doc.fillColor(color);
        doc.text(cells[i], cx + (c.align === 'left' ? 4 : 0), y + 5, {
          width: c.w - (c.align === 'left' ? 8 : 4),
          align: c.align, lineBreak: false, ellipsis: true,
        });
        cx += c.w;
      });
      y += 18;
    }

    if (data.rows.length === 0) {
      y = drawEmptyRow(doc, left, y, fullW, 'No transactions in this period.');
    } else {
      for (let i = 0; i < data.rows.length; i++) {
        const r = data.rows[i];
        const typeShort = r.type === 'INVOICE' ? 'Invoice'
          : r.type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
        const cells = [
          fmtDate(r.date),
          r.voucherNumber,
          typeShort,
          r.reference || '-',
          r.narration || '-',
          r.debit > 0 ? fmt(r.debit) : '',
          r.credit > 0 ? fmt(r.credit) : '',
          `${fmt(r.runningBalance)} ${r.runningSide}`,
        ];
        const needed = measureRowH(doc, cols, cells) + 2;
        y = ensureSpace(doc, y, needed);
        y = drawDataRow(doc, left, y, cols, cells, i % 2 === 1);
      }
      y = ensureSpace(doc, y, 28);
      y = drawSubtotalRow(doc, left, y, cols, 'Closing Balance',
        `${fmt(data.closing.balance)} ${data.closing.side}`, NAVY);
    }
    y += 14;

    // ===== SUMMARY PANEL =====
    y = ensureSpace(doc, y, 90);
    const sumPanelH = 76;
    doc.fillColor(NAVY_TINT_2).rect(left, y, fullW, sumPanelH).fill();
    doc.fillColor(NAVY).rect(left, y, 4, sumPanelH).fill();
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10)
      .text('SUMMARY', left + 14, y + 10, { width: 200, lineBreak: false, characterSpacing: 1.4 });

    const sumX = left + 16;
    const sumW = fullW - 32;
    let sy = y + 28;
    const drawSumKV = (label: string, value: string, color: string, strong = false) => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(strong ? 11 : 9.5)
        .text(label, sumX, sy + (strong ? 1 : 0), { width: sumW * 0.55, lineBreak: false });
      doc.fillColor(color).font('Helvetica-Bold').fontSize(strong ? 13 : 11)
        .text(value, sumX + sumW * 0.55, sy - 1, { width: sumW * 0.45, align: 'right', lineBreak: false, ellipsis: true });
      sy += strong ? 20 : 14;
    };
    drawSumKV('Total Debit', fmt(data.totals.totalDebit), ROSE);
    drawSumKV('Total Credit', fmt(data.totals.totalCredit), EMERALD);
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(sumX, sy - 2).lineTo(sumX + sumW, sy - 2).stroke();
    sy += 2;
    drawSumKV('Closing Balance', `${fmt(data.closing.balance)} ${data.closing.side}`, NAVY, true);

    y += sumPanelH + 12;

    doc.fillColor(SUBTLE).font('Helvetica-Oblique').fontSize(8)
      .text(`Generated ${fmtDate(new Date())}  ·  Computer-generated statement  ·  Figures shown in account base currency.`,
        left, y, { width: fullW, align: 'center', lineBreak: false });

    doc.end();
  });
}
