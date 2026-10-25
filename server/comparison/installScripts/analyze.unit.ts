import { createHash } from 'node:crypto';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { analyzeInstallScripts } from './analyze';

function inspect(code: Record<string, string>, scripts: Record<string, string> = { postinstall: 'node install.js' }) {
  const sources = new Map(Object.entries(code));

  const files = [...sources].map(([path, body]) => ({
    path,
    type: 'file' as const,
    size: Buffer.byteLength(body),
    sha256: createHash('sha256').update(body).digest('hex'),
  }));

  return Effect.runSync(analyzeInstallScripts(scripts, files, sources));
}

describe('package-local install analysis', () => {
  it('does not classify inherited property names as built-in operations', () => {
    const result = inspect({ 'install.js': 'const fs = require("node:fs"); fs.toString(); fs.constructor();' });
    expect(result.analysis.findings).toEqual([]);
  });

  it('stops repeated npm-script expansion within its work budget', () => {
    const steps = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [
        `step${index}`,
        `npm run step${index + 1} && npm run step${index + 1}`,
      ]),
    );

    const scripts = {
      postinstall: 'npm run a',
      a: 'npm run b && npm run b',
      b: 'npm run step0',
      ...steps,
      step10: 'node install.js',
    };

    const result = inspect({ 'install.js': 'fetch("https://example.com");' }, scripts);
    expect(result.analysis.status).toBe('partial');
    expect(result.analysis.findings).toEqual([expect.objectContaining({ kind: 'network', path: 'install.js' })]);
  });

  it('finds aliased and destructured APIs with original lines, not comments or strings', () => {
    const result = inspect({
      'install.js':
        '// exec("not code")\nconst { execFileSync: run } = require("node:child_process");\nconst invoke = run;\ninvoke("tool");\nconst text = "fetch(never)";',
    });

    expect(result.analysis.findings).toEqual([
      expect.objectContaining({
        kind: 'process',
        path: 'install.js',
        line: 4,
        detail: 'tool',
        excerpt: 'invoke("tool")',
      }),
    ]);
  });

  it('does not turn unused imports or shadowed bindings into operation findings', () => {
    const result = inspect({
      'install.js':
        'import fs from "node:fs";\nfunction example(fs) { fs.writeFileSync("not-node-fs", "x"); }\nfunction other(fetch) { fetch("not-global-fetch"); }',
    });

    expect(result.analysis.findings).toEqual([]);
  });

  it('follows local modules and cycles while ignoring unrelated shipped files', () => {
    const result = inspect({
      'install.js': 'require("./helpers/task");',
      'helpers/task.js': 'require("../install.js");\nfetch("https://example.com/file");',
      'unused.js': 'eval("never reached");',
    });

    expect(result.analysis.scripts[0]?.files).toEqual(['helpers/task.js', 'install.js']);
    expect(result.analysis.findings).toEqual([
      expect.objectContaining({ kind: 'network', path: 'helpers/task.js', line: 2 }),
    ]);
    expect(result.files.map(({ path }) => path)).toEqual(['helpers/task.js', 'install.js']);
  });

  it('follows self-referencing imports through exports and continues through local files', () => {
    const result = inspect({
      'package.json': JSON.stringify({ name: 'puppeteer', exports: { './internal/*': './lib/*' } }),
      'install.js': 'import("puppeteer/internal/node/install.js");',
      'lib/node/install.js': 'export * from "./download.js";',
      'lib/node/download.js': 'fetch("https://example.com/browser");',
    });

    expect(result.analysis.findings).toEqual([
      expect.objectContaining({ kind: 'network', path: 'lib/node/download.js' }),
    ]);
    expect(result.analysis.scripts[0]?.files).toEqual(['install.js', 'lib/node/download.js', 'lib/node/install.js']);
    expect(result.analysis.uninspectedPackages).toEqual([]);
    expect(result.analysis.status).toBe('available');
  });

  it('uses import and require conditions for scoped package self references', () => {
    const result = inspect({
      'package.json': JSON.stringify({
        name: '@scope/tool',
        exports: { node: { import: './esm.js', require: './common.cjs' }, default: './unused.js' },
      }),
      'install.js': 'require("@scope/tool"); import("@scope/tool");',
      'esm.js': 'fetch("https://example.com");',
      'common.cjs': 'require("node:child_process").execSync("compiler"); require("@scope/tool");',
      'unused.js': 'eval("not selected");',
    });

    expect(result.analysis.findings).toEqual([
      expect.objectContaining({ kind: 'process', path: 'common.cjs' }),
      expect.objectContaining({ kind: 'network', path: 'esm.js' }),
    ]);
    expect(result.analysis.uninspectedPackages).toEqual([]);
    expect(result.analysis.status).toBe('available');
  });

  it('distinguishes ignored custom conditions from invalid array-index conditions', () => {
    const result = inspect({
      'package.json': JSON.stringify({
        name: 'tool',
        exports: {
          '.': { '01': './wrong.js', default: './selected.js' },
          './blocked': { '0': './wrong.js', default: './wrong.js' },
        },
      }),
      'install.js': 'import("tool"); import("tool/blocked");',
      'selected.js': 'fetch("https://example.com");',
      'wrong.js': 'eval("not selected");',
    });

    expect(result.analysis.findings).toEqual([expect.objectContaining({ kind: 'network', path: 'selected.js' })]);
    expect(result.analysis.status).toBe('partial');
  });

  it('follows local import aliases but stops aliases pointing to dependencies', () => {
    const result = inspect({
      'package.json': JSON.stringify({
        imports: { '#installer': './lib/install.js', '#external': 'dependency/setup' },
      }),
      'install.js': 'require("#installer"); require("#external");',
      'lib/install.js': 'fetch("https://example.com");',
      'node_modules/dependency/setup.js': 'eval("dependency code");',
    });

    expect(result.analysis.findings).toEqual([expect.objectContaining({ kind: 'network', path: 'lib/install.js' })]);
    expect(result.analysis.uninspectedPackages).toEqual(['dependency']);
    expect(result.analysis.scripts[0]?.files).toEqual(['install.js', 'lib/install.js']);
    expect(result.analysis.status).toBe('partial');
  });

  it('respects exact exports, the most specific pattern, and blocked subpaths', () => {
    const result = inspect({
      'package.json': JSON.stringify({
        name: 'tool',
        exports: {
          './*': './broad/*.js',
          './install/*': './lib/*',
          './private/*': null,
          './exact': './exact.js',
        },
      }),
      'install.js': 'import("tool/install/task.js"); import("tool/private/task"); import("tool/exact");',
      'lib/task.js': 'fetch("https://example.com");',
      'exact.js': 'require("node:child_process").execSync("compiler");',
      'broad/install/task.js.js': 'eval("wrong pattern");',
      'broad/private/task.js': 'eval("blocked");',
      'broad/exact.js': 'eval("wrong exact match");',
    });

    expect(result.analysis.findings).toEqual([
      expect.objectContaining({ kind: 'process', path: 'exact.js' }),
      expect.objectContaining({ kind: 'network', path: 'lib/task.js' }),
    ]);
    expect(result.analysis.scripts[0]?.files).toEqual(['exact.js', 'install.js', 'lib/task.js']);
    expect(result.analysis.status).toBe('partial');
    expect(result.analysis.uninspectedPackages).toEqual([]);
  });

  it('uses the nearest package scope for private import aliases', () => {
    const result = inspect({
      'package.json': JSON.stringify({ imports: { '#helper': './wrong.js' } }),
      'install.js': 'require("./lib/entry.js");',
      'lib/package.json': JSON.stringify({ imports: { '#helper': './helper.js' } }),
      'lib/entry.js': 'require("#helper");',
      'lib/helper.js': 'fetch("https://example.com");',
      'wrong.js': 'eval("wrong scope");',
    });

    expect(result.analysis.findings).toEqual([expect.objectContaining({ kind: 'network', path: 'lib/helper.js' })]);
    expect(result.analysis.status).toBe('available');
  });

  it('never follows dependencies inside node_modules, even through relative imports', () => {
    const result = inspect({
      'install.js': 'require("dependency"); require("./node_modules/dependency/index.js"); require("../outside.js");',
      'dependency.js': 'eval("not a self reference");',
      'node_modules/dependency/index.js': 'fetch("https://example.com/dependency");',
    });

    expect(result.analysis.findings).toEqual([]);
    expect(result.analysis.scripts[0]?.files).toEqual(['install.js']);
    expect(result.analysis.uninspectedPackages).toEqual(['dependency']);
    expect(result.analysis.status).toBe('partial');
  });

  it.each([
    '../outside.js',
    './lib/../danger.js',
    './lib/%2e%2e/danger.js',
    './node_modules/dependency/index.js',
    './%6eode_modules/dependency/index.js',
  ])('rejects package mappings outside the allowed file boundary: %s', (target) => {
    const result = inspect({
      'package.json': JSON.stringify({ name: 'tool', exports: target }),
      'install.js': 'import("tool");',
      'danger.js': 'fetch("https://example.com/wrong");',
      'node_modules/dependency/index.js': 'fetch("https://example.com/dependency");',
    });

    expect(result.analysis.findings).toEqual([]);
    expect(result.analysis.scripts[0]?.files).toEqual(['install.js']);
    expect(result.analysis.status).toBe('partial');
  });

  it.each([
    { targets: [null, './danger.js'], reached: false },
    { targets: ['./missing.js', './danger.js'], reached: false },
    { targets: ['../invalid.js', './danger.js'], reached: true },
  ])('only skips invalid targets in export fallback arrays: $targets', ({ targets, reached }) => {
    const result = inspect({
      'package.json': JSON.stringify({ name: 'tool', exports: targets }),
      'install.js': 'require("tool");',
      'danger.js': 'fetch("https://example.com");',
    });

    expect(result.analysis.findings).toEqual(
      reached ? [expect.objectContaining({ kind: 'network', path: 'danger.js' })] : [],
    );
    expect(result.analysis.status).toBe(reached ? 'available' : 'partial');
  });

  it('follows CommonJS directory entries from their own package metadata', () => {
    const result = inspect({
      'install.js': 'require("./installer");',
      'installer/package.json': JSON.stringify({ main: './tasks' }),
      'installer/tasks/index.js': 'fetch("https://example.com");',
      'installer/index.js': 'eval("wrong fallback");',
    });

    expect(result.analysis.findings).toEqual([
      expect.objectContaining({ kind: 'network', path: 'installer/tasks/index.js' }),
    ]);
    expect(result.analysis.status).toBe('available');
  });

  it('preserves known calls when package metadata cannot resolve a self import', () => {
    const result = inspect({
      'package.json': '{"name":"tool","exports":',
      'install.js': 'import("tool"); fetch("https://example.com");',
      'tool.js': 'eval("not resolved");',
    });

    expect(result.analysis.findings).toEqual([expect.objectContaining({ kind: 'network', path: 'install.js' })]);
    expect(result.analysis.status).toBe('partial');
    expect(result.analysis.uninspectedPackages).toEqual([]);
  });

  it('resolves mappings independently of unused manifest fields', () => {
    const result = inspect({
      'package.json': JSON.stringify({ name: 'tool', exports: './helper.js', imports: null }),
      'install.js': 'import("tool");',
      'helper.js': 'require("./nested/entry.js");',
      'nested/package.json': JSON.stringify({ name: '', main: false, imports: { '#task': './task.js' } }),
      'nested/entry.js': 'import("#task");',
      'nested/task.js': 'fetch("https://example.com");',
    });

    expect(result.analysis.findings).toEqual([expect.objectContaining({ kind: 'network', path: 'nested/task.js' })]);
    expect(result.analysis.status).toBe('available');
  });

  it('does not follow files beneath a linked directory', () => {
    const source = 'require("./linked/helper.js");';

    const result = Effect.runSync(
      analyzeInstallScripts(
        { install: 'node install.js' },
        [
          { path: 'install.js', type: 'file', size: source.length, sha256: 'a'.repeat(64) },
          { path: 'linked', type: 'symlink', size: 0, sha256: null, linkTarget: '../dependency' },
          { path: 'linked/helper.js', type: 'file', size: 0, sha256: 'b'.repeat(64) },
        ],
        new Map([
          ['install.js', source],
          ['linked/helper.js', 'fetch("https://example.com/dependency");'],
        ]),
      ),
    );

    expect(result.analysis.findings).toEqual([]);
    expect(result.analysis.scripts[0]?.files).toEqual(['install.js']);
    expect(result.analysis.status).toBe('partial');
  });

  it('groups package subpaths once across all followed files', () => {
    const result = inspect({
      'install.js':
        'require("semver/functions/coerce"); require("@img/sharp-libvips-dev/include"); require("./helper.js");',
      'helper.js': 'require("semver/functions/gte"); require("@img/sharp-libvips-dev/cplusplus"); require("node-gyp");',
    });

    expect(result.analysis.uninspectedPackages).toEqual(['@img/sharp-libvips-dev', 'node-gyp', 'semver']);
    expect(result.analysis.status).toBe('partial');
    expect(result.analysis.reasons).toEqual([]);
  });

  it('keeps non-package import gaps separate from the package list', () => {
    const computed = 'require(process.env.HELPER);';
    const result = inspect({ 'install.js': `${computed} require("semver/functions/gte");` });

    expect(result.analysis.uninspectedPackages).toEqual(['semver']);
    expect(result.analysis.reasons).toEqual(inspect({ 'install.js': computed }).analysis.reasons);
  });

  it.each([40, 80])('bounds grouped packages across a %i-import file without losing known calls', (split) => {
    const names = Array.from({ length: 80 }, (_, index) => `package-${index}`);
    const imports = (packages: string[]) => packages.map((name) => `require("${name}");`).join('\n');

    const result = inspect({
      'install.js': `${imports(names.slice(0, split))}\nrequire("./helper.js");`,
      'helper.js': `${imports(names.slice(split))}\nfetch("https://example.com");`,
    });

    expect(result.analysis.uninspectedPackages).toEqual(names.slice(0, 64).sort());
    expect(result.analysis.status).toBe('partial');
    expect(result.analysis.findings).toEqual([expect.objectContaining({ kind: 'network', path: 'helper.js' })]);
  });

  it('does not label URL, absolute-path, or Node imports as npm packages', () => {
    const result = inspect({
      'install.js':
        'import "https://example.com/helper.js"; require("/tmp/helper.js"); require("node:inspector/promises"); require("semver");',
    });

    expect(result.analysis.uninspectedPackages).toEqual(['semver']);
    expect(result.analysis.status).toBe('partial');
    expect(result.analysis.findings).toEqual([]);
  });

  it('marks computed and external imports as gaps while preserving known operations', () => {
    const result = inspect({
      'install.js': 'require(process.env.HELPER);\nrequire("external-installer");\nfetch("https://example.com");',
    });

    expect(result.analysis.status).toBe('partial');
    expect(result.analysis.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'network' }),
        expect.objectContaining({ kind: 'environment' }),
      ]),
    );
  });

  it('does not claim calls use the original API after reassignment', () => {
    const result = inspect({
      'install.js': 'let run = require("node:child_process").exec;\nrun = () => {};\nrun("not a subprocess");',
    });

    expect(result.analysis.findings).toEqual([]);
    expect(result.analysis.status).toBe('partial');
  });

  it.each(['({ run } = replacement)', '[run] = replacement'])(
    'does not keep an API identity after destructuring reassignment: %s',
    (assignment) => {
      const result = inspect({
        'install.js': `let run = require("node:child_process").exec; ${assignment}; run("not a subprocess");`,
      });

      expect(result.analysis.findings).toEqual([]);
      expect(result.analysis.status).toBe('partial');
    },
  );

  it('recognizes APIs obtained from an awaited literal import', () => {
    // Published source must exercise dynamic-import syntax rather than load a module in this test.
    const result = inspect({
      'install.js': 'const { writeFile } = await import("node:fs/promises"); await writeFile("output", "data");',
    });

    expect(result.analysis.findings).toEqual([expect.objectContaining({ kind: 'file-write', detail: 'output' })]);
  });

  it('marks calculated method names on known APIs as incomplete', () => {
    const result = inspect({
      'install.js': 'const fs = require("node:fs"); const method = fs[process.argv[2]]; method("output");',
    });

    expect(result.analysis.status).toBe('partial');
    expect(result.analysis.findings).toEqual([]);
  });

  it('does not label opening a writable file as reading it', () => {
    const result = inspect({ 'install.js': 'require("node:fs").openSync("output", "w");' });
    expect(result.analysis.findings).toEqual([expect.objectContaining({ kind: 'file-open', detail: 'output' })]);
  });

  it('recognizes lexical shadows declared after a call', () => {
    const result = inspect({ 'install.js': 'function task() { fetch("not a global"); var fetch = () => {}; }' });
    expect(result.analysis.findings).toEqual([]);
  });

  it('follows npm-script hooks and reports an unresolved shell command', () => {
    const result = inspect(
      { 'install.js': 'fetch("https://example.com");' },
      { postinstall: 'npm run build && external-tool', prebuild: 'node install.js', build: 'node install.js' },
    );

    expect(result.analysis.scripts[0]?.files).toEqual(['install.js']);
    expect(result.analysis.findings).toEqual([expect.objectContaining({ kind: 'network', script: 'postinstall' })]);
    expect(result.analysis.status).toBe('partial');
  });

  it('does not guess how substitutions and redirects execute', () => {
    const result = inspect(
      { 'install.js': 'fetch("https://example.com");' },
      { postinstall: 'node $(echo install.js) > output' },
    );

    expect(result.analysis.status).toBe('partial');
    expect(result.analysis.findings).toEqual([]);
  });

  it('does not mistake a build-tool version check for a native build', () => {
    const result = inspect({ 'binding.gyp': '{}' }, { install: 'node-gyp --version' });
    expect(result.analysis.findings).toEqual([]);
    expect(result.analysis.status).toBe('partial');
  });

  it('reports implicit npm native builds without inventing a declared command', () => {
    const result = inspect({ 'binding.gyp': '{"targets": []}' }, {});
    expect(result.analysis.scripts).toEqual([
      { name: 'install', command: 'node-gyp rebuild', origin: 'implicit', files: ['binding.gyp'] },
    ]);
    expect(result.analysis.findings).toEqual([
      expect.objectContaining({ kind: 'native-build', path: 'binding.gyp', line: 1 }),
    ]);
    expect(
      inspect({ 'binding.gyp': '{}' }, { preinstall: 'echo custom' }).analysis.scripts.map(({ name }) => name),
    ).toEqual(['preinstall']);
  });

  it('keeps complete findings when another reached file cannot be parsed', () => {
    const result = inspect({
      'install.js': 'fetch("https://example.com"); require("./broken.js");',
      'broken.js': 'const =',
    });

    expect(result.analysis.status).toBe('partial');
    expect(result.analysis.findings).toEqual([expect.objectContaining({ kind: 'network' })]);
  });

  it('bounds excerpts without moving their original starting lines', () => {
    const result = inspect({ 'install.js': `\n\nfetch("https://example.com/${'a'.repeat(1000)}");` });
    const finding = result.analysis.findings[0];
    expect(finding?.line).toBe(3);
    expect(finding?.excerpt).toBe(`fetch("https://example.com/${'a'.repeat(1000)}`.slice(0, 600));
  });
});
