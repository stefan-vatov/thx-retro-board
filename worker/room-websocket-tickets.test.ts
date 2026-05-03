import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { createInitialStoredState } from "./room-storage";
import {
  consumeWebSocketTicketForRoomEffect,
  createWebSocketTicketForRoom,
  createWebSocketTicketForRoomEffect,
  deleteOutstandingWebSocketTicketForRoomEffect,
  validateWebSocketTicketStringEffect,
} from "./room-websocket-tickets";

describe("room websocket ticket commands", () => {
  it("validates websocket ticket strings through Effect", async () => {
    await expect(Effect.runPromise(validateWebSocketTicketStringEffect(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ))).resolves.toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    const exit = await Effect.runPromiseExit(validateWebSocketTicketStringEffect("not-a-ticket"));
    expect(exit._tag).toBe("Failure");
  });

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

  it("creates websocket tickets through injected Effect dependencies", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: true }];
    state.facilitatorId = "p1";
    state.connectionTokens.p1 = "token";
    const calls: string[] = [];
    const stored = new Map<string, unknown>();

    const result = await Effect.runPromise(createWebSocketTicketForRoomEffect({} as never, "p1", "token", 1000, {
      loadState: () => Effect.sync(() => {
        calls.push("load");
        return state;
      }),
      deleteOutstandingTicket: (_host, participantId) => Effect.sync(() => {
        calls.push(`delete:${participantId}`);
      }),
      generateTicket: () => Effect.succeed("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
      put: (_host, key, value) => Effect.sync(() => {
        calls.push(`put:${key}`);
        stored.set(key, value);
      }),
    }));

    expect(result).toEqual({ success: true, ticket: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    expect(calls).toEqual([
      "load",
      "delete:p1",
      "put:ws-ticket:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "put:ws-ticket-by-participant:p1",
    ]);
    expect(stored.get("ws-ticket-by-participant:p1")).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
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

  it("consumes websocket tickets through injected Effect dependencies", async () => {
    const calls: string[] = [];
    const ticket = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    const result = await Effect.runPromise(consumeWebSocketTicketForRoomEffect(
      {} as never,
      ticket,
      1000,
      {
        getTicket: (_host, key) => Effect.sync(() => {
          calls.push(`get-ticket:${key}`);
          return { participantId: "p1", expiresAt: 31_000 };
        }),
        delete: (_host, key) => Effect.sync(() => {
          calls.push(`delete:${key}`);
        }),
        getParticipantTicket: (_host, key) => Effect.sync(() => {
          calls.push(`get-participant-ticket:${key}`);
          return ticket;
        }),
        hasParticipant: (_host, participantId) => Effect.sync(() => {
          calls.push(`has-participant:${participantId}`);
          return true;
        }),
      },
    ));

    expect(result).toEqual({ success: true, participantId: "p1" });
    expect(calls).toEqual([
      "get-ticket:ws-ticket:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "delete:ws-ticket:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "get-participant-ticket:ws-ticket-by-participant:p1",
      "delete:ws-ticket-by-participant:p1",
      "has-participant:p1",
    ]);
  });
});
