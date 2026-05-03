import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  isEditableElementEffect,
  restoreFocusEffect,
  scheduleFocusRestoreEffect,
} from "./focus-restore";

function element(tagName: string, contenteditable?: string | null) {
  return {
    tagName,
    getAttribute: (name: string) =>
      name === "contenteditable" ? (contenteditable ?? null) : null,
  } as Element;
}

describe("isEditableElementEffect", () => {
  it("detects standard editable controls and contenteditable nodes", async () => {
    await expect(
      Effect.runPromise(isEditableElementEffect(element("TEXTAREA"))),
    ).resolves.toBe(true);
    await expect(
      Effect.runPromise(isEditableElementEffect(element("div", "true"))),
    ).resolves.toBe(true);
    await expect(
      Effect.runPromise(isEditableElementEffect(element("button"))),
    ).resolves.toBe(false);
  });
});

describe("restoreFocusEffect", () => {
  it("focuses the target when no other editable element is active", async () => {
    let focused = false;

    await Effect.runPromise(
      restoreFocusEffect({
        target: { focus: () => (focused = true) },
        activeElement: element("body"),
      }),
    );

    expect(focused).toBe(true);
  });

  it("does not steal focus from another editable element", async () => {
    let focused = false;

    await Effect.runPromise(
      restoreFocusEffect({
        target: { focus: () => (focused = true) },
        activeElement: element("input"),
      }),
    );

    expect(focused).toBe(false);
  });

  it("allows focus when the target itself is active", async () => {
    let focused = false;
    const target = { focus: () => (focused = true) };

    await Effect.runPromise(
      restoreFocusEffect({
        target,
        activeElement: target as Element,
      }),
    );

    expect(focused).toBe(true);
  });
});

describe("scheduleFocusRestoreEffect", () => {
  it("schedules an animation frame and all requested timeouts", async () => {
    const calls: string[] = [];

    await Effect.runPromise(
      scheduleFocusRestoreEffect({
        restore: () => calls.push("restore"),
        delays: [50, 150],
        requestAnimationFrame: (callback) => {
          calls.push("frame");
          callback();
        },
        setTimeout: (callback, delay) => {
          calls.push(`timeout:${delay}`);
          callback();
        },
      }),
    );

    expect(calls).toEqual([
      "frame",
      "restore",
      "timeout:50",
      "restore",
      "timeout:150",
      "restore",
    ]);
  });
});
