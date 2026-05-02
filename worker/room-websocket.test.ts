import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { handleRoomWebSocketRequest, handleRoomWebSocketRequestEffect } from "./room-websocket";

describe("room websocket request handling", () => {
  it("ignores non-websocket requests", async () => {
    const response = await handleRoomWebSocketRequest({} as never, new Request("https://example.test/room"));

    expect(response).toBeNull();
  });

  it("ignores non-websocket requests through the Effect API", async () => {
    const response = await Effect.runPromise(handleRoomWebSocketRequestEffect({} as never, new Request("https://example.test/room")));

    expect(response).toBeNull();
  });

  it("rejects invalid websocket tickets through the Effect API", async () => {
    const response = await Effect.runPromise(handleRoomWebSocketRequestEffect({
      consumeWebSocketTicket: async () => ({ success: false, error: "Missing or invalid websocket ticket" }),
      loadState: async () => {
        throw new Error("should not load state");
      },
      cancelEmptyRoomPurge: async () => {},
      closeParticipantSocket: () => {},
      setSession: () => {},
      acceptWebSocket: () => {},
      broadcast: () => {},
    }, new Request("https://example.test/ws", { headers: { Upgrade: "websocket" } })));

    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ error: "Missing or invalid websocket ticket" });
  });
});
