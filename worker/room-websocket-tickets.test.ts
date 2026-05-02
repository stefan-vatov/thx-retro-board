import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { createInitialStoredState } from "./room-storage";
import {
  consumeWebSocketTicketForRoomEffect,
  createWebSocketTicketForRoom,
  createWebSocketTicketForRoomEffect,
  deleteOutstandingWebSocketTicketForRoomEffect,
} from "./room-websocket-tickets";

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

  it("creates websocket tickets through the Effect API", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: true }];
    state.facilitatorId = "p1";
    state.connectionTokens.p1 = "token";
    const storage = new Map<string, unknown>();

    const host = {
      loadState: async () => state,
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value);
      },
      delete: async (key: string) => {
        storage.delete(key);
      },
    };

    const result = await Effect.runPromise(createWebSocketTicketForRoomEffect(host, "p1", "token", 1000));

    expect(result.success).toBe(true);
    expect(storage.get("ws-ticket-by-participant:p1")).toBe(result.ticket);
  });

  it("deletes and consumes websocket tickets through Effect APIs", async () => {
    const storage = new Map<string, unknown>([
      ["ws-ticket:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {
        participantId: "p1",
        expiresAt: 31_000,
      }],
      ["ws-ticket-by-participant:p1", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    ]);
    const host = {
      loadState: async () => createInitialStoredState("room-a"),
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value);
      },
      delete: async (key: string) => {
        storage.delete(key);
      },
      hasParticipant: async (participantId: string) => participantId === "p1",
    };

    await expect(Effect.runPromise(consumeWebSocketTicketForRoomEffect(
      host,
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      1000,
    ))).resolves.toEqual({ success: true, participantId: "p1" });
    expect(storage.has("ws-ticket:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
    expect(storage.has("ws-ticket-by-participant:p1")).toBe(false);

    storage.set("ws-ticket:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", {
      participantId: "p1",
      expiresAt: 31_000,
    });
    storage.set("ws-ticket-by-participant:p1", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    await Effect.runPromise(deleteOutstandingWebSocketTicketForRoomEffect(host, "p1"));

    expect(storage.has("ws-ticket:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).toBe(false);
    expect(storage.has("ws-ticket-by-participant:p1")).toBe(false);
  });
});
