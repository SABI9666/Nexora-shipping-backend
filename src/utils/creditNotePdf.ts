import PDFDocument from 'pdfkit';
import { attachBrandingToDoc, CONTENT_TOP, PAGE_MARGIN } from './pdfBranding';
import { amountToWords } from './numberToWords';

// ============================================================================
// TAX CREDIT NOTE — issued to a customer against an original tax invoice
// (e.g. after a billing dispute). Carries the details a UAE tax credit note
// needs: supplier TRN, customer, the original invoice reference, the reason,
// the taxable value credited, the VAT reversed and the gross credit.
// ============================================================================

const NAVY = '#0a1628';
const BRAND_RED = '#dc2626';
const TEXT = '#0f172a';
const MUTED = '#475569';
const SUBTLE = '#94a3b8';
const DIVIDER = '#e2e8f0';
const NAVY_TINT = '#eef2f7';
const NAVY_TINT_2 = '#f4f7fb';
const WHITE = '#ffffff';
const ROSE = '#be123c';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

export interface CreditNotePdfData {
  creditNoteNumber: string;
  date: Date | string;
  currency: string;
  reason: string | null;
  remarks: string | null;
  netAmount: number;
  vatPercent: number;
  vatAmount: number;
  amount: number;
  companyTrn: string | null;
  customer: {
    name: string;
    code: string | null;
    trn: string | null;
    address: string | null;
    email: string | null;
    phone: string | null;
  };
  invoice: {
    invoiceNumber: string;
    invoiceDate: Date | string;
    jobNo: string | null;
    total: number;
    creditedToDate: number;   // all credit notes up to and including this one
    netAfterCredit: number;   // invoice total less those credit notes
  };
}

