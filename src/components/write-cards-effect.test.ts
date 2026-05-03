import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { RoomState } from "../domain";
import {
  refreshRoomStateAfterMutationEffect,
  runWriteCardMutationEffect,
} from "./write-cards-effect";

function roomState(version: number): RoomState {
  return {
    roomId: "room-1",
    phase: "write",
    columns: [],
    items: [],
    groups: [],
    votes: [],
    pairwiseChoices: [],
    reactions: [],
    actions: [],
    participants: [],
    voteBudget: 5,
    rankingMethod: "score",
    timer: { startedAt: null, durationSeconds: null, expired: false },
    facilitatorId: "fac",
    createdAt: 0,
    updatedAt: 0,
    version,
    reviewTargetKey: null,
    purgeScheduledAt: null,
  };
}

describe("refreshRoomStateAfterMutationEffect", () => {
  it("prefers the freshly loaded server state", async () => {
    await expect(
      Effect.runPromise(
        refreshRoomStateAfterMutationEffect(
          roomState(1),
          Effect.succeed(roomState(2)),
          (current) => ({ ...current, version: 99 }),
        ),
      ),
    ).resolves.toMatchObject({ version: 2 });
  });

  it("uses a local fallback when the refresh fails", async () => {
    await expect(
      Effect.runPromise(
        refreshRoomStateAfterMutationEffect(
          roomState(1),
          Effect.fail(new Error("offline")),
          (current) => ({ ...current, version: current.version + 1 }),
        ),
      ),
    ).resolves.toMatchObject({ version: 2 });
  });

  it("returns null when refresh fails and there is no local state", async () => {
    await expect(
      Effect.runPromise(
        refreshRoomStateAfterMutationEffect(
          null,
          Effect.fail(new Error("offline")),
          (current) => ({ ...current, version: current.version + 1 }),
        ),
      ),
    ).resolves.toBeNull();
  });
});

describe("runWriteCardMutationEffect", () => {
  it("runs a successful mutation and returns refreshed state", async () => {
    await expect(
      Effect.runPromise(
        runWriteCardMutationEffect({
          mutation: Effect.succeed({ success: true }),
          currentState: roomState(1),
          loadFreshState: Effect.succeed(roomState(2)),
          fallback: (current) => ({ ...current, version: 99 }),
        }),
      ),
    ).resolves.toEqual({ success: true, state: roomState(2) });
  });

  it("uses the local fallback when mutation succeeds but refresh fails", async () => {
    await expect(
      Effect.runPromise(
        runWriteCardMutationEffect({
          mutation: Effect.succeed({ success: true }),
          currentState: roomState(1),
          loadFreshState: Effect.fail(new Error("offline")),
          fallback: (current) => ({ ...current, version: current.version + 1 }),
        }),
      ),
    ).resolves.toMatchObject({ success: true, state: { version: 2 } });
  });

  it("does not refresh failed mutations", async () => {
    await expect(
      Effect.runPromise(
        runWriteCardMutationEffect({
          mutation: Effect.succeed({ success: false, error: "No permission" }),
          currentState: roomState(1),
          loadFreshState: Effect.sync(() => {
            throw new Error("refresh should not run");
          }),
          fallback: (current) => ({ ...current, version: 99 }),
        }),
      ),
    ).resolves.toEqual({
      success: false,
      error: "No permission",
      state: null,
    });
  });
});
