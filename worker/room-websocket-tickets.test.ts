import { describe, expect, it } from "vitest";

import { createInitialStoredState } from "./room-storage";
import { createWebSocketTicketForRoom } from "./room-websocket-tickets";

describe("room websocket ticket commands", () => {
  it("creates one outstanding websocket ticket per participant", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: true }];
    state.facilitatorId = "p1";
    state.connectionTokens.p1 = "token";
    const storage = new Map<string, unknown>();

    const result = await createWebSocketTicketForRoom({
      loadState: async () => state,
      get: async (key) => storage.get(key),
      put: async (key, value) => {
        storage.set(key, value);
      },
      delete: async (key) => {
        storage.delete(key);
      },
    }, "p1", "token", 1000);

    expect(result.success).toBe(true);
    expect(result.ticket).toMatch(/^[a-f0-9]{64}$/);
    expect(storage.get("ws-ticket-by-participant:p1")).toBe(result.ticket);
    expect(storage.get(`ws-ticket:${result.ticket}`)).toEqual({ participantId: "p1", expiresAt: 31_000 });
  });
});
