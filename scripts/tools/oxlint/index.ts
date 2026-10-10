import { eslintCompatPlugin } from '@oxlint/plugins';

import { noArrayFilterMapRule } from './rules/no-array-filter-map.ts';
import { noConditionalEmptyObjectSpreadRule } from './rules/no-conditional-empty-object-spread.ts';
import { noKnownValueWideningRule } from './rules/no-known-value-widening.ts';
import { noLiveSuffixRule } from './rules/no-live-suffix.ts';
import { noObjectParametersRule } from './rules/no-object-parameters.ts';
import { noReduceAccumulatorCopyRule } from './rules/no-reduce-accumulator-copy.ts';
import { noReflectGetRule } from './rules/no-reflect-get.ts';
import { noRuntimeTypeofRule } from './rules/no-runtime-typeof.ts';
import { noUnknownParametersRule } from './rules/no-unknown-parameters.ts';
import { noUnknownReturnsRule } from './rules/no-unknown-returns.ts';
import { noUnknownTypeAliasesRule } from './rules/no-unknown-type-aliases.ts';
import { noUnsafeDictionaryTypeRule } from './rules/no-unsafe-dictionary-type.ts';
import { noWidenThenAssertRule } from './rules/no-widen-then-assert.ts';
import { requireReadableSpacingRule } from './rules/require-readable-spacing.ts';

/** Generic Oxlint rules that reject low-evidence and low-signal implementation patterns. */
const rulesPlugin = eslintCompatPlugin({
  meta: { name: 'rules' },
  rules: {
    'no-array-filter-map': noArrayFilterMapRule,
    'no-reduce-accumulator-copy': noReduceAccumulatorCopyRule,
    'no-conditional-empty-object-spread': noConditionalEmptyObjectSpreadRule,
    'no-known-value-widening': noKnownValueWideningRule,
    'no-live-suffix': noLiveSuffixRule,
    'no-object-parameters': noObjectParametersRule,
    'no-reflect-get': noReflectGetRule,
    'no-runtime-typeof': noRuntimeTypeofRule,
    'no-unknown-parameters': noUnknownParametersRule,
    'no-unknown-returns': noUnknownReturnsRule,
    'no-unknown-type-aliases': noUnknownTypeAliasesRule,
    'no-unsafe-dictionary-type': noUnsafeDictionaryTypeRule,
    'no-widen-then-assert': noWidenThenAssertRule,
    'require-readable-spacing': requireReadableSpacingRule,
  },
});

export default rulesPlugin;
