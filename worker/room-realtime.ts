import { Effect } from "effect";
import type {
  ClientToServerMessage,
  Phase,
  ReactionTarget,
  VoteTarget,
} from "../src/domain";
import { groupVoteTarget, itemVoteTarget } from "../src/domain";
import type {
  ItemReorderPreconditions,
  MoveItemPreconditions,
} from "./room-types";

type RoomCommandResult = { success: boolean; error?: string };
type RoomResult = Promise<RoomCommandResult>;

export class RealtimeVoteTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealtimeVoteTargetError";
  }
}

export interface RoomRealtimeController {
  join(participantId: string, displayName: string): RoomResult;
  addItem(participantId: string, text: string, columnId?: unknown): RoomResult;
  editItem(participantId: string, itemId: string, text: string): RoomResult;
  deleteItem(participantId: string, itemId: string): RoomResult;
  setVoteBudget(participantId: string, budget: number): RoomResult;
  setRankingMethod(
    participantId: string,
    rankingMethod: "score" | "pairwise",
  ): RoomResult;
  setPhase(participantId: string, phase: Phase): RoomResult;
  createGroup(
    participantId: string,
    name: string,
    columnId?: string,
  ): RoomResult;
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
  reorderGroups(
    participantId: string,
    orderedIds: unknown,
    expectedVersion?: unknown,
  ): RoomResult;
  moveItemToGroup(
    participantId: string,
    itemId: string,
    groupId: string | null,
    index?: unknown,
    preconditions?: Partial<MoveItemPreconditions>,
  ): RoomResult;
  setTimer(participantId: string, durationSeconds: number): RoomResult;
  setReviewTarget(
    participantId: string,
    reviewTargetKey: string | null,
  ): RoomResult;
  castVote(
    participantId: string,
    target: VoteTarget,
    count: number,
  ): RoomResult;
  removeVote(participantId: string, target: VoteTarget): RoomResult;
  choosePairwise(
    participantId: string,
    winner: VoteTarget,
    loser: VoteTarget,
  ): RoomResult;
  toggleReaction(
    participantId: string,
    target: ReactionTarget,
    emoji: string,
  ): RoomResult;
  createAction(participantId: string, text: string): RoomResult;
  editAction(participantId: string, actionId: string, text: string): RoomResult;
  deleteAction(participantId: string, actionId: string): RoomResult;
  sendParticipantError(participantId: string, message: string): void;
}

export interface RoomRealtimeDeps {
  runRoomResult(
    room: RoomRealtimeController,
    participantId: string,
    run: () => RoomResult,
  ): Effect.Effect<RoomCommandResult>;
  sendParticipantError(
    room: RoomRealtimeController,
    participantId: string,
    message: string,
  ): Effect.Effect<void>;
  join(
    room: RoomRealtimeController,
    participantId: string,
    displayName: string,
  ): Effect.Effect<RoomCommandResult>;
}

export const roomRealtimeDeps: RoomRealtimeDeps = {
  runRoomResult: (_room, _participantId, run) => Effect.promise(run),
  sendParticipantError: (room, participantId, message) =>
    Effect.sync(() => room.sendParticipantError(participantId, message)),
  join: (room, participantId, displayName) =>
    Effect.promise(() => room.join(participantId, displayName)),
};

function parseVoteTargetMessage(
  msg: Extract<ClientToServerMessage, { type: "cast-vote" | "remove-vote" }>,
): { success: true; target: VoteTarget } | { success: false; error: string } {
  const hasGroupId = Object.prototype.hasOwnProperty.call(msg, "groupId");
  const hasItemId = Object.prototype.hasOwnProperty.call(msg, "itemId");
  if (hasGroupId && hasItemId) {
    return {
      success: false,
      error: "Vote target must specify exactly one target",
    };
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

export function parseVoteTargetMessageEffect(
  msg: Extract<ClientToServerMessage, { type: "cast-vote" | "remove-vote" }>,
): Effect.Effect<VoteTarget, RealtimeVoteTargetError> {
  return Effect.gen(function* () {
    const parsed = parseVoteTargetMessage(msg);
    if (!parsed.success) {
      return yield* Effect.fail(new RealtimeVoteTargetError(parsed.error));
    }
    return parsed.target;
  });
}

export async function handleRoomRealtimeMessage(
  room: RoomRealtimeController,
  participantId: string,
  msg: ClientToServerMessage,
): Promise<void> {
  return Effect.runPromise(
    handleRoomRealtimeMessageEffect(room, participantId, msg),
  );
}

function reportFailedResultEffect(
  room: RoomRealtimeController,
  participantId: string,
  result: RoomCommandResult,
  deps: RoomRealtimeDeps,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (!result.success) {
      yield* deps.sendParticipantError(
        room,
        participantId,
        result.error ?? "Request failed",
      );
    }
  });
}

