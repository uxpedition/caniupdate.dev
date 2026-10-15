import { Schema } from 'effect';

import {
  PackageDeclarationsResponseSchema,
  PackageMeasurementsResponseSchema,
} from '../../../shared/comparison/comparison.defs.ts';
import { ParsedPackagesSearchResponseSchema } from '../../../shared/comparison/package/search.defs.ts';

export {
  decodeBriefingJobEvent,
  decodeBriefingSubmission,
  type BriefingJobEvent,
  type BriefingSubmission,
} from '../../../shared/comparison/briefing/briefingJob.defs.ts';

const StrictDecodeOptions = { errors: 'all' as const, onExcessProperty: 'error' as const };

const HealthResponseSchema = Schema.Struct({ status: Schema.Literal('ok') });

export const decodePackageSearchResponse = Schema.decodeUnknownSync(
  ParsedPackagesSearchResponseSchema,
  StrictDecodeOptions,
);

export const decodePackageDeclarationsResponse = Schema.decodeUnknownSync(
  PackageDeclarationsResponseSchema,
  StrictDecodeOptions,
);

export const decodePackageMeasurementsResponse = Schema.decodeUnknownSync(
  PackageMeasurementsResponseSchema,
  StrictDecodeOptions,
);

export const decodeHealthResponse = Schema.decodeUnknownSync(HealthResponseSchema, StrictDecodeOptions);
