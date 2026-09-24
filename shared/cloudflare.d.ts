import type { D1Database } from '@cloudflare/workers-types';

import type { PackageEvidenceNamespace } from './packageEvidence.defs';

// Nitro's dev binding proxy and built Worker attach this platform context to each request.
declare module 'h3' {
  interface H3EventContext {
    cloudflare?: {
      readonly env?: {
        readonly BRIEFINGS_DB?: D1Database;
        readonly PACKAGE_EVIDENCE?: PackageEvidenceNamespace;
      };
    };
  }
}
