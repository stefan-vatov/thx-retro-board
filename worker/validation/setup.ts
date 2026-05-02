import { Effect } from "effect";
import type { Column, Group, Participant, Phase, RankingMethod, RetroItem, VoteAllocation } from "../../src/domain";
import {
  applyDeleteColumn,
  applyEditColumn,
  applyReorderColumns,
  canTransition,
  isValidColumnName,
  MAX_COLUMNS,
  PHASE_ORDER,
  sanitizeColumnName,
  validateFullColumnPermutation,
} from "../../src/domain";
import { MAX_PAIRWISE_TARGETS, MAX_PARTICIPANTS_PER_ROOM } from "../room-types";
import type { StoredState } from "../room-types";
import { RoomMutationValidationError } from "./shared";

type VoteBudgetValidationState = Pick<StoredState, "facilitatorId" | "participants" | "phase">;
type RankingMethodValidationState = Pick<StoredState, "facilitatorId" | "participants" | "phase">;
type PhaseValidationState = Pick<StoredState, "facilitatorId" | "participants" | "phase" | "columns" | "rankingMethod">;
type ColumnCreateValidationState = Pick<StoredState, "facilitatorId" | "participants" | "phase" | "columns">;
type ColumnEditValidationState = Pick<StoredState, "facilitatorId" | "participants" | "phase" | "columns">;
type ColumnReorderValidationState = Pick<StoredState, "facilitatorId" | "participants" | "phase" | "columns">;
type ColumnDeleteValidationState = Pick<StoredState, "facilitatorId" | "participants" | "phase" | "columns" | "groups" | "items" | "votes">;
type ParticipantJoinValidationState = Pick<StoredState, "participants" | "facilitatorId" | "facilitatorClaimToken" | "connectionTokens">;

export function validateVoteBudgetChangeEffect(
  state: VoteBudgetValidationState,
  participantId: string,
  budget: number,
): Effect.Effect<{ budget: number }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (state.facilitatorId !== participantId) {
      return yield* Effect.fail(new RoomMutationValidationError("Only the facilitator can set vote budget"));
    }
    if (state.phase !== "setup") {
      return yield* Effect.fail(new RoomMutationValidationError("Vote budget can only be changed during setup"));
    }
    if (typeof budget !== "number" || budget < 1 || budget > 100 || !Number.isInteger(budget)) {
      return yield* Effect.fail(new RoomMutationValidationError("Vote budget must be an integer between 1 and 100"));
    }
    return { budget };
  });
}

export function validateRankingMethodChangeEffect(
  state: RankingMethodValidationState,
  participantId: string,
  rankingMethod: RankingMethod,
): Effect.Effect<{ rankingMethod: RankingMethod }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (state.facilitatorId !== participantId) {
      return yield* Effect.fail(new RoomMutationValidationError("Only the facilitator can set ranking method"));
    }
    if (state.phase !== "setup") {
      return yield* Effect.fail(new RoomMutationValidationError("Ranking method can only be changed during setup"));
    }
    if (rankingMethod !== "score" && rankingMethod !== "pairwise") {
      return yield* Effect.fail(new RoomMutationValidationError("Invalid ranking method"));
    }
    return { rankingMethod };
  });
}

export function validatePhaseChangeEffect(
  state: PhaseValidationState,
  participantId: string,
  phase: Phase,
  decisionTargetCount: number,
): Effect.Effect<{ phase: Phase }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (state.facilitatorId !== participantId) {
      return yield* Effect.fail(new RoomMutationValidationError("Only the facilitator can change phase"));
    }
    if (!PHASE_ORDER.includes(phase)) {
      return yield* Effect.fail(new RoomMutationValidationError("Invalid phase"));
    }
    if (!canTransition(state.phase, phase)) {
      return yield* Effect.fail(new RoomMutationValidationError(`Cannot transition from ${state.phase} to ${phase}`));
    }
    if (state.phase === "setup" && phase === "write" && (state.columns ?? []).length === 0) {
      return yield* Effect.fail(new RoomMutationValidationError("Add at least one column before starting write phase"));
    }
    if (phase === "vote" && (state.rankingMethod ?? "score") === "pairwise" && decisionTargetCount > MAX_PAIRWISE_TARGETS) {
      return yield* Effect.fail(new RoomMutationValidationError(`Pairwise ranking supports at most ${MAX_PAIRWISE_TARGETS} cards or groups`));
    }
    return { phase };
  });
}

export function validateColumnCreateEffect(
  state: ColumnCreateValidationState,
  participantId: string,
  rawName: string,
): Effect.Effect<{ name: string; order: number }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (state.facilitatorId !== participantId) {
      return yield* Effect.fail(new RoomMutationValidationError("Only the facilitator can configure columns"));
    }
    if (state.phase !== "setup") {
      return yield* Effect.fail(new RoomMutationValidationError("Columns can only be configured during setup"));
    }
    if (!isValidColumnName(rawName)) {
      return yield* Effect.fail(new RoomMutationValidationError("Column name cannot be empty"));
    }
    if ((state.columns ?? []).length >= MAX_COLUMNS) {
      return yield* Effect.fail(new RoomMutationValidationError(`Rooms can have at most ${MAX_COLUMNS} columns`));
    }
    return {
      name: sanitizeColumnName(rawName),
      order: (state.columns ?? []).length,
    };
  });
}

