import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { loadEmojiPickerEffect } from "./emoji-picker-effect";

describe("loadEmojiPickerEffect", () => {
  it("runs the dynamic import boundary", async () => {
    let imported = false;

    await expect(Effect.runPromise(loadEmojiPickerEffect(async () => {
      imported = true;
    }))).resolves.toBeUndefined();

    expect(imported).toBe(true);
  });

  it("surfaces import failures as typed Effect failures", async () => {
    const exit = await Effect.runPromiseExit(loadEmojiPickerEffect(async () => {
      throw new Error("missing chunk");
    }));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("EmojiPickerLoadError");
    }
  });
});
