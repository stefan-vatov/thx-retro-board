import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import {
  createRoomState,
  createRoomStateEffect,
  createParticipant,
  createParticipantEffect,
  createItem,
  createItemEffect,
  createGroup,
  createGroupEffect,
  createColumn,
  createColumnEffect,
  createActionItem,
  createActionItemEffect,
  canTransition,
  canTransitionEffect,
  isPhaseAllowed,
  isPhaseAllowedEffect,
  isTimerExpired,
  isTimerExpiredEffect,
  getDefaultColumns,
  getDefaultColumnsEffect,
  getPairwiseComparisons,
  sanitizeDisplayName,
  sanitizeDisplayNameEffect,
  isValidDisplayName,
  isValidDisplayNameEffect,
  sanitizeItemText,
  sanitizeItemTextEffect,
  isValidItemText,
  isValidItemTextEffect,
  sanitizeGroupName,
  sanitizeGroupNameEffect,
  isValidGroupName,
  isValidGroupNameEffect,
  validateExistingColumnId,
  validateExistingColumnIdEffect,
} from "./state";
import type { Group, RetroItem } from "./types";

describe("createRoomState", () => {
  it("creates initial room state with setup phase", () => {
    const state = createRoomState("room-1");
    expect(state.roomId).toBe("room-1");
    expect(state.startedAt).toEqual(expect.any(Number));
    expect(state.phase).toBe("setup");
    expect(state.participants).toEqual([]);
    expect(state.items).toEqual([]);
    expect(state.schemaVersion).toBe(2);
    expect(state.columns).toEqual(getDefaultColumns());
    expect(state.groups).toEqual([]);
    expect(state.votes).toEqual([]);
    expect(state.rankingMethod).toBe("score");
    expect(state.pairwiseChoices).toEqual([]);
    expect(state.actions).toEqual([]);
    expect(state.timer).toEqual({ startedAt: null, durationSeconds: null, expired: false });
    expect(state.voteBudget).toBe(5);
    expect(state.version).toBe(0);
  });

  it("accepts custom vote budget", () => {
    const state = createRoomState("room-2", 10);
    expect(state.voteBudget).toBe(10);
  });

  it("creates room state through an Effect boundary", async () => {
    const state = await Effect.runPromise(createRoomStateEffect("room-3", 7));
    expect(state).toMatchObject({ roomId: "room-3", phase: "setup", voteBudget: 7 });
  });

  it("returns isolated default columns through an Effect boundary", async () => {
    const columns = await Effect.runPromise(getDefaultColumnsEffect());

    expect(columns).toEqual(getDefaultColumns());
    expect(columns).not.toBe(getDefaultColumns());
    expect(columns[0]).not.toBe(getDefaultColumns()[0]);
  });
});

describe("createParticipant", () => {
  it("creates a participant with correct fields", () => {
    const p = createParticipant("p1", "Alice", true);
    expect(p).toEqual({ id: "p1", displayName: "Alice", isFacilitator: true });
  });

  it("creates a participant through an Effect boundary", async () => {
    await expect(Effect.runPromise(createParticipantEffect("p1", "Alice", true)))
      .resolves.toEqual({ id: "p1", displayName: "Alice", isFacilitator: true });
  });
});

