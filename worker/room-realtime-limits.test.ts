import { describe, expect, it } from "vitest";

import { RoomRealtimeLimiter } from "./room-realtime-limits";
import {
  MAX_ROOM_WEBSOCKET_MESSAGES_PER_WINDOW,
  MAX_WEBSOCKET_MESSAGES_PER_WINDOW,
  WEBSOCKET_RATE_WINDOW_MS,
} from "./room-types";

describe("room realtime limiter", () => {
  it("limits each participant inside a rolling window", () => {
    const limiter = new RoomRealtimeLimiter();

    for (let index = 0; index < MAX_WEBSOCKET_MESSAGES_PER_WINDOW; index += 1) {
      expect(limiter.allow("participant-a", 1000)).toEqual({ allowed: true });
    }

    expect(limiter.allow("participant-a", 1000)).toMatchObject({ allowed: false });
    expect(limiter.allow("participant-a", 1000 + WEBSOCKET_RATE_WINDOW_MS)).toEqual({ allowed: true });
  });

  it("limits aggregate room traffic independently from participant traffic", () => {
    const limiter = new RoomRealtimeLimiter();

    for (let index = 0; index < MAX_ROOM_WEBSOCKET_MESSAGES_PER_WINDOW; index += 1) {
      expect(limiter.allow(`participant-${index}`, 1000)).toEqual({ allowed: true });
    }

    expect(limiter.allow("participant-over-room-limit", 1000)).toMatchObject({ allowed: false });
  });
});
