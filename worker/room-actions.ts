import { Effect } from "effect";
import type { ActionItem } from "../src/domain";
import { createActionItem } from "../src/domain";
import { MAX_ACTIONS_PER_ROOM } from "./room-types";
import type { RoomCommandHost } from "./room-command-host";
import { validateReviewActionEffect } from "./validation";

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
    const validation = yield* Effect.either(validateReviewActionEffect(s, participantId, rawText));
    if (validation._tag === "Left") {
      const message = validation.left.message;
      return {
        success: false,
        error: message === "Cannot change actions outside review phase" ? "Cannot add actions outside review phase" : message,
      };
    }
    if ((s.actions ?? []).length >= MAX_ACTIONS_PER_ROOM) {
      return { success: false, error: `Rooms can have at most ${MAX_ACTIONS_PER_ROOM} actions` };
    }

    const action = createActionItem(crypto.randomUUID(), validation.right.text, participantId, (s.actions ?? []).length);
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
    const validation = yield* Effect.either(validateReviewActionEffect(s, participantId, rawText));
    if (validation._tag === "Left") {
      const message = validation.left.message;
      return {
        success: false,
        error: message === "Cannot change actions outside review phase" ? "Cannot edit actions outside review phase" : message,
      };
    }
    if (typeof actionId !== "string" || actionId.trim().length === 0) {
      return { success: false, error: "Action not found" };
    }

    const actionIndex = (s.actions ?? []).findIndex((action) => action.id === actionId);
    if (actionIndex === -1) {
      return { success: false, error: "Action not found" };
    }

    s.actions = [...(s.actions ?? [])];
    const existing = s.actions[actionIndex];
    if (!existing) {
      return { success: false, error: "Action not found" };
    }
    s.actions[actionIndex] = { ...existing, text: validation.right.text };
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

    if (s.phase !== "review") {
      return { success: false, error: "Cannot delete actions outside review phase" };
    }
    if (!s.participants.some((participant) => participant.id === participantId)) {
      return { success: false, error: "Participant not found" };
    }
    if (typeof actionId !== "string" || actionId.trim().length === 0) {
      return { success: false, error: "Action not found" };
    }

    const existing = s.actions ?? [];
    if (!existing.some((action) => action.id === actionId)) {
      return { success: false, error: "Action not found" };
    }

    s.actions = existing
      .filter((action) => action.id !== actionId)
      .sort((a, b) => a.order - b.order)
      .map((action, order) => ({ ...action, order }));
    yield* Effect.promise(() => host.saveState());

    host.broadcast({ type: "actions-changed", actions: s.actions });
    host.broadcastState(s);

    return { success: true };
  });
}
