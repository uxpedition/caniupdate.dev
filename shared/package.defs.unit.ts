import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { RegistryVersionManifestSchema, toPackageVersion } from './package.defs';

const curate = (fixture: unknown) =>
  toPackageVersion(Schema.decodeUnknownSync(RegistryVersionManifestSchema)(fixture, { errors: 'all' }));

// Live `GET https://registry.npmjs.org/{package}/{version}` slices with `Accept: application/json`.
// Registry-added `dist` keys (`signatures`, `attestations`, `npm-signature`) stay in the fixtures so the
// schema is pinned to tolerating keys we do not consume.

const vueManifest = {
  name: 'vue',
  version: '3.5.0',
  dist: {
    shasum: '39ad668cc76052b058a5160976fb23298afed5da',
    tarball: 'https://registry.npmjs.org/vue/-/vue-3.5.0.tgz',
    fileCount: 37,
    integrity: 'sha512-1t70favYoFijwfWJ7g81aTd32obGaAnKYE9FNyMgnEzn3F4YncRi/kqAHHKloG0VXTD8vBYMhbgLKCA+Sk6QDw==',
    signatures: [
      {
        sig: 'MEQCIDk3vrzSz4E1Ux5+25i+/6UZJ4Fl9t+PXbrSPe2bknrvAiBjwiYx5MXjS/haH5FVkvY+VFc5w53XIGA/nd7Ivyw/mA==',
        keyid: 'SHA256:jl3bwswu80PjjokCgh0o2w5c2U4LhQAE57gj9cz1kzA',
      },
    ],
    attestations: {
      url: 'https://registry.npmjs.org/-/npm/v1/attestations/vue@3.5.0',
      provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
    },
    unpackedSize: 2374183,
  },
  license: 'MIT',
  dependencies: {
    '@vue/shared': '3.5.0',
    '@vue/runtime-dom': '3.5.0',
    '@vue/compiler-dom': '3.5.0',
    '@vue/compiler-sfc': '3.5.0',
    '@vue/server-renderer': '3.5.0',
  },
  peerDependencies: { typescript: '*' },
  peerDependenciesMeta: { typescript: { optional: true } },
  main: 'index.js',
  module: 'dist/vue.runtime.esm-bundler.js',
  // Abridged: the live map also declares `./dist/*`, `./jsx-runtime`, `./compiler-sfc`, `./jsx-dev-runtime`, `./server-renderer`.
  exports: {
    '.': {
      import: { node: './index.mjs', types: './dist/vue.d.mts', default: './dist/vue.runtime.esm-bundler.js' },
      require: { node: { default: './index.js' }, types: './dist/vue.d.ts', default: './index.js' },
    },
    './package.json': './package.json',
  },
  types: 'dist/vue.d.ts',
};

const coffeeScriptManifest = {
  name: 'coffee-script',
  version: '1.6.3',
  dist: {
    shasum: '6355d32cf1b04cdff6b484e5e711782b2f0c39be',
    tarball: 'https://registry.npmjs.org/coffee-script/-/coffee-script-1.6.3.tgz',
    integrity: 'sha512-lpusDYw9xym9ZOqFIeQuzzvTvunm2nlRL++BYhUcLn+77vuidExZG+qDPSKUfDXvuaHeFK6QavntXF+HiOq+/Q==',
    signatures: [
      {
        sig: 'MEUCIFJm1TvzPoR+R47RHSXYFFRvsM/ji9qSNRslpoZg2o2jAiEAggYEBaFf4WBM77VvBZ9MxTPW7Lmg15+mNJXRebDUKB0=',
        keyid: 'SHA256:jl3bwswu80PjjokCgh0o2w5c2U4LhQAE57gj9cz1kzA',
      },
    ],
  },
  licenses: [{ url: 'https://raw.github.com/jashkenas/coffee-script/master/LICENSE', type: 'MIT' }],
  deprecated: 'CoffeeScript on NPM has moved to "coffeescript" (no hyphen)',
  engines: { node: '>=0.8.0' },
  scripts: { test: 'node ./bin/cake test' },
  main: './lib/coffee-script/coffee-script',
};

const esbuildManifest = {
  name: 'esbuild',
  version: '0.21.5',
  dist: {
    shasum: '9ca301b120922959b766360d8ac830da0d02997d',
    tarball: 'https://registry.npmjs.org/esbuild/-/esbuild-0.21.5.tgz',
    fileCount: 7,
    integrity: 'sha512-mg3OPMV4hXywwpoDxu3Qda5xCKQi+vCTZq8S9J/EpkhB2HzKXq4SNFZE3+NK93JYxc8VMSep+lOUSC/RVKaBqw==',
    unpackedSize: 133372,
  },
  license: 'MIT',
  engines: { node: '>=12' },
  // Abridged: the live manifest declares 23 platform packages.
  optionalDependencies: {
    '@esbuild/aix-ppc64': '0.21.5',
    '@esbuild/linux-x64': '0.21.5',
    '@esbuild/win32-x64': '0.21.5',
  },
  scripts: { postinstall: 'node install.js' },
  main: 'lib/main.js',
  types: 'lib/main.d.ts',
};

