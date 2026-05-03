import { Effect } from "effect";
import type { RankingMethod, ReactionTarget, VoteTarget } from "../src/domain";
import { saveAndBroadcastStateEffect } from "./room-command-effect";
import type { RoomCommandHost } from "./room-command-host";
import type { StoredState } from "./room-types";
import {
  validatePairwiseChoiceEffect,
  validateRankingMethodChangeEffect,
  validateReactionToggleEffect,
  validateVoteBudgetChangeEffect,
  validateVoteCastEffect,
  validateVoteRemoveEffect,
} from "./validation";

export interface SetVoteBudgetForRoomDeps {
  loadState: (host: RoomCommandHost) => Effect.Effect<StoredState>;
  saveAndBroadcastState: (host: RoomCommandHost, state: StoredState) => Effect.Effect<void>;
}

export const setVoteBudgetForRoomDeps: SetVoteBudgetForRoomDeps = {
  loadState: (host) => Effect.promise(() => host.loadState()),
  saveAndBroadcastState: saveAndBroadcastStateEffect,
};

export interface SetRankingMethodForRoomDeps {
  loadState: (host: RoomCommandHost) => Effect.Effect<StoredState>;
  saveState: (host: RoomCommandHost) => Effect.Effect<void>;
  broadcastRankingMethodChanged: (host: RoomCommandHost, rankingMethod: RankingMethod) => Effect.Effect<void>;
  broadcastState: (host: RoomCommandHost, state: StoredState) => Effect.Effect<void>;
}

export const setRankingMethodForRoomDeps: SetRankingMethodForRoomDeps = {
  loadState: (host) => Effect.promise(() => host.loadState()),
  saveState: (host) => Effect.promise(() => host.saveState()),
  broadcastRankingMethodChanged: (host, rankingMethod) => Effect.sync(() => {
    host.broadcast({ type: "ranking-method-changed", rankingMethod });
  }),
  broadcastState: (host, state) => Effect.sync(() => {
    host.broadcastState(state);
  }),
};

export async function setVoteBudgetForRoom(
  host: RoomCommandHost,
  participantId: string,
  budget: number,
): Promise<{ success: boolean; error?: string }> {
  return Effect.runPromise(setVoteBudgetForRoomEffect(host, participantId, budget));
}

export function setVoteBudgetForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  budget: number,
  deps: SetVoteBudgetForRoomDeps = setVoteBudgetForRoomDeps,
): Effect.Effect<{ success: boolean; error?: string }> {
  return Effect.gen(function* () {
    const s = yield* deps.loadState(host);
    const validation = yield* Effect.either(validateVoteBudgetChangeEffect(s, participantId, budget));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.voteBudget = validation.right.budget;
    yield* deps.saveAndBroadcastState(host, s);
    return { success: true };
  });
}

export async function setRankingMethodForRoom(
  host: RoomCommandHost,
  participantId: string,
  rankingMethod: RankingMethod,
): Promise<{ success: boolean; error?: string }> {
  return Effect.runPromise(setRankingMethodForRoomEffect(host, participantId, rankingMethod));
}

export function setRankingMethodForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  rankingMethod: RankingMethod,
  deps: SetRankingMethodForRoomDeps = setRankingMethodForRoomDeps,
): Effect.Effect<{ success: boolean; error?: string }> {
  return Effect.gen(function* () {
    const s = yield* deps.loadState(host);
    const validation = yield* Effect.either(validateRankingMethodChangeEffect(s, participantId, rankingMethod));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.rankingMethod = validation.right.rankingMethod;
    s.votes = [];
    s.pairwiseChoices = [];
    yield* deps.saveState(host);
    yield* deps.broadcastRankingMethodChanged(host, validation.right.rankingMethod);
    yield* deps.broadcastState(host, s);
    return { success: true };
  });
}

export async function toggleReactionForRoom(
  host: RoomCommandHost,
  participantId: string,
  target: ReactionTarget,
  emoji: string,
): Promise<{ success: boolean; error?: string }> {
  return Effect.runPromise(toggleReactionForRoomEffect(host, participantId, target, emoji));
}

export function toggleReactionForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  target: ReactionTarget,
  emoji: string,
): Effect.Effect<{ success: boolean; error?: string }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateReactionToggleEffect(s, participantId, target, emoji));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }
    s.reactions = validation.right.reactions;
    yield* saveAndBroadcastStateEffect(host, s);
    return { success: true };
  });
}

export async function castVoteForRoom(
  host: RoomCommandHost,
  participantId: string,
  targetOrGroupId: VoteTarget | string,
  count: number,
): Promise<{ success: boolean; error?: string }> {
  return Effect.runPromise(castVoteForRoomEffect(host, participantId, targetOrGroupId, count));
}

export function castVoteForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  targetOrGroupId: VoteTarget | string,
  count: number,
): Effect.Effect<{ success: boolean; error?: string }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateVoteCastEffect(s, participantId, targetOrGroupId, count));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.votes = validation.right.votes;
    yield* saveAndBroadcastStateEffect(host, s);

    return { success: true };
  });
}

export async function removeVoteForRoom(
  host: RoomCommandHost,
  participantId: string,
  targetOrGroupId: VoteTarget | string,
): Promise<{ success: boolean; error?: string }> {
  return Effect.runPromise(removeVoteForRoomEffect(host, participantId, targetOrGroupId));
}

export function removeVoteForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  targetOrGroupId: VoteTarget | string,
): Effect.Effect<{ success: boolean; error?: string }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateVoteRemoveEffect(s, participantId, targetOrGroupId));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.votes = validation.right.votes;
    yield* saveAndBroadcastStateEffect(host, s);

    return { success: true };
  });
}

export async function choosePairwiseForRoom(
  host: RoomCommandHost,
  participantId: string,
  winner: VoteTarget,
  loser: VoteTarget,
): Promise<{ success: boolean; error?: string }> {
  return Effect.runPromise(choosePairwiseForRoomEffect(host, participantId, winner, loser));
}

export function choosePairwiseForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  winner: VoteTarget,
  loser: VoteTarget,
): Effect.Effect<{ success: boolean; error?: string }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validatePairwiseChoiceEffect(s, participantId, winner, loser));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.pairwiseChoices = validation.right.pairwiseChoices;
    yield* saveAndBroadcastStateEffect(host, s);

    return { success: true };
  });
}
