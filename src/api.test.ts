import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, getRoomState } from "./api";
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

    await expect(getRoomState("missing-room", "p1", "token")).rejects.toMatchObject({
      name: "ApiError",
      message: "Room not found",
      status: 404,
    } satisfies Partial<ApiError>);
  });

  it("preserves server failure status instead of treating it as not found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Nope" }, { status: 500 })));

    await expect(getRoomState("server-error", "p1", "token")).rejects.toMatchObject({
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

    await expect(getRoomState("ROOM123", "p1", "token")).rejects.toThrow(/networkerror/i);
    await expect(getRoomState("ROOM123", "p1", "token")).resolves.toEqual(roomState);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
