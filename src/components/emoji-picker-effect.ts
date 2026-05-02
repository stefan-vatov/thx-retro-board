import { Effect } from "effect";

export class EmojiPickerLoadError extends Error {
  constructor(message = "Emoji picker failed to load") {
    super(message);
    this.name = "EmojiPickerLoadError";
  }
}

export function loadEmojiPickerEffect(
  importer: () => Promise<unknown> = () => import("emoji-picker-element"),
): Effect.Effect<void, EmojiPickerLoadError> {
  return Effect.tryPromise({
    try: async () => {
      await importer();
    },
    catch: () => new EmojiPickerLoadError(),
  });
}

export function loadEmojiPicker(): Promise<void> {
  return Effect.runPromise(loadEmojiPickerEffect());
}
