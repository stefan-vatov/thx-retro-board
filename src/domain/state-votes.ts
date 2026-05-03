import { Effect } from "effect";
import type { VoteAllocation, VoteTarget } from "./types";

import {
  getVoteTarget,
  groupVoteTarget,
  itemVoteTarget,
  sameVoteTarget,
} from "./state-targets";

export function getVotesForTarget(votes: VoteAllocation[], target: VoteTarget): number {
  return votes
    .filter((v) => {
      const voteTarget = getVoteTarget(v);
      return voteTarget !== null && sameVoteTarget(voteTarget, target);
    })
    .reduce((sum, v) => sum + v.count, 0);
}

export function getVotesForTargetEffect(votes: VoteAllocation[], target: VoteTarget): Effect.Effect<number> {
  return Effect.sync(() => getVotesForTarget(votes, target));
}

export function getVotesForGroup(votes: VoteAllocation[], groupId: string): number {
  return getVotesForTarget(votes, groupVoteTarget(groupId));
}

export function getVotesForGroupEffect(votes: VoteAllocation[], groupId: string): Effect.Effect<number> {
  return Effect.sync(() => getVotesForGroup(votes, groupId));
}

export function getVotesForUngroupedItem(votes: VoteAllocation[], itemId: string): number {
  return getVotesForTarget(votes, itemVoteTarget(itemId));
}

export function getVotesForUngroupedItemEffect(votes: VoteAllocation[], itemId: string): Effect.Effect<number> {
  return Effect.sync(() => getVotesForUngroupedItem(votes, itemId));
}

/** @deprecated Votes target groups. Use getVotesForGroup. */
export const getVotesForItem = getVotesForGroup;

export function getVotesByParticipant(votes: VoteAllocation[], participantId: string): number {
  return votes
    .filter((v) => v.participantId === participantId)
    .reduce((sum, v) => sum + v.count, 0);
}

export function getVotesByParticipantEffect(votes: VoteAllocation[], participantId: string): Effect.Effect<number> {
  return Effect.sync(() => getVotesByParticipant(votes, participantId));
}

export function getRemainingBudget(votes: VoteAllocation[], participantId: string, budget: number): number {
  return budget - getVotesByParticipant(votes, participantId);
}

export function getRemainingBudgetEffect(
  votes: VoteAllocation[],
  participantId: string,
  budget: number,
): Effect.Effect<number> {
  return Effect.sync(() => getRemainingBudget(votes, participantId, budget));
}

export function applyCastVote(
  votes: VoteAllocation[],
  participantId: string,
  targetOrGroupId: VoteTarget | string,
  count: number,
  budget: number,
): { votes: VoteAllocation[]; error?: string } {
  const target = typeof targetOrGroupId === "string" ? groupVoteTarget(targetOrGroupId) : targetOrGroupId;
  if (count < 1 || !Number.isInteger(count)) {
    return { votes, error: "Vote count must be a positive integer" };
  }

  const currentUsed = getVotesByParticipant(votes, participantId);
  const remaining = budget - currentUsed;
  if (count > remaining) {
    return { votes, error: `Over budget: ${remaining} votes remaining` };
  }

  const existing = votes.find((v) => {
    const voteTarget = getVoteTarget(v);
    return v.participantId === participantId && voteTarget !== null && sameVoteTarget(voteTarget, target);
  });

  if (existing) {
    const updated = votes.map((v) => {
      const voteTarget = getVoteTarget(v);
      return v.participantId === participantId && voteTarget !== null && sameVoteTarget(voteTarget, target)
        ? { ...v, count: v.count + count }
        : v;
    });
    return { votes: updated };
  }

  return { votes: [...votes, { participantId, target, count }] };
}

export function applyCastVoteEffect(
  votes: VoteAllocation[],
  participantId: string,
  targetOrGroupId: VoteTarget | string,
  count: number,
  budget: number,
): Effect.Effect<{ votes: VoteAllocation[]; error?: string }> {
  return Effect.sync(() => applyCastVote(votes, participantId, targetOrGroupId, count, budget));
}

export function applyRemoveVote(
  votes: VoteAllocation[],
  participantId: string,
  targetOrGroupId: VoteTarget | string,
): VoteAllocation[] {
  const target = typeof targetOrGroupId === "string" ? groupVoteTarget(targetOrGroupId) : targetOrGroupId;
  const existing = votes.find((v) => {
    const voteTarget = getVoteTarget(v);
    return v.participantId === participantId && voteTarget !== null && sameVoteTarget(voteTarget, target);
  });
  if (!existing) return votes;

  if (existing.count <= 1) {
    return votes.filter((v) => {
      const voteTarget = getVoteTarget(v);
      return !(v.participantId === participantId && voteTarget !== null && sameVoteTarget(voteTarget, target));
    });
  }

  return votes.map((v) => {
    const voteTarget = getVoteTarget(v);
    return v.participantId === participantId && voteTarget !== null && sameVoteTarget(voteTarget, target)
      ? { ...v, count: v.count - 1 }
      : v;
  });
}

export function applyRemoveVoteEffect(
  votes: VoteAllocation[],
  participantId: string,
  targetOrGroupId: VoteTarget | string,
): Effect.Effect<VoteAllocation[]> {
  return Effect.sync(() => applyRemoveVote(votes, participantId, targetOrGroupId));
}
