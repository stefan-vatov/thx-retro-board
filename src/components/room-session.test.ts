import { describe, expect, it } from "vitest";
import { classifyRoomLoadError, formatElapsedTime, mergeRoomState } from "./room-session";
import { ApiError } from "../api";
import type { RoomState } from "../domain";

function roomState(version: number): RoomState {
  return {
    schemaVersion: 2,
    roomId: "room-1",
    startedAt: 1000,
    purgeScheduledAt: null,
    phase: "setup",
    participants: [],
    items: [],
    columns: [],
    groups: [],
    votes: [],
    rankingMethod: "score",
    pairwiseChoices: [],
    pairwiseProgress: [],
    reviewTargetKey: null,
    actions: [],
    reactions: [],
    timer: { startedAt: null, durationSeconds: null, expired: false },
    voteBudget: 5,
    version,
  };
}

describe("room session helpers", () => {
  it("keeps the newest room snapshot", () => {
    expect(mergeRoomState(null, roomState(1))?.version).toBe(1);
    expect(mergeRoomState(roomState(2), null)?.version).toBe(2);
    expect(mergeRoomState(roomState(2), roomState(1))?.version).toBe(2);
    expect(mergeRoomState(roomState(1), roomState(2))?.version).toBe(2);
  });

  it("formats elapsed retro time", () => {
    expect(formatElapsedTime(0)).toBe("0:00");
    expect(formatElapsedTime(65_000)).toBe("1:05");
    expect(formatElapsedTime(3_665_000)).toBe("1:01:05");
  });

  it("classifies unavailable rooms without leaking credentials", () => {
    const error = classifyRoomLoadError(new ApiError("boom", 500));

    expect(error.title).toBe("Room temporarily unavailable");
    expect(error.detail).not.toMatch(/token|credential/i);
  });
});
