import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const LIVE_SUFFIX = /Live$/u;

/** Identifier nodes this rule treats as locally owned names. */
type OwnedIdentifier = ESTree.BindingIdentifier | ESTree.IdentifierName | ESTree.IdentifierReference;

const declarationNames = (node: ESTree.Node): ESTree.BindingIdentifier | null => {
	if (
		node.type === "VariableDeclarator" ||
		node.type === "FunctionDeclaration" ||
		node.type === "ClassDeclaration" ||
		node.type === "TSInterfaceDeclaration" ||
		node.type === "TSTypeAliasDeclaration" ||
		node.type === "TSEnumDeclaration" ||
		node.type === "TSModuleDeclaration"
	) {
		const id = node.id;
		return id !== null && id.type === "Identifier" ? id : null;
	}
	return null;
};

/** Reject the library-shaped `Live` suffix on names this repository owns. */
export const noLiveSuffixRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow the `Live` suffix on locally owned bindings and exports; third-party exports may be imported under an aliased name.",
		},
		messages: {
			liveSuffix:
				"The `{{name}}` name ends in `Live`, which mirrors external naming. Choose a descriptive local name, such as an explicit `...Layer` or capability name.",
		},
	},
	create(context) {
		const reportIfSuffixed = (identifier: OwnedIdentifier | null) => {
			if (identifier === null || !LIVE_SUFFIX.test(identifier.name)) return;
			context.report({
				node: identifier,
				messageId: "liveSuffix",
				data: { name: identifier.name },
			});
		};

		return {
			VariableDeclarator: (node) => reportIfSuffixed(declarationNames(node)),
			FunctionDeclaration: (node) => reportIfSuffixed(declarationNames(node)),
			ClassDeclaration: (node) => reportIfSuffixed(declarationNames(node)),
			TSInterfaceDeclaration: (node) => reportIfSuffixed(declarationNames(node)),
			TSTypeAliasDeclaration: (node) => reportIfSuffixed(declarationNames(node)),
			TSEnumDeclaration: (node) => reportIfSuffixed(declarationNames(node)),
			TSModuleDeclaration: (node) => reportIfSuffixed(declarationNames(node)),
			ImportSpecifier: (node) => {
				// Only an aliased import keeps a third-party `Live` name; a same-name binding is ours.
				if (node.imported.type === "Identifier" && node.imported.name === node.local.name) {
					reportIfSuffixed(node.local);
				}
			},
			ImportDefaultSpecifier: (node) => reportIfSuffixed(node.local),
			ImportNamespaceSpecifier: (node) => reportIfSuffixed(node.local),
			ExportSpecifier: (node) => {
				reportIfSuffixed(node.exported.type === "Identifier" ? node.exported : null);
			},
			ExportDefaultDeclaration: (node) => {
				if (node.declaration.type !== "Identifier") return;
				reportIfSuffixed(node.declaration);
			},
		};
	},
});
