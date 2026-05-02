import { Effect } from "effect";

export interface ClipboardWriter {
  writeText: (text: string) => Promise<void>;
}

export class ClipboardWriteError extends Error {
  constructor(message = "Clipboard write failed") {
    super(message);
    this.name = "ClipboardWriteError";
  }
}

export function writeClipboardTextEffect(
  text: string,
  clipboard: ClipboardWriter | null | undefined,
): Effect.Effect<void, ClipboardWriteError> {
  if (!clipboard) {
    return Effect.fail(new ClipboardWriteError("Clipboard is not available"));
  }

  return Effect.tryPromise({
    try: () => clipboard.writeText(text),
    catch: () => new ClipboardWriteError(),
  });
}

export function writeClipboardText(
  text: string,
  clipboard: ClipboardWriter | null | undefined,
): Promise<void> {
  return Effect.runPromise(writeClipboardTextEffect(text, clipboard));
}
