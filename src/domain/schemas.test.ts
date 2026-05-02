import { Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  ClientToServerMessageSchema,
  RoomStateSchema,
  ServerToClientMessageSchema,
} from "./schemas";
import type { RoomState } from "./types";

const roomState: RoomState = {
  schemaVersion: 2,
  roomId: "ROOM123",
  startedAt: 1000,
  purgeScheduledAt: null,
  phase: "write",
  participants: [],
  columns: [],
  items: [],
  groups: [],
  votes: [],
  rankingMethod: "score",
  pairwiseChoices: [],
  pairwiseProgress: [],
  actions: [],
  reviewTargetKey: null,
  reactions: [],
  timer: { startedAt: null, durationSeconds: null, expired: false },
  voteBudget: 5,
  version: 1,
};

describe("Effect domain schemas", () => {
  it("decodes a valid room state at the domain boundary", async () => {
    await expect(Effect.runPromise(Schema.decodeUnknown(RoomStateSchema)(roomState))).resolves.toEqual(roomState);
  });

  it("rejects malformed room state before it reaches UI state", async () => {
    const exit = await Effect.runPromiseExit(Schema.decodeUnknown(RoomStateSchema)({
      ...roomState,
      phase: "unknown",
    }));

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("decodes websocket snapshot messages with the shared domain schema", async () => {
    await expect(Effect.runPromise(Schema.decodeUnknown(ServerToClientMessageSchema)({
      type: "snapshot",
      state: roomState,
    }))).resolves.toEqual({
      type: "snapshot",
      state: roomState,
    });
  });

  it("decodes valid outbound websocket commands with the shared domain schema", async () => {
    await expect(Effect.runPromise(Schema.decodeUnknown(ClientToServerMessageSchema)({
      type: "move-item-to-group",
      itemId: "item-1",
      groupId: null,
      index: 0,
      expectedVersion: 2,
      sourceGroupId: "group-1",
      sourceIndex: 1,
    }))).resolves.toEqual({
      type: "move-item-to-group",
      itemId: "item-1",
      groupId: null,
      index: 0,
      expectedVersion: 2,
      sourceGroupId: "group-1",
      sourceIndex: 1,
    });
  });

  it("rejects malformed outbound websocket commands before they reach the socket", async () => {
    const exit = await Effect.runPromiseExit(Schema.decodeUnknown(ClientToServerMessageSchema)({
      type: "set-phase",
      phase: "done",
    }));

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
