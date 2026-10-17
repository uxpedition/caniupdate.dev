import { Data, Effect } from 'effect';

import { hasCredentialScopeViolation, PRIVATE_CI_KEYS } from './credentialScope.ts';

export { PRIVATE_CI_KEYS };

export const STAGE_ORIGIN = 'https://stage.caniupdate.dev';

export const STAGE_SOCKET_ORIGIN = 'wss://stage-briefing.caniupdate.dev';

export class CredentialIsolationFailure extends Data.TaggedError('CredentialIsolationFailure')<{
  readonly message: string;
}> {}

export function assertCredentialIsolation(
  environment: NodeJS.ProcessEnv,
): Effect.Effect<void, CredentialIsolationFailure> {
  if (hasCredentialScopeViolation(environment)) {
    return Effect.fail(
      new CredentialIsolationFailure({
        message: 'Private and deployment variables require their exact dedicated GitLab environment scope',
      }),
    );
  }

  return Effect.void;
}
