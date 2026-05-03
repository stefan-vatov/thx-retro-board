import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  buildMoveItemCommandEffect,
  shouldBeginPointerDragEffect,
} from "./organise-drag-effect";

describe("shouldBeginPointerDragEffect", () => {
  it("waits until the pointer moves past the drag threshold", async () => {
    await expect(
      Effect.runPromise(
        shouldBeginPointerDragEffect({
          start: { x: 100, y: 100 },
          current: { x: 103, y: 104 },
          threshold: 6,
        }),
      ),
    ).resolves.toBe(false);

    await expect(
      Effect.runPromise(
        shouldBeginPointerDragEffect({
          start: { x: 100, y: 100 },
          current: { x: 106, y: 101 },
          threshold: 6,
        }),
      ),
    ).resolves.toBe(true);
  });
});

describe("buildMoveItemCommandEffect", () => {
  const dragStart = {
    itemId: "item-1",
    itemText: "Improve the docs",
    columnId: "col-1",
    expectedVersion: 4,
    sourceGroupId: "group-a",
    sourceIndex: 2,
  };

  it("builds the realtime move command for valid same-column drops", async () => {
    await expect(
      Effect.runPromise(
        buildMoveItemCommandEffect(dragStart, {
          groupId: null,
          columnId: "col-1",
          index: 3,
        }),
      ),
    ).resolves.toEqual({
      success: true,
      command: {
        type: "move-item-to-group",
        itemId: "item-1",
        groupId: null,
        index: 3,
        expectedVersion: 4,
        sourceGroupId: "group-a",
        sourceIndex: 2,
      },
    });
  });

  it("rejects cross-column drops before sending", async () => {
    await expect(
      Effect.runPromise(
        buildMoveItemCommandEffect(dragStart, {
          groupId: "group-b",
          columnId: "col-2",
          index: 0,
        }),
      ),
    ).resolves.toEqual({
      success: false,
      error: "Items can only be moved within their original column.",
    });
  });

  it("does nothing when there is no drop target", async () => {
    await expect(
      Effect.runPromise(buildMoveItemCommandEffect(dragStart, null)),
    ).resolves.toEqual({
      success: false,
      error: null,
    });
  });
});
