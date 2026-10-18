import { describe, expect, it } from 'vitest';

import { renderRobots, renderSitemap } from './discovery';

describe('reviewed discovery', () => {
  it('never advertises URLs when indexing is disabled or the origin is missing', () => {
    for (const [origin, enabled] of [
      ['https://staging.example', false],
      ['', true],
    ] as const) {
      expect(renderSitemap(origin, enabled)).not.toContain('<loc>');
      expect(renderRobots(origin, enabled)).not.toContain('Sitemap:');
    }
  });

  it('publishes exact ordered identities and useful static pages without invented modification dates', () => {
    const xml = renderSitemap('https://caniupdate.dev', true);
    expect(xml).toContain('<loc>https://caniupdate.dev/about</loc>');
    expect(xml).toContain('<loc>https://caniupdate.dev/@tanstack%2Freact-query/4.44.0...5.104.4</loc>');
    expect(xml).not.toContain('/typescript/7.0.2...6.0.3');
    expect(xml).not.toContain('lastmod');
    expect(renderRobots('https://caniupdate.dev', true)).toContain('Sitemap: https://caniupdate.dev/sitemap.xml');
  });
});
