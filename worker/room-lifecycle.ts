import { Effect } from "effect";
import {
  EMPTY_ROOM_PURGE_DELAY_MS,
  MAX_ROOM_LIFETIME_MS,
  type StoredState,
} from "./room-types";

const ABSOLUTE_EXPIRY_REASON = "Room data was deleted after reaching the maximum room lifetime.";
const EMPTY_ROOM_PURGE_REASON = "Room data was deleted after one hour without active participants.";

export interface RoomLifecycleHost {
  getLoadedState: () => StoredState | null;
  getSessionCount: () => number;
  getStoredState: () => Promise<StoredState | undefined | null>;
  loadState: () => Promise<StoredState>;
  saveState: () => Promise<void>;
  setAlarm: (timestamp: number) => Promise<void>;
  deleteAlarm: () => Promise<void>;
  purgeRoom: (reason: string) => Promise<void>;
}

export interface ScheduleEmptyRoomPurgeDeps {
  loadState: (host: RoomLifecycleHost) => Effect.Effect<StoredState>;
  getSessionCount: (host: RoomLifecycleHost) => Effect.Effect<number>;
  setAlarm: (host: RoomLifecycleHost, timestamp: number) => Effect.Effect<void>;
  saveState: (host: RoomLifecycleHost) => Effect.Effect<void>;
}

export const scheduleEmptyRoomPurgeDeps: ScheduleEmptyRoomPurgeDeps = {
  loadState: (host) => Effect.promise(() => host.loadState()),
  getSessionCount: (host) => Effect.sync(() => host.getSessionCount()),
  setAlarm: (host, timestamp) => Effect.promise(() => host.setAlarm(timestamp)),
  saveState: (host) => Effect.promise(() => host.saveState()),
};

export interface CancelEmptyRoomPurgeDeps {
  deleteAlarm: (host: RoomLifecycleHost) => Effect.Effect<void>;
  getLoadedState: (host: RoomLifecycleHost) => Effect.Effect<StoredState | null>;
  saveState: (host: RoomLifecycleHost) => Effect.Effect<void>;
  setAlarm: (host: RoomLifecycleHost, timestamp: number) => Effect.Effect<void>;
}

export const cancelEmptyRoomPurgeDeps: CancelEmptyRoomPurgeDeps = {
  deleteAlarm: (host) => Effect.promise(() => host.deleteAlarm()),
  getLoadedState: (host) => Effect.sync(() => host.getLoadedState()),
  saveState: (host) => Effect.promise(() => host.saveState()),
  setAlarm: (host, timestamp) => Effect.promise(() => host.setAlarm(timestamp)),
};

export interface PurgeIfExpiredDeps {
  getStoredState: (host: RoomLifecycleHost) => Effect.Effect<StoredState | undefined | null>;
  purgeRoom: (host: RoomLifecycleHost, reason: string) => Effect.Effect<void>;
}

export const purgeIfExpiredDeps: PurgeIfExpiredDeps = {
  getStoredState: (host) => Effect.promise(() => host.getStoredState()),
  purgeRoom: (host, reason) => Effect.promise(() => host.purgeRoom(reason)),
};

export interface RunRoomAlarmDeps {
  getStoredState: (host: RoomLifecycleHost) => Effect.Effect<StoredState | undefined | null>;
  purgeIfExpired: (host: RoomLifecycleHost, stored: StoredState, now: number) => Effect.Effect<boolean>;
  getSessionCount: (host: RoomLifecycleHost) => Effect.Effect<number>;
  cancelEmptyRoomPurge: (host: RoomLifecycleHost, now: number) => Effect.Effect<void>;
  purgeRoom: (host: RoomLifecycleHost, reason: string) => Effect.Effect<void>;
}

export const runRoomAlarmDeps: RunRoomAlarmDeps = {
  getStoredState: (host) => Effect.promise(() => host.getStoredState()),
  purgeIfExpired: (host, stored, now) => purgeIfExpiredEffect(host, stored, now),
  getSessionCount: (host) => Effect.sync(() => host.getSessionCount()),
  cancelEmptyRoomPurge: (host, now) => cancelEmptyRoomPurgeEffect(host, now),
  purgeRoom: (host, reason) => Effect.promise(() => host.purgeRoom(reason)),
};

