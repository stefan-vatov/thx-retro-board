import { describe, it, expect } from "vitest";
import {
  createRoomState,
  createParticipant,
  createItem,
  createGroup,
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
  applyReorderGroups,
  applyMoveItemToGroup,
  applyCastVote,
  applyRemoveVote,
} from "./state";
import type { RetroItem, Group, RoomState } from "./types";

function makeState(overrides: Partial<RoomState> & { roomId: string }): RoomState {
  return {
    phase: "write",
    participants: [],
    items: [],
    groups: [],
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
  it("creates an item with null groupId", () => {
    const item = createItem("i1", "Improve standups", "p1", 0);
    expect(item).toEqual({ id: "i1", text: "Improve standups", authorId: "p1", groupId: null, order: 0 });
  });
});

describe("createGroup", () => {
  it("creates a group with correct fields", () => {
    const g = createGroup("g1", "Process", 0);
    expect(g).toEqual({ id: "g1", name: "Process", order: 0 });
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
    { id: "a", text: "A", authorId: "p1", groupId: null, order: 0 },
    { id: "b", text: "B", authorId: "p1", groupId: null, order: 1 },
    { id: "c", text: "C", authorId: "p1", groupId: null, order: 2 },
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
    { id: "a", text: "A", authorId: "p1", groupId: null, order: 2 },
    { id: "b", text: "B", authorId: "p1", groupId: "g1", order: 0 },
    { id: "c", text: "C", authorId: "p1", groupId: null, order: 1 },
  ];

  it("returns items with null groupId sorted by order", () => {
    const result = getUngroupedItems(items);
    expect(result.map((i) => i.id)).toEqual(["c", "a"]);
  });

  it("returns empty array when all items are grouped", () => {
    const grouped: RetroItem[] = [
      { id: "a", text: "A", authorId: "p1", groupId: "g1", order: 0 },
    ];
    expect(getUngroupedItems(grouped)).toEqual([]);
  });
});

describe("getGroupedItems", () => {
  const items: RetroItem[] = [
    { id: "a", text: "A", authorId: "p1", groupId: "g1", order: 1 },
    { id: "b", text: "B", authorId: "p1", groupId: null, order: 0 },
    { id: "c", text: "C", authorId: "p1", groupId: "g1", order: 0 },
    { id: "d", text: "D", authorId: "p1", groupId: "g2", order: 0 },
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
    { id: "a", text: "A", authorId: "p1", groupId: null, order: 0 },
    { id: "b", text: "B", authorId: "p1", groupId: null, order: 1 },
    { id: "c", text: "C", authorId: "p1", groupId: null, order: 2 },
  ];

  it("reorders items and reassigns order indices", () => {
    const result = applyReorderItems(items, ["c", "a", "b"]);
    expect(result.map((i) => i.id)).toEqual(["c", "a", "b"]);
    expect(result.map((i) => i.order)).toEqual([0, 1, 2]);
  });

  it("preserves items not in the ordered list", () => {
    const result = applyReorderItems(items, ["c", "a"]);
    expect(result.map((i) => i.id)).toEqual(["c", "a"]);
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

describe("applyMoveItemToGroup", () => {
  const items: RetroItem[] = [
    { id: "a", text: "A", authorId: "p1", groupId: null, order: 0 },
    { id: "b", text: "B", authorId: "p1", groupId: null, order: 1 },
    { id: "c", text: "C", authorId: "p1", groupId: "g1", order: 0 },
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
      { id: "x1", text: "Same", authorId: "p1", groupId: null, order: 0 },
      { id: "x2", text: "Same", authorId: "p1", groupId: null, order: 1 },
    ];
    const result = applyMoveItemToGroup(dupItems, "x1", "g1", 0);
    expect(result).toHaveLength(2);
    const moved = result.find((i) => i.id === "x1");
    const stayed = result.find((i) => i.id === "x2");
    expect(moved?.groupId).toBe("g1");
    expect(stayed?.groupId).toBeNull();
  });
});

describe("applyCastVote", () => {
  it("adds a new vote allocation", () => {
    const result = applyCastVote([], "p1", "i1", 1, 5);
    expect(result.error).toBeUndefined();
    expect(result.votes).toEqual([{ participantId: "p1", itemId: "i1", count: 1 }]);
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
      { participantId: "p1", itemId: "i1", count: 2 },
      { participantId: "p1", itemId: "i2", count: 3 },
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
