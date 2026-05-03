import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  computeTimerStatus,
  computeTimerStatusEffect,
  getDecisionTargetCount,
  getDecisionTargetCountEffect,
  toRoomState,
  toRoomStateEffect,
} from "./room-presenter";
import { createInitialStoredState } from "./room-storage";

describe("room presenter Effect helpers", () => {
  it("computes timer status through an Effect boundary", async () => {
    const timer = { startedAt: 1_000, durationSeconds: 5, expired: false };

    await expect(Effect.runPromise(computeTimerStatusEffect(timer, 7_000)))
      .resolves.toEqual(computeTimerStatus(timer, 7_000));
  });

  it("counts decision targets through an Effect boundary", async () => {
    const state = createInitialStoredState("room-a");
    state.groups = [{ id: "group-a", name: "Group A", columnId: "mad", order: 0 }];
    state.items = [
      { id: "item-a", text: "A", authorId: "p1", columnId: "mad", groupId: null, order: 0 },
      { id: "item-b", text: "B", authorId: "p1", columnId: "mad", groupId: "group-a", order: 0 },
    ];

    await expect(Effect.runPromise(getDecisionTargetCountEffect(state)))
      .resolves.toBe(getDecisionTargetCount(state));
  });

  it("projects stored state for clients through an Effect boundary", async () => {
    const state = createInitialStoredState("room-a", null, 123);
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: true }];

    await expect(Effect.runPromise(toRoomStateEffect(state, "p1")))
      .resolves.toEqual(toRoomState(state, "p1"));
  });
});
