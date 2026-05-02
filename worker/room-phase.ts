import { Effect } from "effect";
import type { Phase } from "../src/domain";
import { getDecisionTargetCount } from "./room-presenter";
import type { RoomCommandHost } from "./room-command-host";
import {
  validatePhaseChangeEffect,
  validateReviewTargetChangeEffect,
  validateTimerChangeEffect,
} from "./validation";

export async function setPhaseForRoom(
  host: RoomCommandHost,
  participantId: string,
  phase: Phase,
): Promise<{ success: boolean; error?: string }> {
  const s = await host.loadState();
  let validated: { phase: Phase };
  try {
    validated = await Effect.runPromise(validatePhaseChangeEffect(s, participantId, phase, getDecisionTargetCount(s)));
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Phase validation failed",
    };
  }

  s.phase = validated.phase;
  if (validated.phase === "vote") {
    s.votingParticipantIds = s.participants.map((participant) => participant.id);
  }
  s.timer = { startedAt: null, durationSeconds: null, expired: false };
  await host.saveState();

  host.broadcast({ type: "phase-changed", phase: validated.phase });
  host.broadcastState(s);

  return { success: true };
}

export async function setTimerForRoom(
  host: RoomCommandHost,
  participantId: string,
  durationSeconds: number,
  now = Date.now(),
): Promise<{ success: boolean; error?: string }> {
  const s = await host.loadState();
  let validated: { durationSeconds: number };
  try {
    validated = await Effect.runPromise(validateTimerChangeEffect(s, participantId, durationSeconds));
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Timer validation failed",
    };
  }

  s.timer = {
    startedAt: now,
    durationSeconds: validated.durationSeconds,
    expired: false,
  };
  await host.saveState();

  host.broadcast({ type: "timer-updated", timer: s.timer });
  host.broadcastState(s);

  return { success: true };
}

export async function setReviewTargetForRoom(
  host: RoomCommandHost,
  participantId: string,
  reviewTargetKey: string | null,
): Promise<{ success: boolean; error?: string }> {
  const s = await host.loadState();
  let validated: { reviewTargetKey: string | null };
  try {
    validated = await Effect.runPromise(validateReviewTargetChangeEffect(s, participantId, reviewTargetKey));
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Review target validation failed",
    };
  }

  s.reviewTargetKey = validated.reviewTargetKey;
  await host.saveState();
  host.broadcast({ type: "review-target-changed", reviewTargetKey: validated.reviewTargetKey });
  host.broadcastState(s);
  return { success: true };
}
