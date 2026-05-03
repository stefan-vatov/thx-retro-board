import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { itemVoteTarget, type ServerToClientMessage } from "../src/domain";
import { createInitialStoredState } from "./room-storage";
import {
  addItemForRoom,
  addItemForRoomEffect,
  deleteItemForRoomEffect,
  editItemForRoomEffect,
} from "./room-items";

describe("room item commands", () => {
  it("adds write-phase items and broadcasts item plus snapshot updates", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "write";
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: false }];

    let saved = false;
    const broadcasts: ServerToClientMessage[] = [];
    const result = await addItemForRoom({
      loadState: async () => state,
      saveState: async () => {
        saved = true;
      },
      broadcast: (message) => broadcasts.push(message),
      broadcastState: () => {},
    }, "p1", "  First card  ", "mad");

    expect(result).toMatchObject({ success: true });
    expect(saved).toBe(true);
    expect(result.item?.text).toBe("First card");
    expect(state.items).toHaveLength(1);
    expect(broadcasts).toContainEqual({ type: "item-added", item: state.items[0]! });
  });

  it("rejects item creation outside write phase", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "setup";
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: false }];

    const result = await addItemForRoom({
      loadState: async () => state,
      saveState: async () => {
        throw new Error("should not save");
      },
      broadcast: () => {},
      broadcastState: () => {},
    }, "p1", "First card", "mad");

    expect(result).toEqual({ success: false, error: "Cannot add items outside write phase" });
    expect(state.items).toEqual([]);
  });

  it("adds items through the Effect API", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "write";
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: false }];

    let snapshots = 0;
    const result = await Effect.runPromise(addItemForRoomEffect({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {
        snapshots += 1;
      },
    }, "p1", "  Effect card  ", "glad"));

    expect(result).toMatchObject({ success: true });
    expect(result.item?.text).toBe("Effect card");
    expect(result.item?.columnId).toBe("glad");
    expect(snapshots).toBe(1);
  });

  it("adds items through injected Effect dependencies", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "write";
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: false }];
    const calls: string[] = [];

    const result = await Effect.runPromise(addItemForRoomEffect({} as never, "p1", "  Injected card  ", "sad", {
      loadState: () => Effect.sync(() => {
        calls.push("load");
        return state;
      }),
      generateItemId: () => Effect.succeed("item-injected"),
      broadcast: (_host, message) => Effect.sync(() => {
        calls.push(`broadcast:${message.type}`);
      }),
      saveAndBroadcastState: (_host, savedState) => Effect.sync(() => {
        calls.push(`save:${savedState.items.length}`);
      }),
    }));

    expect(result).toEqual({
      success: true,
      item: {
        id: "item-injected",
        text: "Injected card",
        authorId: "p1",
        columnId: "sad",
        groupId: null,
        order: 0,
      },
    });
    expect(calls).toEqual(["load", "broadcast:item-added", "save:1"]);
  });

  it("edits owned items through the Effect API", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "write";
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: false }];
    state.items = [{
      id: "item-1",
      text: "Before",
      authorId: "p1",
      columnId: "mad",
      groupId: null,
      order: 0,
    }];

    const result = await Effect.runPromise(editItemForRoomEffect({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    }, "p1", "item-1", "  After  "));

    expect(result).toEqual({ success: true, item: state.items[0] });
    expect(state.items[0]?.text).toBe("After");
  });

  it("deletes owned items and cleans dependent signals through the Effect API", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "write";
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: false }];
    state.items = [
      { id: "item-1", text: "Delete", authorId: "p1", columnId: "mad", groupId: null, order: 0 },
      { id: "item-2", text: "Keep", authorId: "p1", columnId: "mad", groupId: null, order: 1 },
    ];
    state.votes = [{ participantId: "p1", target: itemVoteTarget("item-1"), count: 1 }];
    state.pairwiseChoices = [{
      participantId: "p1",
      winner: { type: "item", id: "item-1" },
      loser: { type: "item", id: "item-2" },
    }];
    state.reactions = [{ participantId: "p1", emoji: "👍", target: { type: "item", id: "item-1" } }];

    const result = await Effect.runPromise(deleteItemForRoomEffect({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    }, "p1", "item-1"));

    expect(result).toEqual({ success: true });
    expect(state.items).toEqual([{ id: "item-2", text: "Keep", authorId: "p1", columnId: "mad", groupId: null, order: 0 }]);
    expect(state.votes).toEqual([]);
    expect(state.pairwiseChoices).toEqual([]);
    expect(state.reactions).toEqual([]);
  });
});
