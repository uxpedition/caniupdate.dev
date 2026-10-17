import { describe, expect, it } from 'vitest';

import { absoluteUrl, parseSiteOrigin } from './siteUrl';

/** The rejection reason for a value the parser must refuse; the assertion keeps the union narrow. */
const reasonFor = (value: string | undefined): string => {
  const parsed = parseSiteOrigin(value);

  expect(parsed.ok).toBe(false);

  return parsed.ok ? '' : parsed.reason;
};

describe('parseSiteOrigin', () => {
  it('normalizes a configured origin to its canonical form', () => {
    expect(parseSiteOrigin('https://CANIupdate.DEV:443/')).toEqual({ ok: true, origin: 'https://caniupdate.dev' });
    expect(parseSiteOrigin('  https://caniupdate.dev:8443  ')).toEqual({
      ok: true,
      origin: 'https://caniupdate.dev:8443',
    });
  });

  it('accepts a loopback http origin for a local build', () => {
    expect(parseSiteOrigin('http://localhost:5173/')).toEqual({ ok: true, origin: 'http://localhost:5173' });
    expect(parseSiteOrigin('http://127.0.0.1:5173')).toEqual({ ok: true, origin: 'http://127.0.0.1:5173' });
    expect(parseSiteOrigin('http://[::1]:5173')).toEqual({ ok: true, origin: 'http://[::1]:5173' });
  });

  it('accepts a plain-http dev runtime on this machine’s own address', () => {
    expect(parseSiteOrigin('http://192.168.101.197:5173')).toEqual({ ok: true, origin: 'http://192.168.101.197:5173' });
    expect(parseSiteOrigin('http://100.122.224.20:5173')).toEqual({ ok: true, origin: 'http://100.122.224.20:5173' });
    expect(parseSiteOrigin('http://[fd7a:115c:a1e0::1]:5173')).toEqual({
      ok: true,
      origin: 'http://[fd7a:115c:a1e0::1]:5173',
    });
  });

  it('rejects a missing or blank value', () => {
    expect(reasonFor(undefined)).toContain('not set');
    expect(reasonFor('   ')).toContain('not set');
  });

  it('rejects a value that is not an absolute URL', () => {
    expect(reasonFor('caniupdate.dev')).toContain('absolute URL');
    expect(reasonFor('/caniupdate.dev')).toContain('absolute URL');
  });

  it('rejects plain http outside loopback', () => {
    expect(reasonFor('http://caniupdate.dev')).toContain('https');
    expect(reasonFor('ftp://caniupdate.dev')).toContain('https');
  });

  it('rejects credentials, a path, a query, or a fragment', () => {
    expect(reasonFor('https://user:secret@caniupdate.dev')).toContain('credentials');
    expect(reasonFor('https://caniupdate.dev/app')).toContain('path');
    expect(reasonFor('https://caniupdate.dev/?search=1')).toContain('path');
    expect(reasonFor('https://caniupdate.dev/#top')).toContain('path');
  });
});

describe('absoluteUrl', () => {
  it('addresses the homepage with a trailing slash', () => {
    expect(absoluteUrl('https://caniupdate.dev', '/')).toBe('https://caniupdate.dev/');
  });

  it('keeps the route path, including an encoded scope and a prerelease identifier', () => {
    expect(absoluteUrl('https://caniupdate.dev', '/vue/3.4.38...3.5.13')).toBe(
      'https://caniupdate.dev/vue/3.4.38...3.5.13',
    );
    expect(absoluteUrl('https://caniupdate.dev', '/@vue%2Freactivity/2.0.0-rc.1...2.0.0')).toBe(
      'https://caniupdate.dev/@vue%2Freactivity/2.0.0-rc.1...2.0.0',
    );
  });

  it('never carries a query or a fragment into a canonical address', () => {
    expect(absoluteUrl('https://caniupdate.dev', '/minimist/1.2.0...1.2.8?tab=notes#advisories')).toBe(
      'https://caniupdate.dev/minimist/1.2.0...1.2.8',
    );
  });
});
