import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  getVoteTarget,
  getVoteTargetEffect,
  groupVoteTarget,
  groupVoteTargetEffect,
  itemVoteTarget,
  itemVoteTargetEffect,
  pairwiseComparisonKey,
  pairwiseComparisonKeyEffect,
  sameVoteTargetEffect,
  voteTargetKeyEffect,
} from "./state-targets";
import type { VoteAllocation } from "./types";

describe("state target helpers", () => {
  it("keeps pairwise comparison keys stable regardless of comparison order", () => {
    const group = groupVoteTarget("group-a");
    const item = itemVoteTarget("item-b");

    expect(pairwiseComparisonKey(group, item)).toBe(pairwiseComparisonKey(item, group));
  });

  it("derives target keys and comparisons through Effect boundaries", async () => {
    const group = groupVoteTarget("group-a");
    const item = itemVoteTarget("item-b");

    await expect(Effect.runPromise(voteTargetKeyEffect(group))).resolves.toBe("group:group-a");
    await expect(Effect.runPromise(pairwiseComparisonKeyEffect(group, item)))
      .resolves.toBe(pairwiseComparisonKey(item, group));
  });

  it("builds and compares vote targets through Effect boundaries", async () => {
    await expect(Effect.runPromise(groupVoteTargetEffect("group-a"))).resolves.toEqual({ type: "group", id: "group-a" });
    await expect(Effect.runPromise(itemVoteTargetEffect("item-a"))).resolves.toEqual({ type: "item", id: "item-a" });
    await expect(Effect.runPromise(sameVoteTargetEffect(groupVoteTarget("group-a"), groupVoteTarget("group-a")))).resolves.toBe(true);
  });

  it("normalizes explicit vote targets before legacy ids", () => {
    const vote: VoteAllocation = {
      participantId: "participant-a",
      groupId: "legacy-group",
      target: itemVoteTarget("item-a"),
      count: 1,
    };

    expect(getVoteTarget(vote)).toEqual(itemVoteTarget("item-a"));
  });

  it("normalizes vote targets through an Effect boundary", async () => {
    const vote: VoteAllocation = {
      participantId: "participant-a",
      groupId: "legacy-group",
      target: itemVoteTarget("item-a"),
      count: 1,
    };

    await expect(Effect.runPromise(getVoteTargetEffect(vote))).resolves.toEqual(itemVoteTarget("item-a"));
  });
});
