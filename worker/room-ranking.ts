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
  const s = await host.loadState();
  let validated: { budget: number };
  try {
    validated = await Effect.runPromise(validateVoteBudgetChangeEffect(s, participantId, budget));
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Vote budget validation failed",
    };
  }
  s.voteBudget = validated.budget;
  await host.saveState();
  host.broadcastState(s);
  return { success: true };
}

export async function setRankingMethodForRoom(
  host: RoomCommandHost,
  participantId: string,
  rankingMethod: RankingMethod,
): Promise<{ success: boolean; error?: string }> {
  const s = await host.loadState();
  let validated: { rankingMethod: RankingMethod };
  try {
    validated = await Effect.runPromise(validateRankingMethodChangeEffect(s, participantId, rankingMethod));
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Ranking method validation failed",
    };
  }

  s.rankingMethod = validated.rankingMethod;
  s.votes = [];
  s.pairwiseChoices = [];
  await host.saveState();
  host.broadcast({ type: "ranking-method-changed", rankingMethod: validated.rankingMethod });
  host.broadcastState(s);
  return { success: true };
}

export async function toggleReactionForRoom(
  host: RoomCommandHost,
  participantId: string,
  target: ReactionTarget,
  emoji: string,
): Promise<{ success: boolean; error?: string }> {
  const s = await host.loadState();
  const validation = await Effect.runPromise(Effect.either(validateReactionToggleEffect(s, participantId, target, emoji)));
  if (validation._tag === "Left") {
    return { success: false, error: validation.left.message };
  }
  s.reactions = validation.right.reactions;
  await host.saveState();
  host.broadcastState(s);
  return { success: true };
}

export async function castVoteForRoom(
  host: RoomCommandHost,
  participantId: string,
  targetOrGroupId: VoteTarget | string,
  count: number,
): Promise<{ success: boolean; error?: string }> {
  const s = await host.loadState();
  const validation = await Effect.runPromise(Effect.either(validateVoteCastEffect(s, participantId, targetOrGroupId, count)));
  if (validation._tag === "Left") {
    return { success: false, error: validation.left.message };
  }

  s.votes = validation.right.votes;
  await host.saveState();
  host.broadcastState(s);

  return { success: true };
}

export async function removeVoteForRoom(
  host: RoomCommandHost,
  participantId: string,
  targetOrGroupId: VoteTarget | string,
): Promise<{ success: boolean; error?: string }> {
  const s = await host.loadState();
  const validation = await Effect.runPromise(Effect.either(validateVoteRemoveEffect(s, participantId, targetOrGroupId)));
  if (validation._tag === "Left") {
    return { success: false, error: validation.left.message };
  }

  s.votes = validation.right.votes;
  await host.saveState();
  host.broadcastState(s);

  return { success: true };
}

export async function choosePairwiseForRoom(
  host: RoomCommandHost,
  participantId: string,
  winner: VoteTarget,
  loser: VoteTarget,
): Promise<{ success: boolean; error?: string }> {
  const s = await host.loadState();
  const validation = await Effect.runPromise(Effect.either(validatePairwiseChoiceEffect(s, participantId, winner, loser)));
  if (validation._tag === "Left") {
    return { success: false, error: validation.left.message };
  }

  s.pairwiseChoices = validation.right.pairwiseChoices;
  await host.saveState();
  host.broadcastState(s);

  return { success: true };
}
