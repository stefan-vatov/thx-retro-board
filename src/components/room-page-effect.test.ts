import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { RoomState } from "../domain";
import {
  planInitialRoomLoadEffect,
  resolveInitialJoinResultEffect,
} from "./room-page-effect";

const state = {
  schemaVersion: 2,
  roomId: "room-1",
  startedAt: 1000,
  purgeScheduledAt: null,
  phase: "setup",
  participants: [],
  columns: [],
  groups: [],
  items: [],
  votes: [],
  actions: [],
  rankingMethod: "score",
  pairwiseChoices: [],
  reviewTargetKey: null,
  reactions: [],
  timer: { startedAt: null, durationSeconds: null, expired: false },
  voteBudget: 5,
  version: 1,
} satisfies RoomState;

describe("room page load effects", () => {
  it("routes users without stored credentials to join", async () => {
    await expect(
      Effect.runPromise(
        planInitialRoomLoadEffect({
          roomId: "room-1",
          displayName: "",
          connectionToken: "token",
        }),
      ),
    ).resolves.toEqual({ action: "show-join" });

    await expect(
      Effect.runPromise(
        planInitialRoomLoadEffect({
          roomId: "room-1",
          displayName: "Alex",
          connectionToken: undefined,
        }),
      ),
    ).resolves.toEqual({ action: "show-join" });
  });

  it("plans a credentialed initial join request", async () => {
    await expect(
      Effect.runPromise(
        planInitialRoomLoadEffect({
          roomId: "room-1",
          displayName: "Alex",
          connectionToken: "token",
        }),
      ),
    ).resolves.toEqual({
      action: "request-join",
      roomId: "room-1",
      displayName: "Alex",
      connectionToken: "token",
    });
  });

  it("resolves failed initial joins back to join state", async () => {
    await expect(
      Effect.runPromise(resolveInitialJoinResultEffect({ success: false })),
    ).resolves.toEqual({ action: "reset-to-join" });
  });

  it("resolves successful initial joins into room state", async () => {
    await expect(
      Effect.runPromise(
        resolveInitialJoinResultEffect({
          success: true,
          state,
          connectionToken: "fresh-token",
        }),
      ),
    ).resolves.toEqual({
      action: "show-room",
      state,
      connectionToken: "fresh-token",
    });
  });
});
