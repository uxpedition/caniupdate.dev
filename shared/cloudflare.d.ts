import type { BriefingEvidence } from './briefing.defs';
import type { BriefingServiceResult } from './briefingService.defs';
import type { PackageEvidenceNamespace } from './packageEvidence.defs';

type DisposableBriefingServiceResult = BriefingServiceResult & { [Symbol.dispose](): void };

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
          submit(packet: BriefingEvidence): Promise<DisposableBriefingServiceResult>;
        };
        /** Private OTLP endpoint supplied only to the Nuxt Worker. */
        readonly NUXT_OTEL_ENDPOINT?: string;
        /** JSON-encoded private OTLP authentication headers supplied only to the Nuxt Worker. */
        readonly NUXT_OTEL_HEADERS?: string;
        /** Public opt-in gate used by Nuxt and the browser plugin. */
        readonly NUXT_PUBLIC_TELEMETRY_ENABLED?: string;
      };
    };
  }
}
