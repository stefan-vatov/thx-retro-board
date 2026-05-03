import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  cancelEmptyRoomPurgeEffect,
  getAbsoluteRoomExpiresAt,
  getAbsoluteRoomExpiresAtEffect,
  purgeIfExpiredEffect,
  runRoomAlarmEffect,
  scheduleEmptyRoomPurgeEffect,
} from "./room-lifecycle";
import { EMPTY_ROOM_PURGE_DELAY_MS, MAX_ROOM_LIFETIME_MS, type StoredState } from "./room-types";
import { createInitialStoredState } from "./room-storage";

function createState(startedAt = 1_000): StoredState {
  return createInitialStoredState("room-lifecycle", null, startedAt);
}

function createHost(state: StoredState | null, sessionCount = 0) {
  const calls: Array<[string, unknown?]> = [];
  const host = {
    getLoadedState: () => state,
    getSessionCount: () => sessionCount,
    getStoredState: () => Promise.resolve(state),
    loadState: () => {
      if (!state) throw new Error("missing state");
      return Promise.resolve(state);
    },
    saveState: () => {
      calls.push(["save"]);
      return Promise.resolve();
    },
    setAlarm: (timestamp: number) => {
      calls.push(["setAlarm", timestamp]);
      return Promise.resolve();
    },
    deleteAlarm: () => {
      calls.push(["deleteAlarm"]);
      return Promise.resolve();
    },
    purgeRoom: (reason: string) => {
      calls.push(["purgeRoom", reason]);
      state = null;
      return Promise.resolve();
    },
  };
  return { host, calls };
}

describe("room lifecycle effects", () => {
  it("calculates absolute expiry from room start", () => {
    expect(getAbsoluteRoomExpiresAt({ startedAt: 5_000 }, 10_000)).toBe(5_000 + MAX_ROOM_LIFETIME_MS);
    expect(getAbsoluteRoomExpiresAt({}, 10_000)).toBe(10_000 + MAX_ROOM_LIFETIME_MS);
  });

  it("calculates absolute expiry through an Effect boundary", async () => {
    await expect(Effect.runPromise(getAbsoluteRoomExpiresAtEffect({ startedAt: 5_000 }, 10_000)))
      .resolves.toBe(getAbsoluteRoomExpiresAt({ startedAt: 5_000 }, 10_000));
  });

  it("schedules empty-room purge and saves the purge timestamp", async () => {
    const state = createState(1_000);
    const { host, calls } = createHost(state, 0);

    await Effect.runPromise(scheduleEmptyRoomPurgeEffect(host, 20_000));

    expect(state.purgeScheduledAt).toBe(20_000 + EMPTY_ROOM_PURGE_DELAY_MS);
    expect(calls).toEqual([
      ["setAlarm", 20_000 + EMPTY_ROOM_PURGE_DELAY_MS],
      ["save"],
    ]);
  });

  it("keeps active rooms alive until absolute expiry", async () => {
    const state = createState(1_000);
    const { host, calls } = createHost(state, 2);

    await Effect.runPromise(scheduleEmptyRoomPurgeEffect(host, 20_000));

    expect(state.purgeScheduledAt).toBeNull();
    expect(calls).toEqual([["setAlarm", 1_000 + MAX_ROOM_LIFETIME_MS]]);
  });

  it("cancels empty-room purge and restores the absolute expiry alarm", async () => {
    const state = createState(1_000);
    state.purgeScheduledAt = 30_000;
    const { host, calls } = createHost(state, 1);

    await Effect.runPromise(cancelEmptyRoomPurgeEffect(host, 20_000));

    expect(state.purgeScheduledAt).toBeNull();
    expect(calls).toEqual([
      ["deleteAlarm"],
      ["save"],
      ["setAlarm", 1_000 + MAX_ROOM_LIFETIME_MS],
    ]);
  });

  it("purges expired rooms before serving them", async () => {
    const state = createState(1_000);
    const { host, calls } = createHost(state, 0);

    const purged = await Effect.runPromise(purgeIfExpiredEffect(host, null, 1_000 + MAX_ROOM_LIFETIME_MS));

    expect(purged).toBe(true);
    expect(calls).toEqual([["purgeRoom", "Room data was deleted after reaching the maximum room lifetime."]]);
  });

  it("runs the empty-room alarm only once the scheduled purge time is due", async () => {
    const state = createState(1_000);
    state.purgeScheduledAt = 30_000;
    const { host, calls } = createHost(state, 0);

    await Effect.runPromise(runRoomAlarmEffect(host, 29_999));
    expect(calls).toEqual([]);

    await Effect.runPromise(runRoomAlarmEffect(host, 30_000));
    expect(calls).toEqual([["purgeRoom", "Room data was deleted after one hour without active participants."]]);
  });

  it("cancels stale empty-room alarms when participants are active", async () => {
    const state = createState(1_000);
    state.purgeScheduledAt = 30_000;
    const { host, calls } = createHost(state, 1);

    await Effect.runPromise(runRoomAlarmEffect(host, 30_000));

    expect(state.purgeScheduledAt).toBeNull();
    expect(calls).toEqual([
      ["deleteAlarm"],
      ["save"],
      ["setAlarm", 1_000 + MAX_ROOM_LIFETIME_MS],
    ]);
  });
});
