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

function drawDataRow(doc: Doc, x: number, y: number, cols: Col[], cells: string[], alt: boolean, debitIdx: number, creditIdx: number): number {
  const rowH = measureRowH(doc, cols, cells);
  const w = cols.reduce((s, c) => s + c.w, 0);
  if (alt) doc.fillColor(ROW_ALT).rect(x, y, w, rowH).fill();
  let cx = x;
  doc.fontSize(8);
  cols.forEach((c, i) => {
    const isLast = i === cols.length - 1;
    let color: string = TEXT;
    if (isLast) color = NAVY;
    else if (i === debitIdx && cells[i]) color = ROSE;
    else if (i === creditIdx && cells[i]) color = EMERALD;
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
    // INFO PANEL — both columns now use measured heights so values
    // that wrap (long period strings, long names) push later rows
    // down instead of overlapping them.
    // ============================================================
    const PAD_X = 12;
    const leftColW = fullW * 0.48 - PAD_X * 2;
    const rightColW = fullW * 0.50;
    const rightX = left + fullW * 0.50;
    const KV_LABEL_W = 96;
    const valueW = rightColW - KV_LABEL_W - PAD_X;

    // Pre-measure left column blocks
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

    const leftContentH = 12
      + nameH + 4
      + codeGroupH + 6
      + (contactBits ? contactH + 4 : 0)
      + (data.account.address ? addressH : 0);

    // Pre-measure right column values so the panel height accounts
    // for a wrapped Period string (the long date range can wrap).
    const periodStr = data.period.from || data.period.to
      ? `${data.period.from ? fmtDate(data.period.from) : '-'}  to  ${data.period.to ? fmtDate(data.period.to) : '-'}`
      : 'All Time';
    doc.font('Helvetica-Bold').fontSize(10);
    const periodValH = doc.heightOfString(periodStr, { width: valueW, align: 'right' });
    // Three small KV rows + one strong KV (Closing Balance)
    const rightContentH = Math.max(14, periodValH + 2)
      + 14 /* Total Debit */
      + 14 /* Total Credit */
      + 22 /* Closing Balance (strong) */;

    const panelH = Math.max(leftContentH, rightContentH) + 20;

    doc.fillColor(NAVY_TINT_2).rect(left, y, fullW, panelH).fill();
    doc.fillColor(NAVY).rect(left, y, 3, panelH).fill();

    // LEFT column — flowing Y
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

    // RIGHT column — flowing Y. drawKv now ADVANCES by the actual
    // rendered value height, so a Period like "31 Mar 2026 to 01
    // Jun 2026" that needs two lines pushes Total Debit / Credit /
    // Closing Balance down instead of being overlapped by them.
    let ry = y + 10;
    const drawKv = (label: string, value: string, color: string, bold = false) => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(8)
        .text(label.toUpperCase(), rightX, ry, { width: KV_LABEL_W, lineBreak: false, characterSpacing: 0.6 });
      doc.fillColor(color).font('Helvetica-Bold').fontSize(bold ? 13 : 10);
      const vh = doc.heightOfString(value, { width: valueW, align: 'right' });
      doc.text(value, rightX + KV_LABEL_W, ry - (bold ? 2 : 0), {
        width: valueW, align: 'right',
      });
      const minAdvance = bold ? 22 : 14;
      ry += Math.max(minAdvance, vh + 4);
    };
    drawKv('Period', periodStr, TEXT);
    drawKv('Total Debit', fmt(data.totals.totalDebit), ROSE);
    drawKv('Total Credit', fmt(data.totals.totalCredit), EMERALD);
    drawKv('Closing Balance', `${fmt(data.closing.balance)} ${data.closing.side}`, NAVY, true);

    y += panelH + 14;

    // ============================================================
    // LEDGER — Type column dropped (the voucher # prefix already
    // tells you the type: "INV NEX..." vs "VCH..."). Reference and
    // Narration are wrap columns; row height is computed per row;
    // numeric columns stay single-line.
    // ============================================================
    y = ensureSpace(doc, y, 70);
    drawSectionHeader(doc, left, y, fullW, `LEDGER  ·  ${data.rows.length} transaction${data.rows.length === 1 ? '' : 's'}`);
    y += 24;

    // Compact fixed widths leave more room for Narration, the only
    // column that can carry long free-text. Reference can wrap too,
    // but typically holds short refs like "ORD NEXDX-2026-00005".
    const fixedWidth = 56 + 86 + 96 + 60 + 60 + 72; // Date+Vch+Ref+Dr+Cr+Bal
    const narrationW = Math.max(110, fullW - fixedWidth);
    const cols: Col[] = [
      { label: 'Date',       w: 56,         align: 'left'                 },
      { label: 'Voucher #',  w: 86,         align: 'left'                 },
      { label: 'Reference',  w: 96,         align: 'left', wrap: true     },
      { label: 'Narration',  w: narrationW, align: 'left', wrap: true     },
      { label: 'Debit',      w: 60,         align: 'right'                },
      { label: 'Credit',     w: 60,         align: 'right'                },
      { label: 'Balance',    w: 72,         align: 'right'                },
    ];
    const DEBIT_IDX = 4;
    const CREDIT_IDX = 5;

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
        '', '', '', 'Opening Balance',
        data.opening.debit > 0 ? fmt(data.opening.debit) : '',
        data.opening.credit > 0 ? fmt(data.opening.credit) : '',
        `${fmt(openingBalance)} ${openingSide}`,
      ];
      cols.forEach((c, i) => {
        const isLast = i === cols.length - 1;
        const isLabel = i === 3; // Narration col holds the "Opening Balance" label
        doc.font(isLabel || isLast ? 'Helvetica-Bold' : 'Helvetica');
        const color: string = isLast ? NAVY
          : (isLabel ? NAVY
            : (i === DEBIT_IDX ? ROSE : i === CREDIT_IDX ? EMERALD : MUTED));
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
        const cells = [
          fmtDate(r.date),
          r.voucherNumber,
          r.reference || '-',
          r.narration || '-',
          r.debit > 0 ? fmt(r.debit) : '',
          r.credit > 0 ? fmt(r.credit) : '',
          `${fmt(r.runningBalance)} ${r.runningSide}`,
        ];
        const needed = measureRowH(doc, cols, cells) + 2;
        y = ensureSpace(doc, y, needed);
        y = drawDataRow(doc, left, y, cols, cells, i % 2 === 1, DEBIT_IDX, CREDIT_IDX);
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
