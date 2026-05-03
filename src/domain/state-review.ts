import { Effect } from "effect";
import type { Column, PairwiseChoice, RankingMethod, RoomState, VoteTarget } from "./types";

import { getUngroupedItems } from "./state-items";
import {
  groupVoteTarget,
  itemVoteTarget,
  pairwiseComparisonKey,
  voteTargetKey,
} from "./state-targets";
import { getVotesForTarget } from "./state-votes";

export interface ReviewTarget {
  target: VoteTarget;
  columnId: string;
  order: number;
  totalVotes: number;
  wins: number;
  losses: number;
  comparisons: number;
  score: number;
  method: RankingMethod;
}

export interface DecisionTarget {
  target: VoteTarget;
  columnId: string;
  order: number;
  label: string;
}

export interface PairwiseComparison {
  key: string;
  columnId: string;
  left: DecisionTarget;
  right: DecisionTarget;
}

export function getDecisionTargets(state: Pick<RoomState, "groups" | "items">): DecisionTarget[] {
  const groups = state.groups.map((group) => ({
    target: groupVoteTarget(group.id),
    columnId: group.columnId,
    order: group.order,
    label: group.name,
  }));
  const ungroupedItems = getUngroupedItems(state.items).map((item) => ({
    target: itemVoteTarget(item.id),
    columnId: item.columnId,
    order: item.order,
    label: item.text,
  }));
  return [...groups, ...ungroupedItems];
}

export function getDecisionTargetsEffect(state: Pick<RoomState, "groups" | "items">): Effect.Effect<DecisionTarget[]> {
  return Effect.sync(() => getDecisionTargets(state));
}

export function getPairwiseComparisons(state: Pick<RoomState, "columns" | "groups" | "items">): PairwiseComparison[] {
  const columnOrder = new Map(state.columns.map((column) => [column.id, column.order]));
  const sortedTargets = getDecisionTargets(state).sort((a, b) => {
    const columnDifference = (columnOrder.get(a.columnId) ?? Number.MAX_SAFE_INTEGER) - (columnOrder.get(b.columnId) ?? Number.MAX_SAFE_INTEGER);
    if (columnDifference !== 0) return columnDifference;
    const orderDifference = a.order - b.order;
    if (orderDifference !== 0) return orderDifference;
    return voteTargetKey(a.target).localeCompare(voteTargetKey(b.target));
  });

  const comparisons: PairwiseComparison[] = [];
  for (let leftIndex = 0; leftIndex < sortedTargets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sortedTargets.length; rightIndex += 1) {
      const left = sortedTargets[leftIndex];
      const right = sortedTargets[rightIndex];
      if (!left || !right) continue;
      comparisons.push({
        key: pairwiseComparisonKey(left.target, right.target),
        columnId: left.columnId === right.columnId ? left.columnId : "__cross_column__",
        left,
        right,
      });
    }
  }

  return comparisons;
}

export function getPairwiseComparisonsEffect(
  state: Pick<RoomState, "columns" | "groups" | "items">,
): Effect.Effect<PairwiseComparison[]> {
  return Effect.sync(() => getPairwiseComparisons(state));
}

export function getPairwiseChoice(
  choices: PairwiseChoice[],
  participantId: string,
  left: VoteTarget,
  right: VoteTarget,
): PairwiseChoice | null {
  const key = pairwiseComparisonKey(left, right);
  return choices.find((choice) =>
    choice.participantId === participantId
    && pairwiseComparisonKey(choice.winner, choice.loser) === key,
  ) ?? null;
}

export function getPairwiseChoiceEffect(
  choices: PairwiseChoice[],
  participantId: string,
  left: VoteTarget,
  right: VoteTarget,
): Effect.Effect<PairwiseChoice | null> {
  return Effect.sync(() => getPairwiseChoice(choices, participantId, left, right));
}

export function getReviewTargets(
  state: Pick<RoomState, "columns" | "groups" | "items" | "votes"> & Partial<Pick<RoomState, "rankingMethod" | "pairwiseChoices">>,
): ReviewTarget[] {
  const method = state.rankingMethod ?? "score";
  const pairwiseTotals = new Map<string, { wins: number; losses: number }>();
  for (const choice of state.pairwiseChoices ?? []) {
    const winnerKey = voteTargetKey(choice.winner);
    const loserKey = voteTargetKey(choice.loser);
    const winner = pairwiseTotals.get(winnerKey) ?? { wins: 0, losses: 0 };
    const loser = pairwiseTotals.get(loserKey) ?? { wins: 0, losses: 0 };
    const count = Number.isInteger(choice.count) && choice.count !== undefined && choice.count > 0 ? choice.count : 1;
    pairwiseTotals.set(winnerKey, { ...winner, wins: winner.wins + count });
    pairwiseTotals.set(loserKey, { ...loser, losses: loser.losses + count });
  }

  return getDecisionTargets(state).map((decisionTarget) => {
    const pairwise = pairwiseTotals.get(voteTargetKey(decisionTarget.target)) ?? { wins: 0, losses: 0 };
    const totalVotes = getVotesForTarget(state.votes, decisionTarget.target);
    return {
      target: decisionTarget.target,
      columnId: decisionTarget.columnId,
      order: decisionTarget.order,
      totalVotes,
      wins: pairwise.wins,
      losses: pairwise.losses,
      comparisons: pairwise.wins + pairwise.losses,
      score: method === "pairwise" ? pairwise.wins : totalVotes,
      method,
    };
  });
}

export function getReviewTargetsEffect(
  state: Pick<RoomState, "columns" | "groups" | "items" | "votes"> & Partial<Pick<RoomState, "rankingMethod" | "pairwiseChoices">>,
): Effect.Effect<ReviewTarget[]> {
  return Effect.sync(() => getReviewTargets(state));
}

export function sortReviewTargets(
  targets: ReviewTarget[],
  columns: Column[],
): ReviewTarget[] {
  const columnOrder = new Map(columns.map((column) => [column.id, column.order]));
  return [...targets].sort((a, b) => {
    const scoreDifference = b.score - a.score;
    if (scoreDifference !== 0) return scoreDifference;
    const comparisonDifference = b.comparisons - a.comparisons;
    if (comparisonDifference !== 0) return comparisonDifference;
    const columnDifference = (columnOrder.get(a.columnId) ?? Number.MAX_SAFE_INTEGER) - (columnOrder.get(b.columnId) ?? Number.MAX_SAFE_INTEGER);
    if (columnDifference !== 0) return columnDifference;
    const orderDifference = a.order - b.order;
    if (orderDifference !== 0) return orderDifference;
    return voteTargetKey(a.target).localeCompare(voteTargetKey(b.target));
  });
}

export function sortReviewTargetsEffect(
  targets: ReviewTarget[],
  columns: Column[],
): Effect.Effect<ReviewTarget[]> {
  return Effect.sync(() => sortReviewTargets(targets, columns));
}
