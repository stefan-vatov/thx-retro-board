import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import {
  reorderList,
  hasDuplicateGroupNameInColumn,
  applyEditGroup,
  getUngroupedItems,
  getGroupedItems,
  applyReorderItems,
  validateGroupReorderPayloadEffect,
  validateItemReorderPayload,
  validateItemReorderPayloadEffect,
  applyReorderGroups,
  validateGroupReorderPayload,
  applyDeleteGroup,
  applyMoveItemToGroup,
} from "./state";
import type { Group, RetroItem } from "./types";

describe("reorderList", () => {
  const items: RetroItem[] = [
    { id: "a", text: "A", authorId: "p1", columnId: "col-1", groupId: null, order: 0 },
    { id: "b", text: "B", authorId: "p1", columnId: "col-1", groupId: null, order: 1 },
    { id: "c", text: "C", authorId: "p1", columnId: "col-1", groupId: null, order: 2 },
  ];

  it("reorders items by ID list", () => {
    const result = reorderList(items, ["c", "a", "b"], (item) => item.id);
    expect(result.map((i) => i.id)).toEqual(["c", "a", "b"]);
  });

  it("handles partial ID list", () => {
    const result = reorderList(items, ["b"], (item) => item.id);
    expect(result.map((i) => i.id)).toEqual(["b"]);
  });

  it("ignores unknown IDs gracefully", () => {
    const result = reorderList(items, ["c", "z", "a"], (item) => item.id);
    expect(result.map((i) => i.id)).toEqual(["c", "a"]);
  });
});

describe("group name uniqueness", () => {
  const groups: Group[] = [
    { id: "group-a", name: "Shared theme", columnId: "col-a", order: 0 },
    { id: "group-b", name: "Shared theme", columnId: "col-b", order: 0 },
    { id: "group-c", name: "Other theme", columnId: "col-a", order: 1 },
  ];

  it("detects duplicate sanitized group names only within the same column", () => {
    expect(hasDuplicateGroupNameInColumn(groups, "col-a", "  Shared theme  ")).toBe(true);
    expect(hasDuplicateGroupNameInColumn(groups, "col-b", "Shared theme")).toBe(true);
    expect(hasDuplicateGroupNameInColumn(groups, "col-c", "Shared theme")).toBe(false);
  });

  it("allows a group to keep its current sanitized name when renaming", () => {
    expect(hasDuplicateGroupNameInColumn(groups, "col-a", " Shared theme ", "group-a")).toBe(false);
    expect(applyEditGroup(groups, "group-a", " Shared theme ")).toEqual({
      groups: [
        { id: "group-a", name: "Shared theme", columnId: "col-a", order: 0 },
        { id: "group-b", name: "Shared theme", columnId: "col-b", order: 0 },
        { id: "group-c", name: "Other theme", columnId: "col-a", order: 1 },
      ],
    });
  });

  it("rejects renaming a group to another sanitized name in the same column without mutating groups", () => {
    const result = applyEditGroup(groups, "group-c", " Shared theme ");

    expect(result).toEqual({
      groups,
      error: "Group name already exists in this column",
    });
  });
});

describe("getUngroupedItems", () => {
  const items: RetroItem[] = [
    { id: "a", text: "A", authorId: "p1", columnId: "col-1", groupId: null, order: 2 },
    { id: "b", text: "B", authorId: "p1", columnId: "col-1", groupId: "g1", order: 0 },
    { id: "c", text: "C", authorId: "p1", columnId: "col-1", groupId: null, order: 1 },
  ];

  it("returns items with null groupId sorted by order", () => {
    const result = getUngroupedItems(items);
    expect(result.map((i) => i.id)).toEqual(["c", "a"]);
  });

  it("returns empty array when all items are grouped", () => {
    const grouped: RetroItem[] = [
      { id: "a", text: "A", authorId: "p1", columnId: "col-1", groupId: "g1", order: 0 },
    ];
    expect(getUngroupedItems(grouped)).toEqual([]);
  });
});

describe("getGroupedItems", () => {
  const items: RetroItem[] = [
    { id: "a", text: "A", authorId: "p1", columnId: "col-1", groupId: "g1", order: 1 },
    { id: "b", text: "B", authorId: "p1", columnId: "col-1", groupId: null, order: 0 },
    { id: "c", text: "C", authorId: "p1", columnId: "col-1", groupId: "g1", order: 0 },
    { id: "d", text: "D", authorId: "p1", columnId: "col-1", groupId: "g2", order: 0 },
  ];

  it("returns items in specified group sorted by order", () => {
    const result = getGroupedItems(items, "g1");
    expect(result.map((i) => i.id)).toEqual(["c", "a"]);
  });

  it("returns empty array for non-existent group", () => {
    expect(getGroupedItems(items, "g99")).toEqual([]);
  });
});

