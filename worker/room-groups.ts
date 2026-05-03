import { Effect } from "effect";
import type { Group } from "../src/domain";
import { groupVoteTarget, sameVoteTarget } from "../src/domain";
import { saveAndBroadcastStateEffect } from "./room-command-effect";
import type { RoomCommandHost } from "./room-command-host";
import { normalizePairwiseChoices } from "./room-normalize";
import type { ItemReorderPreconditions, MoveItemPreconditions, StoredState } from "./room-types";
import {
  validateGroupCreateEffect,
  validateGroupDeleteEffect,
  validateGroupEditEffect,
  validateGroupReorderEffect,
  validateItemMoveEffect,
  validateItemReorderEffect,
} from "./validation";

export interface CreateGroupForRoomDeps {
  loadState: (host: RoomCommandHost) => Effect.Effect<StoredState>;
  generateGroupId: () => Effect.Effect<string>;
  saveAndBroadcastState: (host: RoomCommandHost, state: StoredState) => Effect.Effect<void>;
}

export const createGroupForRoomDeps: CreateGroupForRoomDeps = {
  loadState: (host) => Effect.promise(() => host.loadState()),
  generateGroupId: () => Effect.sync(() => crypto.randomUUID()),
  saveAndBroadcastState: saveAndBroadcastStateEffect,
};

export async function createGroupForRoom(
  host: RoomCommandHost,
  participantId: string,
  rawName: string,
  columnId?: string,
): Promise<{ success: boolean; error?: string; group?: Group }> {
  return Effect.runPromise(createGroupForRoomEffect(host, participantId, rawName, columnId));
}

export function createGroupForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  rawName: string,
  columnId?: string,
  deps: CreateGroupForRoomDeps = createGroupForRoomDeps,
): Effect.Effect<{ success: boolean; error?: string; group?: Group }> {
  return Effect.gen(function* () {
    const s = yield* deps.loadState(host);
    const validation = yield* Effect.either(validateGroupCreateEffect(s, participantId, rawName, columnId));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    const group: Group = {
      id: yield* deps.generateGroupId(),
      name: validation.right.name,
      columnId: validation.right.columnId,
      order: validation.right.order,
    };
    s.groups.push(group);
    yield* deps.saveAndBroadcastState(host, s);

    return { success: true, group };
  });
}

export async function editGroupForRoom(
  host: RoomCommandHost,
  participantId: string,
  groupId: string,
  rawName: string,
): Promise<{ success: boolean; error?: string; group?: Group }> {
  return Effect.runPromise(editGroupForRoomEffect(host, participantId, groupId, rawName));
}

export function editGroupForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  groupId: string,
  rawName: string,
): Effect.Effect<{ success: boolean; error?: string; group?: Group }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateGroupEditEffect(s, participantId, groupId, rawName));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.groups = validation.right.groups;
    yield* saveAndBroadcastStateEffect(host, s);
    return { success: true, group: validation.right.group };
  });
}

export async function deleteGroupForRoom(
  host: RoomCommandHost,
  participantId: string,
  groupId: string,
): Promise<{ success: boolean; error?: string }> {
  return Effect.runPromise(deleteGroupForRoomEffect(host, participantId, groupId));
}

export function deleteGroupForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  groupId: string,
): Effect.Effect<{ success: boolean; error?: string }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateGroupDeleteEffect(s, participantId, groupId));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.groups = validation.right.groups;
    s.items = validation.right.items;
    s.votes = validation.right.votes;
    s.pairwiseChoices = normalizePairwiseChoices(s.pairwiseChoices, s.participants, s.groups, s.items);
    s.reactions = (s.reactions ?? []).filter((reaction) => !sameVoteTarget(reaction.target, groupVoteTarget(groupId)));
    yield* saveAndBroadcastStateEffect(host, s);
    return { success: true };
  });
}

export async function reorderGroupsForRoom(
  host: RoomCommandHost,
  participantId: string,
  orderedIds: unknown,
  expectedVersion?: unknown,
): Promise<{ success: boolean; error?: string }> {
  return Effect.runPromise(reorderGroupsForRoomEffect(host, participantId, orderedIds, expectedVersion));
}

export function reorderGroupsForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  orderedIds: unknown,
  expectedVersion?: unknown,
): Effect.Effect<{ success: boolean; error?: string }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateGroupReorderEffect(s, participantId, orderedIds, expectedVersion));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.groups = validation.right.groups;
    yield* saveAndBroadcastStateEffect(host, s);
    return { success: true };
  });
}

export async function reorderItemsForRoom(
  host: RoomCommandHost,
  participantId: string,
  orderedIds: unknown,
  preconditions?: Partial<ItemReorderPreconditions>,
): Promise<{ success: boolean; error?: string }> {
  return Effect.runPromise(reorderItemsForRoomEffect(host, participantId, orderedIds, preconditions));
}

export function reorderItemsForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  orderedIds: unknown,
  preconditions?: Partial<ItemReorderPreconditions>,
): Effect.Effect<{ success: boolean; error?: string }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateItemReorderEffect(s, participantId, orderedIds, preconditions));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.items = validation.right.items;

    host.broadcast({ type: "items-reordered", items: s.items });
    yield* saveAndBroadcastStateEffect(host, s);

    return { success: true };
  });
}

export async function moveItemToGroupForRoom(
  host: RoomCommandHost,
  participantId: string,
  itemId: string,
  targetGroupId: string | null,
  targetIndex: number,
  preconditions?: Partial<MoveItemPreconditions>,
): Promise<{ success: boolean; error?: string }> {
  return Effect.runPromise(moveItemToGroupForRoomEffect(
    host,
    participantId,
    itemId,
    targetGroupId,
    targetIndex,
    preconditions,
  ));
}

export function moveItemToGroupForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  itemId: string,
  targetGroupId: string | null,
  targetIndex: number,
  preconditions?: Partial<MoveItemPreconditions>,
): Effect.Effect<{ success: boolean; error?: string }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateItemMoveEffect(
      s,
      participantId,
      itemId,
      targetGroupId,
      targetIndex,
      preconditions,
    ));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.items = validation.right.items;
    yield* saveAndBroadcastStateEffect(host, s);

    return { success: true };
  });
}
