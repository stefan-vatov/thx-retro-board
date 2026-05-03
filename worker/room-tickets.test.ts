import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  generateToken,
  generateTokenEffect,
  getWebSocketTicket,
  getWebSocketTicketEffect,
} from "./room-tickets";

describe("room websocket tickets", () => {
  it("generates 64-character hex tokens", () => {
    expect(generateToken()).toMatch(/^[a-f0-9]{64}$/);
  });

  it("generates tokens through an Effect boundary", async () => {
    await expect(Effect.runPromise(generateTokenEffect())).resolves.toMatch(/^[a-f0-9]{64}$/);
  });

  it("extracts ticket protocol from websocket protocols", () => {
    const request = new Request("https://example.test/ws", {
      headers: { "Sec-WebSocket-Protocol": "retro-board, ticket-abc123" },
    });

    expect(getWebSocketTicket(request)).toBe("abc123");
  });

  it("extracts websocket ticket protocols through an Effect boundary", async () => {
    const request = new Request("https://example.test/ws", {
      headers: { "Sec-WebSocket-Protocol": "retro-board, ticket-abc123" },
    });

    await expect(Effect.runPromise(getWebSocketTicketEffect(request))).resolves.toBe("abc123");
  });
});
