import { Effect } from "effect";
import type { PairwiseChoice, Reaction, ReactionTarget, VoteAllocation, VoteTarget } from "../../src/domain";
import {
  applyCastVote,
  applyRemoveVote,
  getVoteTarget,
  groupVoteTarget,
  isAllowedReactionEmoji,
  itemVoteTarget,
  pairwiseComparisonKey,
  sameVoteTarget,
  voteTargetKey,
} from "../../src/domain";
import {
  MAX_PAIRWISE_CHOICES_PER_ROOM,
  MAX_PAIRWISE_TARGETS,
  MAX_REACTIONS_PER_ROOM,
  MAX_REACTIONS_PER_TARGET,
} from "../room-types";
import type { StoredState } from "../room-types";
import {
  resolveReactionTargetForStateEffect,
  resolveVoteTargetForStateEffect,
  RoomMutationValidationError,
} from "./shared";

type ScoreVoteValidationState = Pick<StoredState, "participants" | "votingParticipantIds" | "phase" | "rankingMethod" | "voteBudget" | "groups" | "items" | "votes">;
type ReactionToggleValidationState = Pick<StoredState, "participants" | "groups" | "items" | "reactions">;
type PairwiseChoiceValidationState = Pick<StoredState, "participants" | "votingParticipantIds" | "phase" | "rankingMethod" | "groups" | "items" | "pairwiseChoices">;

function validateScoreVoteContext(
  state: ScoreVoteValidationState,
  participantId: string,
): Effect.Effect<void, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (state.phase !== "vote") {
      return yield* Effect.fail(new RoomMutationValidationError("Cannot vote outside vote phase"));
    }
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (state.votingParticipantIds?.length && !state.votingParticipantIds.includes(participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant joined after voting started"));
    }
    if ((state.rankingMethod ?? "score") !== "score") {
      return yield* Effect.fail(new RoomMutationValidationError("This room is using pairwise ranking"));
    }
  });
}

export function validateVoteCastEffect(
  state: ScoreVoteValidationState,
  participantId: string,
  targetOrGroupId: VoteTarget | string,
  count: number,
): Effect.Effect<{ votes: VoteAllocation[] }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    yield* validateScoreVoteContext(state, participantId);
    const target = typeof targetOrGroupId === "string" ? groupVoteTarget(targetOrGroupId) : targetOrGroupId;
    const validatedTarget = yield* resolveVoteTargetForStateEffect(state, target);
    const result = applyCastVote(state.votes, participantId, validatedTarget, count, state.voteBudget);
    if (result.error) {
      return yield* Effect.fail(new RoomMutationValidationError(result.error));
    }
    return { votes: result.votes };
  });
}

export function validateVoteRemoveEffect(
  state: ScoreVoteValidationState,
  participantId: string,
  targetOrGroupId: VoteTarget | string,
): Effect.Effect<{ votes: VoteAllocation[] }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    yield* validateScoreVoteContext(state, participantId);
    const target = typeof targetOrGroupId === "string" ? groupVoteTarget(targetOrGroupId) : targetOrGroupId;
    const validatedTarget = yield* resolveVoteTargetForStateEffect(state, target);
    const existing = state.votes.find((vote) => {
      const voteTarget = getVoteTarget(vote);
      return vote.participantId === participantId && voteTarget !== null && sameVoteTarget(voteTarget, validatedTarget);
    });
    if (!existing) {
      return yield* Effect.fail(new RoomMutationValidationError("No votes to remove"));
    }
    return { votes: applyRemoveVote(state.votes, participantId, validatedTarget) };
  });
}

