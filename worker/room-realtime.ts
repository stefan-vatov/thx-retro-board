import { Effect } from "effect";
import type { ClientToServerMessage, Phase, ReactionTarget, VoteTarget } from "../src/domain";
import { groupVoteTarget, itemVoteTarget } from "../src/domain";
import type { ItemReorderPreconditions, MoveItemPreconditions } from "./room-types";

type RoomResult = Promise<{ success: boolean; error?: string }>;

export interface RoomRealtimeController {
  join(participantId: string, displayName: string): RoomResult;
  addItem(participantId: string, text: string, columnId?: unknown): RoomResult;
  editItem(participantId: string, itemId: string, text: string): RoomResult;
  deleteItem(participantId: string, itemId: string): RoomResult;
  setVoteBudget(participantId: string, budget: number): RoomResult;
  setRankingMethod(participantId: string, rankingMethod: "score" | "pairwise"): RoomResult;
  setPhase(participantId: string, phase: Phase): RoomResult;
  createGroup(participantId: string, name: string, columnId?: string): RoomResult;
  editGroup(participantId: string, groupId: string, name: string): RoomResult;
  deleteGroup(participantId: string, groupId: string): RoomResult;
  createColumn(participantId: string, name: string): RoomResult;
  editColumn(participantId: string, columnId: string, name: string): RoomResult;
  reorderColumns(participantId: string, orderedIds: unknown): RoomResult;
  deleteColumn(participantId: string, columnId: string): RoomResult;
  reorderItems(
    participantId: string,
    itemIds: unknown,
    preconditions?: Partial<ItemReorderPreconditions>,
  ): RoomResult;
  reorderGroups(participantId: string, orderedIds: unknown, expectedVersion?: unknown): RoomResult;
  moveItemToGroup(
    participantId: string,
    itemId: string,
    groupId: string | null,
    index?: unknown,
    preconditions?: Partial<MoveItemPreconditions>,
  ): RoomResult;
  setTimer(participantId: string, durationSeconds: number): RoomResult;
  setReviewTarget(participantId: string, reviewTargetKey: string | null): RoomResult;
  castVote(participantId: string, target: VoteTarget, count: number): RoomResult;
  removeVote(participantId: string, target: VoteTarget): RoomResult;
  choosePairwise(participantId: string, winner: VoteTarget, loser: VoteTarget): RoomResult;
  toggleReaction(participantId: string, target: ReactionTarget, emoji: string): RoomResult;
  createAction(participantId: string, text: string): RoomResult;
  editAction(participantId: string, actionId: string, text: string): RoomResult;
  deleteAction(participantId: string, actionId: string): RoomResult;
  sendParticipantError(participantId: string, message: string): void;
}

function parseVoteTargetMessage(
  msg: Extract<ClientToServerMessage, { type: "cast-vote" | "remove-vote" }>,
): { success: true; target: VoteTarget } | { success: false; error: string } {
  const hasGroupId = Object.prototype.hasOwnProperty.call(msg, "groupId");
  const hasItemId = Object.prototype.hasOwnProperty.call(msg, "itemId");
  if (hasGroupId && hasItemId) {
    return { success: false, error: "Vote target must specify exactly one target" };
  }
  if (hasGroupId) {
    return typeof msg.groupId === "string" && msg.groupId.trim().length > 0
      ? { success: true, target: groupVoteTarget(msg.groupId) }
      : { success: false, error: "Group not found" };
  }
  if (hasItemId) {
    return typeof msg.itemId === "string" && msg.itemId.trim().length > 0
      ? { success: true, target: itemVoteTarget(msg.itemId) }
      : { success: false, error: "Item not found" };
  }
  return { success: false, error: "Vote target is required" };
}

export async function handleRoomRealtimeMessage(
  room: RoomRealtimeController,
  participantId: string,
  msg: ClientToServerMessage,
): Promise<void> {
  return Effect.runPromise(handleRoomRealtimeMessageEffect(room, participantId, msg));
}

function reportFailedResultEffect(
  room: RoomRealtimeController,
  participantId: string,
  result: { success: boolean; error?: string },
): Effect.Effect<void> {
  return Effect.sync(() => {
    if (!result.success) {
      room.sendParticipantError(participantId, result.error ?? "Request failed");
    }
  });
}

function runRoomResultEffect(
  room: RoomRealtimeController,
  participantId: string,
  run: () => RoomResult,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const result = yield* Effect.promise(run);
    yield* reportFailedResultEffect(room, participantId, result);
  });
}

