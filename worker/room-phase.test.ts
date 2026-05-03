import { describe, expect, it } from "vitest";

import type { ServerToClientMessage } from "../src/domain";
import { createInitialStoredState } from "./room-storage";
import {
  setPhaseForRoom,
  setPhaseForRoomEffect,
  setReviewTargetForRoom,
  setReviewTargetForRoomEffect,
  setTimerForRoom,
  setTimerForRoomEffect,
} from "./room-phase";
import { Effect } from "effect";

describe("room phase commands", () => {
  it("advances phase, resets timer, and records voting participants", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";
    state.timer = { startedAt: 1, durationSeconds: 60, expired: false };

    const broadcasts: ServerToClientMessage[] = [];
    const result = await setPhaseForRoom({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: (message) => broadcasts.push(message),
      broadcastState: () => {},
    }, "fac", "write");

    expect(result).toEqual({ success: true });
    expect(state.phase).toBe("write");
    expect(state.timer).toEqual({ startedAt: null, durationSeconds: null, expired: false });
    expect(broadcasts).toContainEqual({ type: "phase-changed", phase: "write" });
  });

  it("starts timers through the command host", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";

    const broadcasts: ServerToClientMessage[] = [];
    const result = await setTimerForRoom({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: (message) => broadcasts.push(message),
      broadcastState: () => {},
    }, "fac", 120, 1000);

    expect(result).toEqual({ success: true });
    expect(state.timer).toEqual({ startedAt: 1000, durationSeconds: 120, expired: false });
    expect(broadcasts).toContainEqual({ type: "timer-updated", timer: state.timer });
  });

  it("syncs review target changes", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "review";
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";

    const broadcasts: ServerToClientMessage[] = [];
    const result = await setReviewTargetForRoom({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: (message) => broadcasts.push(message),
      broadcastState: () => {},
    }, "fac", null);

    expect(result).toEqual({ success: true });
    expect(state.reviewTargetKey).toBeNull();
    expect(broadcasts).toContainEqual({ type: "review-target-changed", reviewTargetKey: null });
  });

  it("exposes Effect-native phase, timer, and review target commands", async () => {
    const state = createInitialStoredState("room-effect-phase");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";
    const host = {
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    };

    await expect(Effect.runPromise(setPhaseForRoomEffect(host, "fac", "write"))).resolves.toEqual({ success: true });
    expect(state.phase).toBe("write");
    await expect(Effect.runPromise(setTimerForRoomEffect(host, "fac", 90, 2000))).resolves.toEqual({ success: true });
    expect(state.timer).toEqual({ startedAt: 2000, durationSeconds: 90, expired: false });
    state.phase = "review";
    await expect(Effect.runPromise(setReviewTargetForRoomEffect(host, "fac", null))).resolves.toEqual({ success: true });
    expect(state.reviewTargetKey).toBeNull();
  });

  it("advances phase through injected Effect dependencies", async () => {
    const state = createInitialStoredState("room-effect-injected-phase");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";
    state.timer = { startedAt: 1, durationSeconds: 60, expired: false };
    const calls: string[] = [];

    const result = await Effect.runPromise(setPhaseForRoomEffect({} as never, "fac", "write", {
      loadState: () => Effect.sync(() => {
        calls.push("load");
        return state;
      }),
      broadcast: (_host, message) => Effect.sync(() => {
        calls.push(`broadcast:${message.type}`);
      }),
      saveAndBroadcastState: (_host, savedState) => Effect.sync(() => {
        calls.push(`save:${savedState.phase}`);
      }),
    }));

    expect(result).toEqual({ success: true });
    expect(state.phase).toBe("write");
    expect(calls).toEqual(["load", "broadcast:phase-changed", "save:write"]);
  });

  it("starts timers through injected Effect dependencies", async () => {
    const state = createInitialStoredState("room-effect-injected-timer");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";
    const calls: string[] = [];

    const result = await Effect.runPromise(setTimerForRoomEffect({} as never, "fac", 120, 1000, {
      loadState: () => Effect.sync(() => {
        calls.push("load");
        return state;
      }),
      broadcast: (_host, message) => Effect.sync(() => {
        calls.push(`broadcast:${message.type}`);
      }),
      saveAndBroadcastState: (_host, savedState) => Effect.sync(() => {
        calls.push(`save:${savedState.timer.startedAt}`);
      }),
    }));

    expect(result).toEqual({ success: true });
    expect(state.timer).toEqual({ startedAt: 1000, durationSeconds: 120, expired: false });
    expect(calls).toEqual(["load", "broadcast:timer-updated", "save:1000"]);
  });
});
