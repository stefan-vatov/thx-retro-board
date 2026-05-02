import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  writeClipboardTextEffect,
} from "./clipboard-effect";

describe("writeClipboardTextEffect", () => {
  it("writes text through the injected clipboard boundary", async () => {
    const writes: string[] = [];

    await expect(Effect.runPromise(writeClipboardTextEffect("invite", {
      writeText: async (text) => {
        writes.push(text);
      },
    }))).resolves.toBeUndefined();

    expect(writes).toEqual(["invite"]);
  });

  it("returns a typed error when clipboard writes fail", async () => {
    const exit = await Effect.runPromiseExit(writeClipboardTextEffect("invite", {
      writeText: async () => {
        throw new Error("denied");
      },
    }));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("ClipboardWriteError");
    }
  });

  it("fails when clipboard support is missing", async () => {
    const exit = await Effect.runPromiseExit(writeClipboardTextEffect("invite", null));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("Clipboard is not available");
    }
  });
});
