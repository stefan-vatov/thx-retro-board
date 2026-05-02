import { Effect } from "effect";
import type { Group } from "../src/domain";
import { groupVoteTarget, sameVoteTarget } from "../src/domain";
import type { ItemReorderPreconditions, MoveItemPreconditions } from "./room-types";
import type { RoomCommandHost } from "./room-command-host";
import { normalizePairwiseChoices } from "./room-normalize";
import {
  validateGroupCreateEffect,
  validateGroupDeleteEffect,
  validateGroupEditEffect,
  validateGroupReorderEffect,
  validateItemMoveEffect,
  validateItemReorderEffect,
} from "./validation";

export async function createGroupForRoom(
  host: RoomCommandHost,
  participantId: string,
  rawName: string,
  columnId?: string,
): Promise<{ success: boolean; error?: string; group?: Group }> {
  const s = await host.loadState();
  const validation = await Effect.runPromise(Effect.either(validateGroupCreateEffect(s, participantId, rawName, columnId)));
  if (validation._tag === "Left") {
    return { success: false, error: validation.left.message };
  }
  const validated = validation.right;

  const group: Group = {
    id: crypto.randomUUID(),
    name: validated.name,
    columnId: validated.columnId,
    order: validated.order,
  };
  s.groups.push(group);
  await host.saveState();
  host.broadcastState(s);

  return { success: true, group };
}

export async function editGroupForRoom(
  host: RoomCommandHost,
  participantId: string,
  groupId: string,
  rawName: string,
): Promise<{ success: boolean; error?: string; group?: Group }> {
  const s = await host.loadState();
  const validation = await Effect.runPromise(Effect.either(validateGroupEditEffect(s, participantId, groupId, rawName)));
  if (validation._tag === "Left") {
    return { success: false, error: validation.left.message };
  }
  const validated = validation.right;
  s.groups = validated.groups;
  await host.saveState();
  host.broadcastState(s);
  return { success: true, group: validated.group };
}

export async function deleteGroupForRoom(
  host: RoomCommandHost,
  participantId: string,
  groupId: string,
): Promise<{ success: boolean; error?: string }> {
  const s = await host.loadState();
  const validation = await Effect.runPromise(Effect.either(validateGroupDeleteEffect(s, participantId, groupId)));
  if (validation._tag === "Left") {
    return { success: false, error: validation.left.message };
  }
  const validated = validation.right;
  s.groups = validated.groups;
  s.items = validated.items;
  s.votes = validated.votes;
  s.pairwiseChoices = normalizePairwiseChoices(s.pairwiseChoices, s.participants, s.groups, s.items);
  s.reactions = (s.reactions ?? []).filter((reaction) => !sameVoteTarget(reaction.target, groupVoteTarget(groupId)));
  await host.saveState();
  host.broadcastState(s);
  return { success: true };
}

export async function reorderGroupsForRoom(
  host: RoomCommandHost,
  participantId: string,
  orderedIds: unknown,
  expectedVersion?: unknown,
): Promise<{ success: boolean; error?: string }> {
  const s = await host.loadState();
  const validation = await Effect.runPromise(Effect.either(validateGroupReorderEffect(s, participantId, orderedIds, expectedVersion)));
  if (validation._tag === "Left") {
    return { success: false, error: validation.left.message };
  }

  s.groups = validation.right.groups;
  await host.saveState();
  host.broadcastState(s);
  return { success: true };
}

export async function reorderItemsForRoom(
  host: RoomCommandHost,
  participantId: string,
  orderedIds: unknown,
  preconditions?: Partial<ItemReorderPreconditions>,
): Promise<{ success: boolean; error?: string }> {
  const s = await host.loadState();
  const validation = await Effect.runPromise(Effect.either(validateItemReorderEffect(s, participantId, orderedIds, preconditions)));
  if (validation._tag === "Left") {
    return { success: false, error: validation.left.message };
  }

  s.items = validation.right.items;
  await host.saveState();

  host.broadcast({ type: "items-reordered", items: s.items });
  host.broadcastState(s);

  return { success: true };
}

export async function moveItemToGroupForRoom(
  host: RoomCommandHost,
  participantId: string,
  itemId: string,
  targetGroupId: string | null,
  targetIndex: number,
  preconditions?: Partial<MoveItemPreconditions>,
): Promise<{ success: boolean; error?: string }> {
  const s = await host.loadState();
  const validation = await Effect.runPromise(Effect.either(validateItemMoveEffect(
    s,
    participantId,
    itemId,
    targetGroupId,
    targetIndex,
    preconditions,
  )));
  if (validation._tag === "Left") {
    return { success: false, error: validation.left.message };
  }

  s.items = validation.right.items;
  await host.saveState();
  host.broadcastState(s);

  return { success: true };
}
