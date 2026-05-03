import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_ATTEMPTS,
  MAX_RECONNECT_DELAY_MS,
  REALTIME_RECONNECT_PAUSED_MESSAGE,
  canAttemptRealtimeReconnect,
  getRealtimeReconnectDelay,
  planRealtimeReconnectEffect,
  planRealtimeOnlineReconnectEffect,
  resolveRealtimeWebSocketUrlEffect,
  shouldResetRealtimeReconnectAttempts,
} from "./realtime-reconnect";

describe("realtime reconnect backoff", () => {
  it("uses capped exponential backoff for realtime reconnect attempts", () => {
    expect(getRealtimeReconnectDelay(0)).toBe(INITIAL_RECONNECT_DELAY_MS);
    expect(getRealtimeReconnectDelay(1)).toBe(INITIAL_RECONNECT_DELAY_MS * 2);
    expect(getRealtimeReconnectDelay(10)).toBe(MAX_RECONNECT_DELAY_MS);
  });

  it("stops retrying after the bounded reconnect attempt budget is exhausted", () => {
    expect(canAttemptRealtimeReconnect(MAX_RECONNECT_ATTEMPTS - 1)).toBe(true);
    expect(canAttemptRealtimeReconnect(MAX_RECONNECT_ATTEMPTS)).toBe(false);
  });

  it("does not reset the retry budget for short-lived websocket opens", () => {
    expect(shouldResetRealtimeReconnectAttempts(4_999)).toBe(false);
    expect(shouldResetRealtimeReconnectAttempts(5_000)).toBe(true);
  });
});

describe("planRealtimeReconnectEffect", () => {
  it("ignores reconnects after disposal or while a timer is already active", async () => {
    await expect(
      Effect.runPromise(
        planRealtimeReconnectEffect({
          disposed: true,
          timerScheduled: false,
          reconnectAttempts: 0,
        }),
      ),
    ).resolves.toEqual({ type: "ignored" });

    await expect(
      Effect.runPromise(
        planRealtimeReconnectEffect({
          disposed: false,
          timerScheduled: true,
          reconnectAttempts: 0,
        }),
      ),
    ).resolves.toEqual({ type: "ignored" });
  });

  it("returns a paused state when the retry budget is exhausted", async () => {
    await expect(
      Effect.runPromise(
        planRealtimeReconnectEffect({
          disposed: false,
          timerScheduled: false,
          reconnectAttempts: MAX_RECONNECT_ATTEMPTS,
        }),
      ),
    ).resolves.toEqual({
      type: "paused",
      error: REALTIME_RECONNECT_PAUSED_MESSAGE,
    });
  });

  it("schedules reconnects and increments attempts only when requested", async () => {
    await expect(
      Effect.runPromise(
        planRealtimeReconnectEffect({
          disposed: false,
          timerScheduled: false,
          reconnectAttempts: 2,
          requestedDelay: 100,
        }),
      ),
    ).resolves.toEqual({ type: "schedule", attempts: 3, delay: 100 });

    await expect(
      Effect.runPromise(
        planRealtimeReconnectEffect({
          disposed: false,
          timerScheduled: false,
          reconnectAttempts: 2,
          consumeAttempt: false,
        }),
      ),
    ).resolves.toEqual({
      type: "schedule",
      attempts: 2,
      delay: getRealtimeReconnectDelay(2),
    });
  });
});

describe("realtime connection boundary helpers", () => {
  it("builds the websocket URL from the current browser location", async () => {
    await expect(
      Effect.runPromise(
        resolveRealtimeWebSocketUrlEffect({
          protocol: "wss:",
          host: "retro.example.test",
          roomId: "room with spaces",
        }),
      ),
    ).resolves.toBe("wss://retro.example.test/api/rooms/room%20with%20spaces/ws");
  });

  it("plans online reconnects only when there is no open websocket", async () => {
    await expect(
      Effect.runPromise(
        planRealtimeOnlineReconnectEffect({
          readyState: 1,
          openReadyState: 1,
        }),
      ),
    ).resolves.toEqual({ type: "ignore" });

    await expect(
      Effect.runPromise(
        planRealtimeOnlineReconnectEffect({
          readyState: 3,
          openReadyState: 1,
        }),
      ),
    ).resolves.toEqual({ type: "schedule", delay: 0 });
  });
});
