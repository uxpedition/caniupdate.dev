import { Array, Effect, Option, Schema } from 'effect';

type Lexer = { commands: string[][]; token: string; quote: string };

class UnsupportedShell extends Schema.TaggedError<UnsupportedShell>()('UnsupportedShell', {}) {}

const finishWord = (state: Lexer): void => {
  if (state.token) Option.map(Array.last(state.commands), (words) => words.push(state.token));
  state.token = '';
};

const quotedCharacter = Effect.fnUntraced(function* (
  char: string,
  state: Lexer,
): Effect.fn.Return<void, UnsupportedShell> {
  if (char === state.quote) state.quote = '';
  else if (/[\\$`]/.test(char)) return yield* new UnsupportedShell();
  else state.token += char;
});

const unquotedCharacter = Effect.fnUntraced(function* (
  char: string,
  next: string,
  state: Lexer,
): Effect.fn.Return<number, UnsupportedShell> {
  if (char === "'" || char === '"') state.quote = char;
  else if (/\s/.test(char)) finishWord(state);
  else if (char === ';' || (/[&|]/.test(char) && next === char)) {
    finishWord(state);
    state.commands.push([]);

    return char === ';' ? 0 : 1;
  } else if (/[<>|&$`\\*?(){}[\]#]/.test(char)) return yield* new UnsupportedShell();
  else state.token += char;

  return 0;
});

/** Literal words and &&, ||, ; only. Unsupported shell syntax is not guessed. */
export const installCommands = (command: string): Effect.Effect<string[][] | undefined> =>
  Effect.gen(function* () {
    const state: Lexer = { commands: [[]], token: '', quote: '' };
    let index = 0;
    yield* Effect.whileLoop({
      while: () => index < command.length,
      body: () =>
        state.quote
          ? quotedCharacter(command[index] ?? '', state).pipe(Effect.as(0))
          : unquotedCharacter(command[index] ?? '', command[index + 1] ?? '', state),
      step: (consumed) => {
        index += consumed + 1;
      },
    });

    if (state.quote) return yield* new UnsupportedShell();
    finishWord(state);

    return state.commands;
  }).pipe(Effect.catchTag('UnsupportedShell', () => Effect.succeed(undefined)));
