import type { SurfaceBadge } from './packageSurfaceBadges';

export type SurfaceBranch = {
  conditions: readonly string[];
  target: string | null;
};

export type SurfaceUsage = {
  label: string;
  example: string | null;
  detail: string;
  branches: readonly SurfaceBranch[];
};

export type SurfaceSide = {
  label: string;
  import: SurfaceUsage;
  require: SurfaceUsage;
  types: readonly SurfaceBranch[];
  signature: string;
};

export type SurfaceEntry = {
  key: string;
  path: string;
  depth: number;
  kind: 'entry' | 'group' | 'pattern';
  from: SurfaceSide;
  to: SurfaceSide;
};

export type SurfaceVersion = {
  version: string;
  badges: readonly SurfaceBadge[];
  declaredKeys: readonly string[];
  exportKeys: readonly string[];
  exportCount: number | null;
  patternCount: number;
  moduleDescription: string;
  moduleFields: readonly { name: string; value: string }[];
  types: readonly SurfaceBranch[];
  typeMappings: readonly { compiler: string; path: string; targets: readonly string[] }[];
};

export type SurfaceComparison = {
  entries: readonly SurfaceEntry[];
  from: SurfaceVersion;
  to: SurfaceVersion;
  summary:
    | { status: 'available'; same: number; changed: number; added: number; removed: number }
    | { status: 'unavailable'; reason: string };
};
