import { Data } from 'effect';

export type Options = {
  readonly otelEndpoint?: string;
  readonly preview: boolean;
  readonly migrateOnly: boolean;
  readonly persistTo: string;
  readonly evidencePort: number;
  readonly briefingPort: number;
  readonly frontendPort: number;
  /** The first of three consecutive inspector ports, one per session. */
  readonly inspectorBase: number;
};

const USAGE =
  'Usage: node scripts/dev/dev.ts [--preview] [--migrate-only] [--persist-to <dir>] [--evidence-port <port>] [--briefing-port <port>] ' +
  '[--frontend-port <port>] [--inspector-base <port>] [--otel-endpoint <url>]';

export class UsageError extends Data.TaggedError('UsageError')<{
  readonly message: string;
}> {}

const parsePort = (flag: string, value: string | undefined): number => {
  const port = Number(value);

  if (value === undefined || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new UsageError({ message: `${flag} expects a TCP port, got ${JSON.stringify(value)}\n${USAGE}` });
  }

  return port;
};

const parseDirectory = (value: string | undefined): string => {
  if (value === undefined || value.trim() === '') {
    throw new UsageError({ message: `--persist-to expects a directory\n${USAGE}` });
  }

  return value;
};

const parseEndpoint = (value: string | undefined): string => {
  let parsed: URL;

  try {
    parsed = new URL(value ?? '');
  } catch {
    throw new UsageError({ message: `--otel-endpoint expects an HTTP(S) URL\n${USAGE}` });
  }

  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new UsageError({
      message: `--otel-endpoint expects an HTTP(S) URL without credentials, query or fragment\n${USAGE}`,
    });
  }

  return parsed.href.replace(/\/+$/, '');
};

type MutableOptions = { -readonly [Key in keyof Options]: Options[Key] };

const applyValueOption = (options: MutableOptions, flag: string | undefined, value: string | undefined): void => {
  switch (flag) {
    case '--persist-to':
      options.persistTo = parseDirectory(value);
      break;
    case '--evidence-port':
      options.evidencePort = parsePort(flag, value);
      break;
    case '--briefing-port':
      options.briefingPort = parsePort(flag, value);
      break;
    case '--frontend-port':
      options.frontendPort = parsePort(flag, value);
      break;
    case '--inspector-base':
      options.inspectorBase = parsePort(flag, value);
      break;
    case '--otel-endpoint':
      options.otelEndpoint = parseEndpoint(value);
      break;
    default:
      throw new UsageError({ message: `Unknown argument ${JSON.stringify(flag)}\n${USAGE}` });
  }
};

/** Local port/state overrides let isolated smoke runs avoid an existing development session. */
export const parseOptions = (argv: readonly string[]): Options => {
  const options: MutableOptions = {
    preview: false,
    migrateOnly: false,
    persistTo: '.wrangler/state',
    evidencePort: 8790,
    briefingPort: 8791,
    frontendPort: 5173,
    inspectorBase: 9230,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];

    if (flag === '--preview') options.preview = true;
    else if (flag === '--migrate-only') options.migrateOnly = true;
    else {
      index += 1;
      applyValueOption(options, flag, argv[index]);
    }
  }

  return options;
};