export function generateCreditNotePdfBuffer(data: CreditNotePdfData): Promise<Buffer> {
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
    const cur = data.currency;
    let y = CONTENT_TOP;

    // ---- Title -----------------------------------------------------------
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(22)
      .text('TAX CREDIT NOTE', left, y, { width: fullW * 0.6, lineBreak: false });
    if (data.companyTrn) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
        .text(`TRN: ${data.companyTrn}`, left + fullW * 0.6, y + 8, { width: fullW * 0.4, align: 'right', lineBreak: false });
    }
    y += 28;
    doc.fillColor(BRAND_RED).circle(left + 3, y, 2.6).fill();
    doc.lineWidth(2.5).strokeColor(NAVY).moveTo(left + 10, y).lineTo(left + 86, y).stroke();
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left + 92, y).lineTo(right, y).stroke();
    y += 14;

    // ---- Customer (left) + document refs (right) -------------------------
    const boxH = 108;
    const colW = (fullW - 12) / 2;
    const rx = left + colW + 12;
    doc.fillColor(NAVY_TINT_2).rect(left, y, colW, boxH).fill();
    doc.fillColor(NAVY).rect(left, y, 3, boxH).fill();
    doc.fillColor(NAVY_TINT_2).rect(rx, y, colW, boxH).fill();
    doc.fillColor(NAVY).rect(rx, y, 3, boxH).fill();

    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text('CREDIT TO', left + 12, y + 8, { width: colW - 20, characterSpacing: 1, lineBreak: false });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11.5)
      .text(data.customer.name, left + 12, y + 20, { width: colW - 20, height: 30, ellipsis: true });
    let cy = doc.y + 2;
    doc.fillColor(TEXT).font('Helvetica').fontSize(8.5);
    const custLines = [
      data.customer.address,
      data.customer.trn ? `TRN: ${data.customer.trn}` : null,
      data.customer.phone ? `Tel: ${data.customer.phone}` : null,
      data.customer.email,
      data.customer.code ? `A/C: ${data.customer.code}` : null,
    ].filter(Boolean) as string[];
    for (const line of custLines) {
      if (cy > y + boxH - 14) break;
      doc.text(line, left + 12, cy, { width: colW - 20, lineBreak: false, ellipsis: true });
      cy += 12;
    }

    const kv: [string, string][] = [
      ['Credit Note No', data.creditNoteNumber],
      ['Credit Note Date', fmtDate(data.date)],
      ['Against Invoice', data.invoice.invoiceNumber],
      ['Invoice Date', fmtDate(data.invoice.invoiceDate)],
      ['Job No', data.invoice.jobNo || '-'],
      ['Currency', cur],
    ];
    let ky = y + 10;
    for (const [k, v] of kv) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
        .text(k, rx + 12, ky, { width: colW * 0.45, lineBreak: false });
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9)
        .text(v, rx + 12 + colW * 0.45, ky, { width: colW * 0.55 - 24, align: 'right', lineBreak: false, ellipsis: true });
      ky += 15.5;
    }
    y += boxH + 16;

    // ---- Reason ----------------------------------------------------------
    doc.fillColor(NAVY).rect(left, y, fullW, 20).fill();
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(9.5)
      .text('REASON FOR CREDIT', left + 8, y + 6, { width: fullW - 16, characterSpacing: 1.2, lineBreak: false });
    y += 26;
    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(10)
      .text(data.reason || 'Adjustment to invoice', left + 4, y, { width: fullW - 8 });
    y = doc.y + 2;
    if (data.remarks) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
        .text(data.remarks, left + 4, y, { width: fullW - 8 });
      y = doc.y;
    }
    y += 14;

    // ---- Amount table ----------------------------------------------------
    const cols = [
      { label: 'DESCRIPTION', w: fullW - 330, align: 'left' as const },
      { label: `TAXABLE (${cur})`, w: 100, align: 'right' as const },
      { label: 'VAT %', w: 60, align: 'right' as const },
      { label: `VAT (${cur})`, w: 80, align: 'right' as const },
      { label: `TOTAL (${cur})`, w: 90, align: 'right' as const },
    ];
    doc.fillColor(NAVY_TINT).rect(left, y, fullW, 22).fill();
    let cx = left;
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8);
    for (const c of cols) {
      doc.text(c.label, cx + 6, y + 7, { width: c.w - 12, align: c.align, lineBreak: false });
      cx += c.w;
    }
    doc.lineWidth(0.8).strokeColor(NAVY).moveTo(left, y + 22).lineTo(right, y + 22).stroke();
    y += 22;

    const cells = [
      `Credit against Invoice ${data.invoice.invoiceNumber}`,
      fmt(data.netAmount),
      `${fmt(data.vatPercent)}%`,
      fmt(data.vatAmount),
      fmt(data.amount),
    ];
    cx = left;
    doc.fillColor(TEXT).font('Helvetica').fontSize(9.5);
    cols.forEach((c, i) => {
      doc.font(i === cols.length - 1 ? 'Helvetica-Bold' : 'Helvetica')
        .text(cells[i], cx + 6, y + 9, { width: c.w - 12, align: c.align, lineBreak: false, ellipsis: true });
      cx += c.w;
    });
    y += 30;
    doc.lineWidth(0.6).strokeColor(DIVIDER).moveTo(left, y).lineTo(right, y).stroke();
    y += 10;

    // ---- Totals panel (right) --------------------------------------------
    const tW = 250;
    const tx = right - tW;
    const tRow = (label: string, value: string, strong = false, color = NAVY) => {
      if (strong) {
        doc.fillColor(NAVY).rect(tx, y - 4, tW, 24).fill();
        doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(10.5)
          .text(label, tx + 10, y + 3, { width: tW * 0.55, lineBreak: false });
        doc.text(value, tx + tW * 0.45, y + 3, { width: tW * 0.55 - 10, align: 'right', lineBreak: false });
        y += 26;
      } else {
        doc.fillColor(MUTED).font('Helvetica').fontSize(9.5)
          .text(label, tx + 10, y, { width: tW * 0.55, lineBreak: false });
        doc.fillColor(color).font('Helvetica-Bold').fontSize(9.5)
          .text(value, tx + tW * 0.45, y, { width: tW * 0.55 - 10, align: 'right', lineBreak: false });
        y += 16;
      }
    };
    tRow('Taxable value credited', `${cur} ${fmt(data.netAmount)}`);
    tRow(`Output VAT reversed (${fmt(data.vatPercent)}%)`, `${cur} ${fmt(data.vatAmount)}`);
    y += 4;
    tRow('TOTAL CREDIT', `${cur} ${fmt(data.amount)}`, true);

    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8.5)
      .text(`Amount in words: ${amountToWords(data.amount, cur)}`, left, y + 2, { width: fullW });
    y = doc.y + 16;

    // ---- Effect on the original invoice -----------------------------------
    const effH = 62;
    doc.fillColor(NAVY_TINT_2).rect(left, y, fullW, effH).fill();
    doc.fillColor(ROSE).rect(left, y, 3, effH).fill();
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9)
      .text('EFFECT ON INVOICE', left + 12, y + 8, { width: 200, characterSpacing: 1.2, lineBreak: false });
    const eW = (fullW - 24) / 3;
    const eff: [string, string][] = [
      ['Original invoice value', `${cur} ${fmt(data.invoice.total)}`],
      ['Total credited to date', `(${cur} ${fmt(data.invoice.creditedToDate)})`],
      ['Revised invoice value', `${cur} ${fmt(data.invoice.netAfterCredit)}`],
    ];
    eff.forEach(([k, v], i) => {
      const ex = left + 12 + i * eW;
      doc.fillColor(MUTED).font('Helvetica').fontSize(8)
        .text(k, ex, y + 26, { width: eW - 8, lineBreak: false });
      doc.fillColor(i === 1 ? ROSE : NAVY).font('Helvetica-Bold').fontSize(11)
        .text(v, ex, y + 38, { width: eW - 8, lineBreak: false, ellipsis: true });
    });
    y += effH + 40;

    // ---- Signatures -------------------------------------------------------
    const sW = 170;
    doc.lineWidth(0.6).strokeColor(SUBTLE)
      .moveTo(left, y).lineTo(left + sW, y).stroke()
      .moveTo(right - sW, y).lineTo(right, y).stroke();
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
      .text('Prepared by', left, y + 5, { width: sW, align: 'center', lineBreak: false })
      .text('Authorised signatory', right - sW, y + 5, { width: sW, align: 'center', lineBreak: false });
    y += 30;

    doc.fillColor(SUBTLE).font('Helvetica-Oblique').fontSize(7.5)
      .text(
        `This tax credit note reduces the amount due on invoice ${data.invoice.invoiceNumber}. `
        + 'Computer-generated document.',
        left, y, { width: fullW, align: 'center' },
      );

    doc.end();
  });
}
