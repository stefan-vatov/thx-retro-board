import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyRoomLoadError,
  classifyRoomLoadErrorEffect,
  clearStoredIdentityEffect,
  formatElapsedTime,
  formatElapsedTimeEffect,
  getFacilitatorClaimTokenEffect,
  getStoredIdentityEffect,
  mergeRoomState,
  mergeRoomStateEffect,
  runRoomMutationWithRefreshEffect,
} from "./room-session";
import { ApiError } from "../api";
import type { RoomState } from "../domain";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
  } as Storage;
}

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
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorage());
    vi.stubGlobal("sessionStorage", createStorage());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the newest room snapshot", () => {
    expect(mergeRoomState(null, roomState(1))?.version).toBe(1);
    expect(mergeRoomState(roomState(2), null)?.version).toBe(2);
    expect(mergeRoomState(roomState(2), roomState(1))?.version).toBe(2);
    expect(mergeRoomState(roomState(1), roomState(2))?.version).toBe(2);
  });

  it("keeps the newest room snapshot through Effect", async () => {
    await expect(
      Effect.runPromise(mergeRoomStateEffect(roomState(1), roomState(2))),
    ).resolves.toMatchObject({
      version: 2,
    });
  });

  it("formats elapsed retro time", () => {
    expect(formatElapsedTime(0)).toBe("0:00");
    expect(formatElapsedTime(65_000)).toBe("1:05");
    expect(formatElapsedTime(3_665_000)).toBe("1:01:05");
  });

  it("formats elapsed retro time through Effect", async () => {
    await expect(
      Effect.runPromise(formatElapsedTimeEffect(3_665_000)),
    ).resolves.toBe("1:01:05");
  });

  it("classifies unavailable rooms without leaking credentials", () => {
    const error = classifyRoomLoadError(new ApiError("boom", 500));

    expect(error.title).toBe("Room temporarily unavailable");
    expect(error.detail).not.toMatch(/token|credential/i);
  });

  it("classifies unavailable rooms through Effect", async () => {
    const error = await Effect.runPromise(
      classifyRoomLoadErrorEffect(new ApiError("boom", 500)),
    );

    expect(error.title).toBe("Room temporarily unavailable");
    expect(error.detail).not.toMatch(/token|credential/i);
  });

  it("reads and initializes stored identity through Effect", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("generated-id");

    await expect(
      Effect.runPromise(getStoredIdentityEffect("room-1")),
    ).resolves.toEqual({
      participantId: "generated-id",
      displayName: "",
      connectionToken: undefined,
    });
    expect(localStorage.getItem("retro-participant-room-1")).toBe(
      "generated-id",
    );

    localStorage.setItem("retro-name-room-1", "Alex");
    localStorage.setItem("retro-token-room-1", "token");
    await expect(
      Effect.runPromise(getStoredIdentityEffect("room-1")),
    ).resolves.toEqual({
      participantId: "generated-id",
      displayName: "Alex",
      connectionToken: "token",
    });
  });

  it("reads facilitator claims and clears identity storage through Effect", async () => {
    localStorage.setItem("retro-participant-room-1", "p1");
    localStorage.setItem("retro-name-room-1", "Alex");
    localStorage.setItem("retro-token-room-1", "token");
    sessionStorage.setItem("retro-facilitator-claim-room-1", "claim");

    await expect(
      Effect.runPromise(getFacilitatorClaimTokenEffect("room-1")),
    ).resolves.toBe("claim");
    await Effect.runPromise(clearStoredIdentityEffect("room-1"));

    expect(localStorage.getItem("retro-participant-room-1")).toBeNull();
    expect(localStorage.getItem("retro-name-room-1")).toBeNull();
    expect(localStorage.getItem("retro-token-room-1")).toBeNull();
    expect(sessionStorage.getItem("retro-facilitator-claim-room-1")).toBeNull();
  });

  it("runs successful room mutations and returns refreshed state through Effect", async () => {
    const result = await Effect.runPromise(
      runRoomMutationWithRefreshEffect(
        Effect.succeed({ success: true }),
        Effect.succeed(roomState(2)),
      ),
    );

    expect(result).toEqual({ success: true, state: roomState(2) });
  });

  it("keeps successful mutations successful when refresh fails", async () => {
    const result = await Effect.runPromise(
      runRoomMutationWithRefreshEffect(
        Effect.succeed({ success: true }),
        Effect.fail(new Error("offline")),
      ),
    );

    expect(result).toEqual({ success: true, state: null });
  });

  it("does not refresh failed room mutations", async () => {
    const result = await Effect.runPromise(
      runRoomMutationWithRefreshEffect(
        Effect.succeed({ success: false, error: "No permission" }),
        Effect.sync(() => {
          throw new Error("refresh should not run");
        }),
      ),
    );

    expect(result).toEqual({
      success: false,
      error: "No permission",
      state: null,
    });
  });
});
