import type { Reaction, ReactionTarget } from "./types";

import { sameVoteTarget } from "./state-targets";

export function isAllowedReactionEmoji(emoji: string): boolean {
  const normalized = emoji.trim();
  if (normalized.length === 0 || normalized.length > 32) return false;

  const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
  if (segmenter && Array.from(segmenter.segment(normalized)).length !== 1) return false;

  return /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}]/u.test(normalized);
}

export function getReactionsForTarget(reactions: Reaction[] | undefined, target: ReactionTarget): Reaction[] {
  return (reactions ?? []).filter((reaction) => sameVoteTarget(reaction.target, target));
}

export function getReactionCount(reactions: Reaction[] | undefined, target: ReactionTarget, emoji: string): number {
  return getReactionsForTarget(reactions, target).filter((reaction) => reaction.emoji === emoji).length;
}

export function hasParticipantReaction(
  reactions: Reaction[] | undefined,
  participantId: string,
  target: ReactionTarget,
  emoji: string,
): boolean {
  return getReactionsForTarget(reactions, target).some((reaction) =>
    reaction.participantId === participantId && reaction.emoji === emoji,
  );
}
