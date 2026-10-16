// Added only to the Miniflare test manifest. The production job, SQLite, D1 and Queue still run normally;
// one terminal storage API call is deliberately refused before native put, as an unavailable platform would do.
export const TERMINAL_PUT_FAULT_MODULE = 'terminal-put-fault.js';

export const TERMINAL_PUT_FAULT_SCRIPT = `
import worker, { BriefingJob as ProductionJob, BriefingSubmitter } from './index.js';

export default worker;
export { BriefingSubmitter };

export class BriefingJob extends ProductionJob {
  constructor(ctx, env) {
    const put = ctx.storage.put.bind(ctx.storage);
    let refused = false;
    ctx.storage.put = (key, value, ...options) => {
      if (!refused && key === 'job' && (value?.state === 'available' || value?.state === 'unavailable')) {
        refused = true;
        return Promise.reject(new Error('PRIVATE_TERMINAL_PUT_MARKER'));
      }
      return put(key, value, ...options);
    };
    super(ctx, env);
  }
}
`;
