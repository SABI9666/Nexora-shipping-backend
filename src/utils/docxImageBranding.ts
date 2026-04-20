// Shared branding for docx downloads.
// Reads header.png, footer.png, watermark.png from /public/branding/ on disk
// and returns ready-to-use Paragraph/Header/Footer objects. If an image is
// missing, the corresponding helper returns null so the document still renders
// (without that asset).

import fs from 'fs';
import path from 'path';
import {
  AlignmentType,
  Footer,
  Header,
  ImageRun,
  Paragraph,
} from 'docx';

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

// A4 width at 96dpi ≈ 794px; we use 680px for a small page margin.
const PAGE_WIDTH_PX = 680;

export function buildDocHeader(): Header | undefined {
  const buf = readPngSafe('header.png');
  if (!buf) return undefined;
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: buf,
            transformation: { width: PAGE_WIDTH_PX, height: 90 },
          }),
        ],
      }),
    ],
  });
}

export function buildDocFooter(): Footer | undefined {
  const buf = readPngSafe('footer.png');
  if (!buf) return undefined;
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: buf,
            transformation: { width: PAGE_WIDTH_PX, height: 90 },
          }),
        ],
      }),
    ],
  });
}

// Watermark sits in the header layer, floating behind text.
export function buildWatermarkParagraph(): Paragraph | null {
  const buf = readPngSafe('watermark.png');
  if (!buf) return null;
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new ImageRun({
        data: buf,
        transformation: { width: 450, height: 450 },
        floating: {
          horizontalPosition: {
            relative: 'page' as never,
            align: 'center' as never,
          },
          verticalPosition: {
            relative: 'page' as never,
            align: 'center' as never,
          },
          behindDocument: true,
        },
      }),
    ],
  });
}

// Convenience: returns header with watermark baked in (so watermark appears
// on every page in the background).
export function buildDocHeaderWithWatermark(): Header | undefined {
  const headerBuf = readPngSafe('header.png');
  const watermark = buildWatermarkParagraph();
  const children: Paragraph[] = [];

  if (headerBuf) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: headerBuf,
            transformation: { width: PAGE_WIDTH_PX, height: 90 },
          }),
        ],
      }),
    );
  }
  if (watermark) children.push(watermark);

  if (children.length === 0) return undefined;
  return new Header({ children });
}
