import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Column, Group, RetroItem, RoomState } from "../domain";
import { groupVoteTarget, itemVoteTarget } from "../domain";
import { buildReviewSlideshowModelEffect } from "./review-board-effect";

function makeRoomState({
  groups = [],
  items = [],
  reviewTargetKey = null,
}: {
  groups?: Group[];
  items?: RetroItem[];
  reviewTargetKey?: string | null;
}): RoomState {
  const columns: Column[] = [
    { id: "column-1", name: "Mad", order: 0 },
    { id: "column-2", name: "Glad", order: 1 },
  ];

  return {
    schemaVersion: 2,
    roomId: "room-review-model",
    startedAt: 1000,
    purgeScheduledAt: null,
    phase: "review",
    participants: [{ id: "fac1", displayName: "Alice", isFacilitator: true }],
    columns,
    groups,
    items,
    votes: [
      { participantId: "fac1", target: itemVoteTarget("item-top"), count: 4 },
      { participantId: "fac1", target: groupVoteTarget("group-low"), count: 1 },
    ],
    actions: [],
    rankingMethod: "score",
    pairwiseChoices: [],
    reviewTargetKey,
    reactions: [],
    timer: { startedAt: null, durationSeconds: null, expired: false },
    voteBudget: 5,
    version: 1,
  };
}

describe("buildReviewSlideshowModelEffect", () => {
  it("builds the active review slide from the synced target key", async () => {
    const state = makeRoomState({
      groups: [
        { id: "group-low", name: "Low", columnId: "column-1", order: 0 },
        { id: "group-second", name: "Synced", columnId: "column-2", order: 0 },
      ],
      items: [
        {
          id: "item-top",
          text: "Top ungrouped",
          authorId: "fac1",
          columnId: "column-1",
          groupId: null,
          order: 1,
        },
      ],
      reviewTargetKey: "group:group-second",
    });

    await expect(
      Effect.runPromise(buildReviewSlideshowModelEffect(state, true)),
    ).resolves.toMatchObject({
      activeIndex: 2,
      activeTargetKey: "group:group-second",
      totalTargets: 3,
      canNavigatePrevious: true,
      canNavigateNext: false,
    });
  });

  it("falls back to the first sorted target when the synced key is stale", async () => {
    const state = makeRoomState({
      items: [
        {
          id: "item-top",
          text: "Top ungrouped",
          authorId: "fac1",
          columnId: "column-1",
          groupId: null,
          order: 0,
        },
      ],
      reviewTargetKey: "group:missing",
    });

    await expect(
      Effect.runPromise(buildReviewSlideshowModelEffect(state, true)),
    ).resolves.toMatchObject({
      activeIndex: 0,
      activeTargetKey: "item:item-top",
      canNavigatePrevious: false,
      canNavigateNext: false,
    });
  });

  it("keeps non-facilitator navigation read-only", async () => {
    const state = makeRoomState({
      items: [
        {
          id: "item-a",
          text: "First",
          authorId: "fac1",
          columnId: "column-1",
          groupId: null,
          order: 0,
        },
        {
          id: "item-b",
          text: "Second",
          authorId: "fac1",
          columnId: "column-2",
          groupId: null,
          order: 0,
        },
      ],
    });

    await expect(
      Effect.runPromise(buildReviewSlideshowModelEffect(state, false)),
    ).resolves.toMatchObject({
      canGoPrevious: false,
      canGoNext: true,
      canNavigatePrevious: false,
      canNavigateNext: false,
    });
  });

  it("returns an empty model when there are no review targets", async () => {
    await expect(
      Effect.runPromise(
        buildReviewSlideshowModelEffect(makeRoomState({}), true),
      ),
    ).resolves.toMatchObject({
      activeReviewTarget: null,
      activeTargetKey: null,
      activeIndex: 0,
      totalTargets: 0,
    });
  });
});
