import { describe, expect, it } from "vitest";

import { generateToken, getWebSocketTicket } from "./room-tickets";

describe("room websocket tickets", () => {
  it("generates 64-character hex tokens", () => {
    expect(generateToken()).toMatch(/^[a-f0-9]{64}$/);
  });

  it("extracts ticket protocol from websocket protocols", () => {
    const request = new Request("https://example.test/ws", {
      headers: { "Sec-WebSocket-Protocol": "retro-board, ticket-abc123" },
    });

    expect(getWebSocketTicket(request)).toBe("abc123");
  });
});