export function getAbsoluteRoomExpiresAt(
  state: Pick<StoredState, "startedAt">,
  now = Date.now(),
): number {
  return (state.startedAt ?? now) + MAX_ROOM_LIFETIME_MS;
}

export function getAbsoluteRoomExpiresAtEffect(
  state: Pick<StoredState, "startedAt">,
  now = Date.now(),
): Effect.Effect<number> {
  return Effect.sync(() => getAbsoluteRoomExpiresAt(state, now));
}

export function scheduleEmptyRoomPurgeEffect(
  host: RoomLifecycleHost,
  now = Date.now(),
  deps: ScheduleEmptyRoomPurgeDeps = scheduleEmptyRoomPurgeDeps,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const state = yield* deps.loadState(host);
    if ((yield* deps.getSessionCount(host)) > 0) {
      const expiresAt = yield* getAbsoluteRoomExpiresAtEffect(state, now);
      yield* deps.setAlarm(host, expiresAt);
      return;
    }

    const purgeScheduledAt = now + EMPTY_ROOM_PURGE_DELAY_MS;
    state.purgeScheduledAt = purgeScheduledAt;
    const expiresAt = yield* getAbsoluteRoomExpiresAtEffect(state, now);
    yield* deps.setAlarm(host, Math.min(purgeScheduledAt, expiresAt));
    yield* deps.saveState(host);
  });
}

export function cancelEmptyRoomPurgeEffect(
  host: RoomLifecycleHost,
  now = Date.now(),
  deps: CancelEmptyRoomPurgeDeps = cancelEmptyRoomPurgeDeps,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* deps.deleteAlarm(host);
    const state = yield* deps.getLoadedState(host);
    if (!state) return;
    if (state.purgeScheduledAt !== null) {
      state.purgeScheduledAt = null;
      yield* deps.saveState(host);
    }
    const expiresAt = yield* getAbsoluteRoomExpiresAtEffect(state, now);
    yield* deps.setAlarm(host, expiresAt);
  });
}

export function purgeIfExpiredEffect(
  host: RoomLifecycleHost,
  stored?: StoredState | null,
  now = Date.now(),
  deps: PurgeIfExpiredDeps = purgeIfExpiredDeps,
): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const state = stored ?? (yield* deps.getStoredState(host));
    if (!state) return false;
    const expiresAt = yield* getAbsoluteRoomExpiresAtEffect(state, now);
    if (now < expiresAt) return false;
    yield* deps.purgeRoom(host, ABSOLUTE_EXPIRY_REASON);
    return true;
  });
}

export function runRoomAlarmEffect(
  host: RoomLifecycleHost,
  now = Date.now(),
  deps: RunRoomAlarmDeps = runRoomAlarmDeps,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const stored = yield* deps.getStoredState(host);
    if (!stored) return;
    if (yield* deps.purgeIfExpired(host, stored, now)) return;

    const purgeScheduledAt = typeof stored.purgeScheduledAt === "number" && Number.isFinite(stored.purgeScheduledAt)
      ? stored.purgeScheduledAt
      : null;
    if (purgeScheduledAt === null || now < purgeScheduledAt) return;

    if ((yield* deps.getSessionCount(host)) > 0) {
      yield* deps.cancelEmptyRoomPurge(host, now);
      return;
    }

    yield* deps.purgeRoom(host, EMPTY_ROOM_PURGE_REASON);
  });
}

export function scheduleEmptyRoomPurge(host: RoomLifecycleHost): Promise<void> {
  return Effect.runPromise(scheduleEmptyRoomPurgeEffect(host));
}

export function cancelEmptyRoomPurge(host: RoomLifecycleHost): Promise<void> {
  return Effect.runPromise(cancelEmptyRoomPurgeEffect(host));
}

export function purgeIfExpired(
  host: RoomLifecycleHost,
  stored?: StoredState | null,
): Promise<boolean> {
  return Effect.runPromise(purgeIfExpiredEffect(host, stored));
}

export function runRoomAlarm(host: RoomLifecycleHost): Promise<void> {
  return Effect.runPromise(runRoomAlarmEffect(host));
}