function runRoomResultEffect(
  room: RoomRealtimeController,
  participantId: string,
  run: () => RoomResult,
  deps: RoomRealtimeDeps,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const result = yield* deps.runRoomResult(room, participantId, run);
    yield* reportFailedResultEffect(room, participantId, result, deps);
  });
}

export function handleRoomRealtimeMessageEffect(
  room: RoomRealtimeController,
  participantId: string,
  msg: ClientToServerMessage,
  deps: RoomRealtimeDeps = roomRealtimeDeps,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    switch (msg.type) {
      case "join": {
        const result = yield* deps.join(room, participantId, msg.displayName);
        yield* reportFailedResultEffect(room, participantId, result, deps);
        return;
      }
      case "add-item":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.addItem(participantId, msg.text, msg.columnId ?? null),
          deps,
        );
      case "edit-item":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.editItem(participantId, msg.itemId, msg.text),
          deps,
        );
      case "delete-item":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.deleteItem(participantId, msg.itemId),
          deps,
        );
      case "set-vote-budget":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.setVoteBudget(participantId, msg.budget),
          deps,
        );
      case "set-ranking-method":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.setRankingMethod(participantId, msg.rankingMethod),
          deps,
        );
      case "set-phase":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.setPhase(participantId, msg.phase),
          deps,
        );
      case "create-group":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.createGroup(participantId, msg.name, msg.columnId),
          deps,
        );
      case "edit-group":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.editGroup(participantId, msg.groupId, msg.name),
          deps,
        );
      case "delete-group":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.deleteGroup(participantId, msg.groupId),
          deps,
        );
      case "create-column":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.createColumn(participantId, msg.name),
          deps,
        );
      case "edit-column":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.editColumn(participantId, msg.columnId, msg.name),
          deps,
        );
      case "reorder-columns":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.reorderColumns(participantId, msg.columnIds),
          deps,
        );
      case "delete-column":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.deleteColumn(participantId, msg.columnId),
          deps,
        );
      case "reorder-items":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () =>
            room.reorderItems(participantId, msg.itemIds, {
              expectedVersion: msg.expectedVersion,
              sourceColumnId: msg.sourceColumnId,
              sourceGroupId: msg.sourceGroupId,
            }),
          deps,
        );
      case "reorder-groups":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () =>
            room.reorderGroups(
              participantId,
              msg.groupIds,
              msg.expectedVersion,
            ),
          deps,
        );
      case "move-item-to-group":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () =>
            room.moveItemToGroup(
              participantId,
              msg.itemId,
              msg.groupId,
              msg.index,
              {
                expectedVersion: msg.expectedVersion,
                sourceGroupId: msg.sourceGroupId,
                sourceIndex: msg.sourceIndex,
              },
            ),
          deps,
        );
      case "set-timer":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.setTimer(participantId, msg.durationSeconds),
          deps,
        );
      case "set-review-target":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.setReviewTarget(participantId, msg.reviewTargetKey),
          deps,
        );
      case "cast-vote": {
        const target = yield* Effect.either(parseVoteTargetMessageEffect(msg));
        if (target._tag === "Left") {
          return yield* reportFailedResultEffect(
            room,
            participantId,
            { success: false, error: target.left.message },
            deps,
          );
        }
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.castVote(participantId, target.right, msg.count),
          deps,
        );
      }
      case "remove-vote": {
        const target = yield* Effect.either(parseVoteTargetMessageEffect(msg));
        if (target._tag === "Left") {
          return yield* reportFailedResultEffect(
            room,
            participantId,
            { success: false, error: target.left.message },
            deps,
          );
        }
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.removeVote(participantId, target.right),
          deps,
        );
      }
      case "choose-pairwise":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.choosePairwise(participantId, msg.winner, msg.loser),
          deps,
        );
      case "toggle-reaction":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.toggleReaction(participantId, msg.target, msg.emoji),
          deps,
        );
      case "create-action":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.createAction(participantId, msg.text),
          deps,
        );
      case "edit-action":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.editAction(participantId, msg.actionId, msg.text),
          deps,
        );
      case "delete-action":
        return yield* runRoomResultEffect(
          room,
          participantId,
          () => room.deleteAction(participantId, msg.actionId),
          deps,
        );
      default:
        return;
    }
  });
}
