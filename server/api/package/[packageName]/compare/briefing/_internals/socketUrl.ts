// The subscription URL a submission answers with is built by the private briefing service from its own configuration,
// so a local session advertises a loopback URL whatever host the browser loaded the page from. A browser on another
// device — the README's Tailscale workflow — would dial its own loopback and never reach the service, so a loopback
// advertisement is re-pointed at the host the request arrived on, keeping the advertised scheme, port, and path. A
// deployed service advertises its real hostname, which is the only host that serves it, and is returned untouched.

/** The host a request names: the page's `Origin` when the browser sent a real one, otherwise the `Host` header. */
const requestedHostname = (origin: string | undefined, host: string | undefined): string | undefined => {
  // A browser's Origin is an absolute URL; the opaque `null` of a sandboxed document carries no scheme and names no
  // host, so it is skipped instead of being read as the hostname `null`. A Host header never carries a scheme.
  const candidates = [origin?.includes('://') === true ? origin : undefined, host];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === '') continue;
    try {
      // `Host` arrives without a scheme; `Origin` always carries one, and both are read as a URL so IPv6 brackets and
      // an explicit port are handled by the platform's parser rather than by hand.
      const { hostname } = new URL(candidate.includes('://') ? candidate : `http://${candidate}`);
      if (hostname !== '') return hostname;
    } catch {
      // Neither header is authoritative: a value that names no host leaves the advertised URL as it is.
    }
  }
  return undefined;
};

/**
 * The subscription URL this request must answer with. Both headers are client-supplied, and both can only move the
 * host of the socket URL this response already carries, so a spoofed value misdirects only the client that sent it.
 */
export const browserBriefingSocketUrl = (
  eventsUrl: string,
  origin: string | undefined,
  host: string | undefined,
): string => {
  const socket = new URL(eventsUrl);
  const advertised = socket.hostname;
  // A loopback hostname names the machine serving the page, never a site the requesting browser can dial back.
  if (advertised !== 'localhost' && advertised !== '[::1]' && !advertised.startsWith('127.')) return eventsUrl;

  const hostname = requestedHostname(origin, host);
  if (hostname === undefined || hostname === advertised) return eventsUrl;

  socket.hostname = hostname;
  return socket.toString();
};