export function validateColumnEditEffect(
  state: ColumnEditValidationState,
  participantId: string,
  columnId: string,
  rawName: string,
): Effect.Effect<{ columns: Column[]; column: Column }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (state.facilitatorId !== participantId) {
      return yield* Effect.fail(new RoomMutationValidationError("Only the facilitator can configure columns"));
    }
    if (state.phase !== "setup") {
      return yield* Effect.fail(new RoomMutationValidationError("Columns can only be configured during setup"));
    }
    if (typeof columnId !== "string" || columnId.trim().length === 0) {
      return yield* Effect.fail(new RoomMutationValidationError("Column not found"));
    }
    const result = applyEditColumn(state.columns ?? [], columnId, rawName);
    if (result.error) {
      return yield* Effect.fail(new RoomMutationValidationError(result.error));
    }
    const column = result.columns.find((candidate) => candidate.id === columnId);
    if (!column) {
      return yield* Effect.fail(new RoomMutationValidationError("Column not found"));
    }
    return { columns: result.columns, column };
  });
}

export function validateColumnReorderEffect(
  state: ColumnReorderValidationState,
  participantId: string,
  orderedIds: unknown,
): Effect.Effect<{ columns: Column[] }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (state.facilitatorId !== participantId) {
      return yield* Effect.fail(new RoomMutationValidationError("Only the facilitator can configure columns"));
    }
    if (state.phase !== "setup") {
      return yield* Effect.fail(new RoomMutationValidationError("Columns can only be configured during setup"));
    }
    const validation = validateFullColumnPermutation(state.columns ?? [], orderedIds);
    if (!validation.valid) {
      return yield* Effect.fail(new RoomMutationValidationError(validation.error));
    }
    return { columns: applyReorderColumns(state.columns ?? [], validation.ids) };
  });
}

export function validateColumnDeleteEffect(
  state: ColumnDeleteValidationState,
  participantId: string,
  columnId: string,
): Effect.Effect<{
  columns: Column[];
  groups: Group[];
  items: RetroItem[];
  votes: VoteAllocation[];
}, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (state.facilitatorId !== participantId) {
      return yield* Effect.fail(new RoomMutationValidationError("Only the facilitator can configure columns"));
    }
    if (state.phase !== "setup") {
      return yield* Effect.fail(new RoomMutationValidationError("Columns can only be configured during setup"));
    }
    if (typeof columnId !== "string" || columnId.trim().length === 0) {
      return yield* Effect.fail(new RoomMutationValidationError("Column not found"));
    }
    const result = applyDeleteColumn(state.columns ?? [], state.groups, state.items, state.votes, columnId);
    if (result.error) {
      return yield* Effect.fail(new RoomMutationValidationError(result.error));
    }
    return {
      columns: result.columns,
      groups: result.groups,
      items: result.items,
      votes: result.votes,
    };
  });
}

export function validateParticipantJoinEffect(
  state: ParticipantJoinValidationState,
  participantId: string,
  displayName: string,
  connectionToken?: string,
  facilitatorClaimToken?: unknown,
): Effect.Effect<{
  displayName: string;
  existing: Participant | null;
  isFacilitator: boolean;
  shouldClaimFacilitator: boolean;
}, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (typeof participantId !== "string" || participantId.trim().length === 0 || participantId.length > 128) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (typeof displayName !== "string") {
      return yield* Effect.fail(new RoomMutationValidationError("Display name cannot be blank"));
    }
    const trimmed = displayName.trim();
    if (trimmed.length === 0) {
      return yield* Effect.fail(new RoomMutationValidationError("Display name cannot be blank"));
    }
    const sanitized = trimmed.slice(0, 50);
    const existing = state.participants.find((participant) => participant.id === participantId) ?? null;
    const canClaimFacilitator = state.facilitatorId === null
      && typeof facilitatorClaimToken === "string"
      && typeof state.facilitatorClaimToken === "string"
      && facilitatorClaimToken === state.facilitatorClaimToken;

    if (existing) {
      if (
        typeof connectionToken !== "string"
        || connectionToken.length === 0
        || state.connectionTokens[participantId] !== connectionToken
      ) {
        return yield* Effect.fail(new RoomMutationValidationError("Invalid participant credentials"));
      }
      return {
        displayName: sanitized,
        existing,
        isFacilitator: canClaimFacilitator ? true : existing.isFacilitator,
        shouldClaimFacilitator: canClaimFacilitator,
      };
    }

    if (state.participants.length >= MAX_PARTICIPANTS_PER_ROOM) {
      return yield* Effect.fail(new RoomMutationValidationError(`Rooms can have at most ${MAX_PARTICIPANTS_PER_ROOM} participants`));
    }
    const isFacilitator = state.participants.length === 0 && state.facilitatorClaimToken === null
      ? true
      : canClaimFacilitator;
    return {
      displayName: sanitized,
      existing: null,
      isFacilitator,
      shouldClaimFacilitator: canClaimFacilitator,
    };
  });
}
