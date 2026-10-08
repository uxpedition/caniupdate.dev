import { Logger } from 'effect';

/** Structured JSON logger shared by browser and Worker runtimes. */
export const ConsoleLoggerLive = Logger.layer([Logger.withLeveledConsole(Logger.formatJson)]);
