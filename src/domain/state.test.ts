import { describe, it, expect } from "vitest";
import {
  createRoomState,
  createParticipant,
  createItem,
  createGroup,
  getDefaultColumns,
  validateFullColumnPermutation,
  applyReorderColumns,
  applyEditColumn,
  applyDeleteColumn,
  PHASE_ORDER,
  canTransition,
  isPhaseAllowed,
  getVotesForItem,
  getVotesByParticipant,
  getRemainingBudget,
  sanitizeDisplayName,
  isValidDisplayName,
  sanitizeItemText,
  isValidItemText,
  reorderList,
  sanitizeGroupName,
  isValidGroupName,
  getUngroupedItems,
  getGroupedItems,
  applyReorderItems,
  validateItemReorderPayload,
  applyReorderGroups,
  validateGroupReorderPayload,
  applyDeleteGroup,
  applyMoveItemToGroup,
  applyCastVote,
  applyRemoveVote,
  validateExistingColumnId,
} from "./state";
import type { RetroItem, Group, RoomState } from "./types";

function makeState(overrides: Partial<RoomState> & { roomId: string }): RoomState {
  return {
    phase: "write",
    participants: [],
    items: [],
    columns: getDefaultColumns(),
    groups: getDefaultColumns(),
    votes: [],
    timer: { startedAt: null, durationSeconds: null, expired: false },
    voteBudget: 5,
    version: 0,
    ...overrides,
  };
}

describe("createRoomState", () => {
  it("creates initial room state with write phase", () => {
    const state = createRoomState("room-1");
    expect(state.roomId).toBe("room-1");
    expect(state.phase).toBe("write");
    expect(state.participants).toEqual([]);
    expect(state.items).toEqual([]);
    expect(state.schemaVersion).toBe(2);
    expect(state.columns).toEqual([]);
    expect(state.groups).toEqual([]);
    expect(state.votes).toEqual([]);
    expect(state.timer).toEqual({ startedAt: null, durationSeconds: null, expired: false });
    expect(state.voteBudget).toBe(5);
    expect(state.version).toBe(0);
  });

  it("accepts custom vote budget", () => {
    const state = createRoomState("room-2", 10);
    expect(state.voteBudget).toBe(10);
  });
});

describe("createParticipant", () => {
  it("creates a participant with correct fields", () => {
    const p = createParticipant("p1", "Alice", true);
    expect(p).toEqual({ id: "p1", displayName: "Alice", isFacilitator: true });
  });
});

describe("createItem", () => {
  it("creates an item with a required original column ID and null groupId", () => {
    const item = createItem("i1", "Improve standups", "p1", 0, "col-1");
    expect(item).toEqual({ id: "i1", text: "Improve standups", authorId: "p1", columnId: "col-1", groupId: null, order: 0 });
  });
});

describe("validateExistingColumnId", () => {
  const columns = [
    { id: "col-1", name: "Went well", order: 0 },
    { id: "col-2", name: "Could improve", order: 1 },
  ];

  it("accepts valid configured column IDs", () => {
    expect(validateExistingColumnId(columns, "col-1")).toEqual({ valid: true, columnId: "col-1" });
  });

  it("rejects missing, null, malformed, and unknown column IDs", () => {
    expect(validateExistingColumnId(columns, undefined)).toEqual({ valid: false, error: "Column is required" });
    expect(validateExistingColumnId(columns, null)).toEqual({ valid: false, error: "Column is required" });
    expect(validateExistingColumnId(columns, 12)).toEqual({ valid: false, error: "Column is required" });
    expect(validateExistingColumnId(columns, "missing")).toEqual({ valid: false, error: "Column not found" });
  });
});

describe("createGroup", () => {
  it("creates a group with correct fields", () => {
    const g = createGroup("g1", "Process", "col-1", 0);
    expect(g).toEqual({ id: "g1", name: "Process", columnId: "col-1", order: 0 });
  });
});


