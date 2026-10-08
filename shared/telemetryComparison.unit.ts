import { describe, expect, it } from 'vitest';

import { comparisonTelemetryAttributes } from './telemetryComparison';

// These cases catch unresolved selectors being presented as concrete versions and diagnostic input leaking as text.
describe('comparisonTelemetryAttributes', () => {
  it('preserves requested selectors before resolution without claiming concrete versions', () => {
    expect(
      comparisonTelemetryAttributes({ packageName: '@scope/package' }, { from: '^1.0.0', to: ' latest ' }),
    ).toEqual({
      'comparison.package.name': '@scope/package',
      'comparison.requested.from': '^1.0.0',
      'comparison.requested.to': 'latest',
    });
  });

  it('keeps differing selectors beside resolved prerelease and build versions', () => {
    expect(
      comparisonTelemetryAttributes(
        { packageName: '@scope/package', from: '1.2.3-beta.1', to: '2.0.0+build.7' },
        { from: '^1.2.3-beta.1', to: 'latest' },
      ),
    ).toEqual({
      'comparison.package.name': '@scope/package',
      'comparison.version.from': '1.2.3-beta.1',
      'comparison.version.to': '2.0.0+build.7',
      'comparison.requested.from': '^1.2.3-beta.1',
      'comparison.requested.to': 'latest',
    });
  });

  it('does not duplicate selectors matching the resolved versions', () => {
    expect(
      comparisonTelemetryAttributes(
        { packageName: 'package', from: '1.0.0', to: '2.0.0' },
        { from: '1.0.0', to: '2.0.0' },
      ),
    ).toEqual({
      'comparison.package.name': 'package',
      'comparison.version.from': '1.0.0',
      'comparison.version.to': '2.0.0',
    });
  });

  it('omits unsafe identifiers independently without breaking an operation', () => {
    expect(
      comparisonTelemetryAttributes(
        { packageName: 'https://private.example/token', from: 'latest', to: '2.0.0' },
        { from: 'file:/private/token', to: 'latest\nprivate-error' },
      ),
    ).toEqual({ 'comparison.version.to': '2.0.0' });
  });
});
