import { Array as Arr, Predicate, type Schema } from 'effect';

import type { DeclaredPackageVersion } from '#shared/comparison/comparison.defs';

import type { SurfaceBranch, SurfaceVersion } from './packageSurface.defs';

export type ModuleFormat = DeclaredPackageVersion['moduleFormat'];

export type ExportMap = ReadonlyMap<string, Schema.Json>;

function jsonEntries(value: Schema.Json | undefined): [string, Schema.Json][] | undefined {
  if (
    value === undefined ||
    value === null ||
    Predicate.isString(value) ||
    Predicate.isNumber(value) ||
    Predicate.isBoolean(value)
  )
    return undefined;

  if (Arr.isArray<Schema.Json>(value)) return undefined;

  return Object.entries(value);
}

// An ordered declaration inventory, not a Node or TypeScript resolver.
export function declarationBranches(
  value: Schema.Json | undefined,
  conditions: readonly string[] = [],
): SurfaceBranch[] {
  if (Predicate.isString(value) || value === null) return [{ conditions, target: value }];

  if (Arr.isArray<Schema.Json | undefined>(value))
    return value.flatMap((item, index) => declarationBranches(item, [...conditions, `fallback ${index + 1}`]));

  const entries = jsonEntries(value) ?? [];

  if (entries.some(([condition]) => condition.startsWith('.'))) return [];

  return entries.flatMap(([condition, item]) => declarationBranches(item, [...conditions, condition]));
}

export function exportDeclarations(value: Schema.Json | undefined): ExportMap {
  if (value === undefined) return new Map();

  const entries = jsonEntries(value);

  if (entries && entries.every(([key]) => key === '.' || key.startsWith('./'))) return new Map(entries);

  return new Map([['.', value]]);
}

export function typeBranches(entries: readonly SurfaceBranch[]): SurfaceBranch[] {
  return entries.filter(({ conditions }) =>
    conditions.some((condition) => condition === 'types' || condition.startsWith('types@')),
  );
}

export function pathBranches(key: string, format: ModuleFormat, map: ExportMap) {
  const entries = declarationBranches(map.get(key));
  const types = typeBranches(entries);

  if (format.exports === undefined && key === '.') {
    if (format.main !== undefined) entries.push({ conditions: ['main'], target: format.main });

    if (format.types !== undefined) types.push({ conditions: ['types'], target: format.types });

    if (format.typings !== undefined) types.push({ conditions: ['typings'], target: format.typings });
  }

  return { entries, types };
}

function compilerMappings(value: Schema.Json | undefined): SurfaceVersion['typeMappings'] {
  return (jsonEntries(value) ?? []).flatMap(([compiler, paths]) =>
    (jsonEntries(paths) ?? []).map(([path, targets]) => ({
      compiler,
      path,
      targets: Arr.isArray<Schema.Json>(targets) ? targets.filter(Predicate.isString) : [],
    })),
  );
}

function moduleDescription(type: string | undefined): string {
  if (type === 'module') return '.js files are declared as ES modules. This alone does not rule out require().';

  if (type === 'commonjs') return '.js files are declared as CommonJS unless a more specific rule applies.';

  if (type === undefined)
    return 'No JavaScript file format declared. Legacy Node loading usually treats .js as CommonJS; runtime and file-level rules can differ.';

  return `Unrecognized module type: ${type}. Loading support cannot be determined.`;
}

function exportInventory(format: ModuleFormat, map: ExportMap) {
  const exportKeys: string[] = [];
  let complete = format.exports !== undefined;

  for (const [key, value] of map) {
    const branches = declarationBranches(value);

    if (branches.length === 0) complete = false;

    if (branches.some((branch) => branch.target !== null)) exportKeys.push(key);
  }

  const patternCount = exportKeys.filter((key) => key.includes('*')).length;

  return {
    declaredKeys: [...map.keys()],
    exportKeys,
    exportCount: complete ? exportKeys.length - patternCount : null,
    patternCount,
  };
}

export function versionSurface(
  version: DeclaredPackageVersion,
  map: ExportMap,
  badges: SurfaceVersion['badges'],
): SurfaceVersion {
  const format = version.moduleFormat;
  const types = [...map.entries()].flatMap(([key, value]) => typeBranches(declarationBranches(value, [key])));

  if (format.types !== undefined) types.push({ conditions: ['types field'], target: format.types });

  if (format.typings !== undefined) types.push({ conditions: ['typings field'], target: format.typings });

  return {
    version: version.version,
    badges,
    ...exportInventory(format, map),
    moduleDescription: moduleDescription(format.type),
    moduleFields: Object.entries({
      type: format.type,
      main: format.main,
      module: format.module,
    }).flatMap(([name, value]) => (value === undefined ? [] : [{ name, value }])),
    types,
    typeMappings: compilerMappings(format.typesVersions),
  };
}
