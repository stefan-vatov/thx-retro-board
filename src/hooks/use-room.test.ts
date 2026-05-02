import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  canAttemptRealtimeReconnect,
  decodeRealtimeMessageEffect,
  getRealtimeReconnectDelay,
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_ATTEMPTS,
  MAX_RECONNECT_DELAY_MS,
  shouldResetRealtimeReconnectAttempts,
} from "./use-room";

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

describe("realtime message decoding", () => {
  it("decodes valid realtime error messages as an Effect", async () => {
    await expect(Effect.runPromise(decodeRealtimeMessageEffect(JSON.stringify({
      type: "error",
      message: "Nope",
    })))).resolves.toEqual({
      type: "error",
      message: "Nope",
    });
  });

  it("rejects malformed realtime snapshot payloads instead of trusting unknown JSON", async () => {
    const exit = await Effect.runPromiseExit(decodeRealtimeMessageEffect(JSON.stringify({
      type: "snapshot",
      state: {
        roomId: "ROOM123",
      },
    })));

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("rejects non-json websocket payloads as typed failures", async () => {
    const exit = await Effect.runPromiseExit(decodeRealtimeMessageEffect("{not json"));

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
