import { Effect } from "effect";
import type { ActionItem, RetroItem, VoteTarget } from "../../src/domain";
import {
  isValidActionText,
  isValidItemText,
  itemVoteTarget,
  sanitizeActionText,
  sanitizeItemText,
  validateExistingColumnIdEffect,
} from "../../src/domain";
import { MAX_ITEMS_PER_ROOM } from "../room-types";
import type { StoredState } from "../room-types";
import { normalizeReviewTargetKey, RoomMutationValidationError } from "./shared";

type ReviewActionValidationState = Pick<StoredState, "participants" | "phase">;
type ReviewActionEditValidationState = Pick<StoredState, "participants" | "phase" | "actions">;
type ReviewActionDeleteValidationState = Pick<StoredState, "participants" | "phase" | "actions">;
type WriteItemCreateValidationState = Pick<StoredState, "participants" | "phase" | "items" | "columns">;
type WriteItemEditValidationState = Pick<StoredState, "participants" | "phase" | "items">;
type WriteItemDeleteValidationState = Pick<StoredState, "participants" | "phase" | "items">;
type TimerValidationState = Pick<StoredState, "facilitatorId" | "participants">;
type ReviewTargetValidationState = Pick<StoredState, "facilitatorId" | "participants" | "phase" | "groups" | "items">;

export function validateReviewActionEffect(
  state: ReviewActionValidationState,
  participantId: string,
  rawText: string,
): Effect.Effect<{ text: string }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (state.phase !== "review") {
      return yield* Effect.fail(new RoomMutationValidationError("Cannot change actions outside review phase"));
    }
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (!isValidActionText(rawText)) {
      return yield* Effect.fail(new RoomMutationValidationError("Action text cannot be empty"));
    }
    return { text: sanitizeActionText(rawText) };
  });
}

export function validateReviewActionEditEffect(
  state: ReviewActionEditValidationState,
  participantId: string,
  actionId: string,
  rawText: string,
): Effect.Effect<{ action: ActionItem }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    const validation = yield* validateReviewActionEffect(state, participantId, rawText);
    if (typeof actionId !== "string" || actionId.trim().length === 0) {
      return yield* Effect.fail(new RoomMutationValidationError("Action not found"));
    }
    const existing = (state.actions ?? []).find((action) => action.id === actionId);
    if (!existing) {
      return yield* Effect.fail(new RoomMutationValidationError("Action not found"));
    }
    return { action: { ...existing, text: validation.text } };
  });
}

export function validateReviewActionDeleteEffect(
  state: ReviewActionDeleteValidationState,
  participantId: string,
  actionId: string,
): Effect.Effect<{ actionId: string }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (state.phase !== "review") {
      return yield* Effect.fail(new RoomMutationValidationError("Cannot delete actions outside review phase"));
    }
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (typeof actionId !== "string" || actionId.trim().length === 0) {
      return yield* Effect.fail(new RoomMutationValidationError("Action not found"));
    }
    if (!(state.actions ?? []).some((action) => action.id === actionId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Action not found"));
    }
    return { actionId };
  });
}

export function validateWriteItemCreateEffect(
  state: WriteItemCreateValidationState,
  participantId: string,
  rawText: string,
  columnId: unknown,
): Effect.Effect<{ text: string; columnId: string; order: number }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (state.phase !== "write") {
      return yield* Effect.fail(new RoomMutationValidationError("Cannot add items outside write phase"));
    }
    if (!isValidItemText(rawText)) {
      return yield* Effect.fail(new RoomMutationValidationError("Item text cannot be empty"));
    }
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (state.items.length >= MAX_ITEMS_PER_ROOM) {
      return yield* Effect.fail(new RoomMutationValidationError(`Rooms can have at most ${MAX_ITEMS_PER_ROOM} cards`));
    }
    const validatedColumnId = yield* validateExistingColumnIdEffect(state.columns ?? [], columnId).pipe(
      Effect.mapError((error) => new RoomMutationValidationError(error.message)),
    );
    return {
      text: sanitizeItemText(rawText),
      columnId: validatedColumnId,
      order: state.items.length,
    };
  });
}

export function validateWriteItemEditEffect(
  state: WriteItemEditValidationState,
  participantId: string,
  itemId: string,
  rawText: string,
): Effect.Effect<{ item: RetroItem }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (state.phase !== "write") {
      return yield* Effect.fail(new RoomMutationValidationError("Cannot edit items outside write phase"));
    }
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (!isValidItemText(rawText)) {
      return yield* Effect.fail(new RoomMutationValidationError("Item text cannot be empty"));
    }
    const existing = state.items.find((item) => item.id === itemId);
    if (!existing) {
      return yield* Effect.fail(new RoomMutationValidationError("Item not found"));
    }
    if (existing.authorId !== participantId) {
      return yield* Effect.fail(new RoomMutationValidationError("Only the author can edit this item"));
    }
    return { item: { ...existing, text: sanitizeItemText(rawText) } };
  });
}

export function validateWriteItemDeleteEffect(
  state: WriteItemDeleteValidationState,
  participantId: string,
  itemId: string,
): Effect.Effect<{ target: VoteTarget }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (state.phase !== "write") {
      return yield* Effect.fail(new RoomMutationValidationError("Cannot delete items outside write phase"));
    }
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    const existing = state.items.find((item) => item.id === itemId);
    if (!existing) {
      return yield* Effect.fail(new RoomMutationValidationError("Item not found"));
    }
    if (existing.authorId !== participantId) {
      return yield* Effect.fail(new RoomMutationValidationError("Only the author can delete this item"));
    }
    return { target: itemVoteTarget(itemId) };
  });
}

export function validateTimerChangeEffect(
  state: TimerValidationState,
  participantId: string,
  durationSeconds: number,
): Effect.Effect<{ durationSeconds: number }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (state.facilitatorId !== participantId) {
      return yield* Effect.fail(new RoomMutationValidationError("Only the facilitator can set timers"));
    }
    if (typeof durationSeconds !== "number" || durationSeconds < 1 || !Number.isInteger(durationSeconds)) {
      return yield* Effect.fail(new RoomMutationValidationError("Timer duration must be a positive integer (seconds)"));
    }
    return { durationSeconds };
  });
}

export function validateReviewTargetChangeEffect(
  state: ReviewTargetValidationState,
  participantId: string,
  reviewTargetKey: string | null,
): Effect.Effect<{ reviewTargetKey: string | null }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (state.facilitatorId !== participantId) {
      return yield* Effect.fail(new RoomMutationValidationError("Only the facilitator can change review slide"));
    }
    if (state.phase !== "review") {
      return yield* Effect.fail(new RoomMutationValidationError("Review slide can only be changed during review"));
    }
    const normalizedTargetKey = normalizeReviewTargetKey(reviewTargetKey, state.groups, state.items);
    if (reviewTargetKey !== null && normalizedTargetKey === null) {
      return yield* Effect.fail(new RoomMutationValidationError("Review target not found"));
    }
    return { reviewTargetKey: normalizedTargetKey };
  });
}
