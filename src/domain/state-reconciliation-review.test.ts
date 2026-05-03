import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  getDefaultColumns,
  getReviewTargets,
  getReviewTargetsEffect,
  sortReviewTargets,
  sortReviewTargetsEffect,
  groupVoteTarget,
  itemVoteTarget,
} from "./state";
import type { RoomState } from "./types";

function makeState(overrides: Partial<RoomState> & { roomId: string }): RoomState {
  return {
    schemaVersion: 2,
    startedAt: 1000,
    purgeScheduledAt: null,
    phase: "write",
    participants: [],
    items: [],
    columns: getDefaultColumns(),
    groups: getDefaultColumns(),
    votes: [],
    rankingMethod: "score",
    pairwiseChoices: [],
    actions: [],
    timer: { startedAt: null, durationSeconds: null, expired: false },
    voteBudget: 5,
    version: 0,
    ...overrides,
  };
}

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

describe("review target helpers", () => {
  it("builds and sorts mixed group and ungrouped item review targets", () => {
    const state = makeState({
      roomId: "review-targets",
      columns: [
        { id: "col-b", name: "B", order: 1 },
        { id: "col-a", name: "A", order: 0 },
      ],
      groups: [
        { id: "group-a", name: "Group A", columnId: "col-a", order: 1 },
        { id: "group-b", name: "Group B", columnId: "col-b", order: 0 },
      ],
      items: [
        { id: "item-a", text: "Ungrouped A", authorId: "p1", columnId: "col-a", groupId: null, order: 0 },
        { id: "item-b-grouped", text: "Grouped", authorId: "p1", columnId: "col-b", groupId: "group-b", order: 0 },
      ],
      votes: [
        { participantId: "p1", target: itemVoteTarget("item-a"), count: 3 },
        { participantId: "p2", target: groupVoteTarget("group-b"), count: 2 },
        { participantId: "p3", target: groupVoteTarget("group-a"), count: 3 },
      ],
    });

    const targets = sortReviewTargets(getReviewTargets(state), state.columns);

    expect(targets.map((target) => target.target)).toEqual([
      itemVoteTarget("item-a"),
      groupVoteTarget("group-a"),
      groupVoteTarget("group-b"),
    ]);
    expect(targets.map((target) => target.totalVotes)).toEqual([3, 3, 2]);
  });

  it("builds and sorts review targets through Effect boundaries", async () => {
    const state = makeState({
      roomId: "review-targets-effect",
      columns: [
        { id: "col-b", name: "B", order: 1 },
        { id: "col-a", name: "A", order: 0 },
      ],
      groups: [
        { id: "group-a", name: "Group A", columnId: "col-a", order: 1 },
        { id: "group-b", name: "Group B", columnId: "col-b", order: 0 },
      ],
      items: [
        { id: "item-a", text: "Ungrouped A", authorId: "p1", columnId: "col-a", groupId: null, order: 0 },
      ],
      votes: [
        { participantId: "p1", target: itemVoteTarget("item-a"), count: 3 },
        { participantId: "p2", target: groupVoteTarget("group-b"), count: 2 },
        { participantId: "p3", target: groupVoteTarget("group-a"), count: 3 },
      ],
    });

    const targets = await Effect.runPromise(getReviewTargetsEffect(state).pipe(
      Effect.flatMap((reviewTargets) => sortReviewTargetsEffect(reviewTargets, state.columns)),
    ));

    expect(targets.map((target) => target.target)).toEqual([
      itemVoteTarget("item-a"),
      groupVoteTarget("group-a"),
      groupVoteTarget("group-b"),
    ]);
  });
});
