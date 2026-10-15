import type { BriefingEvidence } from './comparison/briefing/briefing.defs';
import type { BriefingServiceResult } from './comparison/briefing/briefingService.defs';
import type { StoredBriefingResult } from './comparison/briefing/storedBriefing.defs';
import type { PackageEvidenceNamespace } from './comparison/evidence/packageEvidence.defs';

type DisposableBriefingServiceResult = BriefingServiceResult & { [Symbol.dispose](): void };

type DisposableStoredBriefingResult = StoredBriefingResult & { [Symbol.dispose](): void };

/** Native submission object with Cloudflare's documented lifecycle hook. */
export type BriefingServiceBinding = {
  submit(packet: BriefingEvidence): Promise<DisposableBriefingServiceResult>;
  read(packet: BriefingEvidence): Promise<DisposableStoredBriefingResult>;
};

// Nitro's dev binding proxy and built Worker attach this platform context to each request. The Nuxt Worker owns no
// inference or store: the private evidence object builds the bounded packet, while the briefing service owns D1,
// generation, and the socket the browser follows; its read RPC exposes only a validated stored success or a miss.
declare module 'h3' {
  interface H3EventContext {
    comparisonHtmlCacheable?: boolean;
    cloudflare?: {
      readonly env?: {
        readonly PACKAGE_EVIDENCE?: PackageEvidenceNamespace;
        readonly BRIEFING_SERVICE?: BriefingServiceBinding;
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