describe("column helpers", () => {
  it("validates complete column reorder payloads atomically", () => {
    const columns = getDefaultColumns();
    expect(validateFullColumnPermutation(columns, columns.map((column) => column.id)).valid).toBe(true);
    expect(validateFullColumnPermutation(columns, ["start", "start", "continue"]).valid).toBe(false);
    expect(validateFullColumnPermutation(columns, ["start", "stop"]).valid).toBe(false);
    expect(validateFullColumnPermutation(columns, ["start", "stop", "unknown"]).valid).toBe(false);
    expect(validateFullColumnPermutation(columns, "start").valid).toBe(false);
  });

  it("reorders columns with stable IDs and contiguous order", () => {
    const columns = [
      { id: "start", name: "Start", order: 0 },
      { id: "stop", name: "Stop", order: 1 },
      { id: "continue", name: "Continue", order: 2 },
    ];
    const result = applyReorderColumns(columns, ["continue", "start", "stop"]);
    expect(result.map((column) => column.id)).toEqual(["continue", "start", "stop"]);
    expect(result.map((column) => column.order)).toEqual([0, 1, 2]);
  });

  it("edits column names without changing IDs", () => {
    const columns = [{ id: "start", name: "Start", order: 0 }];
    const result = applyEditColumn(columns, "start", "  Begin  ");
    expect(result.error).toBeUndefined();
    expect(result.columns.find((column) => column.id === "start")?.name).toBe("Begin");
    expect(result.columns.map((column) => column.id)).toEqual(columns.map((column) => column.id));
  });

  it("deletes a column and cascades only its contained groups, items, and votes", () => {
    const columns = [
      { id: "keep", name: "Keep", order: 0 },
      { id: "delete", name: "Delete", order: 1 },
      { id: "also-keep", name: "Also keep", order: 2 },
    ];
    const groups = [
      { id: "keep-group", name: "Keep group", columnId: "keep", order: 0 },
      { id: "delete-group", name: "Delete group", columnId: "delete", order: 0 },
      { id: "also-keep-group", name: "Also keep group", columnId: "also-keep", order: 0 },
    ];
    const items = [
      { id: "keep-item", text: "Keep", authorId: "p1", columnId: "keep", groupId: "keep-group", order: 0 },
      { id: "delete-item", text: "Delete", authorId: "p1", columnId: "delete", groupId: "delete-group", order: 0 },
      { id: "also-keep-item", text: "Also keep", authorId: "p1", columnId: "also-keep", groupId: null, order: 0 },
    ];
    const votes = [
      { participantId: "p1", groupId: "keep-group", count: 1 },
      { participantId: "p1", groupId: "delete-group", count: 2 },
      { participantId: "p2", groupId: "also-keep-group", count: 3 },
    ];

    const result = applyDeleteColumn(columns, groups, items, votes, "delete");

    expect(result.error).toBeUndefined();
    expect(result.columns.map((column) => [column.id, column.order])).toEqual([["keep", 0], ["also-keep", 1]]);
    expect(result.groups.map((group) => group.id)).toEqual(["keep-group", "also-keep-group"]);
    expect(result.items.map((item) => item.id)).toEqual(["keep-item", "also-keep-item"]);
    expect(result.votes).toEqual([
      { participantId: "p1", groupId: "keep-group", count: 1 },
      { participantId: "p2", groupId: "also-keep-group", count: 3 },
    ]);
  });

  it("deletes the final column into an empty board", () => {
    const result = applyDeleteColumn(
      [{ id: "last", name: "Last", order: 0 }],
      [{ id: "last-group", name: "Last group", columnId: "last", order: 0 }],
      [{ id: "last-item", text: "Last", authorId: "p1", columnId: "last", groupId: "last-group", order: 0 }],
      [{ participantId: "p1", groupId: "last-group", count: 1 }],
      "last",
    );

    expect(result).toEqual({ columns: [], groups: [], items: [], votes: [] });
  });
});

describe("PHASE_ORDER", () => {
  it("contains phases in correct order", () => {
    expect(PHASE_ORDER).toEqual(["write", "organise", "vote", "review"]);
  });
});

