import nitroWorker from 'nitropack/presets/cloudflare/runtime/cloudflare-module';

import { withTelemetryIngress } from './telemetryWorker';

const applicationFetch = nitroWorker.fetch;
if (applicationFetch === undefined) throw new Error('Nitro Cloudflare Worker entry has no fetch handler');

export default {
  ...nitroWorker,
  fetch: withTelemetryIngress(applicationFetch),
};
