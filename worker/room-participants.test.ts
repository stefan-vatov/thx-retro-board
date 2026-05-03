import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { ServerToClientMessage } from "../src/domain";
import { createInitialStoredState } from "./room-storage";
import { joinRoomParticipant, joinRoomParticipantEffect } from "./room-participants";

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

  it("rejoins existing participants through the Effect API and rotates credentials", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "p1", displayName: "Pat", isFacilitator: true }];
    state.facilitatorId = "p1";
    state.connectionTokens.p1 = "old-token";

    let closedSocket = false;
    let deletedTicket = false;
    const result = await Effect.runPromise(joinRoomParticipantEffect({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
      cancelEmptyRoomPurge: async () => {},
      closeParticipantSocket: () => {
        closedSocket = true;
      },
      deleteOutstandingWebSocketTicket: async () => {
        deletedTicket = true;
      },
      scheduleEmptyRoomPurge: async () => {},
      getSessionCount: () => 1,
    }, "p1", "Pat", "old-token"));

    expect(result.success).toBe(true);
    expect(result.connectionToken).toMatch(/^[a-f0-9]{64}$/);
    expect(result.connectionToken).not.toBe("old-token");
    expect(state.connectionTokens.p1).toBe(result.connectionToken);
    expect(closedSocket).toBe(true);
    expect(deletedTicket).toBe(true);
  });

  it("uses Effect token generation when joining participants", async () => {
    const state = createInitialStoredState("room-a");

    const result = await Effect.runPromise(joinRoomParticipantEffect({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
      cancelEmptyRoomPurge: async () => {},
      closeParticipantSocket: () => {},
      deleteOutstandingWebSocketTicket: async () => {},
      scheduleEmptyRoomPurge: async () => {},
      getSessionCount: () => 1,
    }, "p1", "Pat", undefined, undefined, {
      generateConnectionToken: () => Effect.succeed("deterministic-token"),
    }));

    expect(result).toMatchObject({ success: true, connectionToken: "deterministic-token" });
    expect(state.connectionTokens.p1).toBe("deterministic-token");
  });

  it("joins participants through injected Effect dependencies", async () => {
    const state = createInitialStoredState("room-a");
    const calls: string[] = [];

    const result = await Effect.runPromise(joinRoomParticipantEffect({} as never, "p1", "Pat", undefined, undefined, {
      loadState: () => Effect.sync(() => {
        calls.push("load");
        return state;
      }),
      cancelEmptyRoomPurge: () => Effect.sync(() => {
        calls.push("cancel-purge");
      }),
      generateConnectionToken: () => Effect.succeed("deterministic-token"),
      saveState: () => Effect.sync(() => {
        calls.push("save");
      }),
      broadcast: (_host, message, exceptParticipantId) => Effect.sync(() => {
        calls.push(`broadcast:${message.type}:${exceptParticipantId ?? "all"}`);
      }),
      broadcastState: (_host, _state, exceptParticipantId) => Effect.sync(() => {
        calls.push(`state:${exceptParticipantId ?? "all"}`);
      }),
      getSessionCount: () => Effect.succeed(0),
      scheduleEmptyRoomPurge: () => Effect.sync(() => {
        calls.push("schedule-purge");
      }),
      closeParticipantSocket: () => Effect.void,
      deleteOutstandingWebSocketTicket: () => Effect.void,
    }));

    expect(result).toMatchObject({ success: true, connectionToken: "deterministic-token" });
    expect(state.participants).toEqual([{ id: "p1", displayName: "Pat", isFacilitator: true }]);
    expect(calls).toEqual([
      "load",
      "cancel-purge",
      "save",
      "broadcast:participant-joined:p1",
      "state:p1",
      "schedule-purge",
    ]);
  });
});
