// Shared branding for PDF downloads.
// Reads header.png / footer.png / watermark.png from /public/branding/
// (same source images the Word generator uses) so the PDF and Word outputs
// share identical branding.

import fs from 'fs';
import path from 'path';

function brandingDir(): string {
  return path.join(process.cwd(), 'public', 'branding');
}

function readPngSafe(filename: string): Buffer | null {
  try {
    const p = path.join(brandingDir(), filename);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

const headerImg = readPngSafe('header.png');
const footerImg = readPngSafe('footer.png');
const watermarkImg = readPngSafe('watermark.png');

export const HEADER_BAND_HEIGHT = 80;
export const FOOTER_BAND_HEIGHT = 80;

// Pdfkit page margins. Top/bottom leave space for header/footer banners
// plus a small gap so content doesn't crash into the artwork.
export const PAGE_MARGIN = {
  top: HEADER_BAND_HEIGHT + 20,
  bottom: FOOTER_BAND_HEIGHT + 20,
  left: 40,
  right: 40,
};

// Y at which the body content can start drawing.
export const CONTENT_TOP = PAGE_MARGIN.top;

export function paintBranding(doc: PDFKit.PDFDocument) {
  const pageW = doc.page.width;
  const pageH = doc.page.height;

  // Watermark sits behind content at low opacity.
  if (watermarkImg) {
    doc.save();
    doc.opacity(0.07);
    const size = 360;
    doc.image(watermarkImg, (pageW - size) / 2, (pageH - size) / 2, {
      width: size,
      height: size,
    });
    doc.restore();
  }

  if (headerImg) {
    doc.image(headerImg, 0, 0, { width: pageW, height: HEADER_BAND_HEIGHT });
  }

  if (footerImg) {
    doc.image(footerImg, 0, pageH - FOOTER_BAND_HEIGHT, {
      width: pageW,
      height: FOOTER_BAND_HEIGHT,
    });
  }
}

// Paints branding on the first page and on every subsequent page added by
// pdfkit (e.g. when an items table spills over).
export function attachBrandingToDoc(doc: PDFKit.PDFDocument) {
  paintBranding(doc);
  doc.on('pageAdded', () => paintBranding(doc));
}

// Returns the largest y coordinate the body can use before risking overlap
// with the footer band.
export function contentBottom(doc: PDFKit.PDFDocument) {
  return doc.page.height - PAGE_MARGIN.bottom;
}
