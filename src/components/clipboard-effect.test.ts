import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  copyExportCardEffect,
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
