import { describe, expect, it } from 'vitest';

import { comparisonTelemetryAttributes } from './telemetryComparison';

describe('resolved public comparison identity', () => {
  it('retains author-named scoped packages and resolved prerelease/build versions', () => {
    expect(
      comparisonTelemetryAttributes({ packageName: '@sindresorhus/is', from: '1.2.3-beta.1', to: '2.0.0+build.7' }),
    ).toEqual({
      'comparison.package.name': '@sindresorhus/is',
      'comparison.version.from': '1.2.3-beta.1',
      'comparison.version.to': '2.0.0+build.7',
    });
  });
  it('does not attach unresolved or rejected identity', () => {
    expect(comparisonTelemetryAttributes({ packageName: '@author/unknown', from: '^1.0.0', to: 'latest' })).toEqual({});
    expect(
      comparisonTelemetryAttributes({ packageName: 'https://private.test/input', from: '1.0.0', to: '2.0.0' }),
    ).toEqual({});
  });
});
