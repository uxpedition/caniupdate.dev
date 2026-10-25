import { describe, expect, it } from 'vitest';

import type { InstallInspection } from '../../../shared/comparison/evidence/installScripts.defs';
import { compareInstallImplementation } from './compare';

const inspection = (
  files: InstallInspection['files'],
  status: InstallInspection['analysis']['status'] = 'available',
): InstallInspection => ({
  analysis: { status, reasons: [], uninspectedPackages: [], scripts: [], findings: [] },
  files,
});

describe('install implementation comparison', () => {
  it('reports changed content even when the entry command need not change', () => {
    expect(
      compareInstallImplementation(
        inspection([{ path: 'install.js', sha256: 'old' }]),
        inspection([{ path: 'install.js', sha256: 'new' }]),
      ),
    ).toEqual({ status: 'available', changedFiles: ['install.js'] });
  });

  it('keeps known changes with incomplete analysis but never treats an untraced file as absent', () => {
    const from = inspection([
      { path: 'install.js', sha256: 'old' },
      { path: 'untraced.js', sha256: 'same' },
    ]);

    const to = inspection([{ path: 'install.js', sha256: 'new' }], 'partial');
    expect(compareInstallImplementation(from, to)).toEqual({ status: 'partial', changedFiles: ['install.js'] });
  });

  it('does not claim unchanged content when one archive is unavailable', () => {
    expect(
      compareInstallImplementation(inspection([{ path: 'install.js', sha256: 'old' }]), inspection([], 'unavailable')),
    ).toEqual({ status: 'unavailable', changedFiles: [] });
  });
});
