import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import {
  getDefaultColumns,
  validateFullColumnPermutation,
  validateFullColumnPermutationEffect,
  applyReorderColumns,
  applyReorderColumnsEffect,
  applyEditColumn,
  applyEditColumnEffect,
  applyDeleteColumn,
  applyDeleteColumnEffect,
  PHASE_ORDER,
  canTransition,
  isPhaseAllowed,
  getVotesForItem,
  getVotesForUngroupedItem,
  groupVoteTarget,
  itemVoteTarget,
  getVotesForTarget,
  getVotesForTargetEffect,
  getVotesByParticipant,
  getRemainingBudget,
  getRemainingBudgetEffect,
  applyCastVote,
  applyCastVoteEffect,
  applyRemoveVote,
  applyRemoveVoteEffect,
} from "./state";

describe("column helpers", () => {
  it("validates complete column reorder payloads atomically", () => {
    const columns = getDefaultColumns();
    expect(validateFullColumnPermutation(columns, columns.map((column) => column.id)).valid).toBe(true);
    expect(validateFullColumnPermutation(columns, ["start", "start", "continue"]).valid).toBe(false);
    expect(validateFullColumnPermutation(columns, ["start", "stop"]).valid).toBe(false);
    expect(validateFullColumnPermutation(columns, ["start", "stop", "unknown"]).valid).toBe(false);
    expect(validateFullColumnPermutation(columns, "start").valid).toBe(false);
  });

  it("validates complete column reorder payloads through an Effect boundary", async () => {
    const columns = getDefaultColumns();
    const ids = columns.map((column) => column.id).toReversed();

    await expect(Effect.runPromise(validateFullColumnPermutationEffect(columns, ids))).resolves.toEqual(ids);

    const exit = await Effect.runPromiseExit(validateFullColumnPermutationEffect(columns, [ids[0], ids[0]]));
    expect(Exit.isFailure(exit)).toBe(true);
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

  it("reorders columns through an Effect boundary", async () => {
    const columns = [
      { id: "start", name: "Start", order: 0 },
      { id: "stop", name: "Stop", order: 1 },
      { id: "continue", name: "Continue", order: 2 },
    ];

    const result = await Effect.runPromise(applyReorderColumnsEffect(columns, ["continue", "start", "stop"]));

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

  it("edits column names through an Effect boundary", async () => {
    const columns = [{ id: "start", name: "Start", order: 0 }];

    await expect(Effect.runPromise(applyEditColumnEffect(columns, "start", "  Begin  ")))
      .resolves.toEqual(applyEditColumn(columns, "start", "Begin"));
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

  it("deletes a column through an Effect boundary", async () => {
    const columns = [
      { id: "keep", name: "Keep", order: 0 },
      { id: "delete", name: "Delete", order: 1 },
    ];
    const groups = [
      { id: "keep-group", name: "Keep group", columnId: "keep", order: 0 },
      { id: "delete-group", name: "Delete group", columnId: "delete", order: 0 },
    ];
    const items = [
      { id: "keep-item", text: "Keep", authorId: "p1", columnId: "keep", groupId: "keep-group", order: 0 },
      { id: "delete-item", text: "Delete", authorId: "p1", columnId: "delete", groupId: "delete-group", order: 0 },
    ];
    const votes = [
      { participantId: "p1", groupId: "keep-group", count: 1 },
      { participantId: "p1", groupId: "delete-group", count: 2 },
    ];

    await expect(Effect.runPromise(applyDeleteColumnEffect(columns, groups, items, votes, "delete")))
      .resolves.toEqual(applyDeleteColumn(columns, groups, items, votes, "delete"));
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
    expect(PHASE_ORDER).toEqual(["setup", "write", "organise", "vote", "review", "finalize"]);
  });
});

describe("canTransition", () => {
  it("allows forward transitions", () => {
    expect(canTransition("write", "organise")).toBe(true);
    expect(canTransition("organise", "vote")).toBe(true);
    expect(canTransition("vote", "review")).toBe(true);
    expect(canTransition("review", "finalize")).toBe(true);
  });

  it("rejects same-phase transition", () => {
    expect(canTransition("write", "write")).toBe(false);
  });

  it("rejects backward transitions", () => {
    expect(canTransition("organise", "write")).toBe(false);
    expect(canTransition("review", "vote")).toBe(false);
    expect(canTransition("finalize", "review")).toBe(false);
  });

  it("rejects skipping phases", () => {
    expect(canTransition("write", "vote")).toBe(false);
    expect(canTransition("write", "review")).toBe(false);
    expect(canTransition("vote", "finalize")).toBe(false);
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

  it("distinguishes canonical group and ungrouped item vote targets with the same ID", () => {
    const mixedVotes = [
      { participantId: "p1", target: groupVoteTarget("same-id"), count: 2 },
      { participantId: "p1", target: itemVoteTarget("same-id"), count: 1 },
    ];

    expect(getVotesForTarget(mixedVotes, groupVoteTarget("same-id"))).toBe(2);
    expect(getVotesForTarget(mixedVotes, itemVoteTarget("same-id"))).toBe(1);
    expect(getVotesForUngroupedItem(mixedVotes, "same-id")).toBe(1);
    expect(getVotesByParticipant(mixedVotes, "p1")).toBe(3);
  });

  it("aggregates vote totals and remaining budget through Effect boundaries", async () => {
    await expect(Effect.runPromise(getVotesForTargetEffect(votes, groupVoteTarget("i1")))).resolves.toBe(3);
    await expect(Effect.runPromise(getRemainingBudgetEffect(votes, "p1", 5))).resolves.toBe(2);
  });
});

describe("applyCastVote", () => {
  it("adds a new vote allocation", () => {
    const result = applyCastVote([], "p1", "g1", 1, 5);
    expect(result.error).toBeUndefined();
    expect(result.votes).toEqual([{ participantId: "p1", target: groupVoteTarget("g1"), count: 1 }]);
  });

  it("adds a new vote allocation through an Effect boundary", async () => {
    await expect(Effect.runPromise(applyCastVoteEffect([], "p1", "g1", 1, 5))).resolves.toEqual({
      votes: [{ participantId: "p1", target: groupVoteTarget("g1"), count: 1 }],
    });
  });

  it("stacks votes on the same group", () => {
    const result = applyCastVote(
      [{ participantId: "p1", groupId: "g1", count: 2 }],
      "p1", "g1", 2, 5,
    );
    expect(result.error).toBeUndefined();
    expect(result.votes).toEqual([{ participantId: "p1", groupId: "g1", count: 4 }]);
  });

  it("adds canonical ungrouped item allocations independently from group IDs", () => {
    const result = applyCastVote(
      [{ participantId: "p1", target: groupVoteTarget("same-id"), count: 1 }],
      "p1",
      itemVoteTarget("same-id"),
      2,
      5,
    );
    expect(result.error).toBeUndefined();
    expect(result.votes).toEqual([
      { participantId: "p1", target: groupVoteTarget("same-id"), count: 1 },
      { participantId: "p1", target: itemVoteTarget("same-id"), count: 2 },
    ]);
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

  it("distributes votes across groups", () => {
    let result = applyCastVote([], "p1", "g1", 2, 5);
    expect(result.error).toBeUndefined();
    result = applyCastVote(result.votes, "p1", "g2", 3, 5);
    expect(result.error).toBeUndefined();
    expect(result.votes).toEqual([
      { participantId: "p1", target: groupVoteTarget("g1"), count: 2 },
      { participantId: "p1", target: groupVoteTarget("g2"), count: 3 },
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
    const votes = [{ participantId: "p1", target: itemVoteTarget("i1"), count: 1 }];
    const result = applyRemoveVote(votes, "p1", itemVoteTarget("i1"));
    expect(result).toEqual([]);
  });

  it("removes allocations through an Effect boundary", async () => {
    await expect(Effect.runPromise(applyRemoveVoteEffect(
      [{ participantId: "p1", target: itemVoteTarget("i1"), count: 1 }],
      "p1",
      itemVoteTarget("i1"),
    ))).resolves.toEqual([]);
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
