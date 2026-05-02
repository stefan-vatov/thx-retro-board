import { Effect } from "effect";
import type { RetroItem, VoteTarget } from "../src/domain";
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
  const s = await host.loadState();
  let validated: { text: string; columnId: string; order: number };
  try {
    validated = await Effect.runPromise(validateWriteItemCreateEffect(s, participantId, rawText, columnId));
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Item validation failed",
    };
  }

  const item: RetroItem = {
    id: crypto.randomUUID(),
    text: validated.text,
    authorId: participantId,
    columnId: validated.columnId,
    groupId: null,
    order: validated.order,
  };
  s.items.push(item);
  await host.saveState();

  host.broadcast({ type: "item-added", item });
  host.broadcastState(s);

  return { success: true, item };
}

export async function editItemForRoom(
  host: RoomCommandHost,
  participantId: string,
  itemId: string,
  rawText: string,
): Promise<{ success: boolean; error?: string; item?: RetroItem }> {
  const s = await host.loadState();
  let validated: { item: RetroItem };
  try {
    validated = await Effect.runPromise(validateWriteItemEditEffect(s, participantId, itemId, rawText));
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Item validation failed",
    };
  }

  const item = validated.item;
  s.items = s.items.map((candidate) => candidate.id === itemId ? item : candidate);
  await host.saveState();
  host.broadcastState(s);
  return { success: true, item };
}

export async function deleteItemForRoom(
  host: RoomCommandHost,
  participantId: string,
  itemId: string,
): Promise<{ success: boolean; error?: string }> {
  const s = await host.loadState();
  let validated: { target: VoteTarget };
  try {
    validated = await Effect.runPromise(validateWriteItemDeleteEffect(s, participantId, itemId));
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Item validation failed",
    };
  }

  const target = validated.target;
  s.items = s.items
    .filter((item) => item.id !== itemId)
    .sort((a, b) => a.order - b.order)
    .map((item, _index, allItems) => ({
      ...item,
      order: allItems.filter((candidate) => candidate.columnId === item.columnId && candidate.groupId === item.groupId && candidate.order < item.order).length,
    }));
  s.votes = s.votes.filter((vote) => {
    const voteTarget = getVoteTarget(vote);
    return voteTarget === null || !sameVoteTarget(voteTarget, target);
  });
  s.pairwiseChoices = normalizePairwiseChoices(
    (s.pairwiseChoices ?? []).filter((choice) => !sameVoteTarget(choice.winner, target) && !sameVoteTarget(choice.loser, target)),
    s.participants,
    s.groups,
    s.items,
  );
  s.reactions = (s.reactions ?? []).filter((reaction) => !sameVoteTarget(reaction.target, target));

  await host.saveState();
  host.broadcastState(s);
  return { success: true };
}
