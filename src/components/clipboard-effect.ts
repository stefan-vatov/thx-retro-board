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

export type DownloadableExportCard = {
  filename: string;
  mimeType: string;
  content: string;
};

export type DownloadLink = {
  href: string;
  download: string;
  click: () => void;
  remove: () => void;
};

export type ExportDownloadDeps<
  BlobLike = Blob,
  LinkLike extends DownloadLink = DownloadLink,
> = {
  createBlob: (parts: BlobPart[], options: BlobPropertyBag) => BlobLike;
  createObjectUrl: (blob: BlobLike) => string;
  createLink: () => LinkLike;
  appendLink: (link: LinkLike) => void;
  revokeObjectUrl: (url: string) => void;
};

export function downloadExportCardEffect<
  BlobLike,
  LinkLike extends DownloadLink,
>(
  card: DownloadableExportCard,
  deps: ExportDownloadDeps<BlobLike, LinkLike>,
): Effect.Effect<void> {
  return Effect.sync(() => {
    const blob = deps.createBlob([card.content], {
      type: `${card.mimeType};charset=utf-8`,
    });
    const url = deps.createObjectUrl(blob);
    const link = deps.createLink();

    link.href = url;
    link.download = card.filename;
    deps.appendLink(link);
    link.click();
    link.remove();
    deps.revokeObjectUrl(url);
  });
}
