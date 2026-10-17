import { Effect, Schema } from 'effect';

import {
  PackageDeclarationsResponseSchema,
  PackageMeasurementsResponseSchema,
} from '../../../shared/comparison/comparison.defs.ts';
import { ParsedPackagesSearchResponseSchema } from '../../../shared/comparison/package/search.defs.ts';
import { SmokeFailure } from './errors.ts';

const StrictDecodeOptions = { errors: 'all' as const, onExcessProperty: 'error' as const };

const decode =
  <S extends Schema.Constraint>(schema: S, stage: string) =>
  (input: Effect.Effect<unknown, SmokeFailure>) =>
    input.pipe(
      Effect.flatMap((value) => Schema.decodeUnknownEffect(schema, StrictDecodeOptions)(value)),
      Effect.mapError(() => new SmokeFailure(stage)),
    );

export const decodePackageSearchResponse = decode(ParsedPackagesSearchResponseSchema, 'browser-interaction');

export const decodePackageDeclarationsResponse = decode(PackageDeclarationsResponseSchema, 'browser-interaction');

export const decodePackageMeasurementsResponse = decode(PackageMeasurementsResponseSchema, 'browser-interaction');
