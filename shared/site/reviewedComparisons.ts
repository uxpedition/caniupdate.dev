import type { PackageDeclarationsResponse } from '../comparison/comparison.defs';

type ReviewedComparison = {
  readonly packageName: string;
  readonly from: string;
  readonly to: string;
  readonly evidence: 'moduleFormat' | 'dependencies' | 'peers' | 'node' | 'types';
  readonly rationale: string;
  readonly reviewedOn: string;
};

/** Bounded declaration-backed pilot; additions and removals require inventory review in an MR. No provider I/O. */
export const REVIEWED_COMPARISONS: readonly ReviewedComparison[] = [
  {
    packageName: 'typescript',
    from: '6.0.3',
    to: '7.0.2',
    evidence: 'node',
    rationale: 'Raises the Node requirement from >=14.17 to >=16.20.0 for the native compiler release.',
    reviewedOn: '2026-10-18',
  },
  {
    packageName: 'next',
    from: '15.5.28',
    to: '16.4.2',
    evidence: 'node',
    rationale: 'Raises the Node requirement to >=20.9.0.',
    reviewedOn: '2026-10-18',
  },
  {
    packageName: 'react-dom',
    from: '18.3.1',
    to: '19.3.1',
    evidence: 'peers',
    rationale: 'Changes the React peer requirement from ^18.3.1 to ^19.3.1.',
    reviewedOn: '2026-10-18',
  },
  {
    packageName: 'tailwindcss',
    from: '3.4.19',
    to: '4.3.3',
    evidence: 'types',
    rationale: 'Changes the root type entry for the v4 package structure.',
    reviewedOn: '2026-10-18',
  },
  {
    packageName: 'vite',
    from: '7.3.7',
    to: '8.3.4',
    evidence: 'dependencies',
    rationale: 'Changes build dependencies for the Rolldown-based toolchain.',
    reviewedOn: '2026-10-18',
  },
  {
    packageName: 'zod',
    from: '3.24.2',
    to: '4.6.7',
    evidence: 'types',
    rationale: 'Changes the root type entry from index.d.ts to index.d.cts.',
    reviewedOn: '2026-10-18',
  },
  {
    packageName: 'eslint',
    from: '9.39.5',
    to: '10.13.0',
    evidence: 'node',
    rationale: 'Changes the supported Node ranges for the v10 toolchain.',
    reviewedOn: '2026-10-18',
  },
  {
    packageName: 'vitest',
    from: '4.1.12',
    to: '5.0.5',
    evidence: 'node',
    rationale: 'Raises the supported Node ranges for the v5 test runner.',
    reviewedOn: '2026-10-18',
  },
  {
    packageName: 'express',
    from: '4.22.3',
    to: '5.3.0',
    evidence: 'dependencies',
    rationale: 'Changes direct dependencies across the Express 4 to 5 migration.',
    reviewedOn: '2026-10-18',
  },
  {
    packageName: 'react',
    from: '18.3.1',
    to: '19.3.1',
    evidence: 'dependencies',
    rationale: 'Removes loose-envify from direct dependencies.',
    reviewedOn: '2026-10-18',
  },
  {
    packageName: '@tanstack/react-query',
    from: '4.44.0',
    to: '5.104.4',
    evidence: 'peers',
    rationale: 'Changes React peer requirements across the v4 to v5 migration.',
    reviewedOn: '2026-10-18',
  },
  {
    packageName: '@prisma/client',
    from: '6.19.3',
    to: '7.10.1',
    evidence: 'node',
    rationale: 'Raises the supported Node ranges for Prisma Client 7.',
    reviewedOn: '2026-10-18',
  },
  {
    packageName: 'nuxt',
    from: '3.21.11',
    to: '4.6.2',
    evidence: 'node',
    rationale: 'Raises the supported Node ranges across the Nuxt 3 to 4 migration.',
    reviewedOn: '2026-10-18',
  },
  {
    packageName: 'svelte',
    from: '4.2.20',
    to: '5.57.2',
    evidence: 'node',
    rationale: 'Changes the Node requirement across the Svelte 4 to 5 migration.',
    reviewedOn: '2026-10-18',
  },
  {
    packageName: 'jest',
    from: '29.7.0',
    to: '30.5.2',
    evidence: 'node',
    rationale: 'Changes the supported Node ranges for Jest 30.',
    reviewedOn: '2026-10-18',
  },
  {
    packageName: '@angular/core',
    from: '21.2.25',
    to: '22.2.3',
    evidence: 'node',
    rationale: 'Changes the supported Node ranges for Angular 22.',
    reviewedOn: '2026-10-18',
  },
  {
    packageName: 'fastify',
    from: '4.29.1',
    to: '5.12.7',
    evidence: 'dependencies',
    rationale: 'Changes direct dependencies across the Fastify 4 to 5 migration.',
    reviewedOn: '2026-10-18',
  },
  {
    packageName: 'date-fns',
    from: '3.6.0',
    to: '4.4.0',
    evidence: 'moduleFormat',
    rationale: 'Changes the declared module format to module.',
    reviewedOn: '2026-10-18',
  },
  {
    packageName: 'prettier',
    from: '2.8.8',
    to: '3.9.10',
    evidence: 'node',
    rationale: 'Raises the Node requirement across the Prettier 2 to 3 migration.',
    reviewedOn: '2026-10-18',
  },
  {
    packageName: 'vue',
    from: '2.7.16',
    to: '3.5.44',
    evidence: 'dependencies',
    rationale: 'Changes compiler and runtime dependencies across the Vue 2 to 3 migration.',
    reviewedOn: '2026-10-18',
  },
];

/** An allowlisted URL alone is insufficient: the rendered declaration tier must support its reviewed evidence. */
export const isReviewedComparisonIndexable = (declarations: PackageDeclarationsResponse | undefined): boolean => {
  if (declarations === undefined) return false;

  const entry = REVIEWED_COMPARISONS.find(
    ({ packageName, from, to }) =>
      packageName === declarations.packageName && from === declarations.from.version && to === declarations.to.version,
  );

  if (entry === undefined) return false;
  const evidence = declarations.comparison[entry.evidence];

  return Array.isArray(evidence) ? evidence.length > 0 : evidence.changed;
};
