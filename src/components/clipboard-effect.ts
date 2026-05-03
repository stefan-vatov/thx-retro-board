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

export type CopyableExportCard = {
  id: string;
  content: string;
};

export function copyExportCardEffect(
  card: CopyableExportCard,
  clipboard: ClipboardWriter | null | undefined,
): Effect.Effect<{ copiedId: string | null }> {
  return writeClipboardTextEffect(card.content, clipboard).pipe(
    Effect.as({ copiedId: card.id }),
    Effect.catchAll(() => Effect.succeed({ copiedId: null })),
  );
}

export type InviteCopyResult = {
  copied: boolean;
  copyFailed: boolean;
  manualUrl: string | null;
};

export function copyInviteLinkEffect(
  inviteUrl: string,
  copySupported: boolean,
  clipboard: ClipboardWriter | null | undefined,
): Effect.Effect<InviteCopyResult> {
  if (!copySupported) {
    return Effect.succeed({
      copied: false,
      copyFailed: true,
      manualUrl: inviteUrl,
    });
  }

  return writeClipboardTextEffect(inviteUrl, clipboard).pipe(
    Effect.as({ copied: true, copyFailed: false, manualUrl: null }),
    Effect.catchAll(() =>
      Effect.succeed({
        copied: false,
        copyFailed: true,
        manualUrl: inviteUrl,
      }),
    ),
  );
}
