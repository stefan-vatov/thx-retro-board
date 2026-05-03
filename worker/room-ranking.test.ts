import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { groupVoteTarget, itemVoteTarget } from "../src/domain";
import { createInitialStoredState } from "./room-storage";
import {
  castVoteForRoom,
  castVoteForRoomEffect,
  choosePairwiseForRoomEffect,
  removeVoteForRoomEffect,
  setRankingMethodForRoom,
  setRankingMethodForRoomEffect,
  setVoteBudgetForRoomEffect,
  toggleReactionForRoom,
  toggleReactionForRoomEffect,
} from "./room-ranking";

describe("room ranking commands", () => {
  it("sets ranking method and clears previous ranking state", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";
    state.votes = [{ participantId: "fac", target: itemVoteTarget("item-a"), count: 1 }];

    const result = await setRankingMethodForRoom({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    }, "fac", "pairwise");

    expect(result).toEqual({ success: true });
    expect(state.rankingMethod).toBe("pairwise");
    expect(state.votes).toEqual([]);
    expect(state.pairwiseChoices).toEqual([]);
  });

  it("casts votes and toggles reactions through shared state snapshots", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "vote";
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: false }];
    state.items = [{ id: "item-a", text: "A", authorId: "p1", columnId: "mad", groupId: null, order: 0 }];

    const host = {
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    };

    expect(await castVoteForRoom(host, "p1", itemVoteTarget("item-a"), 1)).toEqual({ success: true });
    expect(state.votes).toEqual([{ participantId: "p1", target: itemVoteTarget("item-a"), count: 1 }]);

    expect(await toggleReactionForRoom(host, "p1", itemVoteTarget("item-a"), "👍")).toEqual({ success: true });
    expect(state.reactions).toEqual([{ participantId: "p1", target: itemVoteTarget("item-a"), emoji: "👍" }]);
  });

  it("updates setup ranking settings through Effect APIs", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";
    state.votes = [{ participantId: "fac", target: itemVoteTarget("item-a"), count: 1 }];

    const host = {
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    };

    await expect(Effect.runPromise(setVoteBudgetForRoomEffect(host, "fac", 8))).resolves.toEqual({ success: true });
    await expect(Effect.runPromise(setRankingMethodForRoomEffect(host, "fac", "pairwise"))).resolves.toEqual({ success: true });

    expect(state.voteBudget).toBe(8);
    expect(state.rankingMethod).toBe("pairwise");
    expect(state.votes).toEqual([]);
    expect(state.pairwiseChoices).toEqual([]);
  });

  it("sets vote budget through injected Effect dependencies", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";
    const calls: string[] = [];

    const result = await Effect.runPromise(setVoteBudgetForRoomEffect({} as never, "fac", 7, {
      loadState: () => Effect.sync(() => {
        calls.push("load");
        return state;
      }),
      saveAndBroadcastState: (_host, savedState) => Effect.sync(() => {
        calls.push(`save:${savedState.voteBudget}`);
      }),
    }));

    expect(result).toEqual({ success: true });
    expect(state.voteBudget).toBe(7);
    expect(calls).toEqual(["load", "save:7"]);
  });

  it("casts and removes score votes through Effect APIs", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "vote";
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: false }];
    state.items = [{ id: "item-a", text: "A", authorId: "p1", columnId: "mad", groupId: null, order: 0 }];

    const host = {
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    };

    await expect(Effect.runPromise(castVoteForRoomEffect(host, "p1", itemVoteTarget("item-a"), 2)))
      .resolves.toEqual({ success: true });
    await expect(Effect.runPromise(removeVoteForRoomEffect(host, "p1", itemVoteTarget("item-a"))))
      .resolves.toEqual({ success: true });

    expect(state.votes).toEqual([{ participantId: "p1", target: itemVoteTarget("item-a"), count: 1 }]);
  });

  it("chooses pairwise winners and toggles reactions through Effect APIs", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "vote";
    state.rankingMethod = "pairwise";
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: false }];
    state.items = [{ id: "item-a", text: "A", authorId: "p1", columnId: "mad", groupId: null, order: 0 }];
    state.groups = [{ id: "group-a", name: "A", columnId: "mad", order: 0 }];

    const host = {
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    };

    await expect(Effect.runPromise(choosePairwiseForRoomEffect(
      host,
      "p1",
      groupVoteTarget("group-a"),
      itemVoteTarget("item-a"),
    ))).resolves.toEqual({ success: true });
    await expect(Effect.runPromise(toggleReactionForRoomEffect(host, "p1", itemVoteTarget("item-a"), "🔥")))
      .resolves.toEqual({ success: true });

    expect(state.pairwiseChoices).toEqual([{
      participantId: "p1",
      winner: groupVoteTarget("group-a"),
      loser: itemVoteTarget("item-a"),
    }]);
    expect(state.reactions).toEqual([{ participantId: "p1", target: itemVoteTarget("item-a"), emoji: "🔥" }]);
  });
});
