import { Predicate, Schema } from 'effect';

import { TelemetryComparisonPackageSchema, TelemetryComparisonVersionSchema } from './telemetry.schema';

const isPackage = Schema.is(TelemetryComparisonPackageSchema);

const isVersion = Schema.is(TelemetryComparisonVersionSchema);

type ComparisonTelemetryKey = 'comparison.package.name' | 'comparison.version.from' | 'comparison.version.to';

export type ComparisonTelemetryAttributes = Partial<Record<ComparisonTelemetryKey, string>>;

/** Call only with registry-resolved identity. Rejected inputs and requested selectors are not diagnostics. */
export const comparisonTelemetryAttributes = (comparison: {
  readonly packageName: string;
  readonly from: string | { readonly version: string };
  readonly to: string | { readonly version: string };
}): ComparisonTelemetryAttributes => {
  try {
    const { packageName, from: resolvedFrom, to: resolvedTo } = comparison;
    const from = Predicate.isString(resolvedFrom) ? resolvedFrom : resolvedFrom.version;
    const to = Predicate.isString(resolvedTo) ? resolvedTo : resolvedTo.version;

    if (!isPackage(packageName) || !isVersion(from) || !isVersion(to)) return {};

    return {
      'comparison.package.name': packageName,
      'comparison.version.from': from,
      'comparison.version.to': to,
    };
  } catch {
    // Incomplete or unreadable metadata is absent evidence, never an application failure.
    return {};
  }
};
