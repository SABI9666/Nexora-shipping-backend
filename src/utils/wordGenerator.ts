import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import {
  buildDocHeaderWithWatermark,
  buildDocFooter,
} from './docxImageBranding';

const C = {
  NAVY: '1E3A5F',
  WHITE: 'FFFFFF',
  LIGHT_GRAY: 'F8FAFC',
  SLATE: '475569',
  LIGHT_SLATE: '94A3B8',
  DARK: '0F172A',
  BORDER: 'E2E8F0',
  BLUE: '1D4ED8',
  BLUE_BG: 'EFF6FF',
};

const NO_BORDER = {
  top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
};

const TABLE_NO_BORDER = {
  ...NO_BORDER,
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
};

const DATA_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 4, color: C.BORDER },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: C.BORDER },
  left: { style: BorderStyle.SINGLE, size: 4, color: C.BORDER },
  right: { style: BorderStyle.SINGLE, size: 4, color: C.BORDER },
};

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export type WordInvoice = {
  invoiceNumber: string;
  status: string;
  invoiceDate: Date | string;
  dueDate?: Date | string | null;
  billToName: string;
  billToAddress: string;
  billToCity: string;
  billToCountry: string;
  billToEmail?: string | null;
  billToPhone?: string | null;
  customerTrn?: string | null;
  shipFromName: string;
  shipFromAddress: string;
  shipFromCity: string;
  shipFromCountry: string;
  currency: string;
  taxRate: number;
  taxAmount: number;
  shippingCost: number;
  subtotal: number;
  total: number;
  paymentTerms?: string | null;
  notes?: string | null;
  items: { description: string; quantity: number; unitPrice: number; amount: number }[];
  orderRef?: { orderNumber: string } | null;
};

export async function generateInvoiceWordBuffer(invoice: WordInvoice): Promise<Buffer> {
  const docHeader = buildDocHeaderWithWatermark();
  const docFooter = buildDocFooter();

  const rows = [
    ['Description', 'Qty', 'Unit Price', 'Amount'],
    ...invoice.items.map((item) => [
      item.description,
      String(item.quantity),
      fmtNum(item.unitPrice),
      fmtNum(item.amount),
    ]),
  ];

  const itemTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((r, rowIndex) =>
      new TableRow({
        children: r.map((cellValue, colIndex) =>
          new TableCell({
            borders: DATA_BORDER,
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: rowIndex === 0 ? C.NAVY : (rowIndex % 2 === 0 ? C.WHITE : C.LIGHT_GRAY) },
            width: { size: colIndex === 0 ? 45 : 18, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                alignment: colIndex === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: cellValue,
                    bold: rowIndex === 0,
                    size: rowIndex === 0 ? 16 : 12,
                    color: rowIndex === 0 ? C.WHITE : C.DARK,
                    font: 'Arial',
                  }),
                ],
              }),
            ],
          }),
        ),
      }),
    ),
  });

  const totalsData = [
    { label: 'Subtotal', value: fmtNum(invoice.subtotal) },
    ...(invoice.taxRate > 0 ? [{ label: `Tax (${invoice.taxRate}%)`, value: fmtNum(invoice.taxAmount) }] : []),
    ...(invoice.shippingCost > 0 ? [{ label: 'Shipping', value: fmtNum(invoice.shippingCost) }] : []),
    { label: `Total (${invoice.currency})`, value: fmtNum(invoice.total) },
  ];

  const totalsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_NO_BORDER,
    rows: totalsData.map(({ label, value }, idx) =>
      new TableRow({
        children: [
          new TableCell({
            borders: NO_BORDER,
            width: { size: 65, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: label, bold: idx === totalsData.length - 1, size: idx === totalsData.length - 1 ? 20 : 14, color: C.DARK, font: 'Arial' })] })],
          }),
          new TableCell({
            borders: NO_BORDER,
            width: { size: 35, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: value, bold: idx === totalsData.length - 1, size: idx === totalsData.length - 1 ? 20 : 14, color: C.DARK, font: 'Arial' })] })],
          }),
        ],
      }),
    ),
  });

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, right: 720, bottom: 1440, left: 720 },
        },
      },
      ...(docHeader ? { headers: { default: docHeader } } : {}),
      ...(docFooter ? { footers: { default: docFooter } } : {}),
      children: [
        new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: 'TAX INVOICE', bold: true, size: 32, color: C.NAVY, font: 'Arial' })] }),
        new Paragraph({ children: [new TextRun({ text: invoice.shipFromName, bold: true, size: 22, color: C.DARK, font: 'Arial' })] }),
        new Paragraph({ children: [new TextRun({ text: `${invoice.shipFromAddress}, ${invoice.shipFromCity}, ${invoice.shipFromCountry}`, size: 18, color: C.SLATE, font: 'Arial' })] }),
        new Paragraph({ spacing: { before: 180, after: 80 }, children: [new TextRun({ text: `Invoice No: ${invoice.invoiceNumber}`, bold: true, size: 18, color: C.DARK, font: 'Arial' })] }),
        new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: `Date: ${fmtDate(invoice.invoiceDate)}`, size: 16, color: C.SLATE, font: 'Arial' })] }),
        new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: `Bill To: ${invoice.billToName}`, size: 16, color: C.SLATE, font: 'Arial' })] }),
        new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: `${invoice.billToAddress}, ${invoice.billToCity}, ${invoice.billToCountry}`, size: 16, color: C.SLATE, font: 'Arial' })] }),
        itemTable,
        new Paragraph({ spacing: { before: 200 } }),
        totalsTable,
        ...(invoice.paymentTerms ? [new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: `Payment Terms: ${invoice.paymentTerms}`, size: 14, color: C.SLATE, font: 'Arial' })] })] : []),
        ...(invoice.notes ? [new Paragraph({ spacing: { before: 80 }, children: [new TextRun({ text: invoice.notes, size: 14, color: C.SLATE, font: 'Arial' })] })] : []),
      ],
    }],
  });

  return await Packer.toBuffer(doc);
}

export default generateInvoiceWordBuffer;
