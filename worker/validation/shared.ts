import { Effect, Schema } from "effect";
import type { ClientToServerMessage, Group, ReactionTarget, RetroItem, VoteTarget } from "../../src/domain";
import {
  ClientToServerMessageSchema,
  groupVoteTarget,
  itemVoteTarget,
  voteTargetKey,
} from "../../src/domain";
import type {
  ItemReorderPreconditions,
  MoveItemPreconditions,
  StoredState,
} from "../room-types";

export class ClientWebSocketMessageError extends Error {
  constructor() {
    super("Invalid websocket client message");
    this.name = "ClientWebSocketMessageError";
  }
}

export class RoomMutationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoomMutationValidationError";
  }
}

type ParticipantAuthorizationState = Pick<StoredState, "participants" | "connectionTokens">;

export function parseClientWebSocketMessageEffect(
  message: string | ArrayBuffer,
): Effect.Effect<ClientToServerMessage, ClientWebSocketMessageError> {
  return Effect.gen(function* () {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    const parsed = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: () => new ClientWebSocketMessageError(),
    });
    return yield* Schema.decodeUnknown(ClientToServerMessageSchema)(parsed).pipe(
      Effect.mapError(() => new ClientWebSocketMessageError()),
    );
  });
}

export function authorizeParticipantEffect(
  state: ParticipantAuthorizationState | null,
  participantId: unknown,
  connectionToken: unknown,
): Effect.Effect<{ participantId: string }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (!state) {
      return yield* Effect.fail(new RoomMutationValidationError("Room not found"));
    }
    if (typeof participantId !== "string" || !state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (
      typeof connectionToken !== "string"
      || connectionToken.length === 0
      || state.connectionTokens[participantId] !== connectionToken
    ) {
      return yield* Effect.fail(new RoomMutationValidationError("Invalid participant credentials"));
    }
    return { participantId };
  });
}

export function validateMoveItemPreconditions(
  preconditions: Partial<MoveItemPreconditions> | undefined,
): { success: true; preconditions: MoveItemPreconditions } | { success: false; error: string } {
  const hasExpectedVersion = Object.prototype.hasOwnProperty.call(preconditions ?? {}, "expectedVersion");
  const hasSourceGroupId = Object.prototype.hasOwnProperty.call(preconditions ?? {}, "sourceGroupId");
  const hasSourceIndex = Object.prototype.hasOwnProperty.call(preconditions ?? {}, "sourceIndex");

  if (!hasExpectedVersion || !hasSourceGroupId || !hasSourceIndex) {
    return { success: false, error: "Move item preconditions are required" };
  }

  const expectedVersion = preconditions?.expectedVersion;
  const sourceGroupId = preconditions?.sourceGroupId;
  const sourceIndex = preconditions?.sourceIndex;

  if (typeof expectedVersion !== "number" || !Number.isFinite(expectedVersion) || !Number.isInteger(expectedVersion)) {
    return { success: false, error: "Expected version must be a finite integer" };
  }
  if (sourceGroupId !== null && typeof sourceGroupId !== "string") {
    return { success: false, error: "Source column precondition must be a string or null" };
  }
  if (typeof sourceIndex !== "number" || !Number.isFinite(sourceIndex) || !Number.isInteger(sourceIndex)) {
    return { success: false, error: "Source index must be a finite integer" };
  }

  return {
    success: true,
    preconditions: {
      expectedVersion,
      sourceGroupId,
      sourceIndex,
    },
  };
}

export function validateItemReorderPreconditions(
  preconditions: Partial<ItemReorderPreconditions> | undefined,
): { success: true; preconditions: ItemReorderPreconditions } | { success: false; error: string } {
  const hasExpectedVersion = Object.prototype.hasOwnProperty.call(preconditions ?? {}, "expectedVersion");
  const hasSourceColumnId = Object.prototype.hasOwnProperty.call(preconditions ?? {}, "sourceColumnId");
  const hasSourceGroupId = Object.prototype.hasOwnProperty.call(preconditions ?? {}, "sourceGroupId");

  if (!hasExpectedVersion || !hasSourceColumnId || !hasSourceGroupId) {
    return { success: false, error: "Item reorder preconditions are required" };
  }

  const expectedVersion = preconditions?.expectedVersion;
  const sourceColumnId = preconditions?.sourceColumnId;
  const sourceGroupId = preconditions?.sourceGroupId;

  if (typeof expectedVersion !== "number" || !Number.isFinite(expectedVersion) || !Number.isInteger(expectedVersion)) {
    return { success: false, error: "Expected version must be a finite integer" };
  }
  if (typeof sourceColumnId !== "string" || sourceColumnId.trim().length === 0) {
    return { success: false, error: "Source column precondition is required" };
  }
  if (sourceGroupId !== null && typeof sourceGroupId !== "string") {
    return { success: false, error: "Source group precondition must be a string or null" };
  }

  return { success: true, preconditions: { expectedVersion, sourceColumnId, sourceGroupId } };
}

export function validateExpectedVersion(
  expectedVersion: unknown,
): { success: true; expectedVersion: number } | { success: false; error: string } {
  if (typeof expectedVersion !== "number" || !Number.isFinite(expectedVersion) || !Number.isInteger(expectedVersion)) {
    return { success: false, error: "Expected version must be a finite integer" };
  }
  return { success: true, expectedVersion };
}

export function resolveVoteTargetForState(
  state: Pick<StoredState, "groups" | "items">,
  target: VoteTarget,
): { success: true; target: VoteTarget } | { success: false; error: string } {
  if (target.type === "group") {
    return state.groups.some((group) => group.id === target.id)
      ? { success: true, target }
      : { success: false, error: "Group not found" };
  }
  const item = state.items.find((candidate) => candidate.id === target.id);
  if (!item) {
    return { success: false, error: "Item not found" };
  }
  if (item.groupId !== null) {
    return { success: false, error: "Cannot vote directly on a grouped item" };
  }
  return { success: true, target };
}

export function resolveReactionTargetForState(
  state: Pick<StoredState, "groups" | "items">,
  target: ReactionTarget,
): { success: true; target: ReactionTarget } | { success: false; error: string } {
  if (!target || (target.type !== "group" && target.type !== "item") || typeof target.id !== "string") {
    return { success: false, error: "Reaction target not found" };
  }
  if (target.type === "group") {
    return state.groups.some((group) => group.id === target.id)
      ? { success: true, target }
      : { success: false, error: "Group not found" };
  }
  return state.items.some((item) => item.id === target.id)
    ? { success: true, target }
    : { success: false, error: "Item not found" };
}

export function normalizeReviewTargetKey(targetKey: unknown, groups: Group[], items: RetroItem[]): string | null {
  if (typeof targetKey !== "string") return null;
  const validTargetKeys = new Set<string>([
    ...groups.map((group) => voteTargetKey(groupVoteTarget(group.id))),
    ...items.filter((item) => item.groupId === null).map((item) => voteTargetKey(itemVoteTarget(item.id))),
  ]);
  return validTargetKeys.has(targetKey) ? targetKey : null;
}
