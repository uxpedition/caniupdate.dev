import type { NetworkInterfaceInfo } from 'node:os';

import { describe, expect, it } from 'vitest';

import { browserOrigins } from './browserOrigins';

const ethernet = (address: string, internal = false): NetworkInterfaceInfo => ({
  address,
  netmask: '255.255.255.0',
  family: 'IPv4',
  mac: '00:00:00:00:00:00',
  internal,
  cidr: `${address}/24`,
});

const ethernet6 = (address: string, internal = false): NetworkInterfaceInfo => ({
  address,
  netmask: 'ffff:ffff:ffff:ffff::',
  family: 'IPv6',
  mac: '00:00:00:00:00:00',
  internal,
  cidr: `${address}/64`,
  scopeid: 0,
});

describe('browser origins', () => {
  it('lists every interface address and the loopback aliases on the frontend port', () => {
    const origins = browserOrigins(5173, {
      lo: [ethernet('127.0.0.1', true), ethernet6('::1', true)],
      enp3s0: [ethernet('192.168.101.197'), ethernet6('fd7a:115c:a1e0::1')],
      tailscale0: [ethernet('100.122.224.20')],
    });

    expect(origins).toEqual([
      'http://100.122.224.20:5173',
      'http://127.0.0.1:5173',
      'http://192.168.101.197:5173',
      'http://[::1]:5173',
      'http://[fd7a:115c:a1e0::1]:5173',
      'http://localhost:5173',
    ]);
  });

  it('carries the port this session listens on', () => {
    const origins = browserOrigins(5273, { lo: [ethernet('127.0.0.1', true)] });

    expect(origins).toEqual(['http://127.0.0.1:5273', 'http://[::1]:5273', 'http://localhost:5273']);
  });

  it('names one address once however many interfaces report it', () => {
    const origins = browserOrigins(5173, {
      docker0: [ethernet('172.17.0.1')],
      br0: [ethernet('172.17.0.1')],
      lo: [ethernet('127.0.0.1', true), ethernet('127.0.0.1', true)],
    });

    expect(origins).toEqual([
      'http://127.0.0.1:5173',
      'http://172.17.0.1:5173',
      'http://[::1]:5173',
      'http://localhost:5173',
    ]);
  });

  it('skips a zone-scoped address, which is no browser origin', () => {
    const origins = browserOrigins(5173, { lo: [ethernet('127.0.0.1', true)], eth0: [ethernet6('fe80::1%eth0')] });

    expect(origins).toEqual(['http://127.0.0.1:5173', 'http://[::1]:5173', 'http://localhost:5173']);
  });
});
