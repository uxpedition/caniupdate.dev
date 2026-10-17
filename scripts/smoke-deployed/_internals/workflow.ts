import { resolve } from 'node:path';

import { Cause, Config, Console, Duration, Effect, Exit, FileSystem, Option, Schema } from 'effect';
import { HttpClientResponse } from 'effect/http';

import {
  authorizedFetch,
  checkAuthorizedSocketAdmission,
  checkUnauthenticatedFrontend,
  checkUnauthenticatedSocket,
  checkPublicSocketRoute,
} from './access.ts';
import { runBrowser, type BrowserOutcome, type BrowserName } from './browserScenario.ts';
import { readSmokeConfig, REQUEST_TIMEOUT_MS, type SmokeConfig } from './config.ts';
import { SmokeFailure } from './errors.ts';

type SmokeReport = {
  outcome: 'passed' | 'failed';
  target?: SmokeConfig['target'];
  commitSha?: string;
  version?: string;
  publicSocketRoute?: number;
  access?: { frontend: number; socket: number; authorizedSocketAdmission: number };
  health?: 'passed';
  browsers: BrowserOutcome[];
  failureStage?: string;
};

const HealthResponseSchema = Schema.Struct({ status: Schema.Literal('ok') });

const verifySurface = (config: SmokeConfig) =>
  Effect.scoped(
    Effect.gen(function* () {
      const response = yield* authorizedFetch(config, '/api/health', 'health');
      yield* HttpClientResponse.schemaBodyJson(HealthResponseSchema, {
        errors: 'all',
        onExcessProperty: 'error',
      })(response);

      if (response.status !== 200) return yield* Effect.fail(new SmokeFailure('health'));
    }),
  ).pipe(
    Effect.timeout(Duration.millis(REQUEST_TIMEOUT_MS)),
    Effect.mapError(() => new SmokeFailure('health')),
  );

const verifyAccess = (config: SmokeConfig, report: SmokeReport) =>
  Effect.gen(function* () {
    if (config.local) return;

    if (config.target === 'production') {
      report.publicSocketRoute = yield* checkPublicSocketRoute(config);
      return;
    }

    const socketUrl = new URL(`/api/briefings/${'0'.repeat(64)}/events`, config.socketOrigin).href;
    const frontend = yield* checkUnauthenticatedFrontend(config);
    const socket = yield* checkUnauthenticatedSocket(config, socketUrl);
    const authorizedSocketAdmission = yield* checkAuthorizedSocketAdmission(config);

    report.access = { frontend, socket, authorizedSocketAdmission };
  });

/** Owns one verification run and always publishes its sanitized report, including on cancellation or defects. */
export const runSmoke = (outputDirectory: string) =>
  Effect.gen(function* () {
    const report: SmokeReport = { outcome: 'failed', browsers: [] };
    const fs = yield* FileSystem.FileSystem;

    const run = Effect.gen(function* () {
      const browser = yield* Config.Literals(['chromium', 'firefox'], 'SMOKE_BROWSER').pipe(
        Config.option,
        Effect.mapError(() => new SmokeFailure('browser-selection')),
      );

      const browsers: readonly BrowserName[] = Option.isNone(browser) ? ['chromium', 'firefox'] : [browser.value];

      const config = yield* readSmokeConfig;

      report.target = config.target;
      report.commitSha = config.expectedSha;
      if (config.expectedVersion !== null) report.version = config.expectedVersion;
      yield* fs
        .makeDirectory(outputDirectory, { recursive: true, mode: 0o700 })
        .pipe(Effect.mapError(() => new SmokeFailure('configuration-or-response')));
      yield* verifyAccess(config, report);
      yield* verifySurface(config);
      report.health = 'passed';

      for (const name of browsers) {
        const outcome = yield* runBrowser(name, config, outputDirectory);
        report.browsers.push(outcome);

        if (outcome.outcome !== 'passed')
          return yield* Effect.fail(new SmokeFailure(outcome.failureStage ?? 'browser'));
      }

      report.outcome = 'passed';
    });

    return yield* run.pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          if (Exit.isFailure(exit)) {
            const failure = Cause.findErrorOption(exit.cause);
            report.outcome = 'failed';
            report.failureStage = Option.isSome(failure)
              ? failure.value.stage
              : Cause.hasInterrupts(exit.cause)
                ? 'interrupted'
                : 'configuration-or-response';
          }

          const output = JSON.stringify(report, null, 2) + '\n';
          // A report write failure must fail the CLI; never silently claim verification succeeded without evidence.
          yield* fs.makeDirectory(outputDirectory, { recursive: true, mode: 0o700 });
          yield* fs.writeFileString(resolve(outputDirectory, 'report.json'), output, { mode: 0o600 });
          yield* Console.log(output.trimEnd());
        }).pipe(Effect.mapError(() => new SmokeFailure('report-write'))),
      ),
    );
  });
