import { Effect } from 'effect';
import { createError, defineEventHandler } from 'h3';

import { getPackageMeasurements, PackageEvidenceClientError } from '../_internals/evidenceClient';
import { runComparisonRequest, tracedEvidenceRequest } from '../_internals/telemetry';

// Provider/archive work remains owned by the evidence object; diagnostics never add a Nuxt fallback.
export default defineEventHandler((event) =>
  runComparisonRequest(event, 'measurements', (request) =>
    tracedEvidenceRequest('measurements', (context) =>
      getPackageMeasurements(event.context.cloudflare?.env?.PACKAGE_EVIDENCE, request, context),
    ).pipe(
      Effect.mapError((cause) =>
        cause instanceof PackageEvidenceClientError
          ? createError({ statusCode: 503, statusMessage: 'Evidence service unavailable' })
          : cause,
      ),
    ),
  ),
);
