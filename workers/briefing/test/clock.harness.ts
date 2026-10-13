// This module is added only to Miniflare's test manifest, never the deployed Worker. It advances the Worker isolate's
// clock to an already-persisted alarm deadline, then reschedules that alarm for immediate native workerd delivery.
// The control RPC never invokes alarm() or shortens a production lease; only the native callback enters that handler.
// Other clocks/timers are not advanced. Real-time lease/eviction suites cover scheduling without this wrapper.
// Storage API: https://developers.cloudflare.com/durable-objects/api/alarms/#storage-methods
export const CLOCK_MODULE = 'controlled-clock.js';

export const CLOCK_SCRIPT = `
import worker, { BriefingJob as ProductionJob, BriefingSubmitter } from './index.js';

const nativeNow = Date.now.bind(Date);
let offset = 0;
Date.now = () => nativeNow() + offset;

export default worker;
export { BriefingSubmitter };

export class BriefingJob extends ProductionJob {
  #completions = 0;

  async alarm() {
    await super.alarm();
    this.#completions++;
  }

  completedAlarms() { return this.#completions; }

  async fireNextAlarm() {
    const deadline = await this.ctx.storage.getAlarm();
    if (deadline === null) throw new Error('No persisted alarm to deliver');
    const before = this.#completions;
    offset = Math.max(offset, deadline - nativeNow());
    await this.ctx.storage.setAlarm(nativeNow());
    return before;
  }
}
`;
