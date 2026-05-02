import { describe, expect, it } from "vitest";

import {
  getVoteTarget,
  groupVoteTarget,
  itemVoteTarget,
  pairwiseComparisonKey,
} from "./state-targets";
import type { VoteAllocation } from "./types";

describe("state target helpers", () => {
  it("keeps pairwise comparison keys stable regardless of comparison order", () => {
    const group = groupVoteTarget("group-a");
    const item = itemVoteTarget("item-b");

    expect(pairwiseComparisonKey(group, item)).toBe(pairwiseComparisonKey(item, group));
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
});
