import type { BriefingEvidence } from './briefing.defs';
import type { PackageEvidenceNamespace } from './packageEvidence.defs';

// Nitro's dev binding proxy and built Worker attach this platform context to each request. The Nuxt Worker owns no
// inference and no store: the private evidence object builds the bounded packet, and the private briefing service
// entrypoint owns generation, D1, and the socket the browser follows.
declare module 'h3' {
  interface H3EventContext {
    cloudflare?: {
      readonly env?: {
        readonly PACKAGE_EVIDENCE?: PackageEvidenceNamespace;
        readonly BRIEFING_SERVICE?: {
          /** JSON text of the submission envelope; see `BriefingSubmitter` for why it is not an object. */
          submit(packet: BriefingEvidence): Promise<string>;
        };
      };
    };
  }
}
