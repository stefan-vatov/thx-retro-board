import { Effect } from "effect";

import type { PairwiseChoice, RoomState, VoteAllocation, VoteTarget } from "../src/domain";
import { getVoteTarget, pairwiseComparisonKey, voteTargetKey } from "../src/domain";
import { ANONYMOUS_VOTE_PARTICIPANT_ID, type StoredState, type StoredTimer } from "./room-types";
import { normalizeReviewTargetKey } from "./room-normalize";

export function computeTimerStatus(timer: StoredTimer, now = Date.now()): StoredTimer {
  if (timer.startedAt !== null && timer.durationSeconds !== null && !timer.expired) {
    const elapsed = (now - timer.startedAt) / 1000;
    if (elapsed >= timer.durationSeconds) {
      return { ...timer, expired: true };
    }
  }
  return timer;
}

export function computeTimerStatusEffect(timer: StoredTimer, now = Date.now()): Effect.Effect<StoredTimer> {
  return Effect.sync(() => computeTimerStatus(timer, now));
}

export function getDecisionTargetCount(s: StoredState): number {
  return s.groups.length + s.items.filter((item) => item.groupId === null).length;
}

export function getDecisionTargetCountEffect(s: StoredState): Effect.Effect<number> {
  return Effect.sync(() => getDecisionTargetCount(s));
}

function getPairwiseProgress(s: StoredState) {
  const targets = getDecisionTargetCount(s);
  const total = targets < 2 ? 0 : (targets * (targets - 1)) / 2;
  return s.participants.map((participant) => {
    const answered = (s.pairwiseChoices ?? []).filter((choice) => choice.participantId === participant.id).length;
    return { participantId: participant.id, answered: Math.min(answered, total), total };
  });
}

function getProjectedVotes(s: StoredState, participantId?: string): VoteAllocation[] {
  if (!participantId) return s.votes;
  const projected = s.votes.filter((vote) => vote.participantId === participantId);
  const anonymousTotals = new Map<string, VoteAllocation>();
  for (const vote of s.votes) {
    if (vote.participantId === participantId) continue;
    const target = getVoteTarget(vote);
    if (target === null) continue;
    const key = voteTargetKey(target);
    const existing = anonymousTotals.get(key);
    anonymousTotals.set(key, {
      participantId: ANONYMOUS_VOTE_PARTICIPANT_ID,
      target,
      count: (existing?.count ?? 0) + vote.count,
    });
  }
  return [...projected, ...anonymousTotals.values()];
}

function getProjectedPairwiseChoices(s: StoredState, participantId?: string): PairwiseChoice[] {
  if (!participantId) return s.pairwiseChoices ?? [];
  if (s.phase !== "review" && s.phase !== "finalize") {
    return (s.pairwiseChoices ?? []).filter((choice) => choice.participantId === participantId);
  }

  const aggregateCounts = new Map<string, { winner: VoteTarget; loser: VoteTarget; count: number }>();
  for (const choice of s.pairwiseChoices ?? []) {
    const key = `${pairwiseComparisonKey(choice.winner, choice.loser)}:${voteTargetKey(choice.winner)}`;
    const existing = aggregateCounts.get(key);
    aggregateCounts.set(key, {
      winner: choice.winner,
      loser: choice.loser,
      count: (existing?.count ?? 0) + 1,
    });
  }

  const projected: PairwiseChoice[] = [];
  let anonymousIndex = 0;
  for (const aggregate of aggregateCounts.values()) {
    projected.push({
      participantId: `${ANONYMOUS_VOTE_PARTICIPANT_ID}-${anonymousIndex}`,
      winner: aggregate.winner,
      loser: aggregate.loser,
      count: aggregate.count,
    });
    anonymousIndex += 1;
  }
  return projected;
}

export function toRoomState(s: StoredState, participantId?: string): RoomState {
  const timer = computeTimerStatus(s.timer);
  return {
    schemaVersion: 2,
    roomId: s.roomId,
    startedAt: s.startedAt ?? Date.now(),
    purgeScheduledAt: s.purgeScheduledAt ?? null,
    phase: s.phase,
    participants: s.participants,
    items: s.items,
    columns: s.columns ?? s.groups,
    groups: s.groups,
    votes: getProjectedVotes(s, participantId),
    rankingMethod: s.rankingMethod ?? "score",
    pairwiseChoices: getProjectedPairwiseChoices(s, participantId),
    pairwiseProgress: getPairwiseProgress(s),
    reviewTargetKey: normalizeReviewTargetKey(s.reviewTargetKey, s.groups, s.items),
    actions: s.actions ?? [],
    reactions: s.reactions ?? [],
    timer,
    voteBudget: s.voteBudget,
    version: s.version,
  };
}

export function toRoomStateEffect(s: StoredState, participantId?: string): Effect.Effect<RoomState> {
  return Effect.sync(() => toRoomState(s, participantId));
}
