import { Effect } from "effect";
import type { Column } from "../src/domain";
import type { RoomCommandHost } from "./room-command-host";
import { normalizePairwiseChoices, normalizeReactions } from "./room-normalize";
import {
  validateColumnCreateEffect,
  validateColumnDeleteEffect,
  validateColumnEditEffect,
  validateColumnReorderEffect,
} from "./validation";

export async function createColumnForRoom(
  host: RoomCommandHost,
  participantId: string,
  rawName: string,
): Promise<{ success: boolean; error?: string; column?: Column }> {
  return Effect.runPromise(createColumnForRoomEffect(host, participantId, rawName));
}

export function createColumnForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  rawName: string,
): Effect.Effect<{ success: boolean; error?: string; column?: Column }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateColumnCreateEffect(s, participantId, rawName));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    const column: Column = {
      id: crypto.randomUUID(),
      name: validation.right.name,
      order: validation.right.order,
    };
    s.columns = [...(s.columns ?? []), column];
    yield* Effect.promise(() => host.saveState());
    host.broadcastState(s);

    return { success: true, column };
  });
}

export async function editColumnForRoom(
  host: RoomCommandHost,
  participantId: string,
  columnId: string,
  rawName: string,
): Promise<{ success: boolean; error?: string; column?: Column }> {
  return Effect.runPromise(editColumnForRoomEffect(host, participantId, columnId, rawName));
}

export function editColumnForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  columnId: string,
  rawName: string,
): Effect.Effect<{ success: boolean; error?: string; column?: Column }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateColumnEditEffect(s, participantId, columnId, rawName));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.columns = validation.right.columns;
    yield* Effect.promise(() => host.saveState());
    host.broadcastState(s);
    return { success: true, column: validation.right.column };
  });
}

export async function reorderColumnsForRoom(
  host: RoomCommandHost,
  participantId: string,
  orderedIds: unknown,
): Promise<{ success: boolean; error?: string }> {
  return Effect.runPromise(reorderColumnsForRoomEffect(host, participantId, orderedIds));
}

export function reorderColumnsForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  orderedIds: unknown,
): Effect.Effect<{ success: boolean; error?: string }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateColumnReorderEffect(s, participantId, orderedIds));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.columns = validation.right.columns;
    yield* Effect.promise(() => host.saveState());
    host.broadcastState(s);
    return { success: true };
  });
}

export async function deleteColumnForRoom(
  host: RoomCommandHost,
  participantId: string,
  columnId: string,
): Promise<{ success: boolean; error?: string }> {
  return Effect.runPromise(deleteColumnForRoomEffect(host, participantId, columnId));
}

export function deleteColumnForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  columnId: string,
): Effect.Effect<{ success: boolean; error?: string }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateColumnDeleteEffect(s, participantId, columnId));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    const validated = validation.right;
    s.columns = validated.columns;
    s.groups = validated.groups;
    s.items = validated.items;
    s.votes = validated.votes;
    s.pairwiseChoices = normalizePairwiseChoices(s.pairwiseChoices, s.participants, s.groups, s.items);
    s.reactions = normalizeReactions(s.reactions, s.participants, s.groups, s.items);
    yield* Effect.promise(() => host.saveState());
    host.broadcastState(s);
    return { success: true };
  });
}