const lodashManifest = {
  name: 'lodash',
  version: '0.1.0',
  dist: {
    shasum: '392617f69a947e40cec7848d85fcc3dd29d74bc5',
    tarball: 'https://registry.npmjs.org/lodash/-/lodash-0.1.0.tgz',
    integrity: 'sha512-ufIfwX7g5obXKaJhzbnAJBNf5Idxqty+AHaNadWFxtNKjGmF/ZO8ptSEjQRQRymBPZtLa0NV9sbrsH87Ae2R1A==',
  },
  licenses: [{ url: 'http://mths.be/mit', type: 'MIT' }],
  engines: ['node', 'rhino'],
  dependencies: {},
  optionalDependencies: {},
  main: 'lodash',
};

describe('toPackageVersion', () => {
  it('curates a modern manifest: string license, exports map, optional peer', () => {
    expect(curate(vueManifest)).toEqual({
      name: 'vue',
      version: '3.5.0',
      dist: {
        tarball: 'https://registry.npmjs.org/vue/-/vue-3.5.0.tgz',
        integrity: 'sha512-1t70favYoFijwfWJ7g81aTd32obGaAnKYE9FNyMgnEzn3F4YncRi/kqAHHKloG0VXTD8vBYMhbgLKCA+Sk6QDw==',
        unpackedSize: 2374183,
        fileCount: 37,
      },
      licenses: ['MIT'],
      deprecated: false,
      engines: {},
      dependencies: {
        '@vue/shared': '3.5.0',
        '@vue/runtime-dom': '3.5.0',
        '@vue/compiler-dom': '3.5.0',
        '@vue/compiler-sfc': '3.5.0',
        '@vue/server-renderer': '3.5.0',
      },
      peerDependencies: { typescript: '*' },
      optionalDependencies: {},
      optionalPeers: ['typescript'],
      installScripts: [],
      installScriptCommands: {},
      moduleFormat: {
        main: 'index.js',
        module: 'dist/vue.runtime.esm-bundler.js',
        exports: {
          '.': {
            import: { node: './index.mjs', types: './dist/vue.d.mts', default: './dist/vue.runtime.esm-bundler.js' },
            require: { node: { default: './index.js' }, types: './dist/vue.d.ts', default: './index.js' },
          },
          './package.json': './package.json',
        },
        types: 'dist/vue.d.ts',
      },
    });
  });

  it('curates a legacy manifest: licenses array, deprecation message, no published sizes', () => {
    expect(curate(coffeeScriptManifest)).toEqual({
      name: 'coffee-script',
      version: '1.6.3',
      dist: {
        tarball: 'https://registry.npmjs.org/coffee-script/-/coffee-script-1.6.3.tgz',
        integrity: 'sha512-lpusDYw9xym9ZOqFIeQuzzvTvunm2nlRL++BYhUcLn+77vuidExZG+qDPSKUfDXvuaHeFK6QavntXF+HiOq+/Q==',
      },
      licenses: ['MIT'],
      deprecated: true,
      deprecationMessage: 'CoffeeScript on NPM has moved to "coffeescript" (no hyphen)',
      engines: { node: '>=0.8.0' },
      dependencies: {},
      peerDependencies: {},
      optionalDependencies: {},
      optionalPeers: [],
      installScripts: [],
      installScriptCommands: {},
      moduleFormat: { main: './lib/coffee-script/coffee-script' },
    });
  });

  it('keeps only install lifecycle scripts and platform optional dependencies', () => {
    expect(curate(esbuildManifest)).toEqual({
      name: 'esbuild',
      version: '0.21.5',
      dist: {
        tarball: 'https://registry.npmjs.org/esbuild/-/esbuild-0.21.5.tgz',
        integrity: 'sha512-mg3OPMV4hXywwpoDxu3Qda5xCKQi+vCTZq8S9J/EpkhB2HzKXq4SNFZE3+NK93JYxc8VMSep+lOUSC/RVKaBqw==',
        unpackedSize: 133372,
        fileCount: 7,
      },
      licenses: ['MIT'],
      deprecated: false,
      engines: { node: '>=12' },
      dependencies: {},
      peerDependencies: {},
      optionalDependencies: {
        '@esbuild/aix-ppc64': '0.21.5',
        '@esbuild/linux-x64': '0.21.5',
        '@esbuild/win32-x64': '0.21.5',
      },
      optionalPeers: [],
      installScripts: ['postinstall'],
      installScriptCommands: { postinstall: 'node install.js' },
      moduleFormat: { main: 'lib/main.js', types: 'lib/main.d.ts' },
    });
  });

  it('normalizes an engine array, including a bare engine name', () => {
    expect(curate(lodashManifest).engines).toEqual({ node: '', rhino: '' });
  });

  it('rejects a version manifest whose published size is not a number', () => {
    expect(() => curate({ ...vueManifest, dist: { ...vueManifest.dist, unpackedSize: '2374183' } })).toThrow(
      Schema.SchemaError,
    );
  });
});