describe("canTransition", () => {
  it("allows forward transitions", () => {
    expect(canTransition("write", "organise")).toBe(true);
    expect(canTransition("organise", "vote")).toBe(true);
    expect(canTransition("vote", "review")).toBe(true);
  });

  it("rejects same-phase transition", () => {
    expect(canTransition("write", "write")).toBe(false);
  });

  it("rejects backward transitions", () => {
    expect(canTransition("organise", "write")).toBe(false);
    expect(canTransition("review", "vote")).toBe(false);
  });

  it("rejects skipping phases", () => {
    expect(canTransition("write", "vote")).toBe(false);
    expect(canTransition("write", "review")).toBe(false);
  });
});

describe("isPhaseAllowed", () => {
  it("returns true when action phase matches current phase", () => {
    expect(isPhaseAllowed("write", "write")).toBe(true);
    expect(isPhaseAllowed("vote", "vote")).toBe(true);
  });

  it("returns false when phases differ", () => {
    expect(isPhaseAllowed("write", "vote")).toBe(false);
  });
});

describe("vote helpers", () => {
  const votes = [
    { participantId: "p1", itemId: "i1", count: 2 },
    { participantId: "p2", itemId: "i1", count: 1 },
    { participantId: "p1", itemId: "i2", count: 1 },
  ];

  it("getVotesForItem aggregates across participants", () => {
    expect(getVotesForItem(votes, "i1")).toBe(3);
    expect(getVotesForItem(votes, "i2")).toBe(1);
    expect(getVotesForItem(votes, "i3")).toBe(0);
  });

  it("getVotesByParticipant aggregates across items", () => {
    expect(getVotesByParticipant(votes, "p1")).toBe(3);
    expect(getVotesByParticipant(votes, "p2")).toBe(1);
    expect(getVotesByParticipant(votes, "p3")).toBe(0);
  });

  it("getRemainingBudget calculates remaining votes", () => {
    expect(getRemainingBudget(votes, "p1", 5)).toBe(2);
    expect(getRemainingBudget(votes, "p2", 5)).toBe(4);
    expect(getRemainingBudget(votes, "p3", 5)).toBe(5);
  });
});

describe("sanitizeDisplayName", () => {
  it("trims whitespace", () => {
    expect(sanitizeDisplayName("  Alice  ")).toBe("Alice");
  });

  it("truncates to 50 characters", () => {
    const long = "A".repeat(60);
    expect(sanitizeDisplayName(long).length).toBe(50);
  });
});

describe("isValidDisplayName", () => {
  it("rejects empty strings", () => {
    expect(isValidDisplayName("")).toBe(false);
  });

  it("rejects whitespace-only strings", () => {
    expect(isValidDisplayName("   ")).toBe(false);
  });

  it("accepts valid names", () => {
    expect(isValidDisplayName("Alice")).toBe(true);
  });
});

describe("sanitizeItemText", () => {
  it("trims whitespace", () => {
    expect(sanitizeItemText("  Improve standups  ")).toBe("Improve standups");
  });

  it("truncates to 500 characters", () => {
    const long = "A".repeat(600);
    expect(sanitizeItemText(long).length).toBe(500);
  });
});

describe("isValidItemText", () => {
  it("rejects empty strings", () => {
    expect(isValidItemText("")).toBe(false);
  });

  it("rejects whitespace-only strings", () => {
    expect(isValidItemText("   ")).toBe(false);
  });

  it("accepts valid text", () => {
    expect(isValidItemText("Improve standups")).toBe(true);
  });
});

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

