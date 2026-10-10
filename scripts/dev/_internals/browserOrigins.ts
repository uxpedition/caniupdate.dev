// The Origins a browser may load the local comparison page from. The launcher serves that page on every interface
// (Nuxt `--host 0.0.0.0`, and the built frontend Worker under `--ip 0.0.0.0`), and the README tells the developer to
// open it from another device by this machine's own address, so the briefing Worker's allow-list has to name those
// addresses: a loopback-only list refuses exactly the device the page was opened on.

import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

/** The interface table `node:os` reports, named here so this module's signature is a contract, not a helper's return. */
export type NetworkInterfaceTable = Readonly<Partial<Record<string, readonly NetworkInterfaceInfo[]>>>;

/** The hostnames a browser on this machine may use, independent of what the interface list reports. */
const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'] as const;

/** An interface address as it appears in a URL host: IPv6 is bracketed, and a zone-scoped address names no site. */
const browserHostnames = (addresses: readonly NetworkInterfaceInfo[]): readonly string[] =>
  addresses.flatMap((address) => {
    if (address.internal || address.address.includes('%')) return [];

    return [address.family === 'IPv6' ? `[${address.address}]` : address.address];
  });

/**
 * One Origin per non-internal interface address, plus the loopback aliases, all on the port the frontend listens on.
 * The order is sorted so a restart hands the same allow-list to the same session, and every entry carries the scheme
 * and the port because the briefing Worker compares it byte-for-byte against a browser's `Origin`.
 */
export const browserOrigins = (
  frontendPort: number,
  interfaces: NetworkInterfaceTable = networkInterfaces(),
): readonly string[] => {
  const hostnames = [
    ...LOOPBACK_HOSTNAMES,
    ...Object.values(interfaces).flatMap((addresses) => browserHostnames(addresses ?? [])),
  ].toSorted();

  return hostnames
    .filter((hostname, index) => hostnames[index - 1] !== hostname)
    .map((hostname) => `http://${hostname}:${frontendPort}`);
};
