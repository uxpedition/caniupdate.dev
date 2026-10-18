import { FRONTEND_ORIGIN, check, log } from './defs.ts';

const audiences = ['Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36', 'Googlebot/2.1 (+http://www.google.com/bot.html)'];

/** Inspect wire HTML, not the hydrated DOM: either audience can populate the shared edge cache. */
export const verifyMetadata = async (): Promise<void> => {
  const siteOrigin = process.env['NUXT_PUBLIC_SITE_URL'];

  for (const [path, title] of [
    ['/', 'Can I update? · Review npm package changes before updating'],
    ['/about', 'About · Can I Update?'],
    ['/privacy', 'Privacy · Can I Update?'],
  ] as const) {
    for (const userAgent of audiences) {
      const response = await fetch(`${FRONTEND_ORIGIN}${path}`, { headers: { 'user-agent': userAgent } });
      const html = await response.text();
      const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
      check(response.status === 200, `${path}: expected HTTP 200`);
      check(head.includes(`<title>${title}</title>`), `${path}: missing literal title for ${userAgent}`);
      const canonical = /<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"[^>]*>/i.exec(head)?.[1];
      check(
        canonical === (siteOrigin ? new URL(path, siteOrigin).href : undefined),
        `${path}: canonical must use only the configured runtime origin for ${userAgent}`,
      );
      check(response.headers.get('cache-control') === 'no-cache', `${path}: browser must revalidate`);
      check(
        response.headers.get('cloudflare-cdn-cache-control') === 'public, max-age=31536000, must-revalidate',
        `${path}: preserve the one-year edge TTL`,
      );
    }
  }

  log('metadata: PASS (human and Googlebot wire HTML, runtime canonical, unchanged cache policy)');
};
