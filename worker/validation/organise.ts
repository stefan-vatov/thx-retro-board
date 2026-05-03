import { Effect } from "effect";
import type { Group, RetroItem, VoteAllocation } from "../../src/domain";
import {
  applyDeleteGroup,
  applyEditGroup,
  applyMoveItemToGroup,
  applyReorderColumnGroups,
  applyReorderItems,
  hasDuplicateGroupNameInColumn,
  isValidColumnName,
  sanitizeColumnName,
  validateGroupReorderPayloadEffect,
  validateItemReorderPayloadEffect,
} from "../../src/domain";
import { MAX_GROUPS_PER_ROOM } from "../room-types";
import type { ItemReorderPreconditions, MoveItemPreconditions, StoredState } from "../room-types";
import {
  RoomMutationValidationError,
  validateExpectedVersion,
  validateItemReorderPreconditions,
  validateMoveItemPreconditions,
} from "./shared";

type GroupCreateValidationState = Pick<StoredState, "participants" | "phase" | "columns" | "groups">;
type GroupEditValidationState = Pick<StoredState, "participants" | "phase" | "groups">;
type GroupDeleteValidationState = Pick<StoredState, "participants" | "phase" | "groups" | "items" | "votes">;
type GroupReorderValidationState = Pick<StoredState, "participants" | "phase" | "groups" | "version">;
type ItemReorderValidationState = Pick<StoredState, "participants" | "phase" | "items" | "version">;
type ItemMoveValidationState = Pick<StoredState, "participants" | "phase" | "groups" | "items" | "version">;

export function validateGroupCreateEffect(
  state: GroupCreateValidationState,
  participantId: string,
  rawName: string,
  columnId: unknown,
): Effect.Effect<{ name: string; columnId: string; order: number }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (state.phase !== "organise") {
      return yield* Effect.fail(new RoomMutationValidationError("Cannot create groups outside organise phase"));
    }
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (typeof columnId !== "string" || !state.columns?.some((column) => column.id === columnId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Column not found"));
    }
    if (!isValidColumnName(rawName)) {
      return yield* Effect.fail(new RoomMutationValidationError("Group name cannot be empty"));
    }
    const sanitized = sanitizeColumnName(rawName);
    if (hasDuplicateGroupNameInColumn(state.groups, columnId, sanitized)) {
      return yield* Effect.fail(new RoomMutationValidationError("Group name already exists in this column"));
    }
    if (state.groups.length >= MAX_GROUPS_PER_ROOM) {
      return yield* Effect.fail(new RoomMutationValidationError(`Rooms can have at most ${MAX_GROUPS_PER_ROOM} groups`));
    }
    return {
      name: sanitized,
      columnId,
      order: state.groups.filter((candidate) => candidate.columnId === columnId).length,
    };
  });
}

export function validateGroupEditEffect(
  state: GroupEditValidationState,
  participantId: string,
  groupId: string,
  rawName: string,
): Effect.Effect<{ groups: Group[]; group: Group }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (state.phase !== "organise") {
      return yield* Effect.fail(new RoomMutationValidationError("Cannot mutate groups outside organise phase"));
    }
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (typeof groupId !== "string" || groupId.trim().length === 0) {
      return yield* Effect.fail(new RoomMutationValidationError("Group not found"));
    }
    const result = applyEditGroup(state.groups, groupId, rawName);
    if (result.error) {
      return yield* Effect.fail(new RoomMutationValidationError(result.error));
    }
    const group = result.groups.find((candidate) => candidate.id === groupId);
    if (!group) {
      return yield* Effect.fail(new RoomMutationValidationError("Group not found"));
    }
    return { groups: result.groups, group };
  });
}

export function validateGroupDeleteEffect(
  state: GroupDeleteValidationState,
  participantId: string,
  groupId: string,
): Effect.Effect<{
  groups: Group[];
  items: RetroItem[];
  votes: VoteAllocation[];
}, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (state.phase !== "organise") {
      return yield* Effect.fail(new RoomMutationValidationError("Cannot mutate groups outside organise phase"));
    }
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (typeof groupId !== "string" || groupId.trim().length === 0) {
      return yield* Effect.fail(new RoomMutationValidationError("Group not found"));
    }
    const result = applyDeleteGroup(state.groups, state.items, state.votes, groupId);
    if (result.error) {
      return yield* Effect.fail(new RoomMutationValidationError(result.error));
    }
    return {
      groups: result.groups,
      items: result.items,
      votes: result.votes,
    };
  });
}

