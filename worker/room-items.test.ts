import { describe, expect, it } from "vitest";

import type { ServerToClientMessage } from "../src/domain";
import { createInitialStoredState } from "./room-storage";
import { addItemForRoom } from "./room-items";

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
});
