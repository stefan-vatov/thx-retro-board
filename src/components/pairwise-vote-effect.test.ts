import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { groupVoteTarget, itemVoteTarget } from "../domain";
import {
  buildPairwiseChoiceCommandEffect,
  shouldPulsePairwiseProgressEffect,
} from "./pairwise-vote-effect";

describe("pairwise vote effects", () => {
  it("pulses progress only after the answered count increases", async () => {
    await expect(
      Effect.runPromise(shouldPulsePairwiseProgressEffect(null, 1)),
    ).resolves.toBe(false);
    await expect(
      Effect.runPromise(shouldPulsePairwiseProgressEffect(1, 1)),
    ).resolves.toBe(false);
    await expect(
      Effect.runPromise(shouldPulsePairwiseProgressEffect(1, 2)),
    ).resolves.toBe(true);
  });

  it("builds pairwise choice messages with winner and loser", async () => {
    const winner = groupVoteTarget("group-1");
    const loser = itemVoteTarget("item-1");

    await expect(
      Effect.runPromise(buildPairwiseChoiceCommandEffect(winner, loser)),
    ).resolves.toEqual({
      type: "choose-pairwise",
      winner,
      loser,
    });
  });
});
