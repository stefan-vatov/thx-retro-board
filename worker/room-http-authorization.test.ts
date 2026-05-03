import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { createInitialStoredState } from "./room-storage";
import type { RoomHttpController } from "./room-http";
import { runAuthorizedRoomMutationEffect } from "./room-http-authorization";

function createRoom(overrides: Partial<RoomHttpController> = {}): RoomHttpController {
  return {
    join: async () => ({ success: true }),
    getRoomStateForParticipant: async () => ({ success: true, state: createInitialStoredState("room-a") }),
    authorizeHttpParticipant: async (participantId) => ({
      success: true,
      participantId,
      state: createInitialStoredState("room-a"),
    }),
    setVoteBudget: async () => ({ success: true }),
    setRankingMethod: async () => ({ success: true }),
    setPhase: async () => ({ success: true }),
    addItem: async () => ({ success: true }),
    editItem: async () => ({ success: true }),
    deleteItem: async () => ({ success: true }),
    setTimer: async () => ({ success: true }),
    setReviewTarget: async () => ({ success: true }),
    purgeByFacilitator: async () => ({ success: true }),
    createWebSocketTicket: async () => ({ success: true }),
    ...overrides,
  };
}

describe("room HTTP authorization effects", () => {
  it("authorizes once before running an HTTP mutation", async () => {
    const response = await Effect.runPromise(runAuthorizedRoomMutationEffect(
      createRoom({
        authorizeHttpParticipant: async () => ({
          success: true,
          participantId: "canonical-p1",
          state: createInitialStoredState("room-a"),
        }),
      }),
      "p1",
      "token",
      async (participantId) => ({ success: true, participantId }),
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, participantId: "canonical-p1" });
  });

  it("returns 403 without running the mutation when credentials fail", async () => {
    let mutationCalled = false;
    const response = await Effect.runPromise(runAuthorizedRoomMutationEffect(
      createRoom({
        authorizeHttpParticipant: async () => ({ success: false, error: "Invalid participant credentials" }),
      }),
      "p1",
      "bad",
      async () => {
        mutationCalled = true;
        return { success: true };
      },
    ));

    expect(response.status).toBe(403);
    expect(mutationCalled).toBe(false);
    await expect(response.json()).resolves.toEqual({ success: false, error: "Invalid participant credentials" });
  });

  it("uses an injected Effect authorization dependency", async () => {
    const response = await Effect.runPromise(runAuthorizedRoomMutationEffect(
      createRoom({
        authorizeHttpParticipant: async () => {
          throw new Error("room authorization should not be called");
        },
      }),
      "p1",
      "token",
      async (participantId) => ({ success: true, participantId }),
      {
        authorizeParticipant: () => Effect.succeed({
          success: true,
          participantId: "effect-p1",
          state: createInitialStoredState("room-a"),
        }),
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, participantId: "effect-p1" });
  });
});
