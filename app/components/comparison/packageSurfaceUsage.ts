import type { SurfaceBranch, SurfaceUsage } from './packageSurface.defs';
import type { ModuleFormat } from './packageSurfaceMetadata';

type LoadingMode = 'import' | 'require';

type UsageState =
  | 'No route declared'
  | 'Blocked'
  | 'Pattern'
  | 'File-specific'
  | 'Runtime-dependent'
  | 'Conditional'
  | 'Route declared';

const DETAILS: Record<UsageState, string> = {
  'No route declared': 'No matching loading route is declared. This is not a runtime compatibility test.',
  Blocked: 'These matching declarations explicitly block this path. Other conditions may differ.',
  Pattern: 'Replace * with a matching path. Published files have not been checked.',
  'File-specific': 'This target needs file-specific loading rules. No generic JavaScript example is shown.',
  'Runtime-dependent':
    'This route points to an ES module. require() depends on your Node version and the module; support is not established here.',
  Conditional:
    'The target depends on conditions and fallback order. The example shows syntax, not verified runtime support.',
  'Route declared':
    'The package declares a route for this syntax. Runtime support and exported values have not been checked.',
};

function usageState(
  path: string,
  mode: LoadingMode,
  matching: readonly SurfaceBranch[],
  format: ModuleFormat,
): UsageState {
  if (!matching.length) return 'No route declared';

  const targets = matching.filter((branch) => branch.target !== null);

  if (!targets.length) return 'Blocked';

  if (path.includes('*')) return 'Pattern';

  if (!targets.every(({ target }) => target !== null && /\.(?:[cm]?js)$/.test(target))) return 'File-specific';

  const esm = targets.some(
    ({ target }) => target?.endsWith('.mjs') || (target?.endsWith('.js') && format.type === 'module'),
  );

  if (mode === 'require' && esm) return 'Runtime-dependent';

  const conditional =
    matching.length > 1 ||
    matching.some(({ conditions }) =>
      conditions.some((condition) => !['import', 'require', 'default', 'main'].includes(condition)),
    );

  return conditional ? 'Conditional' : 'Route declared';
}

export function loadingUsage(
  path: string,
  mode: LoadingMode,
  entries: readonly SurfaceBranch[],
  format: ModuleFormat,
): SurfaceUsage {
  const opposite = mode === 'import' ? 'require' : 'import';

  const matching = entries.filter(
    ({ conditions }) =>
      !conditions.some(
        (condition) => condition === opposite || condition === 'types' || condition.startsWith('types@'),
      ),
  );

  const label = usageState(path, mode, matching, format);
  const hasExample = ['Runtime-dependent', 'Conditional', 'Route declared'].includes(label);

  const example =
    mode === 'import'
      ? `import * as pkg from ${JSON.stringify(path)};`
      : `const pkg = require(${JSON.stringify(path)});`;

  return { label, example: hasExample ? example : null, detail: DETAILS[label], branches: matching };
}
