import { getDefaultColumns } from "../src/domain";
import type { StoredState } from "./room-types";
import {
  isV2StoredState,
  normalizeActions,
  normalizeColumns,
  normalizeGroups,
  normalizeItems,
  normalizePairwiseChoices,
  normalizeRankingMethod,
  normalizeReactions,
  normalizeReviewTargetKey,
  normalizeVotes,
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

export function hydrateStoredState(stored: StoredState, now = Date.now()): StoredState {
  if (!isV2StoredState(stored)) {
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

  const columns = normalizeColumns(stored);
  const groups = normalizeGroups(stored.groups ?? [], columns);
  const state: StoredState = {
    ...stored,
    schemaVersion: 2,
    startedAt: Number.isFinite(stored.startedAt) ? stored.startedAt : now,
    purgeScheduledAt: Number.isFinite(stored.purgeScheduledAt) ? stored.purgeScheduledAt : null,
    columns,
    groups,
    items: normalizeItems(stored.items ?? [], columns, groups),
    votes: [],
    rankingMethod: normalizeRankingMethod(stored.rankingMethod),
    pairwiseChoices: [],
    reviewTargetKey: null,
    actions: normalizeActions(stored.actions, stored.participants ?? []),
    reactions: [],
    facilitatorClaimToken: typeof stored.facilitatorClaimToken === "string" ? stored.facilitatorClaimToken : null,
    votingParticipantIds: Array.isArray(stored.votingParticipantIds)
      ? stored.votingParticipantIds.filter((id) => typeof id === "string" && stored.participants.some((participant) => participant.id === id))
      : [],
  };
  state.votes = normalizeVotes(stored.votes ?? [], state.participants, groups, state.items);
  state.pairwiseChoices = normalizePairwiseChoices(stored.pairwiseChoices, state.participants, groups, state.items);
  state.reviewTargetKey = normalizeReviewTargetKey(stored.reviewTargetKey, groups, state.items);
  state.reactions = normalizeReactions(stored.reactions, state.participants, groups, state.items);
  return state;
}