export function validateReactionToggleEffect(
  state: ReactionToggleValidationState,
  participantId: string,
  target: ReactionTarget,
  emoji: string,
): Effect.Effect<{ reactions: Reaction[] }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (!isAllowedReactionEmoji(emoji)) {
      return yield* Effect.fail(new RoomMutationValidationError("Reaction emoji is not supported"));
    }
    const validatedTarget = yield* resolveReactionTargetForStateEffect(state, target);
    const reactionKey = `${participantId}:${voteTargetKey(validatedTarget)}:${emoji}`;
    const existing = state.reactions ?? [];
    const hasReaction = existing.some((reaction) =>
      `${reaction.participantId}:${voteTargetKey(reaction.target)}:${reaction.emoji}` === reactionKey,
    );
    if (!hasReaction) {
      if (existing.length >= MAX_REACTIONS_PER_ROOM) {
        return yield* Effect.fail(new RoomMutationValidationError(`Rooms can have at most ${MAX_REACTIONS_PER_ROOM} reactions`));
      }
      const targetReactionCount = existing.filter((reaction) => sameVoteTarget(reaction.target, validatedTarget)).length;
      if (targetReactionCount >= MAX_REACTIONS_PER_TARGET) {
        return yield* Effect.fail(new RoomMutationValidationError(`A card or group can have at most ${MAX_REACTIONS_PER_TARGET} reactions`));
      }
    }
    return {
      reactions: hasReaction
        ? existing.filter((reaction) => `${reaction.participantId}:${voteTargetKey(reaction.target)}:${reaction.emoji}` !== reactionKey)
        : [...existing, { participantId, target: validatedTarget, emoji }],
    };
  });
}

export function validatePairwiseChoiceEffect(
  state: PairwiseChoiceValidationState,
  participantId: string,
  winner: VoteTarget,
  loser: VoteTarget,
): Effect.Effect<{ pairwiseChoices: PairwiseChoice[] }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (state.phase !== "vote") {
      return yield* Effect.fail(new RoomMutationValidationError("Cannot rank outside vote phase"));
    }
    if ((state.rankingMethod ?? "score") !== "pairwise") {
      return yield* Effect.fail(new RoomMutationValidationError("This room is using score voting"));
    }
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (state.votingParticipantIds?.length && !state.votingParticipantIds.includes(participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant joined after voting started"));
    }
    const validatedWinner = yield* resolveVoteTargetForStateEffect(state, winner);
    const validatedLoser = yield* resolveVoteTargetForStateEffect(state, loser);
    if (sameVoteTarget(validatedWinner, validatedLoser)) {
      return yield* Effect.fail(new RoomMutationValidationError("Pairwise targets must be different"));
    }
    const targetKeys = new Set<string>([
      ...state.groups.map((group) => voteTargetKey(groupVoteTarget(group.id))),
      ...state.items.filter((item) => item.groupId === null).map((item) => voteTargetKey(itemVoteTarget(item.id))),
    ]);
    if (targetKeys.size > MAX_PAIRWISE_TARGETS) {
      return yield* Effect.fail(new RoomMutationValidationError(`Pairwise ranking supports at most ${MAX_PAIRWISE_TARGETS} cards or groups`));
    }
    const choice: PairwiseChoice = {
      participantId,
      winner: validatedWinner,
      loser: validatedLoser,
    };
    const choiceKey = `${participantId}:${pairwiseComparisonKey(choice.winner, choice.loser)}`;
    const existingChoices = state.pairwiseChoices ?? [];
    const isReplacingChoice = existingChoices.some((candidate) => `${candidate.participantId}:${pairwiseComparisonKey(candidate.winner, candidate.loser)}` === choiceKey);
    if (!isReplacingChoice && existingChoices.length >= MAX_PAIRWISE_CHOICES_PER_ROOM) {
      return yield* Effect.fail(new RoomMutationValidationError(`Rooms can have at most ${MAX_PAIRWISE_CHOICES_PER_ROOM} pairwise choices`));
    }
    return {
      pairwiseChoices: [
        ...existingChoices.filter((candidate) => `${candidate.participantId}:${pairwiseComparisonKey(candidate.winner, candidate.loser)}` !== choiceKey),
        choice,
      ],
    };
  });
}
