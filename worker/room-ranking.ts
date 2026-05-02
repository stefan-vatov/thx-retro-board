import { Effect } from "effect";
import type { RankingMethod, ReactionTarget, VoteTarget } from "../src/domain";
import type { RoomCommandHost } from "./room-command-host";
import {
  validatePairwiseChoiceEffect,
  validateRankingMethodChangeEffect,
  validateReactionToggleEffect,
  validateVoteBudgetChangeEffect,
  validateVoteCastEffect,
  validateVoteRemoveEffect,
} from "./validation";

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
): Effect.Effect<{ success: boolean; error?: string }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateVoteBudgetChangeEffect(s, participantId, budget));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.voteBudget = validation.right.budget;
    yield* Effect.promise(() => host.saveState());
    host.broadcastState(s);
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
): Effect.Effect<{ success: boolean; error?: string }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateRankingMethodChangeEffect(s, participantId, rankingMethod));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.rankingMethod = validation.right.rankingMethod;
    s.votes = [];
    s.pairwiseChoices = [];
    yield* Effect.promise(() => host.saveState());
    host.broadcast({ type: "ranking-method-changed", rankingMethod: validation.right.rankingMethod });
    host.broadcastState(s);
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
    yield* Effect.promise(() => host.saveState());
    host.broadcastState(s);
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
    yield* Effect.promise(() => host.saveState());
    host.broadcastState(s);

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
    yield* Effect.promise(() => host.saveState());
    host.broadcastState(s);

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
    yield* Effect.promise(() => host.saveState());
    host.broadcastState(s);

    return { success: true };
  });
}
