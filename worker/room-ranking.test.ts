import { describe, expect, it } from "vitest";

import { itemVoteTarget } from "../src/domain";
import { createInitialStoredState } from "./room-storage";
import { castVoteForRoom, setRankingMethodForRoom, toggleReactionForRoom } from "./room-ranking";

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
});
