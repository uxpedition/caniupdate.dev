import type {
  DeclaredPackageVersion,
  DeclarationChange,
  DeclarationComparison,
  DependencyRequirement,
  ValueComparison,
} from '#shared/comparison/comparison.defs';

// Keep object order for conditional exports and typesVersions: first matching conditions win.
const equal = (from: unknown, to: unknown): boolean => JSON.stringify(from) === JSON.stringify(to);

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

function moduleDeclaration(version: DeclaredPackageVersion) {
  const { type, main, module } = version.moduleFormat;

  return {
    ...(type === undefined ? {} : { type }),
    ...(main === undefined ? {} : { main }),
    ...(module === undefined ? {} : { module }),
  };
}

function hasTypeCondition(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;

  return Object.entries(value).some(
    ([key, child]) => key === 'types' || key.startsWith('types@') || hasTypeCondition(child),
  );
}

function typeDeclaration(version: DeclaredPackageVersion) {
  const { types, typings, typesVersions, exports } = version.moduleFormat;

  return {
    ...(types === undefined ? {} : { types }),
    ...(typings === undefined ? {} : { typings }),
    ...(typesVersions === undefined ? {} : { typesVersions }),
    exports: hasTypeCondition(exports) ? (exports ?? null) : null,
  };
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
