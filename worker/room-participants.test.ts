import { describe, expect, it } from "vitest";

import type { ServerToClientMessage } from "../src/domain";
import { createInitialStoredState } from "./room-storage";
import { joinRoomParticipant } from "./room-participants";

describe("room participant commands", () => {
  it("joins new participants and returns participant-scoped state", async () => {
    const state = createInitialStoredState("room-a");
    const broadcasts: ServerToClientMessage[] = [];

    const result = await joinRoomParticipant({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: (message) => broadcasts.push(message),
      broadcastState: () => {},
      cancelEmptyRoomPurge: async () => {},
      closeParticipantSocket: () => {},
      deleteOutstandingWebSocketTicket: async () => {},
      scheduleEmptyRoomPurge: async () => {},
      getSessionCount: () => 0,
    }, "p1", "Pat");

    expect(result.success).toBe(true);
    expect(result.connectionToken).toMatch(/^[a-f0-9]{64}$/);
    expect(state.participants).toEqual([{ id: "p1", displayName: "Pat", isFacilitator: true }]);
    expect(broadcasts).toContainEqual({ type: "participant-joined", participant: state.participants[0]! });
  });
});
