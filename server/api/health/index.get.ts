import { Effect } from 'effect';
import { defineEventHandler } from 'h3';

export default defineEventHandler(() => Effect.runSync(Effect.succeed({ status: 'ok' as const })));
