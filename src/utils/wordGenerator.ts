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

// ...existing file content unchanged...

              new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'TAX INVOICE', bold: true, size: 48, color: C.NAVY, font: 'Arial' })] }),
