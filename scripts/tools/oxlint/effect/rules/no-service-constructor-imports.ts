import { defineRule } from '@oxlint/plugins';
import type { ESTree } from '@oxlint/plugins';

const SERVICE_CONSTRUCTOR_NAME = /^make[A-Z]/u;
const TEST_FILE = /\.(?:test|spec|unit)\.[cm]?[jt]sx?$/u;

function isProjectLocalImport(source: string): boolean {
  return source.startsWith('./') || source.startsWith('../');
}

function getImportedName(specifier: ESTree.ImportSpecifier): string {
  if (specifier.imported.type === 'Identifier') return specifier.imported.name;
  return specifier.imported.value;
}

/** Keep dependency-bearing Effect service constructors local to their owning capability modules. */
export const noServiceConstructorImportsRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: 'Reserve relative named make<UppercaseName> imports for test, spec, and unit files.',
    },
    messages: {
      serviceConstructorImport:
        'relative named import `{{name}}` uses the reserved make<UppercaseName> convention' +
        '\nhelp: for an Effect service, import the owning Layer and yield the contextual service; let its requirements reach the composition root' +
        '\nhelp: for a non-service factory, choose an owner-level name describing its operation and update its callers; do not add a Layer solely to satisfy this rule' +
        '\nnote: this is an import-name convention, not proof that the value constructs an Effect service; test, spec, and unit files are exempt',
    },
  },
  create(context) {
    const isTestFile = TEST_FILE.test(context.filename.replaceAll('\\', '/'));

    return {
      ImportDeclaration(node) {
        if (isTestFile || !isProjectLocalImport(node.source.value)) return;

        for (const specifier of node.specifiers) {
          if (specifier.type !== 'ImportSpecifier') continue;

          const importedName = getImportedName(specifier);
          if (!SERVICE_CONSTRUCTOR_NAME.test(importedName)) continue;

          context.report({
            node: specifier,
            messageId: 'serviceConstructorImport',
            data: { name: importedName },
          });
        }
      },
    };
  },
});
