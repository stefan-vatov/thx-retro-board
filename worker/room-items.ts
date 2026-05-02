import { Effect } from "effect";
import type { RetroItem } from "../src/domain";
import { getVoteTarget, sameVoteTarget } from "../src/domain";
import type { RoomCommandHost } from "./room-command-host";
import { normalizePairwiseChoices } from "./room-normalize";
import {
  validateWriteItemCreateEffect,
  validateWriteItemDeleteEffect,
  validateWriteItemEditEffect,
} from "./validation";

export async function addItemForRoom(
  host: RoomCommandHost,
  participantId: string,
  rawText: string,
  columnId?: unknown,
): Promise<{ success: boolean; error?: string; item?: RetroItem }> {
  return Effect.runPromise(addItemForRoomEffect(host, participantId, rawText, columnId));
}

export function addItemForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  rawText: string,
  columnId?: unknown,
): Effect.Effect<{ success: boolean; error?: string; item?: RetroItem }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateWriteItemCreateEffect(s, participantId, rawText, columnId));
    if (validation._tag === "Left") {
      return {
        success: false,
        error: validation.left.message,
      };
    }

    const item: RetroItem = {
      id: crypto.randomUUID(),
      text: validation.right.text,
      authorId: participantId,
      columnId: validation.right.columnId,
      groupId: null,
      order: validation.right.order,
    };
    s.items.push(item);
    yield* Effect.promise(() => host.saveState());

    host.broadcast({ type: "item-added", item });
    host.broadcastState(s);

    return { success: true, item };
  });
}

export async function editItemForRoom(
  host: RoomCommandHost,
  participantId: string,
  itemId: string,
  rawText: string,
): Promise<{ success: boolean; error?: string; item?: RetroItem }> {
  return Effect.runPromise(editItemForRoomEffect(host, participantId, itemId, rawText));
}

export function editItemForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  itemId: string,
  rawText: string,
): Effect.Effect<{ success: boolean; error?: string; item?: RetroItem }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateWriteItemEditEffect(s, participantId, itemId, rawText));
    if (validation._tag === "Left") {
      return {
        success: false,
        error: validation.left.message,
      };
    }

    const item = validation.right.item;
    s.items = s.items.map((candidate) => candidate.id === itemId ? item : candidate);
    yield* Effect.promise(() => host.saveState());
    host.broadcastState(s);
    return { success: true, item };
  });
}

export async function deleteItemForRoom(
  host: RoomCommandHost,
  participantId: string,
  itemId: string,
): Promise<{ success: boolean; error?: string }> {
  return Effect.runPromise(deleteItemForRoomEffect(host, participantId, itemId));
}

export function deleteItemForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  itemId: string,
): Effect.Effect<{ success: boolean; error?: string }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateWriteItemDeleteEffect(s, participantId, itemId));
    if (validation._tag === "Left") {
      return {
        success: false,
        error: validation.left.message,
      };
    }

    const target = validation.right.target;
    s.items = s.items
      .filter((item) => item.id !== itemId)
      .sort((a, b) => a.order - b.order)
      .map((item, _index, allItems) => ({
        ...item,
        order: allItems.filter((candidate) =>
          candidate.columnId === item.columnId && candidate.groupId === item.groupId && candidate.order < item.order
        ).length,
      }));
    s.votes = s.votes.filter((vote) => {
      const voteTarget = getVoteTarget(vote);
      return voteTarget === null || !sameVoteTarget(voteTarget, target);
    });
    s.pairwiseChoices = normalizePairwiseChoices(
      (s.pairwiseChoices ?? []).filter((choice) =>
        !sameVoteTarget(choice.winner, target) && !sameVoteTarget(choice.loser, target)
      ),
      s.participants,
      s.groups,
      s.items,
    );
    s.reactions = (s.reactions ?? []).filter((reaction) => !sameVoteTarget(reaction.target, target));

    yield* Effect.promise(() => host.saveState());
    host.broadcastState(s);
    return { success: true };
  });
}
