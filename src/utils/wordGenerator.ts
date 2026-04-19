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
  top:    { style: BorderStyle.NONE, size: 0, color: 'auto' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  left:   { style: BorderStyle.NONE, size: 0, color: 'auto' },
  right:  { style: BorderStyle.NONE, size: 0, color: 'auto' },
};

const TABLE_NO_BORDER = {
  ...NO_BORDER,
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  insideVertical:   { style: BorderStyle.NONE, size: 0, color: 'auto' },
};

const DATA_BORDER = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: C.BORDER },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: C.BORDER },
  left:   { style: BorderStyle.SINGLE, size: 4, color: C.BORDER },
  right:  { style: BorderStyle.SINGLE, size: 4, color: C.BORDER },
};

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const headerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_NO_BORDER,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: NO_BORDER,
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({ children: [new TextRun({ text: 'NEXORA EXPRESS', bold: true, size: 52, color: C.DARK, font: 'Arial' })] }),
              new Paragraph({ children: [new TextRun({ text: 'nexorashipping.com', size: 20, color: C.LIGHT_SLATE, font: 'Arial' })] }),
              new Paragraph({ children: [new TextRun({ text: `${invoice.shipFromAddress}, ${invoice.shipFromCity}, ${invoice.shipFromCountry}`, size: 20, color: C.LIGHT_SLATE, font: 'Arial' })] }),
            ],
          }),
          new TableCell({
            borders: NO_BORDER,
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'INVOICE', bold: true, size: 64, color: C.NAVY, font: 'Arial' })] }),
              new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: invoice.invoiceNumber, bold: true, size: 28, color: C.DARK, font: 'Courier New' })] }),
              new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `Date: ${fmtDate(invoice.invoiceDate)}`, size: 20, color: C.SLATE, font: 'Arial' })] }),
              ...(invoice.dueDate ? [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `Due: ${fmtDate(invoice.dueDate)}`, size: 20, color: C.SLATE, font: 'Arial' })] })] : []),
              new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `Status: ${invoice.status}`, size: 20, color: C.SLATE, font: 'Arial' })] }),
            ],
          }),
        ],
      }),
    ],
  });

  const divider = new Paragraph({
    border: { bottom: { style: BorderStyle.THICK, size: 12, color: C.NAVY } },
    children: [],
    spacing: { before: 200, after: 200 },
  });

  const fromToTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_NO_BORDER,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: NO_BORDER,
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({ children: [new TextRun({ text: 'FROM', bold: true, size: 16, color: C.LIGHT_SLATE, font: 'Arial' })] }),
              new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: invoice.shipFromName, bold: true, size: 24, color: C.DARK, font: 'Arial' })] }),
              new Paragraph({ children: [new TextRun({ text: invoice.shipFromAddress, size: 22, color: C.SLATE, font: 'Arial' })] }),
              new Paragraph({ children: [new TextRun({ text: `${invoice.shipFromCity}, ${invoice.shipFromCountry}`, size: 22, color: C.SLATE, font: 'Arial' })] }),
            ],
          }),
          new TableCell({
            borders: NO_BORDER,
            width: { size: 50, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: C.LIGHT_GRAY },
            children: [
              new Paragraph({ children: [new TextRun({ text: 'BILL TO', bold: true, size: 16, color: C.LIGHT_SLATE, font: 'Arial' })] }),
              new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: invoice.billToName, bold: true, size: 24, color: C.DARK, font: 'Arial' })] }),
              new Paragraph({ children: [new TextRun({ text: invoice.billToAddress, size: 22, color: C.SLATE, font: 'Arial' })] }),
              new Paragraph({ children: [new TextRun({ text: `${invoice.billToCity}, ${invoice.billToCountry}`, size: 22, color: C.SLATE, font: 'Arial' })] }),
              ...(invoice.billToEmail ? [new Paragraph({ children: [new TextRun({ text: invoice.billToEmail, size: 20, color: C.LIGHT_SLATE, font: 'Arial' })] })] : []),
              ...(invoice.billToPhone ? [new Paragraph({ children: [new TextRun({ text: invoice.billToPhone, size: 20, color: C.LIGHT_SLATE, font: 'Arial' })] })] : []),
            ],
          }),
        ],
      }),
    ],
  });

  const metaTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_NO_BORDER,
    rows: [
      new TableRow({
        children: [
          { label: 'INVOICE DATE',   value: fmtDate(invoice.invoiceDate) },
          { label: 'DUE DATE',       value: fmtDate(invoice.dueDate) },
          { label: 'PAYMENT TERMS',  value: invoice.paymentTerms || '—' },
          { label: 'CURRENCY',       value: invoice.currency },
        ].map(({ label, value }) =>
          new TableCell({
            borders: NO_BORDER,
            width: { size: 25, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: C.LIGHT_GRAY },
            children: [
              new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 16, color: C.LIGHT_SLATE, font: 'Arial' })] }),
              new Paragraph({ spacing: { before: 40 }, children: [new TextRun({ text: value, bold: true, size: 22, color: C.DARK, font: 'Arial' })] }),
            ],
          }),
        ),
      }),
    ],
  });

  const orderRefPara = invoice.orderRef
    ? new Paragraph({
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: C.BLUE_BG },
        spacing: { before: 160, after: 160 },
        children: [
          new TextRun({ text: 'Order Reference: ', size: 22, font: 'Arial', color: C.BLUE }),
          new TextRun({ text: invoice.orderRef.orderNumber, bold: true, size: 22, font: 'Courier New', color: C.BLUE }),
        ],
      })
    : null;

  const colWidths = [60, 10, 15, 15];
  const itemsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: ['DESCRIPTION', 'QTY', 'UNIT PRICE', 'AMOUNT'].map((h, i) =>
          new TableCell({
            borders: NO_BORDER,
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: C.NAVY },
            width: { size: colWidths[i], type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                alignment: i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT,
                children: [new TextRun({ text: h, bold: true, size: 18, color: C.WHITE, font: 'Arial' })],
              }),
            ],
          }),
        ),
      }),
      ...invoice.items.map((item, i) => {
        const fill = i % 2 === 0 ? C.WHITE : C.LIGHT_GRAY;
        return new TableRow({
          children: [
            new TableCell({ borders: DATA_BORDER, shading: { type: ShadingType.CLEAR, color: 'auto', fill }, width: { size: 60, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: item.description, size: 22, color: '334155', font: 'Arial' })] })] }),
            new TableCell({ borders: DATA_BORDER, shading: { type: ShadingType.CLEAR, color: 'auto', fill }, width: { size: 10, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: String(item.quantity), size: 22, color: '334155', font: 'Arial' })] })] }),
            new TableCell({ borders: DATA_BORDER, shading: { type: ShadingType.CLEAR, color: 'auto', fill }, width: { size: 15, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: fmtNum(item.unitPrice), size: 22, color: '334155', font: 'Arial' })] })] }),
            new TableCell({ borders: DATA_BORDER, shading: { type: ShadingType.CLEAR, color: 'auto', fill }, width: { size: 15, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: fmtNum(item.amount), bold: true, size: 22, color: C.DARK, font: 'Arial' })] })] }),
          ],
        });
      }),
    ],
  });

  const totalsData = [
    { label: 'Subtotal',                      value: fmtNum(invoice.subtotal),      isFinal: false },
    ...(invoice.taxRate > 0      ? [{ label: `Tax (${invoice.taxRate}%)`, value: fmtNum(invoice.taxAmount),   isFinal: false }] : []),
    ...(invoice.shippingCost > 0 ? [{ label: 'Shipping',                  value: fmtNum(invoice.shippingCost), isFinal: false }] : []),
    { label: `Total (${invoice.currency})`,   value: fmtNum(invoice.total),         isFinal: true  },
  ];

  const totalsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_NO_BORDER,
    rows: totalsData.map(({ label, value, isFinal }) => {
      const topBorder = isFinal
        ? { style: BorderStyle.THICK, size: 8, color: C.NAVY }
        : { style: BorderStyle.NONE, size: 0, color: 'auto' };
      const cellBorder = { top: topBorder, bottom: NO_BORDER.bottom, left: NO_BORDER.left, right: NO_BORDER.right };
      return new TableRow({
        children: [
          new TableCell({ borders: NO_BORDER, width: { size: 60, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [] })] }),
          new TableCell({ borders: cellBorder, width: { size: 20, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: label, bold: isFinal, size: isFinal ? 28 : 22, color: isFinal ? C.DARK : C.SLATE, font: 'Arial' })] })] }),
          new TableCell({ borders: cellBorder, width: { size: 20, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: value, bold: isFinal, size: isFinal ? 28 : 22, color: isFinal ? C.NAVY : C.SLATE, font: 'Arial' })] })] }),
        ],
      });
    }),
  });

  const footerParas: Paragraph[] = [
    new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: C.BORDER } },
      children: [],
      spacing: { before: 400 },
    }),
  ];
  if (invoice.paymentTerms) {
    footerParas.push(new Paragraph({
      spacing: { before: 100 },
      children: [
        new TextRun({ text: 'Payment Terms: ', bold: true, size: 20, color: C.SLATE, font: 'Arial' }),
        new TextRun({ text: invoice.paymentTerms, size: 20, color: C.SLATE, font: 'Arial' }),
      ],
    }));
  }
  if (invoice.notes) {
    footerParas.push(new Paragraph({
      spacing: { before: 80 },
      children: [new TextRun({ text: invoice.notes, size: 20, color: C.SLATE, font: 'Arial' })],
    }));
  }
  footerParas.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 400 },
    children: [new TextRun({ text: 'Thank you for your business · Nexora Express Logistics · nexorashipping.com', size: 18, color: C.LIGHT_SLATE, font: 'Arial' })],
  }));

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
      children: [
        headerTable,
        divider,
        fromToTable,
        new Paragraph({ children: [], spacing: { before: 200 } }),
        metaTable,
        ...(orderRefPara ? [new Paragraph({ children: [], spacing: { before: 200 } }), orderRefPara] : []),
        new Paragraph({ children: [], spacing: { before: 200 } }),
        itemsTable,
        new Paragraph({ children: [], spacing: { before: 200 } }),
        totalsTable,
        ...footerParas,
      ],
    }],
  });

  return await Packer.toBuffer(doc);
}