describe("createItem", () => {
  it("creates an item with a required original column ID and null groupId", () => {
    const item = createItem("i1", "Improve standups", "p1", 0, "col-1");
    expect(item).toEqual({ id: "i1", text: "Improve standups", authorId: "p1", columnId: "col-1", groupId: null, order: 0 });
  });

  it("creates an item through an Effect boundary", async () => {
    await expect(Effect.runPromise(createItemEffect("i1", "Improve standups", "p1", 0, "col-1")))
      .resolves.toEqual({ id: "i1", text: "Improve standups", authorId: "p1", columnId: "col-1", groupId: null, order: 0 });
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

  it("validates configured column IDs through an Effect boundary", async () => {
    await expect(Effect.runPromise(validateExistingColumnIdEffect(columns, "col-2"))).resolves.toBe("col-2");

    const exit = await Effect.runPromiseExit(validateExistingColumnIdEffect(columns, "missing"));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("createGroup", () => {
  it("creates a group with correct fields", () => {
    const g = createGroup("g1", "Process", "col-1", 0);
    expect(g).toEqual({ id: "g1", name: "Process", columnId: "col-1", order: 0 });
  });

  it("creates a group through an Effect boundary", async () => {
    await expect(Effect.runPromise(createGroupEffect("g1", "Process", "col-1", 0)))
      .resolves.toEqual({ id: "g1", name: "Process", columnId: "col-1", order: 0 });
  });
});

describe("core factory and phase helpers", () => {
  it("creates columns and action items through Effect boundaries", async () => {
    await expect(Effect.runPromise(createColumnEffect("col-1", "Mad", 0)))
      .resolves.toEqual(createColumn("col-1", "Mad", 0));
    await expect(Effect.runPromise(createActionItemEffect("action-1", "  Follow up  ", "p1", 0)))
      .resolves.toEqual(createActionItem("action-1", "Follow up", "p1", 0));
  });

  it("evaluates phase and timer helpers through Effect boundaries", async () => {
    await expect(Effect.runPromise(canTransitionEffect("setup", "write"))).resolves.toBe(canTransition("setup", "write"));
    await expect(Effect.runPromise(isPhaseAllowedEffect("write", "write"))).resolves.toBe(isPhaseAllowed("write", "write"));
    await expect(Effect.runPromise(isTimerExpiredEffect({ startedAt: null, durationSeconds: null, expired: false })))
      .resolves.toBe(isTimerExpired({ startedAt: null, durationSeconds: null, expired: false }));
  });
});

describe("getPairwiseComparisons", () => {
  it("creates every pair across grouped and ungrouped decision targets", () => {
    const columns = [
      { id: "mad", name: "Mad", order: 0 },
      { id: "glad", name: "Glad", order: 1 },
      { id: "sad", name: "Sad", order: 2 },
    ];
    const groups: Group[] = [
      { id: "group-1", name: "Grouped mad", columnId: "mad", order: 0 },
    ];
    const items: RetroItem[] = [
      { id: "mad-grouped-1", text: "Grouped one", authorId: "p1", columnId: "mad", groupId: "group-1", order: 0 },
      { id: "mad-grouped-2", text: "Grouped two", authorId: "p1", columnId: "mad", groupId: "group-1", order: 1 },
      { id: "mad-ungrouped", text: "Ungrouped mad", authorId: "p1", columnId: "mad", groupId: null, order: 1 },
      { id: "glad-ungrouped", text: "Ungrouped glad", authorId: "p1", columnId: "glad", groupId: null, order: 0 },
      { id: "sad-ungrouped", text: "Ungrouped sad", authorId: "p1", columnId: "sad", groupId: null, order: 0 },
    ];

    const comparisons = getPairwiseComparisons({ columns, groups, items });

    expect(comparisons).toHaveLength(6);
    expect(comparisons.map((comparison) => [comparison.left.label, comparison.right.label])).toEqual([
      ["Grouped mad", "Ungrouped mad"],
      ["Grouped mad", "Ungrouped glad"],
      ["Grouped mad", "Ungrouped sad"],
      ["Ungrouped mad", "Ungrouped glad"],
      ["Ungrouped mad", "Ungrouped sad"],
      ["Ungrouped glad", "Ungrouped sad"],
    ]);
  });

  it("compares two decision targets even when they are in different columns", () => {
    const columns = [
      { id: "mad", name: "Mad", order: 0 },
      { id: "glad", name: "Glad", order: 1 },
    ];
    const items: RetroItem[] = [
      { id: "mad-1", text: "Mad one", authorId: "p1", columnId: "mad", groupId: null, order: 0 },
      { id: "glad-1", text: "Glad one", authorId: "p1", columnId: "glad", groupId: null, order: 0 },
    ];

    const comparisons = getPairwiseComparisons({ columns, groups: [], items });

    expect(comparisons).toHaveLength(1);
    expect(comparisons[0]).toMatchObject({
      columnId: "__cross_column__",
      left: expect.objectContaining({ label: "Mad one" }),
      right: expect.objectContaining({ label: "Glad one" }),
    });
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

  it("sanitizes display names through an Effect boundary", async () => {
    await expect(Effect.runPromise(sanitizeDisplayNameEffect("  Alice  "))).resolves.toBe("Alice");
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

  it("validates display names through an Effect boundary", async () => {
    await expect(Effect.runPromise(isValidDisplayNameEffect("Alice"))).resolves.toBe(true);
    await expect(Effect.runPromise(isValidDisplayNameEffect("   "))).resolves.toBe(false);
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

  it("sanitizes item text through an Effect boundary", async () => {
    await expect(Effect.runPromise(sanitizeItemTextEffect("  Improve standups  "))).resolves.toBe("Improve standups");
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

  it("validates item text through an Effect boundary", async () => {
    await expect(Effect.runPromise(isValidItemTextEffect("Improve standups"))).resolves.toBe(true);
    await expect(Effect.runPromise(isValidItemTextEffect("   "))).resolves.toBe(false);
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

  it("sanitizes group names through an Effect boundary", async () => {
    await expect(Effect.runPromise(sanitizeGroupNameEffect("  Process  "))).resolves.toBe("Process");
  });
});

describe("isValidGroupName", () => {
  it("rejects empty strings", () => {
    expect(isValidGroupName("")).toBe(false);
  });

  it("rejects whitespace-only strings", () => {
    expect(isValidGroupName("   ")).toBe(false);
  });

  it("validates group names through an Effect boundary", async () => {
    await expect(Effect.runPromise(isValidGroupNameEffect("Process"))).resolves.toBe(true);
    await expect(Effect.runPromise(isValidGroupNameEffect("   "))).resolves.toBe(false);
  });

  it("accepts valid group names", () => {
    expect(isValidGroupName("Process")).toBe(true);
  });
});
