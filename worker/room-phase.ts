import { Effect } from "effect";
import type { Phase, ServerToClientMessage } from "../src/domain";
import { saveAndBroadcastStateEffect } from "./room-command-effect";
import { getDecisionTargetCountEffect } from "./room-presenter";
import type { RoomCommandHost } from "./room-command-host";
import type { StoredState } from "./room-types";
import {
  validatePhaseChangeEffect,
  validateReviewTargetChangeEffect,
  validateTimerChangeEffect,
} from "./validation";

export interface SetPhaseForRoomDeps {
  loadState: (host: RoomCommandHost) => Effect.Effect<StoredState>;
  broadcast: (host: RoomCommandHost, message: ServerToClientMessage) => Effect.Effect<void>;
  saveAndBroadcastState: (host: RoomCommandHost, state: StoredState) => Effect.Effect<void>;
}

export const setPhaseForRoomDeps: SetPhaseForRoomDeps = {
  loadState: (host) => Effect.promise(() => host.loadState()),
  broadcast: (host, message) => Effect.sync(() => host.broadcast(message)),
  saveAndBroadcastState: saveAndBroadcastStateEffect,
};

export async function setPhaseForRoom(
  host: RoomCommandHost,
  participantId: string,
  phase: Phase,
): Promise<{ success: boolean; error?: string }> {
  return Effect.runPromise(setPhaseForRoomEffect(host, participantId, phase));
}

export function setPhaseForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  phase: Phase,
  deps: SetPhaseForRoomDeps = setPhaseForRoomDeps,
): Effect.Effect<{ success: boolean; error?: string }> {
  return Effect.gen(function* () {
    const s = yield* deps.loadState(host);
    const decisionTargetCount = yield* getDecisionTargetCountEffect(s);
    const validation = yield* Effect.either(validatePhaseChangeEffect(s, participantId, phase, decisionTargetCount));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.phase = validation.right.phase;
    if (validation.right.phase === "vote") {
      s.votingParticipantIds = s.participants.map((participant) => participant.id);
    }
    s.timer = { startedAt: null, durationSeconds: null, expired: false };

    yield* deps.broadcast(host, { type: "phase-changed", phase: validation.right.phase });
    yield* deps.saveAndBroadcastState(host, s);

    return { success: true };
  });
}

export async function setTimerForRoom(
  host: RoomCommandHost,
  participantId: string,
  durationSeconds: number,
  now = Date.now(),
): Promise<{ success: boolean; error?: string }> {
  return Effect.runPromise(setTimerForRoomEffect(host, participantId, durationSeconds, now));
}

export function setTimerForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  durationSeconds: number,
  now = Date.now(),
): Effect.Effect<{ success: boolean; error?: string }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateTimerChangeEffect(s, participantId, durationSeconds));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.timer = {
      startedAt: now,
      durationSeconds: validation.right.durationSeconds,
      expired: false,
    };

    host.broadcast({ type: "timer-updated", timer: s.timer });
    yield* saveAndBroadcastStateEffect(host, s);

    return { success: true };
  });
}

export async function setReviewTargetForRoom(
  host: RoomCommandHost,
  participantId: string,
  reviewTargetKey: string | null,
): Promise<{ success: boolean; error?: string }> {
  return Effect.runPromise(setReviewTargetForRoomEffect(host, participantId, reviewTargetKey));
}

export function setReviewTargetForRoomEffect(
  host: RoomCommandHost,
  participantId: string,
  reviewTargetKey: string | null,
): Effect.Effect<{ success: boolean; error?: string }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const validation = yield* Effect.either(validateReviewTargetChangeEffect(s, participantId, reviewTargetKey));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.reviewTargetKey = validation.right.reviewTargetKey;
    host.broadcast({ type: "review-target-changed", reviewTargetKey: validation.right.reviewTargetKey });
    yield* saveAndBroadcastStateEffect(host, s);
    return { success: true };
  });
}
