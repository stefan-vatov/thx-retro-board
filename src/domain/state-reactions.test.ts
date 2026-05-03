import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  getReactionCount,
  getReactionCountEffect,
  getReactionsForTargetEffect,
  groupVoteTarget,
  hasParticipantReactionEffect,
  isAllowedReactionEmojiEffect,
  itemVoteTarget,
} from ".";
import type { Reaction } from "./types";

describe("reaction helpers", () => {
  const reactions: Reaction[] = [
    { participantId: "p1", target: groupVoteTarget("g1"), emoji: "🔥" },
    { participantId: "p2", target: groupVoteTarget("g1"), emoji: "🔥" },
    { participantId: "p3", target: itemVoteTarget("i1"), emoji: "🔥" },
    { participantId: "p1", target: groupVoteTarget("g1"), emoji: "👍" },
  ];

  it("counts reactions by target and emoji", () => {
    expect(getReactionCount(reactions, groupVoteTarget("g1"), "🔥")).toBe(2);
    expect(getReactionCount(reactions, itemVoteTarget("i1"), "🔥")).toBe(1);
  });

  it("validates emoji and resolves reaction collections through Effect boundaries", async () => {
    await expect(Effect.runPromise(isAllowedReactionEmojiEffect("🔥"))).resolves.toBe(true);
    await expect(Effect.runPromise(isAllowedReactionEmojiEffect("not emoji"))).resolves.toBe(false);
    await expect(Effect.runPromise(getReactionCountEffect(reactions, groupVoteTarget("g1"), "🔥"))).resolves.toBe(2);
    await expect(Effect.runPromise(hasParticipantReactionEffect(reactions, "p1", groupVoteTarget("g1"), "👍"))).resolves.toBe(true);
    await expect(Effect.runPromise(getReactionsForTargetEffect(reactions, groupVoteTarget("g1"))))
      .resolves.toHaveLength(3);
  });
});
