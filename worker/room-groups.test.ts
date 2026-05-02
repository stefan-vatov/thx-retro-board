import { describe, expect, it } from "vitest";

import { groupVoteTarget } from "../src/domain";
import { createInitialStoredState } from "./room-storage";
import { createGroupForRoom, deleteGroupForRoom } from "./room-groups";

describe("room group commands", () => {
  it("creates organise groups in a column", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "organise";
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: false }];

    const result = await createGroupForRoom({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    }, "p1", "Theme", "mad");

    expect(result).toMatchObject({ success: true });
    expect(result.group?.name).toBe("Theme");
    expect(state.groups).toEqual([result.group]);
  });

  it("deletes groups and clears related votes and reactions", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "organise";
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: false }];
    state.groups = [{ id: "group-a", name: "Theme", columnId: "mad", order: 0 }];
    state.votes = [{ participantId: "p1", target: groupVoteTarget("group-a"), count: 1 }];
    state.reactions = [{ participantId: "p1", target: groupVoteTarget("group-a"), emoji: "👍" }];

    const result = await deleteGroupForRoom({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    }, "p1", "group-a");

    expect(result).toEqual({ success: true });
    expect(state.groups).toEqual([]);
    expect(state.votes).toEqual([]);
    expect(state.reactions).toEqual([]);
  });
});
