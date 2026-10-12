import { Schema } from 'effect';

import {
  TelemetryComparisonPackageSchema,
  TelemetryComparisonSelectorSchema,
  TelemetryComparisonVersionSchema,
} from './telemetry.schema';

const isPackage = Schema.is(TelemetryComparisonPackageSchema);

const isVersion = Schema.is(TelemetryComparisonVersionSchema);

const isSelector = Schema.is(TelemetryComparisonSelectorSchema);

type ComparisonTelemetryKey =
  | 'comparison.package.name'
  | 'comparison.version.from'
  | 'comparison.version.to'
  | 'comparison.requested.from'
  | 'comparison.requested.to';

const addRequestedSelector = (
  attributes: Partial<Record<ComparisonTelemetryKey, string>>,
  key: 'comparison.requested.from' | 'comparison.requested.to',
  requested: string,
  resolved: string | undefined,
): void => {
  const selector = requested.trim();

  if (isSelector(selector) && selector !== resolved) attributes[key] = selector;
};

/** Resolved versions are separate from requested selectors; missing resolution never invents a version. */
export const comparisonTelemetryAttributes = (
  comparison: { readonly packageName: string; readonly from?: string; readonly to?: string },
  requested?: { readonly from: string; readonly to: string },
): Partial<Record<ComparisonTelemetryKey, string>> => {
  const attributes: Partial<Record<ComparisonTelemetryKey, string>> = {};

  if (isPackage(comparison.packageName)) attributes['comparison.package.name'] = comparison.packageName;

  if (comparison.from !== undefined && isVersion(comparison.from))
    attributes['comparison.version.from'] = comparison.from;

  if (comparison.to !== undefined && isVersion(comparison.to)) attributes['comparison.version.to'] = comparison.to;

  if (requested !== undefined) {
    addRequestedSelector(
      attributes,
      'comparison.requested.from',
      requested.from,
      attributes['comparison.version.from'],
    );
    addRequestedSelector(attributes, 'comparison.requested.to', requested.to, attributes['comparison.version.to']);
  }

  return attributes;
};
