import { Effect } from "effect";

import { getDefaultColumns } from "../src/domain";
import type { StoredState } from "./room-types";
import {
  isV2StoredStateEffect,
  normalizeActionsEffect,
  normalizeColumnsEffect,
  normalizeGroupsEffect,
  normalizeItemsEffect,
  normalizePairwiseChoicesEffect,
  normalizeRankingMethodEffect,
  normalizeReactionsEffect,
  normalizeReviewTargetKeyEffect,
  normalizeVotesEffect,
} from "./room-normalize";

export function createInitialStoredState(
  roomId: string,
  facilitatorClaimToken: string | null = null,
  now = Date.now(),
): StoredState {
  return {
    schemaVersion: 2,
    roomId,
    startedAt: now,
    purgeScheduledAt: null,
    phase: "setup",
    participants: [],
    items: [],
    columns: getDefaultColumns(),
    groups: [],
    votes: [],
    rankingMethod: "score",
    pairwiseChoices: [],
    reviewTargetKey: null,
    actions: [],
    reactions: [],
    facilitatorId: null,
    facilitatorClaimToken,
    votingParticipantIds: [],
    voteBudget: 5,
    version: 0,
    connectionTokens: {},
    timer: { startedAt: null, durationSeconds: null, expired: false },
  };
}

export function createInitialStoredStateEffect(
  roomId: string,
  facilitatorClaimToken: string | null = null,
  now = Date.now(),
): Effect.Effect<StoredState> {
  return Effect.sync(() => createInitialStoredState(roomId, facilitatorClaimToken, now));
}

export function hydrateStoredState(stored: StoredState, now = Date.now()): StoredState {
  return Effect.runSync(hydrateStoredStateEffect(stored, now));
}

export function hydrateStoredStateEffect(stored: StoredState, now = Date.now()): Effect.Effect<StoredState> {
  return Effect.gen(function* () {
    const isV2 = yield* isV2StoredStateEffect(stored);
    if (!isV2) {
      return {
        ...stored,
        schemaVersion: 2,
        startedAt: Number.isFinite(stored.startedAt) ? stored.startedAt : now,
        purgeScheduledAt: Number.isFinite(stored.purgeScheduledAt) ? stored.purgeScheduledAt : null,
        phase: "setup",
        items: [],
        columns: getDefaultColumns(),
        groups: [],
        votes: [],
        rankingMethod: "score",
        pairwiseChoices: [],
        reviewTargetKey: null,
        actions: [],
        reactions: [],
        facilitatorClaimToken: null,
        votingParticipantIds: [],
      };
    }

    const columns = yield* normalizeColumnsEffect(stored);
    const groups = yield* normalizeGroupsEffect(stored.groups ?? [], columns);
    const items = yield* normalizeItemsEffect(stored.items ?? [], columns, groups);
    const rankingMethod = yield* normalizeRankingMethodEffect(stored.rankingMethod);
    const actions = yield* normalizeActionsEffect(stored.actions, stored.participants ?? []);
    const state: StoredState = {
      ...stored,
      schemaVersion: 2,
      startedAt: Number.isFinite(stored.startedAt) ? stored.startedAt : now,
      purgeScheduledAt: Number.isFinite(stored.purgeScheduledAt) ? stored.purgeScheduledAt : null,
      columns,
      groups,
      items,
      votes: [],
      rankingMethod,
      pairwiseChoices: [],
      reviewTargetKey: null,
      actions,
      reactions: [],
      facilitatorClaimToken: typeof stored.facilitatorClaimToken === "string" ? stored.facilitatorClaimToken : null,
      votingParticipantIds: Array.isArray(stored.votingParticipantIds)
        ? stored.votingParticipantIds.filter((id) => typeof id === "string" && stored.participants.some((participant) => participant.id === id))
        : [],
    };
    state.votes = yield* normalizeVotesEffect(stored.votes ?? [], state.participants, groups, state.items);
    state.pairwiseChoices = yield* normalizePairwiseChoicesEffect(stored.pairwiseChoices, state.participants, groups, state.items);
    state.reviewTargetKey = yield* normalizeReviewTargetKeyEffect(stored.reviewTargetKey, groups, state.items);
    state.reactions = yield* normalizeReactionsEffect(stored.reactions, state.participants, groups, state.items);
    return state;
  });
}
