// Shared branding for Word (.doc) document downloads.
// Images live in /public/branding/ and are served statically by the backend.

import { Request } from 'express';

export function brandingBaseUrl(req: Request): string {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  const host = req.get('host') || 'localhost';
  return `${proto}://${host}`;
}

export function brandingHeaderHtml(baseUrl: string): string {
  return `
  <div style="text-align:center;margin:0 0 18px 0;">
    <img src="${baseUrl}/branding/header.png" alt="Nexora Shipping"
      style="width:100%;max-width:720px;display:block;margin:0 auto;" />
  </div>`;
}

export function brandingFooterHtml(baseUrl: string): string {
  return `
  <div style="text-align:center;margin:24px 0 0 0;">
    <img src="${baseUrl}/branding/footer.png" alt="Nexora Shipping Contact"
      style="width:100%;max-width:720px;display:block;margin:0 auto;" />
  </div>`;
}

// Word-friendly watermark — uses VML for native Word rendering plus a CSS
// fallback for any other Office-HTML viewer.
export function brandingWatermarkHtml(baseUrl: string): string {
  const url = `${baseUrl}/branding/watermark.png`;
  return `
  <!--[if gte mso 9]><xml>
    <o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>
  </xml><![endif]-->
  <!--[if gte mso 9]>
  <v:shape id="watermark1" o:spid="_x0000_s1026" type="#_x0000_t75"
    style="position:absolute;margin-left:60pt;margin-top:230pt;width:380pt;height:380pt;z-index:-251658240;opacity:0.08;"
    o:allowincell="f">
    <v:imagedata src="${url}" o:title="watermark"/>
  </v:shape>
  <![endif]-->
  <div style="position:absolute;top:35%;left:22%;width:55%;opacity:0.08;z-index:-1;text-align:center;pointer-events:none;">
    <img src="${url}" alt="" style="width:100%;" />
  </div>`;
}

export function brandingHeadStyles(): string {
  return `
  <style>
    @page { size: A4; margin: 0.6in 0.6in 0.6in 0.6in; }
    body { font-family: Arial, Helvetica, sans-serif; color:#1e293b; position:relative; }
    table { border-collapse: collapse; }
  </style>`;
}
