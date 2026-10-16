import { assertCredentialIsolation } from './configurationKeys.ts';

try {
  assertCredentialIsolation(process.env);
} catch {
  process.stderr.write('CI environment isolation failed: private/deployment variables require stage scope.\n');
  process.exitCode = 1;
}