describe("applyReorderItems", () => {
  const items: RetroItem[] = [
    { id: "a", text: "A", authorId: "p1", columnId: "col-1", groupId: null, order: 0 },
    { id: "b", text: "B", authorId: "p1", columnId: "col-1", groupId: null, order: 1 },
    { id: "c", text: "C", authorId: "p1", columnId: "col-1", groupId: null, order: 2 },
  ];

  it("reorders items and reassigns order indices", () => {
    const result = applyReorderItems(items, ["c", "a", "b"]);
    expect(result.map((i) => i.id)).toEqual(["c", "a", "b"]);
    expect(result.map((i) => i.order)).toEqual([0, 1, 2]);
  });

  it("preserves items not in the ordered list", () => {
    const result = applyReorderItems(items, ["c", "a"]);
    expect(result.map((i) => i.id)).toEqual(["c", "a", "b"]);
    expect(result).toHaveLength(3);
  });

  it("reordering items within one group preserves items in other groups", () => {
    const multiGroupItems: RetroItem[] = [
      { id: "a1", text: "A1", authorId: "p1", columnId: "col-1", groupId: "g1", order: 0 },
      { id: "a2", text: "A2", authorId: "p1", columnId: "col-1", groupId: "g1", order: 1 },
      { id: "b1", text: "B1", authorId: "p1", columnId: "col-1", groupId: "g2", order: 0 },
      { id: "b2", text: "B2", authorId: "p1", columnId: "col-1", groupId: "g2", order: 1 },
      { id: "u1", text: "U1", authorId: "p1", columnId: "col-1", groupId: null, order: 0 },
    ];
    // Reorder only g1 items (a2, a1)
    const result = applyReorderItems(multiGroupItems, ["a2", "a1"]);
    const g1Ids = result.filter((i) => i.groupId === "g1").map((i) => i.id);
    const g2Ids = result.filter((i) => i.groupId === "g2").map((i) => i.id);
    const ungroupedIds = result.filter((i) => i.groupId === null).map((i) => i.id);
    expect(g1Ids).toEqual(["a2", "a1"]);
    expect(g2Ids).toEqual(["b1", "b2"]);
    expect(ungroupedIds).toEqual(["u1"]);
    expect(result).toHaveLength(5);
  });

  it("reordering ungrouped items preserves grouped items", () => {
    const mixedItems: RetroItem[] = [
      { id: "u1", text: "U1", authorId: "p1", columnId: "col-1", groupId: null, order: 0 },
      { id: "u2", text: "U2", authorId: "p1", columnId: "col-1", groupId: null, order: 1 },
      { id: "g1a", text: "G1A", authorId: "p1", columnId: "col-1", groupId: "g1", order: 0 },
    ];
    // Reorder only ungrouped items
    const result = applyReorderItems(mixedItems, ["u2", "u1"]);
    expect(result).toHaveLength(3);
    expect(result.filter((i) => i.groupId === null).map((i) => i.id)).toEqual(["u2", "u1"]);
    expect(result.filter((i) => i.groupId === "g1").map((i) => i.id)).toEqual(["g1a"]);
  });

  it("reorders items correctly with target-list contiguous order indices", () => {
    const multiGroupItems: RetroItem[] = [
      { id: "a1", text: "A1", authorId: "p1", columnId: "col-1", groupId: "g1", order: 0 },
      { id: "a2", text: "A2", authorId: "p1", columnId: "col-1", groupId: "g1", order: 1 },
      { id: "b1", text: "B1", authorId: "p1", columnId: "col-1", groupId: "g2", order: 2 },
    ];
    const result = applyReorderItems(multiGroupItems, ["a2", "a1"]);
    expect(result.filter((item) => item.groupId === "g1").map((i) => i.order)).toEqual([0, 1]);
    expect(result.find((item) => item.id === "b1")!.order).toBe(2);
  });

  it("handles empty orderedIds preserving all items", () => {
    const result = applyReorderItems(items, []);
    expect(result).toHaveLength(3);
    expect(result.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});

describe("validateItemReorderPayload", () => {
  const items: RetroItem[] = [
    { id: "a1", text: "A1", authorId: "p1", columnId: "g1", groupId: "g1", order: 0 },
    { id: "a2", text: "A2", authorId: "p1", columnId: "g1", groupId: "g1", order: 1 },
    { id: "b1", text: "B1", authorId: "p1", columnId: "g2", groupId: "g2", order: 0 },
    { id: "u1", text: "U1", authorId: "p1", columnId: "g1", groupId: null, order: 0 },
  ];

  it("accepts a complete single-list item permutation", () => {
    expect(validateItemReorderPayload(items, ["a2", "a1"])).toEqual({ valid: true, ids: ["a2", "a1"] });
  });

  it("rejects duplicate item IDs", () => {
    const result = validateItemReorderPayload(items, ["a1", "a1"]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("duplicate");
  });

  it("rejects missing, extra, and unknown item IDs", () => {
    expect(validateItemReorderPayload(items, ["a1"]).valid).toBe(false);
    expect(validateItemReorderPayload(items, ["a2", "a1", "unknown"]).valid).toBe(false);
    expect(validateItemReorderPayload(items, ["unknown"]).valid).toBe(false);
  });

  it("rejects mixed-list reorder payloads", () => {
    const result = validateItemReorderPayload(items, ["a1", "b1"]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("single column");
  });

  it("validates item reorder payloads through an Effect boundary", async () => {
    await expect(Effect.runPromise(validateItemReorderPayloadEffect(items, ["a2", "a1"])))
      .resolves.toEqual(["a2", "a1"]);

    const exit = await Effect.runPromiseExit(validateItemReorderPayloadEffect(items, ["a1", "b1"]));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("applyReorderGroups", () => {
  const groups: Group[] = [
    { id: "g1", name: "A", order: 0 },
    { id: "g2", name: "B", order: 1 },
    { id: "g3", name: "C", order: 2 },
  ];

  it("reorders groups and reassigns order indices", () => {
    const result = applyReorderGroups(groups, ["g3", "g1", "g2"]);
    expect(result.map((g) => g.id)).toEqual(["g3", "g1", "g2"]);
    expect(result.map((g) => g.order)).toEqual([0, 1, 2]);
  });
});

describe("validateGroupReorderPayload", () => {
  const groups: Group[] = [
    { id: "g1", name: "A", columnId: "col-1", order: 0 },
    { id: "g2", name: "B", columnId: "col-1", order: 1 },
    { id: "g3", name: "C", columnId: "col-2", order: 0 },
  ];

  it("accepts a complete same-column group permutation", () => {
    expect(validateGroupReorderPayload(groups, ["g2", "g1"])).toEqual({ valid: true, ids: ["g2", "g1"] });
  });

  it("rejects duplicate, omitted, unknown, and cross-column group reorder payloads", () => {
    expect(validateGroupReorderPayload(groups, ["g1", "g1"])).toMatchObject({ valid: false, error: expect.stringContaining("duplicate") });
    expect(validateGroupReorderPayload(groups, ["g1"])).toMatchObject({ valid: false, error: expect.stringContaining("every group") });
    expect(validateGroupReorderPayload(groups, ["g1", "missing"])).toMatchObject({ valid: false, error: expect.stringContaining("unknown") });
    expect(validateGroupReorderPayload(groups, ["g1", "g3"])).toMatchObject({ valid: false, error: expect.stringContaining("single column") });
  });

  it("validates group reorder payloads through an Effect boundary", async () => {
    await expect(Effect.runPromise(validateGroupReorderPayloadEffect(groups, ["g2", "g1"])))
      .resolves.toEqual(["g2", "g1"]);

    const exit = await Effect.runPromiseExit(validateGroupReorderPayloadEffect(groups, ["g1", "g3"]));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("applyDeleteGroup", () => {
  it("removes only the target nested group, ungroups its items in the same column, and removes its votes", () => {
    const groups: Group[] = [
      { id: "g1", name: "A", columnId: "col-1", order: 0 },
      { id: "g2", name: "B", columnId: "col-1", order: 1 },
      { id: "g3", name: "C", columnId: "col-2", order: 0 },
    ];
    const items: RetroItem[] = [
      { id: "i1", text: "One", authorId: "p1", columnId: "col-1", groupId: "g1", order: 0 },
      { id: "i2", text: "Two", authorId: "p1", columnId: "col-1", groupId: "g2", order: 0 },
      { id: "i3", text: "Three", authorId: "p1", columnId: "col-2", groupId: "g3", order: 0 },
    ];
    const votes = [
      { participantId: "p1", groupId: "g1", itemId: "g1", count: 1 },
      { participantId: "p2", groupId: "g2", itemId: "g2", count: 2 },
    ];

    const result = applyDeleteGroup(groups, items, votes, "g1");

    expect([...result.groups].sort((a, b) => a.columnId.localeCompare(b.columnId) || a.order - b.order)).toEqual([
      { id: "g2", name: "B", columnId: "col-1", order: 0 },
      { id: "g3", name: "C", columnId: "col-2", order: 0 },
    ]);
    expect(result.items).toEqual([
      expect.objectContaining({ id: "i1", columnId: "col-1", groupId: null, order: 0 }),
      expect.objectContaining({ id: "i2", columnId: "col-1", groupId: "g2", order: 0 }),
      expect.objectContaining({ id: "i3", columnId: "col-2", groupId: "g3", order: 0 }),
    ]);
    expect(result.votes).toEqual([{ participantId: "p2", groupId: "g2", itemId: "g2", count: 2 }]);
  });
});

describe("applyMoveItemToGroup", () => {
  const items: RetroItem[] = [
    { id: "a", text: "A", authorId: "p1", columnId: "col-1", groupId: null, order: 0 },
    { id: "b", text: "B", authorId: "p1", columnId: "col-1", groupId: null, order: 1 },
    { id: "c", text: "C", authorId: "p1", columnId: "col-1", groupId: "g1", order: 0 },
  ];

  it("moves item to a group at specified index", () => {
    const result = applyMoveItemToGroup(items, "a", "g1", 0);
    const moved = result.find((i) => i.id === "a");
    expect(moved?.groupId).toBe("g1");
    expect(moved?.order).toBe(0);
  });

  it("moves item to ungrouped (null groupId)", () => {
    const result = applyMoveItemToGroup(items, "c", null, 1);
    const moved = result.find((i) => i.id === "c");
    expect(moved?.groupId).toBeNull();
  });

  it("returns unchanged items if itemId not found", () => {
    const result = applyMoveItemToGroup(items, "z", "g1", 0);
    expect(result).toEqual(items);
  });

  it("keeps duplicate text items distinct when moving one", () => {
    const dupItems: RetroItem[] = [
      { id: "x1", text: "Same", authorId: "p1", columnId: "col-1", groupId: null, order: 0 },
      { id: "x2", text: "Same", authorId: "p1", columnId: "col-1", groupId: null, order: 1 },
    ];
    const result = applyMoveItemToGroup(dupItems, "x1", "g1", 0);
    expect(result).toHaveLength(2);
    const moved = result.find((i) => i.id === "x1");
    const stayed = result.find((i) => i.id === "x2");
    expect(moved?.groupId).toBe("g1");
    expect(stayed?.groupId).toBeNull();
  });

  it("inserts relative to the target list and compacts only affected list order", () => {
    const interleaved: RetroItem[] = [
      { id: "a1", text: "A1", authorId: "p1", columnId: "g1", groupId: "g1", order: 0 },
      { id: "b1", text: "B1", authorId: "p2", columnId: "g2", groupId: "g2", order: 0 },
      { id: "a2", text: "A2", authorId: "p1", columnId: "g1", groupId: "g1", order: 1 },
      { id: "b2", text: "B2", authorId: "p2", columnId: "g2", groupId: "g2", order: 1 },
      { id: "u1", text: "U1", authorId: "p3", columnId: "g1", groupId: null, order: 0 },
    ];

    const result = applyMoveItemToGroup(interleaved, "a2", "g2", 1);

    expect(result.filter((item) => item.groupId === "g2").sort((a, b) => a.order - b.order).map((item) => item.id)).toEqual(["b1", "a2", "b2"]);
    expect(result.filter((item) => item.groupId === "g1").sort((a, b) => a.order - b.order).map((item) => [item.id, item.order])).toEqual([["a1", 0]]);
    expect(result.filter((item) => item.groupId === null).map((item) => [item.id, item.order])).toEqual([["u1", 0]]);
  });

  it("preserves non-layout item data while moving", () => {
    const result = applyMoveItemToGroup(items, "a", "g1", 1);
    const moved = result.find((item) => item.id === "a")!;

    expect(moved.text).toBe("A");
    expect(moved.authorId).toBe("p1");
    expect(moved.columnId).toBe("col-1");
    expect(moved.groupId).toBe("g1");
  });
});
