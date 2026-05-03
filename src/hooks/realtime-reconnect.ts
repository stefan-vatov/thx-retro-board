import { Effect } from "effect";

export const INITIAL_RECONNECT_DELAY_MS = 750;
export const MAX_RECONNECT_DELAY_MS = 30_000;
export const MAX_RECONNECT_ATTEMPTS = 8;
export const STABLE_CONNECTION_RESET_MS = 5_000;
export const REALTIME_RECONNECT_PAUSED_MESSAGE =
  "Realtime reconnect paused after repeated failures. Refresh the room to try again.";

export type RealtimeReconnectPlan =
  | { type: "ignored" }
  | { type: "paused"; error: string }
  | { type: "schedule"; attempts: number; delay: number };

export type RealtimeReconnectPlanInput = {
  disposed: boolean;
  timerScheduled: boolean;
  reconnectAttempts: number;
  consumeAttempt?: boolean;
  requestedDelay?: number;
};

export function getRealtimeReconnectDelay(reconnectAttempts: number): number {
  return Math.min(
    MAX_RECONNECT_DELAY_MS,
    INITIAL_RECONNECT_DELAY_MS * 2 ** reconnectAttempts,
  );
}

export function canAttemptRealtimeReconnect(
  reconnectAttempts: number,
): boolean {
  return reconnectAttempts < MAX_RECONNECT_ATTEMPTS;
}

export function shouldResetRealtimeReconnectAttempts(
  openDurationMs: number,
): boolean {
  return openDurationMs >= STABLE_CONNECTION_RESET_MS;
}

export function planRealtimeReconnectEffect({
  disposed,
  timerScheduled,
  reconnectAttempts,
  consumeAttempt = true,
  requestedDelay,
}: RealtimeReconnectPlanInput): Effect.Effect<RealtimeReconnectPlan> {
  return Effect.sync(() => {
    if (disposed || timerScheduled) return { type: "ignored" as const };

    if (consumeAttempt && !canAttemptRealtimeReconnect(reconnectAttempts)) {
      return {
        type: "paused" as const,
        error: REALTIME_RECONNECT_PAUSED_MESSAGE,
      };
    }

    const attempts = consumeAttempt ? reconnectAttempts + 1 : reconnectAttempts;
    const delay =
      requestedDelay ?? getRealtimeReconnectDelay(reconnectAttempts);
    return { type: "schedule" as const, attempts, delay };
  });
}
