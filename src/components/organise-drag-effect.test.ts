import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  buildMoveItemCommandEffect,
  getDropTargetFromListEffect,
  getDropTargetFromZoneEffect,
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

describe("drop target parsing", () => {
  it("parses explicit drop zones from element datasets", async () => {
    await expect(
      Effect.runPromise(
        getDropTargetFromZoneEffect({
          groupId: "__ungrouped__",
          dropColumnId: "col-1",
          index: "2",
        }),
      ),
    ).resolves.toEqual({
      groupId: null,
      columnId: "col-1",
      index: 2,
    });

    await expect(
      Effect.runPromise(
        getDropTargetFromZoneEffect({
          groupId: "group-1",
          dropColumnId: "col-1",
          index: "bad",
        }),
      ),
    ).resolves.toBeNull();
  });

  it("calculates list drop indexes from row midpoints", async () => {
    await expect(
      Effect.runPromise(
        getDropTargetFromListEffect({
          dropList: "group-1",
          dropColumnId: "col-1",
          pointerY: 26,
          rows: [
            { top: 10, height: 20 },
            { top: 40, height: 20 },
          ],
        }),
      ),
    ).resolves.toEqual({
      groupId: "group-1",
      columnId: "col-1",
      index: 1,
    });
  });

  it("drops at the end of a list when the pointer is below every row", async () => {
    await expect(
      Effect.runPromise(
        getDropTargetFromListEffect({
          dropList: "__ungrouped__",
          dropColumnId: "col-1",
          pointerY: 100,
          rows: [
            { top: 10, height: 20 },
            { top: 40, height: 20 },
          ],
        }),
      ),
    ).resolves.toEqual({
      groupId: null,
      columnId: "col-1",
      index: 2,
    });
  });
});