export function validateGroupReorderEffect(
  state: GroupReorderValidationState,
  participantId: string,
  orderedIds: unknown,
  expectedVersion: unknown,
): Effect.Effect<{ groups: Group[] }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (state.phase !== "organise") {
      return yield* Effect.fail(new RoomMutationValidationError("Cannot mutate groups outside organise phase"));
    }
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    const validatedVersion = validateExpectedVersion(expectedVersion);
    if (!validatedVersion.success) {
      return yield* Effect.fail(new RoomMutationValidationError(validatedVersion.error));
    }
    if (validatedVersion.expectedVersion !== state.version) {
      return yield* Effect.fail(new RoomMutationValidationError("Stale group reorder rejected: room version changed"));
    }
    const ids = yield* validateGroupReorderPayloadEffect(state.groups, orderedIds).pipe(
      Effect.mapError((error) => new RoomMutationValidationError(error.message)),
    );
    return { groups: applyReorderColumnGroups(state.groups, ids) };
  });
}

export function validateItemReorderEffect(
  state: ItemReorderValidationState,
  participantId: string,
  orderedIds: unknown,
  preconditions: Partial<ItemReorderPreconditions> | undefined,
): Effect.Effect<{ items: RetroItem[] }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (state.phase !== "organise") {
      return yield* Effect.fail(new RoomMutationValidationError("Cannot reorder items outside organise phase"));
    }
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    const validatedPreconditions = validateItemReorderPreconditions(preconditions);
    if (!validatedPreconditions.success) {
      return yield* Effect.fail(new RoomMutationValidationError(validatedPreconditions.error));
    }
    if (validatedPreconditions.preconditions.expectedVersion !== state.version) {
      return yield* Effect.fail(new RoomMutationValidationError("Stale item reorder rejected: room version changed"));
    }
    const ids = yield* validateItemReorderPayloadEffect(state.items, orderedIds).pipe(
      Effect.mapError((error) => new RoomMutationValidationError(error.message)),
    );
    const firstItem = state.items.find((item) => item.id === ids[0]);
    if (
      !firstItem
      || firstItem.columnId !== validatedPreconditions.preconditions.sourceColumnId
      || firstItem.groupId !== validatedPreconditions.preconditions.sourceGroupId
    ) {
      return yield* Effect.fail(new RoomMutationValidationError("Stale item reorder rejected: source list changed"));
    }
    return { items: applyReorderItems(state.items, ids) };
  });
}

export function validateItemMoveEffect(
  state: ItemMoveValidationState,
  participantId: string,
  itemId: string,
  targetGroupId: string | null,
  targetIndex: number,
  preconditions: Partial<MoveItemPreconditions> | undefined,
): Effect.Effect<{ items: RetroItem[] }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (state.phase !== "organise") {
      return yield* Effect.fail(new RoomMutationValidationError("Cannot move items outside organise phase"));
    }
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    const validatedPreconditions = validateMoveItemPreconditions(preconditions);
    if (!validatedPreconditions.success) {
      return yield* Effect.fail(new RoomMutationValidationError(validatedPreconditions.error));
    }
    const item = state.items.find((candidate) => candidate.id === itemId);
    if (!item) {
      return yield* Effect.fail(new RoomMutationValidationError("Item not found"));
    }
    if (validatedPreconditions.preconditions.expectedVersion !== state.version) {
      return yield* Effect.fail(new RoomMutationValidationError("Stale item move rejected: room version changed"));
    }
    if (validatedPreconditions.preconditions.sourceGroupId !== item.groupId) {
      return yield* Effect.fail(new RoomMutationValidationError("Stale item move rejected: source column changed"));
    }
    if (validatedPreconditions.preconditions.sourceIndex !== item.order) {
      return yield* Effect.fail(new RoomMutationValidationError("Stale item move rejected: source order changed"));
    }
    const targetGroup = targetGroupId === null ? null : state.groups.find((group) => group.id === targetGroupId);
    if (targetGroupId !== null && !targetGroup) {
      return yield* Effect.fail(new RoomMutationValidationError("Group not found"));
    }
    if (targetGroup && targetGroup.columnId !== item.columnId) {
      return yield* Effect.fail(new RoomMutationValidationError("Cannot move item to a group in another column"));
    }
    if (!Number.isFinite(targetIndex) || !Number.isInteger(targetIndex)) {
      return yield* Effect.fail(new RoomMutationValidationError("Target index must be a finite integer"));
    }
    const targetListLength = state.items.filter(
      (candidate) => candidate.id !== item.id && candidate.columnId === item.columnId && candidate.groupId === targetGroupId,
    ).length;
    if (targetIndex < 0 || targetIndex > targetListLength) {
      return yield* Effect.fail(new RoomMutationValidationError("Target index out of bounds"));
    }
    return { items: applyMoveItemToGroup(state.items, itemId, targetGroupId, targetIndex) };
  });
}
