import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { saveAndBroadcastStateEffect } from "./room-command-effect";
import type { RoomCommandHost } from "./room-command-host";
import type { StoredState } from "./room-types";

describe("room command Effect helpers", () => {
  it("persists state before broadcasting it", async () => {
    const calls: string[] = [];
    const state = { roomId: "room-1" } as StoredState;
    const host = {
      saveState: vi.fn(async () => {
        calls.push("save");
      }),
      broadcastState: vi.fn(() => {
        calls.push("broadcast");
      }),
    } as unknown as RoomCommandHost;

    await Effect.runPromise(saveAndBroadcastStateEffect(host, state));

    expect(calls).toEqual(["save", "broadcast"]);
    expect(host.broadcastState).toHaveBeenCalledWith(state);
  });

  it("uses injected Effect dependencies in order", async () => {
    const calls: string[] = [];
    const state = { roomId: "room-1" } as StoredState;

    await Effect.runPromise(saveAndBroadcastStateEffect({} as RoomCommandHost, state, {
      saveState: () => Effect.sync(() => {
        calls.push("save");
      }),
      broadcastState: (_host, persistedState) => Effect.sync(() => {
        calls.push(`broadcast:${persistedState.roomId}`);
      }),
    }));

    expect(calls).toEqual(["save", "broadcast:room-1"]);
  });
});
