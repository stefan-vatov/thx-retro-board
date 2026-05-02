import type { StoredState } from "./room-types";

export function createStoredStateForTest(state: Partial<StoredState> & Pick<StoredState, "roomId">): StoredState {
  return {
    schemaVersion: 2,
    startedAt: Date.now(),
    purgeScheduledAt: null,
    phase: "setup",
    participants: [],
    items: [],
    groups: [],
    votes: [],
    rankingMethod: "score",
    pairwiseChoices: [],
    reviewTargetKey: null,
    actions: [],
    facilitatorId: null,
    facilitatorClaimToken: null,
    votingParticipantIds: [],
    voteBudget: 5,
    version: 0,
    connectionTokens: {},
    timer: { startedAt: null, durationSeconds: null, expired: false },
    ...state,
  };
}
