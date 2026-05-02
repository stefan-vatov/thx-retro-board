import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect, Exit } from "effect";
import { ApiError, createRoomEffect, getRoomStateEffect, runApiEffect } from "./api";
import type { RoomState } from "./domain";

const roomState: RoomState = {
  schemaVersion: 2,
  roomId: "ROOM123",
  startedAt: 1000,
  purgeScheduledAt: null,
  phase: "write",
  participants: [],
  columns: [],
  items: [],
  groups: [],
  votes: [],
  rankingMethod: "score",
  pairwiseChoices: [],
  pairwiseProgress: [],
  actions: [],
  reviewTargetKey: null,
  reactions: [],
  timer: { startedAt: null, durationSeconds: null, expired: false },
  voteBudget: 5,
  version: 1,
};

describe("getRoomState", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("classifies true missing rooms as 404 ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Room not found" }, { status: 404 })));

    await expect(runApiEffect(getRoomStateEffect("missing-room", "p1", "token"))).rejects.toMatchObject({
      name: "ApiError",
      message: "Room not found",
      status: 404,
    } satisfies Partial<ApiError>);
  });

  it("exposes an Effect-native room state request with typed ApiError failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Room not found" }, { status: 404 })));

    const exit = await Effect.runPromiseExit(getRoomStateEffect("missing-room", "p1", "token"));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("Room not found");
    }
  });

  it("rejects malformed room state payloads instead of trusting unknown JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      success: true,
      state: {
        roomId: "ROOM123",
        phase: "write",
      },
    })));

    await expect(runApiEffect(getRoomStateEffect("ROOM123", "p1", "token"))).rejects.toMatchObject({
      name: "ApiError",
      message: "Failed to parse room response",
    } satisfies Partial<ApiError>);
  });

  it("preserves server failure status instead of treating it as not found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Nope" }, { status: 500 })));

    await expect(runApiEffect(getRoomStateEffect("server-error", "p1", "token"))).rejects.toMatchObject({
      name: "ApiError",
      message: "Failed to load room",
      status: 500,
    } satisfies Partial<ApiError>);
  });

  it("allows retry recovery after a transient failed fetch", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("NetworkError when attempting to fetch resource."))
      .mockResolvedValueOnce(Response.json({ success: true, state: roomState }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runApiEffect(getRoomStateEffect("ROOM123", "p1", "token"))).rejects.toThrow(/networkerror/i);
    await expect(runApiEffect(getRoomStateEffect("ROOM123", "p1", "token"))).resolves.toEqual(roomState);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("createRoomEffect", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects malformed create-room responses instead of navigating to an invalid room", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ facilitatorClaimToken: "claim-only" })));

    await expect(runApiEffect(createRoomEffect("token"))).rejects.toMatchObject({
      name: "ApiError",
      message: "Failed to parse room response",
    } satisfies Partial<ApiError>);
  });
});
