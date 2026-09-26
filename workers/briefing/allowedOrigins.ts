// The briefing Worker's Origin policy, kept out of the entrypoint module so a test can read it without the
// `cloudflare:workers` runtime the entrypoint imports.

/**
 * `BRIEFING_ALLOWED_ORIGIN` is a comma-separated list of origins, because one local session serves the page on more
 * than one hostname: the loopback aliases and every interface address the launcher exposes, so the address a device on
 * the same network opens the page with is an accepted Origin too. Every entry is compared byte-for-byte — never a
 * prefix, a suffix, or a pattern — and an unset or empty list refuses every upgrade rather than opening the route to
 * whatever Origin a request carries.
 */
export const briefingAllowedOrigins = (allowedOrigin: string | undefined): readonly string[] =>
  (allowedOrigin ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
