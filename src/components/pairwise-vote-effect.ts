import { Effect } from "effect";
import type { VoteTarget } from "../domain";

export type PairwiseChoiceMessage = {
  type: "choose-pairwise";
  winner: VoteTarget;
  loser: VoteTarget;
};

export function shouldPulsePairwiseProgressEffect(
  previousAnsweredCount: number | null,
  answeredCount: number,
): Effect.Effect<boolean> {
  return Effect.sync(
    () =>
      previousAnsweredCount !== null && answeredCount > previousAnsweredCount,
  );
}

export function buildPairwiseChoiceCommandEffect(
  winner: VoteTarget,
  loser: VoteTarget,
): Effect.Effect<PairwiseChoiceMessage> {
  return Effect.sync(() => ({ type: "choose-pairwise", winner, loser }));
}
