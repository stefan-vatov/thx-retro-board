import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { applyRealtimeMessageEffect } from "./room-realtime-state";
import type { RoomState, ServerToClientMessage } from "../domain";

function createState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    schemaVersion: 2,
    roomId: "room-a",
    startedAt: 1_000,
    purgeScheduledAt: null,
    phase: "write",
    participants: [{ id: "p1", displayName: "Pat", isFacilitator: true }],
    items: [],
    columns: [{ id: "col-a", name: "A", order: 0 }],
    groups: [],
    votes: [],
    rankingMethod: "score",
    pairwiseChoices: [],
    pairwiseProgress: [],
    reviewTargetKey: null,
    actions: [],
    reactions: [],
    timer: { startedAt: null, durationSeconds: null, expired: false },
    voteBudget: 5,
    version: 1,
    ...overrides,
  };
}

async function apply(state: RoomState | null, message: ServerToClientMessage) {
  return Effect.runPromise(applyRealtimeMessageEffect(state, message));
}

describe("applyRealtimeMessageEffect", () => {
  it("applies snapshots and participant deltas without duplicating participants", async () => {
    const snapshot = createState({ roomId: "snapshot-room", version: 7 });

    await expect(apply(null, { type: "snapshot", state: snapshot })).resolves.toMatchObject({
      state: snapshot,
      roomPurged: false,
    });

    const joined = await apply(createState(), {
      type: "participant-joined",
      participant: { id: "p2", displayName: "Lee", isFacilitator: false },
    });
    expect(joined.state?.participants.map((participant) => participant.id)).toEqual(["p1", "p2"]);

    const duplicate = await apply(joined.state, {
      type: "participant-joined",
      participant: { id: "p2", displayName: "Lee", isFacilitator: false },
    });
    expect(duplicate.state?.participants.map((participant) => participant.id)).toEqual(["p1", "p2"]);
  });

  it("applies board, setup, ranking, review, and timer changes", async () => {
    const state = createState();
    const columns = [{ id: "col-b", name: "B", order: 0 }];
    const item = { id: "item-a", text: "Card", authorId: "p1", columnId: "col-b", groupId: null, order: 0 };

    await expect(apply(state, { type: "phase-changed", phase: "vote" }))
      .resolves.toMatchObject({ state: { phase: "vote" } });
    await expect(apply(state, { type: "columns-changed", columns, version: 3 }))
      .resolves.toMatchObject({ state: { columns, version: 3 } });
    await expect(apply(state, { type: "ranking-method-changed", rankingMethod: "pairwise" }))
      .resolves.toMatchObject({ state: { rankingMethod: "pairwise" } });
    await expect(apply(state, { type: "item-added", item }))
      .resolves.toMatchObject({ state: { items: [item] } });
    await expect(apply(state, { type: "review-target-changed", reviewTargetKey: "item:item-a" }))
      .resolves.toMatchObject({ state: { reviewTargetKey: "item:item-a" } });
    await expect(apply(state, { type: "timer-updated", timer: { startedAt: 2_000, durationSeconds: 60, expired: false } }))
      .resolves.toMatchObject({ state: { timer: { startedAt: 2_000, durationSeconds: 60, expired: false } } });
  });

  it("upserts pairwise choices by participant and comparison key", async () => {
    const state = createState({
      pairwiseChoices: [{
        participantId: "p1",
        winner: { type: "group", id: "a" },
        loser: { type: "item", id: "b" },
      }],
    });

    const result = await apply(state, {
      type: "pairwise-choice-changed",
      choice: {
        participantId: "p1",
        winner: { type: "item", id: "b" },
        loser: { type: "group", id: "a" },
      },
    });

    expect(result.state?.pairwiseChoices).toEqual([{
      participantId: "p1",
      winner: { type: "item", id: "b" },
      loser: { type: "group", id: "a" },
    }]);
  });

  it("returns side-effect instructions for room purges and errors", async () => {
    await expect(apply(createState(), { type: "room-purged", reason: "Expired" })).resolves.toEqual({
      state: null,
      roomPurged: true,
      lastError: "Expired",
      shouldCloseSocket: true,
    });
    await expect(apply(createState(), { type: "error", message: "Nope" })).resolves.toMatchObject({
      lastError: "Nope",
      roomPurged: false,
    });
  });
});
