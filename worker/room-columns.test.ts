import { describe, expect, it } from "vitest";

import { createInitialStoredState } from "./room-storage";
import { createColumnForRoom, deleteColumnForRoom } from "./room-columns";

describe("room column commands", () => {
  it("creates setup columns for facilitators", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";

    let saved = false;
    const result = await createColumnForRoom({
      loadState: async () => state,
      saveState: async () => {
        saved = true;
      },
      broadcast: () => {},
      broadcastState: () => {},
    }, "fac", "  Risks  ");

    expect(result).toMatchObject({ success: true });
    expect(saved).toBe(true);
    expect(result.column?.name).toBe("Risks");
    expect(state.columns.at(-1)).toEqual(result.column);
  });

  it("deletes columns and normalizes dependent room data", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";
    state.items = [{ id: "item-a", text: "A", authorId: "fac", columnId: "mad", groupId: null, order: 0 }];
    state.votes = [{ participantId: "fac", target: { type: "item", id: "item-a" }, count: 1 }];

    const result = await deleteColumnForRoom({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    }, "fac", "mad");

    expect(result).toEqual({ success: true });
    expect(state.columns.some((column) => column.id === "mad")).toBe(false);
    expect(state.items).toEqual([]);
    expect(state.votes).toEqual([]);
  });
});
