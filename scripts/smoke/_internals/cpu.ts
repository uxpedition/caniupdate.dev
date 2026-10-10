// The smoke scenario's CPU sampler. Each runtime is supervised as a process tree — the Wrangler process and the
// `workerd` it spawns — and the tree's CPU time comes from `/proc/<pid>/task/<tid>/schedstat`, whose first field is
// nanoseconds spent on a CPU. The nanosecond clock keeps a short request window meaningful; `/proc/<pid>/stat` only
// resolves to 10 ms ticks.

import { readFile, readdir } from 'node:fs/promises';

export class CpuSamplingFailure extends Error {
  override readonly name = 'CpuSamplingFailure';
}

export type RuntimePids = {
  readonly frontend?: number;
  readonly briefing?: number;
  readonly evidence?: number;
};

export type RuntimeCpuMs = {
  readonly frontend: number;
  readonly briefing: number;
  readonly evidence: number;
};

const processCpuNs = async (pid: number): Promise<{ parentPid: number; ns: number }> => {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => undefined);

  if (stat === undefined) return { parentPid: Number.NaN, ns: 0 };
  const tail = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const tasks = await readdir(`/proc/${pid}/task`).catch(() => []);
  let ns = 0;

  for (const task of tasks) {
    const schedstat = await readFile(`/proc/${pid}/task/${task}/schedstat`, 'utf8').catch(() => undefined);

    if (schedstat === undefined) continue;
    ns += Number(schedstat.split(' ')[0]);
  }

  return { parentPid: Number(tail[1]), ns };
};

type ProcessTable = {
  readonly children: Map<number, number[]>;
  readonly cpuNs: Map<number, number>;
};

/** One table read: the schedstat nanoseconds of every readable pid and the parent index keyed by each pid. */
const sampleTable = async (readTasks: { count: number }): Promise<ProcessTable> => {
  const children = new Map<number, number[]>();
  const cpuNs = new Map<number, number>();

  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    const { parentPid, ns } = await processCpuNs(pid);

    if (!Number.isFinite(parentPid)) continue;
    children.set(parentPid, [...(children.get(parentPid) ?? []), pid]);
    cpuNs.set(pid, ns);
    readTasks.count += 1;
  }

  return { children, cpuNs };
};

/** One tree's CPU in milliseconds: the pending walk gathers the root's descendants from the parent index. */
const treeCpuMs = (rootPid: number, table: ProcessTable): number => {
  let totalNs = 0;
  const pending = [rootPid];

  while (pending.length > 0) {
    const pid = pending.pop();

    if (pid === undefined) break;
    totalNs += table.cpuNs.get(pid) ?? 0;
    pending.push(...(table.children.get(pid) ?? []));
  }

  return totalNs / 1e6;
};

/** CPU milliseconds for each runtime's tree at this instant. */
export const readTrees = async (pids: RuntimePids): Promise<RuntimeCpuMs> => {
  const readTasks = { count: 0 };
  const table = await sampleTable(readTasks);

  const trees: RuntimeCpuMs = {
    frontend: pids.frontend === undefined ? 0 : treeCpuMs(pids.frontend, table),
    briefing: pids.briefing === undefined ? 0 : treeCpuMs(pids.briefing, table),
    evidence: pids.evidence === undefined ? 0 : treeCpuMs(pids.evidence, table),
  };

  if (readTasks.count === 0) {
    throw new CpuSamplingFailure('No /proc/<pid>/task/<tid>/schedstat this kernel exposes, so CPU cannot be sampled');
  }

  return trees;
};
