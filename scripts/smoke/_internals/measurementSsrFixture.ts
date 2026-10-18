/** Private binding fixtures: no providers, queue, job namespace, or paid inference. */
export const measurementSsrFixture = `
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';

const counts = { measurements: 0, evidence: 0, reads: 0, submissions: 0 };
const size = (from, to, status = 'available') => ({
  status, from, to, delta: status === 'available' ? to - from : null,
  percent: status === 'available' ? (to - from) / from * 100 : null,
  reasons: status === 'available' ? [] : ['Fixture provider unavailable'],
});
const version = (name, release, bytes, partial) => ({
  name, version: release, dist: { tarball: 'https://registry.npmjs.org/fixture.tgz' },
  licenses: [], deprecated: false, engines: {}, dependencies: {}, peerDependencies: {},
  optionalDependencies: {}, optionalPeers: [], installScripts: [], installScriptCommands: {}, moduleFormat: {},
  vulnerabilities: partial ? { status: 'unavailable', count: null, advisories: [] }
    : { status: 'available', count: 0, advisories: [] },
  bundleSize: { provider: 'bundlephobia', status: 'available', name, version: release,
    url: 'https://bundlephobia.com/package/' + name + '@' + release,
    size: bytes, gzip: bytes / 2, retrievedAt: '2026-10-18T10:00:00.000Z' },
  tarball: { status: partial ? 'partial' : 'available', reasons: partial ? ['Fixture archive incomplete'] : [],
    url: 'https://registry.npmjs.org/fixture.tgz', fileCount: 3, changelogCount: 0 },
});
export class Evidence extends DurableObject {
  async fetch(request) {
    const identity = await request.json();
    const { packageName, from, to } = identity;
    if (new URL(request.url).pathname === '/briefing-evidence') {
      counts.evidence++;
      return Response.json({ ...identity, sources: [], gaps: [] });
    }
    counts.measurements++;
    if (this.env.MODE === 'unavailable') return new Response('private-provider-marker', { status: 503 });
    const partial = this.env.MODE === 'partial';
    return Response.json({ packageName,
      from: version(packageName, from, 12340, partial), to: version(packageName, to, 24680, partial),
      comparison: {
        sizes: { unpacked: { ...size(10000, 20000), sources: { from: 'registry', to: 'registry' } },
          bundle: { provider: 'bundlephobia', methodology: 'provider-estimate',
            minified: size(12340, 24680), gzip: size(6170, 12340) } },
        advisories: { status: partial ? 'unavailable' : 'available',
          coverage: { from: partial ? 'unavailable' : 'available', to: partial ? 'unavailable' : 'available' },
          reasons: partial ? ['Fixture advisory unavailable'] : [], fromOnly: [], both: [], toOnly: [], uncertain: [] },
      },
    });
  }
}
export class Briefing extends WorkerEntrypoint {
  async read({ packageName, from, to }) {
    counts.reads++;
    if (this.env.MODE === 'read-error') throw new Error('private-provider-marker');
    const identity = { packageName, from, to };
    return this.env.MODE === 'stored' ? { ...identity, status: 'available', briefing: {
      status: 'available', model: 'fixture',
      bullets: [{ kind: 'change', basis: 'fact', text: 'Stored fixture interpretation.', evidenceNumbers: [0] }],
      sources: [{ number: 0, id: 'fixture', kind: 'fact', label: 'Fixture source', urls: [], text: 'Fixture evidence.' }],
    } } : { ...identity, status: 'missing' };
  }
  async submit() { counts.submissions++; throw new Error('GET must never submit'); }
}
export default { fetch() { return Response.json(counts); } };
`;

type FixtureBindings = {
  PACKAGE_EVIDENCE?: { type: 'durable-object'; worker: 'measurement-ssr-fixture'; exportName: 'Evidence' };
  BRIEFING_SERVICE?: { type: 'worker'; worker: 'measurement-ssr-fixture'; exportName: 'Briefing' };
};

export const measurementSsrBindings = (mode: string | undefined): FixtureBindings => {
  if (mode === undefined) return {};

  return {
    PACKAGE_EVIDENCE: { type: 'durable-object' as const, worker: 'measurement-ssr-fixture', exportName: 'Evidence' },
    BRIEFING_SERVICE: { type: 'worker' as const, worker: 'measurement-ssr-fixture', exportName: 'Briefing' },
  };
};

export const measurementSsrWorker = (mode: string | undefined) => {
  if (mode === undefined) return [];

  return [
    {
      config: {
        name: 'measurement-ssr-fixture',
        compatibilityDate: '2026-09-25',
        compatibilityFlags: ['nodejs_compat'],
        env: { MODE: { type: 'text' as const, value: mode } },
        exports: { Evidence: { type: 'durable-object' as const, storage: 'sqlite' as const } },
        manifest: {
          mainModule: 'fixture.js',
          modules: { 'fixture.js': { type: 'esm' as const, contents: measurementSsrFixture } },
        },
      },
    },
  ];
};
