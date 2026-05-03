import { Effect } from "effect";
import type { ActionItem } from "../src/domain";
import { createActionItem } from "../src/domain";
import type { RoomCommandHost } from "./room-command-host";
import {
  validateReviewActionCreateEffect,
  validateReviewActionDeleteEffect,
  validateReviewActionEditEffect,
} from "./validation";

export async function createActionForRoom(
  host: RoomCommandHost,
  participantId: string,
  rawText: string,
): Promise<{ success: boolean; error?: string; action?: ActionItem }> {
  return Effect.runPromise(createActionForRoomEffect(host, participantId, rawText));
}

export function createActionForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  rawText: string,
): Effect.Effect<{ success: boolean; error?: string; action?: ActionItem }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateReviewActionCreateEffect(s, participantId, rawText));
    if (validation._tag === "Left") {
      const message = validation.left.message;
      return {
        success: false,
        error: message === "Cannot change actions outside review phase" ? "Cannot add actions outside review phase" : message,
      };
    }
    const action = createActionItem(crypto.randomUUID(), validation.right.text, participantId, validation.right.order);
    s.actions = [...(s.actions ?? []), action];
    yield* Effect.promise(() => host.saveState());

    host.broadcast({ type: "actions-changed", actions: s.actions });
    host.broadcastState(s);

    return { success: true, action };
  });
}

export async function editActionForRoom(
  host: RoomCommandHost,
  participantId: string,
  actionId: string,
  rawText: string,
): Promise<{ success: boolean; error?: string; action?: ActionItem }> {
  return Effect.runPromise(editActionForRoomEffect(host, participantId, actionId, rawText));
}

export function editActionForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  actionId: string,
  rawText: string,
): Effect.Effect<{ success: boolean; error?: string; action?: ActionItem }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateReviewActionEditEffect(s, participantId, actionId, rawText));
    if (validation._tag === "Left") {
      const message = validation.left.message;
      return {
        success: false,
        error: message === "Cannot change actions outside review phase" ? "Cannot edit actions outside review phase" : message,
      };
    }

    const actionIndex = (s.actions ?? []).findIndex((action) => action.id === validation.right.action.id);
    s.actions = [...(s.actions ?? [])];
    s.actions[actionIndex] = validation.right.action;
    yield* Effect.promise(() => host.saveState());

    host.broadcast({ type: "actions-changed", actions: s.actions });
    host.broadcastState(s);

    return { success: true, action: s.actions[actionIndex] };
  });
}

export async function deleteActionForRoom(
  host: RoomCommandHost,
  participantId: string,
  actionId: string,
): Promise<{ success: boolean; error?: string }> {
  return Effect.runPromise(deleteActionForRoomEffect(host, participantId, actionId));
}

export function deleteActionForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  actionId: string,
): Effect.Effect<{ success: boolean; error?: string }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());

    const validation = yield* Effect.either(validateReviewActionDeleteEffect(s, participantId, actionId));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.actions = (s.actions ?? [])
      .filter((action) => action.id !== validation.right.actionId)
      .sort((a, b) => a.order - b.order)
      .map((action, order) => ({ ...action, order }));
    yield* Effect.promise(() => host.saveState());

    host.broadcast({ type: "actions-changed", actions: s.actions });
    host.broadcastState(s);

    return { success: true };
  });
}
