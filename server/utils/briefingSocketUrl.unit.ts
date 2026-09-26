import { describe, expect, it } from 'vitest';

import { browserBriefingSocketUrl } from './briefingSocketUrl';

const HASH = 'a'.repeat(64);
const at = (base: string): string => `${base}/api/briefings/${HASH}/events`;

type Case = {
  readonly label: string;
  readonly eventsUrl: string;
  readonly origin?: string;
  readonly host?: string;
  readonly expected: string;
};

describe('browser briefing socket URL', () => {
  it.each<Case>([
    {
      label: 're-points a loopback advertisement at the address a device opened the page with',
      eventsUrl: at('ws://localhost:8791'),
      origin: 'http://100.122.224.20:5173',
      expected: at('ws://100.122.224.20:8791'),
    },
    {
      label: 'keeps the advertised port when the launcher overrode it',
      eventsUrl: at('ws://127.0.0.1:8891'),
      origin: 'http://192.168.101.197:5273',
      expected: at('ws://192.168.101.197:8891'),
    },
    {
      label: 'brackets an IPv6 page host',
      eventsUrl: at('ws://[::1]:8791'),
      origin: 'http://[fd7a:115c:a1e0::1]:5173',
      expected: at('ws://[fd7a:115c:a1e0::1]:8791'),
    },
    {
      label: 'keeps an advertised base path',
      eventsUrl: `ws://localhost:8791/base/api/briefings/${HASH}/events`,
      origin: 'http://100.122.224.20:5173',
      expected: `ws://100.122.224.20:8791/base/api/briefings/${HASH}/events`,
    },
    {
      label: 'falls back to the Host header when the browser sent no Origin',
      eventsUrl: at('ws://localhost:8791'),
      host: '100.122.224.20:5173',
      expected: at('ws://100.122.224.20:8791'),
    },
    {
      label: 'falls back to the Host header when the Origin is the opaque sandbox value',
      eventsUrl: at('ws://localhost:8791'),
      origin: 'null',
      host: '100.122.224.20:5173',
      expected: at('ws://100.122.224.20:8791'),
    },
    {
      label: 'leaves the deployed service hostname untouched',
      eventsUrl: at('wss://can-i-update-preview-briefing.caniupdate-dev.workers.dev'),
      origin: 'https://can-i-update-preview.caniupdate-dev.workers.dev',
      expected: at('wss://can-i-update-preview-briefing.caniupdate-dev.workers.dev'),
    },
    {
      label: 'leaves a loopback advertisement alone when the page is on loopback too',
      eventsUrl: at('ws://localhost:8791'),
      origin: 'http://localhost:5173',
      expected: at('ws://localhost:8791'),
    },
    {
      label: 'leaves the advertisement alone when the request names no host at all',
      eventsUrl: at('ws://localhost:8791'),
      expected: at('ws://localhost:8791'),
    },
    {
      label: 'leaves the advertisement alone when neither header parses as a host',
      eventsUrl: at('ws://localhost:8791'),
      origin: 'null',
      host: ':',
      expected: at('ws://localhost:8791'),
    },
  ])('$label', ({ eventsUrl, origin, host, expected }) => {
    expect(browserBriefingSocketUrl(eventsUrl, origin, host)).toBe(expected);
  });

  it('never moves the hash-addressed path or the frame-carrying scheme', () => {
    const rewritten = browserBriefingSocketUrl(at('ws://localhost:8791'), 'http://100.122.224.20:5173', undefined);

    expect(new URL(rewritten).pathname).toBe(`/api/briefings/${HASH}/events`);
    expect(new URL(rewritten).protocol).toBe('ws:');
  });
});
