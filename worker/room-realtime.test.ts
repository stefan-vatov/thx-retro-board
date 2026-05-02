import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { ClientToServerMessage } from "../src/domain";
import type { RoomRealtimeController } from "./room-realtime";
import { handleRoomRealtimeMessageEffect } from "./room-realtime";

function createRoom(overrides: Partial<RoomRealtimeController> = {}): RoomRealtimeController {
  const ok = async () => ({ success: true });
  return {
    join: ok,
    addItem: ok,
    editItem: ok,
    deleteItem: ok,
    setVoteBudget: ok,
    setRankingMethod: ok,
    setPhase: ok,
    createGroup: ok,
    editGroup: ok,
    deleteGroup: ok,
    createColumn: ok,
    editColumn: ok,
    reorderColumns: ok,
    deleteColumn: ok,
    reorderItems: ok,
    reorderGroups: ok,
    moveItemToGroup: ok,
    setTimer: ok,
    setReviewTarget: ok,
    castVote: ok,
    removeVote: ok,
    choosePairwise: ok,
    toggleReaction: ok,
    createAction: ok,
    editAction: ok,
    deleteAction: ok,
    sendParticipantError: () => {},
    ...overrides,
  };
}

describe("room realtime routing", () => {
  it("routes add item messages through the Effect API", async () => {
    let routed: { participantId: string; text: string; columnId: unknown } | null = null;

    await Effect.runPromise(handleRoomRealtimeMessageEffect(createRoom({
      addItem: async (participantId, text, columnId) => {
        routed = { participantId, text, columnId };
        return { success: true };
      },
    }), "p1", { type: "add-item", text: "Card", columnId: "mad" }));

    expect(routed).toEqual({ participantId: "p1", text: "Card", columnId: "mad" });
  });

  it("reports command failures through the Effect API", async () => {
    const errors: string[] = [];

    await Effect.runPromise(handleRoomRealtimeMessageEffect(createRoom({
      createAction: async () => ({ success: false, error: "Cannot add actions outside review phase" }),
      sendParticipantError: (_participantId, message) => errors.push(message),
    }), "p1", { type: "create-action", text: "Follow up" }));

    expect(errors).toEqual(["Cannot add actions outside review phase"]);
  });

  it("rejects malformed vote targets before calling room commands", async () => {
    const errors: string[] = [];
    const message = { type: "cast-vote", groupId: "g1", itemId: "i1", count: 1 } as ClientToServerMessage;

    await Effect.runPromise(handleRoomRealtimeMessageEffect(createRoom({
      castVote: async () => {
        throw new Error("should not vote");
      },
      sendParticipantError: (_participantId, error) => errors.push(error),
    }), "p1", message));

    expect(errors).toEqual(["Vote target must specify exactly one target"]);
  });
});
