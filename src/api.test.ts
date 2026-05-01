import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, getRoomState } from "./api";
import type { RoomState } from "./domain";

const roomState: RoomState = {
  schemaVersion: 2,
  roomId: "ROOM123",
  startedAt: 1000,
  phase: "write",
  participants: [],
  columns: [],
  items: [],
  groups: [],
  votes: [],
  actions: [],
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

    await expect(getRoomState("missing-room")).rejects.toMatchObject({
      name: "ApiError",
      message: "Room not found",
      status: 404,
    } satisfies Partial<ApiError>);
  });

  it("preserves server failure status instead of treating it as not found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Nope" }, { status: 500 })));

    await expect(getRoomState("server-error")).rejects.toMatchObject({
      name: "ApiError",
      message: "Failed to load room",
      status: 500,
    } satisfies Partial<ApiError>);
  });

  it("allows retry recovery after a transient failed fetch", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("NetworkError when attempting to fetch resource."))
      .mockResolvedValueOnce(Response.json(roomState));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getRoomState("ROOM123")).rejects.toThrow(/networkerror/i);
    await expect(getRoomState("ROOM123")).resolves.toEqual(roomState);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
