import { describe, expect, it } from "vitest";

import type { ServerToClientMessage } from "../src/domain";
import { createInitialStoredState } from "./room-storage";
import { createActionForRoom } from "./room-actions";
import type { StoredState } from "./room-types";

describe("room action commands", () => {
  it("creates review actions through the room command host", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "review";
    state.participants = [{ id: "participant-a", displayName: "A", isFacilitator: false }];

    let saved = false;
    const broadcasts: ServerToClientMessage[] = [];
    const result = await createActionForRoom({
      loadState: async () => state,
      saveState: async () => {
        saved = true;
      },
      broadcast: (message) => {
        broadcasts.push(message);
      },
      broadcastState: () => {},
    }, "participant-a", "  Follow up with QA  ");

    expect(result).toMatchObject({ success: true });
    expect(saved).toBe(true);
    expect((result.action ?? { text: "" }).text).toBe("Follow up with QA");
    expect(state.actions).toHaveLength(1);
    expect(broadcasts).toContainEqual({ type: "actions-changed", actions: state.actions });
  });

  it("rejects action creation outside review", async () => {
    const state: StoredState = createInitialStoredState("room-a");
    state.phase = "write";
    state.participants = [{ id: "participant-a", displayName: "A", isFacilitator: false }];

    const result = await createActionForRoom({
      loadState: async () => state,
      saveState: async () => {
        throw new Error("should not save");
      },
      broadcast: () => {},
      broadcastState: () => {},
    }, "participant-a", "Follow up");

    expect(result).toEqual({ success: false, error: "Cannot add actions outside review phase" });
    expect(state.actions).toEqual([]);
  });
});
