import { Predicate, type Schema } from 'effect';

import type {
  DeclaredPackageVersion,
  DeclarationChange,
  DeclarationComparison,
  DependencyRequirement,
  ValueComparison,
} from '#shared/comparison/comparison.defs';

// Children are already decoded JSON; only the container shape needs narrowing at each level.
const isExportContainer = (value: Schema.Json): value is Schema.JsonObject | Schema.JsonArray =>
  Predicate.isObjectOrArray(value);

// Keep object order for conditional exports and typesVersions: first matching conditions win.
const equal = <T>(from: T, to: T): boolean => JSON.stringify(from) === JSON.stringify(to);

const compareValue = <T>(from: T | undefined, to: T | undefined): ValueComparison<T> => ({
  changed: !equal(from, to),
  from: from ?? null,
  to: to ?? null,
  fromDeclared: from !== undefined,
  toDeclared: to !== undefined,
});

function compareDeclarationMaps<T>(from: ReadonlyMap<string, T>, to: ReadonlyMap<string, T>): DeclarationChange<T>[] {
  const changes: DeclarationChange<T>[] = [];

  for (const name of [...new Set([...from.keys(), ...to.keys()])].sort()) {
    const before = from.get(name);
    const after = to.get(name);

    if (!equal(before, after))
      changes.push({
        name,
        kind: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed',
        from: before ?? null,
        to: after ?? null,
      });
  }

  return changes;
}

function dependencies(version: DeclaredPackageVersion): Map<string, DependencyRequirement> {
  const result = new Map<string, DependencyRequirement>();

  for (const [name, range] of Object.entries(version.dependencies)) result.set(name, { category: 'runtime', range });

  for (const [name, range] of Object.entries(version.optionalDependencies))
    result.set(name, { category: 'optional', range });

  return result;
}

function peers(version: DeclaredPackageVersion) {
  const optional = new Set(version.optionalPeers);

  return new Map(
    Object.entries(version.peerDependencies).map(([name, range]) => [name, { range, optional: optional.has(name) }]),
  );
}

type ModuleDeclaration = NonNullable<DeclarationComparison['moduleFormat']['from']>;

type TypeDeclaration = NonNullable<DeclarationComparison['types']['from']>;

type Writable<T> = { -readonly [Key in keyof T]: T[Key] };

type TypeDeclarationFields = Omit<Writable<TypeDeclaration>, 'exports'>;

function moduleDeclaration(version: DeclaredPackageVersion) {
  const { type, main, module } = version.moduleFormat;
  const declaration: Writable<ModuleDeclaration> = {};

  if (type !== undefined) declaration.type = type;

  if (main !== undefined) declaration.main = main;

  if (module !== undefined) declaration.module = module;

  return declaration;
}

// Walks registry-declared conditional export JSON; objects and arrays both branch, scalars end the walk.
function hasTypeCondition(value: Schema.Json): boolean {
  if (!isExportContainer(value)) return false;

  return Object.entries(value).some(
    ([key, child]) => key === 'types' || key.startsWith('types@') || hasTypeCondition(child),
  );
}

function typeDeclaration(version: DeclaredPackageVersion) {
  const { types, typings, typesVersions, exports } = version.moduleFormat;

  const declaration: TypeDeclarationFields = {};

  if (types !== undefined) declaration.types = types;

  if (typings !== undefined) declaration.typings = typings;

  if (typesVersions !== undefined) declaration.typesVersions = typesVersions;

  return { ...declaration, exports: exports !== undefined && hasTypeCondition(exports) ? exports : null };
}

export function compareDeclarations(from: DeclaredPackageVersion, to: DeclaredPackageVersion): DeclarationComparison {
  const oldLicenses = [...new Set(from.licenses)].sort();
  const newLicenses = [...new Set(to.licenses)].sort();

  return {
    dependencies: compareDeclarationMaps(dependencies(from), dependencies(to)),
    peers: compareDeclarationMaps(peers(from), peers(to)),
    node: compareValue(from.engines.node, to.engines.node),
    moduleFormat: compareValue(moduleDeclaration(from), moduleDeclaration(to)),
    exports: compareValue(from.moduleFormat.exports, to.moduleFormat.exports),
    types: compareValue(typeDeclaration(from), typeDeclaration(to)),
    licenses: {
      changed: !equal(oldLicenses, newLicenses),
      from: oldLicenses,
      to: newLicenses,
      added: newLicenses.filter((license) => !oldLicenses.includes(license)),
      removed: oldLicenses.filter((license) => !newLicenses.includes(license)),
    },
    installScripts: compareDeclarationMaps(
      new Map(Object.entries(from.installScriptCommands)),
      new Map(Object.entries(to.installScriptCommands)),
    ),
  };
}