describe("version-aware state reconciliation", () => {
  it("prefers ws state when ws version is higher", () => {
    const local = makeState({ roomId: "r1", version: 3, participants: [{ id: "p1", displayName: "A", isFacilitator: true }] });
    const ws = makeState({ roomId: "r1", version: 5, participants: [{ id: "p1", displayName: "A", isFacilitator: true }, { id: "p2", displayName: "B", isFacilitator: false }] });

    const merged = (ws.version >= local.version) ? ws : local;
    expect(merged.version).toBe(5);
    expect(merged.participants).toHaveLength(2);
  });

  it("prefers local state when local version is higher", () => {
    const local = makeState({ roomId: "r1", version: 7, participants: [{ id: "p1", displayName: "A", isFacilitator: true }] });
    const ws = makeState({ roomId: "r1", version: 3, participants: [{ id: "p1", displayName: "A", isFacilitator: true }, { id: "p2", displayName: "B", isFacilitator: false }] });

    const merged = (ws.version >= local.version) ? ws : local;
    expect(merged.version).toBe(7);
    expect(merged.participants).toHaveLength(1);
  });

  it("prefers ws state when versions are equal", () => {
    const local = makeState({ roomId: "r1", version: 4, participants: [{ id: "p1", displayName: "A", isFacilitator: true }] });
    const ws = makeState({ roomId: "r1", version: 4, participants: [{ id: "p1", displayName: "A", isFacilitator: true }, { id: "p2", displayName: "B", isFacilitator: false }] });

    const merged = (ws.version >= local.version) ? ws : local;
    expect(merged.participants).toHaveLength(2);
  });

  it("does not use participant count for merge decisions", () => {
    const local = makeState({ roomId: "r1", version: 10, participants: [{ id: "p1", displayName: "A", isFacilitator: true }, { id: "p2", displayName: "B", isFacilitator: false }, { id: "p3", displayName: "C", isFacilitator: false }] });
    const ws = makeState({ roomId: "r1", version: 2, participants: [{ id: "p1", displayName: "A", isFacilitator: true }] });

    const merged = (ws.version >= local.version) ? ws : local;
    expect(merged.version).toBe(10);
    expect(merged.participants).toHaveLength(3);
  });
});

describe("sanitizeGroupName", () => {
  it("trims whitespace", () => {
    expect(sanitizeGroupName("  Process  ")).toBe("Process");
  });

  it("truncates to 100 characters", () => {
    const long = "A".repeat(120);
    expect(sanitizeGroupName(long).length).toBe(100);
  });
});

