import { assertCredentialIsolation } from './configurationKeys.ts';

try {
  assertCredentialIsolation(process.env);
} catch {
  process.stderr.write(
    'CI environment isolation failed: private/deployment variables require stage scope; the stage build requires its public stage origin.\n',
  );
  process.exitCode = 1;
}
