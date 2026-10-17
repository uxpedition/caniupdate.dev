import { hasCredentialScopeViolation } from './credentialScope.ts';

if (hasCredentialScopeViolation(process.env)) {
  process.stderr.write(
    'CI environment isolation failed: private/deployment variables require their exact job environment scope.\n',
  );
  process.exitCode = 1;
}
