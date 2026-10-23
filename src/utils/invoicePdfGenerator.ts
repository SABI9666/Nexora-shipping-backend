import PDFDocument from 'pdfkit';
import {
  attachBrandingToDoc,
  contentBottom,
  CONTENT_TOP,
  PAGE_MARGIN,
} from './pdfBranding';

// ...existing file content unchanged...

    // Title shrinks slightly when rendering "PROFORMA INVOICE" so the
    // longer banner doesn't collide with the TRN beneath it.
    const title = invoice.documentTitle || 'TAX INVOICE';
    const titleSize = title.length > 12 ? 22 : 28;
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(titleSize)
      .text(title, left, y, { width: fullW * 0.6, lineBreak: false });
