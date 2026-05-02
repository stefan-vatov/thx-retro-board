import { Effect } from "effect";
import type { Column, RetroItem, Group, VoteAllocation } from "../src/domain";
import type { RoomCommandHost } from "./room-command-host";
import { normalizePairwiseChoices, normalizeReactions } from "./room-normalize";
import {
  RoomMutationValidationError,
  validateColumnCreateEffect,
  validateColumnDeleteEffect,
  validateColumnEditEffect,
  validateColumnReorderEffect,
} from "./validation";

function columnError(error: unknown, fallback: string): string {
  return error instanceof RoomMutationValidationError ? error.message : fallback;
}

export async function createColumnForRoom(
  host: RoomCommandHost,
  participantId: string,
  rawName: string,
): Promise<{ success: boolean; error?: string; column?: Column }> {
  const s = await host.loadState();
  let validated: { name: string; order: number };
  try {
    validated = await Effect.runPromise(validateColumnCreateEffect(s, participantId, rawName));
  } catch (error) {
    return { success: false, error: columnError(error, "Column could not be created") };
  }

  const column: Column = {
    id: crypto.randomUUID(),
    name: validated.name,
    order: validated.order,
  };
  s.columns = [...(s.columns ?? []), column];
  await host.saveState();
  host.broadcastState(s);

  return { success: true, column };
}

export async function editColumnForRoom(
  host: RoomCommandHost,
  participantId: string,
  columnId: string,
  rawName: string,
): Promise<{ success: boolean; error?: string; column?: Column }> {
  const s = await host.loadState();
  let validated: { columns: Column[]; column: Column };
  try {
    validated = await Effect.runPromise(validateColumnEditEffect(s, participantId, columnId, rawName));
  } catch (error) {
    return { success: false, error: columnError(error, "Column could not be updated") };
  }
  s.columns = validated.columns;
  await host.saveState();
  host.broadcastState(s);
  return { success: true, column: validated.column };
}

export async function reorderColumnsForRoom(
  host: RoomCommandHost,
  participantId: string,
  orderedIds: unknown,
): Promise<{ success: boolean; error?: string }> {
  const s = await host.loadState();
  let validated: { columns: Column[] };
  try {
    validated = await Effect.runPromise(validateColumnReorderEffect(s, participantId, orderedIds));
  } catch (error) {
    return { success: false, error: columnError(error, "Columns could not be reordered") };
  }
  s.columns = validated.columns;
  await host.saveState();
  host.broadcastState(s);
  return { success: true };
}

export async function deleteColumnForRoom(
  host: RoomCommandHost,
  participantId: string,
  columnId: string,
): Promise<{ success: boolean; error?: string }> {
  const s = await host.loadState();
  let validated: {
    columns: Column[];
    groups: Group[];
    items: RetroItem[];
    votes: VoteAllocation[];
  };
  try {
    validated = await Effect.runPromise(validateColumnDeleteEffect(s, participantId, columnId));
  } catch (error) {
    return { success: false, error: columnError(error, "Column could not be deleted") };
  }

  s.columns = validated.columns;
  s.groups = validated.groups;
  s.items = validated.items;
  s.votes = validated.votes;
  s.pairwiseChoices = normalizePairwiseChoices(s.pairwiseChoices, s.participants, s.groups, s.items);
  s.reactions = normalizeReactions(s.reactions, s.participants, s.groups, s.items);
  await host.saveState();
  host.broadcastState(s);
  return { success: true };
}
