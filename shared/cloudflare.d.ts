import type { BriefingEvidence } from './briefing.defs';
import type { BriefingSubmission } from './briefingJob.defs';
import type { PackageEvidenceNamespace } from './packageEvidence.defs';

type DisposableBriefingSubmission = BriefingSubmission & { [Symbol.dispose](): void };

// Nitro's dev binding proxy and built Worker attach this platform context to each request. The Nuxt Worker owns no
// inference and no store: the private evidence object builds the bounded packet, and the private briefing service
// entrypoint owns generation, D1, and the socket the browser follows.
declare module 'h3' {
  interface H3EventContext {
    cloudflare?: {
      readonly env?: {
        readonly PACKAGE_EVIDENCE?: PackageEvidenceNamespace;
        readonly BRIEFING_SERVICE?: {
          /** Native submission object with Cloudflare's documented lifecycle hook. */
          submit(packet: BriefingEvidence): Promise<DisposableBriefingSubmission>;
        };
      };
    };
  }
}
