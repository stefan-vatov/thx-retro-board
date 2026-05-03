import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { Phase, RankingMethod } from "../src/domain";
import { createInitialStoredState } from "./room-storage";
import type { RoomHttpController } from "./room-http";
import { handleRoomHttpRequestEffect } from "./room-http";

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createRoom(overrides: Partial<RoomHttpController> = {}): RoomHttpController {
  return {
    join: async () => ({ success: true, connectionToken: "token" }),
    getRoomStateForParticipant: async () => ({ success: true, state: createInitialStoredState("room-a") }),
    authorizeHttpParticipant: async (participantId) => ({
      success: true,
      participantId,
      state: createInitialStoredState("room-a"),
    }),
    setVoteBudget: async () => ({ success: true }),
    setRankingMethod: async (_participantId: string, _rankingMethod: RankingMethod) => ({ success: true }),
    setPhase: async (_participantId: string, _phase: Phase) => ({ success: true }),
    addItem: async () => ({ success: true }),
    editItem: async () => ({ success: true }),
    deleteItem: async () => ({ success: true }),
    setTimer: async () => ({ success: true }),
    setReviewTarget: async () => ({ success: true }),
    purgeByFacilitator: async () => ({ success: true }),
    createWebSocketTicket: async () => ({ success: true, ticket: "ticket" }),
    ...overrides,
  };
}

describe("room HTTP routing", () => {
  it("routes join requests through the Effect API", async () => {
    const response = await Effect.runPromise(handleRoomHttpRequestEffect(createRoom({
      join: async (participantId, displayName) => ({ success: true, state: undefined, connectionToken: `${participantId}:${displayName}` }),
    }), jsonRequest("/join", { participantId: "p1", displayName: "Pat" })));

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ success: true, connectionToken: "p1:Pat" });
  });

  it("routes join requests through injected Effect dependencies", async () => {
    const room = createRoom({
      join: async () => {
        throw new Error("join route should use injected dependency");
      },
    });

    const response = await Effect.runPromise(handleRoomHttpRequestEffect(
      room,
      jsonRequest("/join", { participantId: "p1", displayName: "Pat" }),
      {
        join: (_room, participantId, displayName) => Effect.succeed({
          success: true,
          connectionToken: `${participantId}:${displayName}:effect`,
        }),
        getRoomStateForParticipant: () => Effect.die("unused"),
        createWebSocketTicket: () => Effect.die("unused"),
      },
    ));

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ success: true, connectionToken: "p1:Pat:effect" });
  });

  it("blocks authenticated mutations when participant credentials fail", async () => {
    const response = await Effect.runPromise(handleRoomHttpRequestEffect(createRoom({
      authorizeHttpParticipant: async () => ({ success: false, error: "Invalid participant credentials" }),
      setVoteBudget: async () => {
        throw new Error("should not mutate");
      },
    }), jsonRequest("/vote-budget", { participantId: "p1", connectionToken: "bad", budget: 3 })));

    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ success: false, error: "Invalid participant credentials" });
  });

  it("returns null for unmatched requests through the Effect API", async () => {
    const response = await Effect.runPromise(handleRoomHttpRequestEffect(createRoom(), new Request("https://example.test/unknown")));

    expect(response).toBeNull();
  });

  it("uses injected Effect dependencies for state and websocket ticket routes", async () => {
    const room = createRoom({
      getRoomStateForParticipant: async () => {
        throw new Error("state route should use injected dependency");
      },
      createWebSocketTicket: async () => {
        throw new Error("ticket route should use injected dependency");
      },
    });
    const deps = {
      getRoomStateForParticipant: () => Effect.succeed({ success: true, state: createInitialStoredState("effect-room") }),
      createWebSocketTicket: () => Effect.succeed({ success: true, ticket: "effect-ticket" }),
    };

    const stateResponse = await Effect.runPromise(handleRoomHttpRequestEffect(
      room,
      jsonRequest("/state", { participantId: "p1", connectionToken: "token" }),
      deps,
    ));
    const ticketResponse = await Effect.runPromise(handleRoomHttpRequestEffect(
      room,
      jsonRequest("/ws-ticket", { participantId: "p1", connectionToken: "token" }),
      deps,
    ));

    expect(stateResponse?.status).toBe(200);
    expect(ticketResponse?.status).toBe(200);
    await expect(stateResponse?.json()).resolves.toMatchObject({ success: true, state: { roomId: "effect-room" } });
    await expect(ticketResponse?.json()).resolves.toEqual({ success: true, ticket: "effect-ticket" });
  });
});
