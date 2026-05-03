import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { getDefaultColumns } from "../src/domain";
import {
  createInitialStoredState,
  createInitialStoredStateEffect,
  hydrateStoredState,
  hydrateStoredStateEffect,
} from "./room-storage";
import type { StoredState } from "./room-types";

describe("room storage state", () => {
  it("creates a fresh v2 stored state with default board settings", () => {
    const state = createInitialStoredState("room-a", "claim-token", 123);

    expect(state).toMatchObject({
      schemaVersion: 2,
      roomId: "room-a",
      startedAt: 123,
      purgeScheduledAt: null,
      phase: "setup",
      rankingMethod: "score",
      facilitatorClaimToken: "claim-token",
      voteBudget: 5,
      version: 0,
    });
    expect(state.columns).toEqual(getDefaultColumns());
    expect(state.items).toEqual([]);
    expect(state.connectionTokens).toEqual({});
  });

  it("creates a fresh stored state through an Effect boundary", async () => {
    await expect(Effect.runPromise(createInitialStoredStateEffect("room-a", "claim-token", 123)))
      .resolves.toEqual(createInitialStoredState("room-a", "claim-token", 123));
  });

  it("hydrates legacy stored state into a safe v2 setup room", () => {
    const legacy = {
      roomId: "room-a",
      startedAt: Number.NaN,
      purgeScheduledAt: Number.NaN,
      phase: "review",
      participants: [],
      items: [{ id: "item-a", text: "stale", authorId: "p1", columnId: "missing", groupId: null, order: 0 }],
      groups: [],
      votes: [],
      actions: [],
      facilitatorId: null,
      voteBudget: 3,
      version: 7,
      connectionTokens: {},
      timer: { startedAt: null, durationSeconds: null, expired: false },
    } satisfies StoredState;

    const hydrated = hydrateStoredState(legacy, 456);

    expect(hydrated.schemaVersion).toBe(2);
    expect(hydrated.startedAt).toBe(456);
    expect(hydrated.phase).toBe("setup");
    expect(hydrated.columns).toEqual(getDefaultColumns());
    expect(hydrated.items).toEqual([]);
    expect(hydrated.rankingMethod).toBe("score");
    expect(hydrated.facilitatorClaimToken).toBeNull();
  });

  it("hydrates stored state through an Effect boundary", async () => {
    const state = createInitialStoredState("room-a", null, 123);
    state.columns = [{ id: "mad", name: "  Mad  ", order: 4 }];

    await expect(Effect.runPromise(hydrateStoredStateEffect(state, 456)))
      .resolves.toEqual(hydrateStoredState(state, 456));
  });
});
