import { Effect } from 'effect';

export default defineEventHandler(() => Effect.runSync(Effect.succeed({ status: 'ok' as const })));
