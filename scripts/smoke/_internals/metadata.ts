import { FRONTEND_ORIGIN, check, log } from './defs.ts';

const audiences = ['Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36', 'Googlebot/2.1 (+http://www.google.com/bot.html)'];

const verifySocialPreview = async (head: string, siteOrigin: string | undefined): Promise<void> => {
  const image = /<meta\b[^>]*property="og:image"[^>]*content="([^"]+)"[^>]*>/i.exec(head)?.[1];
  const twitterImage = /<meta\b[^>]*name="twitter:image"[^>]*content="([^"]+)"[^>]*>/i.exec(head)?.[1];
  const expectedImage = siteOrigin ? new URL('/social-preview.png', siteOrigin).href : undefined;
  check(image === expectedImage, 'Homepage Open Graph image must use only the configured runtime origin');
  check(twitterImage === expectedImage, 'Homepage Twitter image must use only the configured runtime origin');

  if (image === undefined) return;

  const response = await fetch(`${FRONTEND_ORIGIN}${new URL(image).pathname}`);
  check(response.status === 200, 'Social preview image must be publicly fetchable');
  check(response.headers.get('content-type')?.split(';')[0] === 'image/png', 'Social preview must be served as PNG');

  const bytes = Buffer.from(await response.arrayBuffer());
  check(
    bytes.length >= 24 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
    'Social preview must contain a PNG image, not an HTML fallback',
  );

  const width = /<meta\b[^>]*property="og:image:width"[^>]*content="([^"]+)"[^>]*>/i.exec(head)?.[1];
  const height = /<meta\b[^>]*property="og:image:height"[^>]*content="([^"]+)"[^>]*>/i.exec(head)?.[1];
  check(Number(width) === bytes.readUInt32BE(16), 'Declared preview width must match the delivered PNG');
  check(Number(height) === bytes.readUInt32BE(20), 'Declared preview height must match the delivered PNG');
};

/** Inspect wire HTML, not the hydrated DOM: either audience can populate the shared edge cache. */
export const verifyMetadata = async (): Promise<void> => {
  const siteOrigin = process.env['NUXT_PUBLIC_SITE_URL'];

  for (const path of ['/', '/about', '/privacy']) {
    for (const userAgent of audiences) {
      const response = await fetch(`${FRONTEND_ORIGIN}${path}`, { headers: { 'user-agent': userAgent } });
      const html = await response.text();
      const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
      check(response.status === 200, `${path}: expected HTTP 200`);
      const canonical = /<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"[^>]*>/i.exec(head)?.[1];
      check(
        canonical === (siteOrigin ? new URL(path, siteOrigin).href : undefined),
        `${path}: canonical must use only the configured runtime origin for ${userAgent}`,
      );

      if (path === '/') await verifySocialPreview(head, siteOrigin);
      check(response.headers.get('cache-control') === 'no-cache', `${path}: browser must revalidate`);
      check(
        response.headers.get('cloudflare-cdn-cache-control') === 'public, max-age=31536000, must-revalidate',
        `${path}: preserve the one-year edge TTL`,
      );
    }
  }

  log(
    'metadata: PASS (human and Googlebot wire HTML, runtime canonical/social URLs, preview PNG, unchanged cache policy)',
  );
};
