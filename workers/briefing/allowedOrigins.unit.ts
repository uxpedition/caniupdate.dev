import { describe, expect, it } from 'vitest';

import { briefingAllowedOrigins } from './allowedOrigins';

const PAGE = 'http://100.122.224.20:5173';

describe('briefing allowed origins', () => {
  it.each([
    ['a single Origin', 'http://localhost:5173', ['http://localhost:5173']],
    [
      'a list of the hostnames one local session serves',
      `http://localhost:5173,${PAGE}`,
      ['http://localhost:5173', PAGE],
    ],
    ['a list whose commas carry spaces', ` http://localhost:5173 , ${PAGE} `, ['http://localhost:5173', PAGE]],
    ['an unset value', undefined, []],
    ['an empty value', '', []],
    ['nothing but separators', ' , , ', []],
  ] as const)('parses %s', (_label, allowedOrigin, expected) => {
    expect(briefingAllowedOrigins(allowedOrigin)).toEqual(expected);
  });

  it('matches an Origin byte-for-byte rather than by prefix or hostname', () => {
    const allowed = briefingAllowedOrigins(PAGE);

    expect(allowed).toContain(PAGE);
    for (const lookalike of [
      `${PAGE}.attacker.example`,
      `${PAGE}0`,
      'http://100.122.224.20:5173#',
      'http://100.122.224.20:5173/',
      PAGE.toUpperCase(),
    ]) {
      expect(allowed).not.toContain(lookalike);
    }
  });
});