export function handleRoomRealtimeMessageEffect(
  room: RoomRealtimeController,
  participantId: string,
  msg: ClientToServerMessage,
): Effect.Effect<void> {
  return Effect.gen(function* () {
  switch (msg.type) {
    case "join":
      yield* Effect.promise(() => room.join(participantId, msg.displayName));
      return;
    case "add-item":
      return yield* runRoomResultEffect(room, participantId, () => room.addItem(participantId, msg.text, msg.columnId ?? null));
    case "edit-item":
      return yield* runRoomResultEffect(room, participantId, () => room.editItem(participantId, msg.itemId, msg.text));
    case "delete-item":
      return yield* runRoomResultEffect(room, participantId, () => room.deleteItem(participantId, msg.itemId));
    case "set-vote-budget":
      return yield* runRoomResultEffect(room, participantId, () => room.setVoteBudget(participantId, msg.budget));
    case "set-ranking-method":
      return yield* runRoomResultEffect(room, participantId, () => room.setRankingMethod(participantId, msg.rankingMethod));
    case "set-phase":
      return yield* runRoomResultEffect(room, participantId, () => room.setPhase(participantId, msg.phase));
    case "create-group":
      return yield* runRoomResultEffect(room, participantId, () => room.createGroup(participantId, msg.name, msg.columnId));
    case "edit-group":
      return yield* runRoomResultEffect(room, participantId, () => room.editGroup(participantId, msg.groupId, msg.name));
    case "delete-group":
      return yield* runRoomResultEffect(room, participantId, () => room.deleteGroup(participantId, msg.groupId));
    case "create-column":
      return yield* runRoomResultEffect(room, participantId, () => room.createColumn(participantId, msg.name));
    case "edit-column":
      return yield* runRoomResultEffect(room, participantId, () => room.editColumn(participantId, msg.columnId, msg.name));
    case "reorder-columns":
      return yield* runRoomResultEffect(room, participantId, () => room.reorderColumns(participantId, msg.columnIds));
    case "delete-column":
      return yield* runRoomResultEffect(room, participantId, () => room.deleteColumn(participantId, msg.columnId));
    case "reorder-items":
      return yield* runRoomResultEffect(room, participantId, () =>
        room.reorderItems(participantId, msg.itemIds, {
          expectedVersion: msg.expectedVersion,
          sourceColumnId: msg.sourceColumnId,
          sourceGroupId: msg.sourceGroupId,
        })
      );
    case "reorder-groups":
      return yield* runRoomResultEffect(room, participantId, () =>
        room.reorderGroups(participantId, msg.groupIds, msg.expectedVersion)
      );
    case "move-item-to-group":
      return yield* runRoomResultEffect(room, participantId, () =>
        room.moveItemToGroup(participantId, msg.itemId, msg.groupId, msg.index, {
          expectedVersion: msg.expectedVersion,
          sourceGroupId: msg.sourceGroupId,
          sourceIndex: msg.sourceIndex,
        })
      );
    case "set-timer":
      return yield* runRoomResultEffect(room, participantId, () => room.setTimer(participantId, msg.durationSeconds));
    case "set-review-target":
      return yield* runRoomResultEffect(room, participantId, () => room.setReviewTarget(participantId, msg.reviewTargetKey));
    case "cast-vote": {
      const target = parseVoteTargetMessage(msg);
      return yield* runRoomResultEffect(room, participantId, () =>
        target.success
          ? room.castVote(participantId, target.target, msg.count)
          : Promise.resolve({ success: false, error: target.error })
      );
    }
    case "remove-vote": {
      const target = parseVoteTargetMessage(msg);
      return yield* runRoomResultEffect(room, participantId, () =>
        target.success
          ? room.removeVote(participantId, target.target)
          : Promise.resolve({ success: false, error: target.error })
      );
    }
    case "choose-pairwise":
      return yield* runRoomResultEffect(room, participantId, () => room.choosePairwise(participantId, msg.winner, msg.loser));
    case "toggle-reaction":
      return yield* runRoomResultEffect(room, participantId, () => room.toggleReaction(participantId, msg.target, msg.emoji));
    case "create-action":
      return yield* runRoomResultEffect(room, participantId, () => room.createAction(participantId, msg.text));
    case "edit-action":
      return yield* runRoomResultEffect(room, participantId, () => room.editAction(participantId, msg.actionId, msg.text));
    case "delete-action":
      return yield* runRoomResultEffect(room, participantId, () => room.deleteAction(participantId, msg.actionId));
    default:
      return;
  }
  });
}
