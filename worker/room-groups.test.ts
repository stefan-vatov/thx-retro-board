import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { groupVoteTarget } from "../src/domain";
import { createInitialStoredState } from "./room-storage";
import {
  createGroupForRoom,
  createGroupForRoomEffect,
  deleteGroupForRoom,
  deleteGroupForRoomEffect,
  editGroupForRoomEffect,
  moveItemToGroupForRoomEffect,
  reorderGroupsForRoomEffect,
  reorderItemsForRoomEffect,
} from "./room-groups";

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

  it("creates groups through the Effect API", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "organise";
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: false }];

    const result = await Effect.runPromise(createGroupForRoomEffect({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    }, "p1", "Focus", "glad"));

    expect(result).toMatchObject({ success: true, group: { name: "Focus", columnId: "glad" } });
  });

  it("creates groups through injected Effect dependencies", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "organise";
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: false }];
    const calls: string[] = [];

    const result = await Effect.runPromise(createGroupForRoomEffect({} as never, "p1", "Focus", "glad", {
      loadState: () => Effect.sync(() => {
        calls.push("load");
        return state;
      }),
      generateGroupId: () => Effect.succeed("group-injected"),
      saveAndBroadcastState: (_host, savedState) => Effect.sync(() => {
        calls.push(`save:${savedState.groups.at(-1)?.id}`);
      }),
    }));

    expect(result).toEqual({
      success: true,
      group: { id: "group-injected", name: "Focus", columnId: "glad", order: 0 },
    });
    expect(calls).toEqual(["load", "save:group-injected"]);
  });

  it("edits groups through the Effect API", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "organise";
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: false }];
    state.groups = [{ id: "group-a", name: "Theme", columnId: "mad", order: 0 }];

    const result = await Effect.runPromise(editGroupForRoomEffect({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    }, "p1", "group-a", "Renamed"));

    expect(result).toEqual({ success: true, group: state.groups[0] });
    expect(state.groups[0]?.name).toBe("Renamed");
  });

  it("edits groups through injected Effect dependencies", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "organise";
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: false }];
    state.groups = [{ id: "group-a", name: "Theme", columnId: "mad", order: 0 }];
    const calls: string[] = [];

    const result = await Effect.runPromise(editGroupForRoomEffect({} as never, "p1", "group-a", "Renamed", {
      loadState: () => Effect.sync(() => {
        calls.push("load");
        return state;
      }),
      saveAndBroadcastState: (_host, savedState) => Effect.sync(() => {
        calls.push(`save:${savedState.groups[0]?.name}`);
      }),
    }));

    expect(result).toEqual({ success: true, group: state.groups[0] });
    expect(state.groups[0]?.name).toBe("Renamed");
    expect(calls).toEqual(["load", "save:Renamed"]);
  });

  it("reorders groups through the Effect API", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "organise";
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: false }];
    state.groups = [
      { id: "group-a", name: "A", columnId: "mad", order: 0 },
      { id: "group-b", name: "B", columnId: "mad", order: 1 },
    ];

    const result = await Effect.runPromise(reorderGroupsForRoomEffect({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    }, "p1", ["group-b", "group-a"], state.version));

    expect(result).toEqual({ success: true });
    expect(Object.fromEntries(state.groups.map((group) => [group.id, group.order]))).toEqual({
      "group-a": 1,
      "group-b": 0,
    });
  });

  it("moves and reorders items through the Effect APIs", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "organise";
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: false }];
    state.groups = [{ id: "group-a", name: "A", columnId: "mad", order: 0 }];
    state.items = [
      { id: "item-a", text: "A", authorId: "p1", columnId: "mad", groupId: null, order: 0 },
      { id: "item-b", text: "B", authorId: "p1", columnId: "mad", groupId: null, order: 1 },
    ];

    const host = {
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    };

    await expect(Effect.runPromise(moveItemToGroupForRoomEffect(host, "p1", "item-a", "group-a", 0, {
      expectedVersion: state.version,
      sourceGroupId: null,
      sourceIndex: 0,
    })))
      .resolves.toEqual({ success: true });
    await expect(Effect.runPromise(reorderItemsForRoomEffect(host, "p1", ["item-b"], {
      expectedVersion: state.version,
      sourceColumnId: "mad",
      sourceGroupId: null,
    })))
      .resolves.toEqual({ success: true });

    expect(state.items.find((item) => item.id === "item-a")?.groupId).toBe("group-a");
    expect(state.items.find((item) => item.id === "item-b")?.order).toBe(0);
  });

  it("deletes groups through the Effect API", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "organise";
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: false }];
    state.groups = [{ id: "group-a", name: "Theme", columnId: "mad", order: 0 }];

    const result = await Effect.runPromise(deleteGroupForRoomEffect({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    }, "p1", "group-a"));

    expect(result).toEqual({ success: true });
    expect(state.groups).toEqual([]);
  });
});