describe("isValidGroupName", () => {
  it("rejects empty strings", () => {
    expect(isValidGroupName("")).toBe(false);
  });

  it("rejects whitespace-only strings", () => {
    expect(isValidGroupName("   ")).toBe(false);
  });

  it("accepts valid group names", () => {
    expect(isValidGroupName("Process")).toBe(true);
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

describe("applyCastVote", () => {
  it("adds a new vote allocation", () => {
    const result = applyCastVote([], "p1", "i1", 1, 5);
    expect(result.error).toBeUndefined();
    expect(result.votes).toEqual([{ participantId: "p1", groupId: "i1", itemId: "i1", count: 1 }]);
  });

  it("stacks votes on the same item", () => {
    const result = applyCastVote(
      [{ participantId: "p1", itemId: "i1", count: 2 }],
      "p1", "i1", 2, 5,
    );
    expect(result.error).toBeUndefined();
    expect(result.votes).toEqual([{ participantId: "p1", itemId: "i1", count: 4 }]);
  });

  it("rejects over-budget vote", () => {
    const result = applyCastVote(
      [{ participantId: "p1", itemId: "i1", count: 3 }],
      "p1", "i2", 3, 5,
    );
    expect(result.error).toContain("Over budget");
    expect(result.votes).toHaveLength(1);
  });

  it("rejects zero or negative count", () => {
    const r1 = applyCastVote([], "p1", "i1", 0, 5);
    expect(r1.error).toBeTruthy();
    const r2 = applyCastVote([], "p1", "i1", -1, 5);
    expect(r2.error).toBeTruthy();
  });

  it("rejects non-integer count", () => {
    const result = applyCastVote([], "p1", "i1", 1.5, 5);
    expect(result.error).toBeTruthy();
  });

  it("distributes votes across items", () => {
    let result = applyCastVote([], "p1", "i1", 2, 5);
    expect(result.error).toBeUndefined();
    result = applyCastVote(result.votes, "p1", "i2", 3, 5);
    expect(result.error).toBeUndefined();
    expect(result.votes).toEqual([
      { participantId: "p1", groupId: "i1", itemId: "i1", count: 2 },
      { participantId: "p1", groupId: "i2", itemId: "i2", count: 3 },
    ]);
  });

  it("rejects when stacking would exceed budget", () => {
    const result = applyCastVote(
      [{ participantId: "p1", itemId: "i1", count: 4 }],
      "p1", "i1", 2, 5,
    );
    expect(result.error).toContain("Over budget");
  });

  it("allows exact budget usage", () => {
    const result = applyCastVote(
      [{ participantId: "p1", itemId: "i1", count: 3 }],
      "p1", "i2", 2, 5,
    );
    expect(result.error).toBeUndefined();
    expect(getVotesByParticipant(result.votes, "p1")).toBe(5);
  });
});

describe("applyRemoveVote", () => {
  it("decrements count when count > 1", () => {
    const votes = [{ participantId: "p1", itemId: "i1", count: 3 }];
    const result = applyRemoveVote(votes, "p1", "i1");
    expect(result).toEqual([{ participantId: "p1", itemId: "i1", count: 2 }]);
  });

  it("removes allocation when count is 1", () => {
    const votes = [{ participantId: "p1", itemId: "i1", count: 1 }];
    const result = applyRemoveVote(votes, "p1", "i1");
    expect(result).toEqual([]);
  });

  it("does nothing if no allocation exists", () => {
    const votes = [{ participantId: "p1", itemId: "i1", count: 2 }];
    const result = applyRemoveVote(votes, "p2", "i1");
    expect(result).toEqual(votes);
  });

  it("does nothing if item has no votes from participant", () => {
    const votes = [{ participantId: "p1", itemId: "i1", count: 2 }];
    const result = applyRemoveVote(votes, "p1", "i2");
    expect(result).toEqual(votes);
  });
});

describe("duplicate item vote identity", () => {
  it("votes attach to item IDs so duplicate text items remain independent", () => {
    // Two items with identical text but different IDs
    const votes = [
      { participantId: "p1", itemId: "i1", count: 3 },
      { participantId: "p1", itemId: "i2", count: 2 },
    ];
    // getVotesForItem returns different totals for different item IDs
    expect(getVotesForItem(votes, "i1")).toBe(3);
    expect(getVotesForItem(votes, "i2")).toBe(2);
    expect(getVotesForItem(votes, "i3")).toBe(0);
  });

  it("adding votes to duplicate item only affects that item's ID", () => {
    let result = applyCastVote([], "p1", "i1", 1, 5);
    expect(result.error).toBeUndefined();
    result = applyCastVote(result.votes, "p1", "i2", 1, 5);
    expect(result.error).toBeUndefined();
    expect(getVotesForItem(result.votes, "i1")).toBe(1);
    expect(getVotesForItem(result.votes, "i2")).toBe(1);
    // Removing from i1 does not affect i2
    const afterRemove = applyRemoveVote(result.votes, "p1", "i1");
    expect(getVotesForItem(afterRemove, "i1")).toBe(0);
    expect(getVotesForItem(afterRemove, "i2")).toBe(1);
  });

  it("stacking votes on one duplicate does not affect the other", () => {
    // p1 has 5 votes budget, puts 2 on i1, 2 on i2
    let result = applyCastVote([], "p1", "i1", 2, 5);
    expect(result.error).toBeUndefined();
    result = applyCastVote(result.votes, "p1", "i2", 2, 5);
    expect(result.error).toBeUndefined();
    expect(getVotesForItem(result.votes, "i1")).toBe(2);
    expect(getVotesForItem(result.votes, "i2")).toBe(2);
    // removing from i1 does not affect i2
    const afterRemove = applyRemoveVote(result.votes, "p1", "i1");
    expect(getVotesForItem(afterRemove, "i1")).toBe(1); // decremented
    expect(getVotesForItem(afterRemove, "i2")).toBe(2); // unchanged
    // p1 now has 3 votes used, 2 remaining, can add 1 more to i2
    const finalResult = applyCastVote(afterRemove, "p1", "i2", 1, 5);
    expect(finalResult.error).toBeUndefined();
    expect(getVotesForItem(finalResult.votes, "i1")).toBe(1);
    expect(getVotesForItem(finalResult.votes, "i2")).toBe(3);
  });
});
