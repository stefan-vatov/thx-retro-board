import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  copyExportCardEffect,
  copyInviteLinkEffect,
  downloadExportCardEffect,
  writeClipboardTextEffect,
} from "./clipboard-effect";

describe("writeClipboardTextEffect", () => {
  it("writes text through the injected clipboard boundary", async () => {
    const writes: string[] = [];

    await expect(
      Effect.runPromise(
        writeClipboardTextEffect("invite", {
          writeText: async (text) => {
            writes.push(text);
          },
        }),
      ),
    ).resolves.toBeUndefined();

    expect(writes).toEqual(["invite"]);
  });

  it("returns a typed error when clipboard writes fail", async () => {
    const exit = await Effect.runPromiseExit(
      writeClipboardTextEffect("invite", {
        writeText: async () => {
          throw new Error("denied");
        },
      }),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("ClipboardWriteError");
    }
  });

  it("fails when clipboard support is missing", async () => {
    const exit = await Effect.runPromiseExit(
      writeClipboardTextEffect("invite", null),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("Clipboard is not available");
    }
  });
});

describe("copyExportCardEffect", () => {
  it("writes export content and returns the copied card id", async () => {
    const writes: string[] = [];

    await expect(
      Effect.runPromise(
        copyExportCardEffect(
          { id: "actions-csv", content: "task,status" },
          {
            writeText: async (text) => {
              writes.push(text);
            },
          },
        ),
      ),
    ).resolves.toEqual({ copiedId: "actions-csv" });

    expect(writes).toEqual(["task,status"]);
  });

  it("returns a null copied id when the clipboard write fails", async () => {
    await expect(
      Effect.runPromise(
        copyExportCardEffect(
          { id: "actions-csv", content: "task,status" },
          {
            writeText: async () => {
              throw new Error("denied");
            },
          },
        ),
      ),
    ).resolves.toEqual({ copiedId: null });
  });
});

describe("copyInviteLinkEffect", () => {
  it("copies supported invite links and clears manual fallback state", async () => {
    const writes: string[] = [];

    await expect(
      Effect.runPromise(
        copyInviteLinkEffect("https://example.test/room/abc", true, {
          writeText: async (text) => {
            writes.push(text);
          },
        }),
      ),
    ).resolves.toEqual({
      copied: true,
      copyFailed: false,
      manualUrl: null,
    });

    expect(writes).toEqual(["https://example.test/room/abc"]);
  });

  it("returns manual fallback state when clipboard is unsupported", async () => {
    await expect(
      Effect.runPromise(
        copyInviteLinkEffect("https://example.test/room/abc", false, {
          writeText: async () => {
            throw new Error("should not write");
          },
        }),
      ),
    ).resolves.toEqual({
      copied: false,
      copyFailed: true,
      manualUrl: "https://example.test/room/abc",
    });
  });

  it("returns manual fallback state when clipboard writing fails", async () => {
    await expect(
      Effect.runPromise(
        copyInviteLinkEffect("https://example.test/room/abc", true, {
          writeText: async () => {
            throw new Error("denied");
          },
        }),
      ),
    ).resolves.toEqual({
      copied: false,
      copyFailed: true,
      manualUrl: "https://example.test/room/abc",
    });
  });
});

describe("downloadExportCardEffect", () => {
  it("creates a downloadable export file through the injected browser boundary", async () => {
    const calls: string[] = [];
    const blob = { marker: "blob" };
    const link = {
      href: "",
      download: "",
      click: () => calls.push("click"),
      remove: () => calls.push("remove"),
    };

    await expect(
      Effect.runPromise(
        downloadExportCardEffect(
          {
            filename: "retro-room-actions.csv",
            mimeType: "text/csv",
            content: "action,status",
          },
          {
            createBlob: (parts, options) => {
              calls.push(`blob:${parts.join("")}:${options.type}`);
              return blob;
            },
            createObjectUrl: (createdBlob) => {
              calls.push(`url:${createdBlob === blob}`);
              return "blob:retro-export";
            },
            createLink: () => {
              calls.push("link");
              return link;
            },
            appendLink: (createdLink) => {
              calls.push(`append:${createdLink === link}`);
            },
            revokeObjectUrl: (url) => calls.push(`revoke:${url}`),
          },
        ),
      ),
    ).resolves.toBeUndefined();

    expect(link).toMatchObject({
      href: "blob:retro-export",
      download: "retro-room-actions.csv",
    });
    expect(calls).toEqual([
      "blob:action,status:text/csv;charset=utf-8",
      "url:true",
      "link",
      "append:true",
      "click",
      "remove",
      "revoke:blob:retro-export",
    ]);
  });
});
