import { Effect } from "effect";
import type { Reaction, ReactionTarget } from "../domain";
import {
  getReactionCount,
  getReactionsForTarget,
  hasParticipantReaction,
} from "../domain";

export type ReactionPillModel = {
  emoji: string;
  count: number;
  selected: boolean;
};

export type ReactionBarModelInput = {
  reactions: Reaction[];
  target: ReactionTarget;
  participantId: string;
};

export type ReactionMenuTogglePlan = {
  nextOpen: boolean;
  shouldStopPropagation: boolean;
};

export function buildReactionBarModelEffect({
  reactions,
  target,
  participantId,
}: ReactionBarModelInput): Effect.Effect<ReactionPillModel[]> {
  return Effect.sync(() =>
    Array.from(
      new Set(
        getReactionsForTarget(reactions, target).map(
          (reaction) => reaction.emoji,
        ),
      ),
    ).map((emoji) => ({
      emoji,
      count: getReactionCount(reactions, target, emoji),
      selected: hasParticipantReaction(
        reactions,
        participantId,
        target,
        emoji,
      ),
    })),
  );
}

export function planReactionMenuToggleEffect({
  open,
  stopPropagation,
}: {
  open: boolean;
  stopPropagation: boolean;
}): Effect.Effect<ReactionMenuTogglePlan> {
  return Effect.succeed({
    nextOpen: !open,
    shouldStopPropagation: stopPropagation,
  });
}
