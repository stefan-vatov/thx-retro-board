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

export function getAbsoluteRoomExpiresAt(
  state: Pick<StoredState, "startedAt">,
  now = Date.now(),
): number {
  return (state.startedAt ?? now) + MAX_ROOM_LIFETIME_MS;
}

export function scheduleEmptyRoomPurgeEffect(
  host: RoomLifecycleHost,
  now = Date.now(),
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const state = yield* Effect.promise(() => host.loadState());
    if (host.getSessionCount() > 0) {
      yield* Effect.promise(() => host.setAlarm(getAbsoluteRoomExpiresAt(state, now)));
      return;
    }

    const purgeScheduledAt = now + EMPTY_ROOM_PURGE_DELAY_MS;
    state.purgeScheduledAt = purgeScheduledAt;
    yield* Effect.promise(() => host.setAlarm(Math.min(purgeScheduledAt, getAbsoluteRoomExpiresAt(state, now))));
    yield* Effect.promise(() => host.saveState());
  });
}

export function cancelEmptyRoomPurgeEffect(
  host: RoomLifecycleHost,
  now = Date.now(),
): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Effect.promise(() => host.deleteAlarm());
    const state = host.getLoadedState();
    if (!state) return;
    if (state.purgeScheduledAt !== null) {
      state.purgeScheduledAt = null;
      yield* Effect.promise(() => host.saveState());
    }
    yield* Effect.promise(() => host.setAlarm(getAbsoluteRoomExpiresAt(state, now)));
  });
}

export function purgeIfExpiredEffect(
  host: RoomLifecycleHost,
  stored?: StoredState | null,
  now = Date.now(),
): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const state = stored ?? (yield* Effect.promise(() => host.getStoredState()));
    if (!state || now < getAbsoluteRoomExpiresAt(state, now)) return false;
    yield* Effect.promise(() => host.purgeRoom(ABSOLUTE_EXPIRY_REASON));
    return true;
  });
}

export function runRoomAlarmEffect(
  host: RoomLifecycleHost,
  now = Date.now(),
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const stored = yield* Effect.promise(() => host.getStoredState());
    if (!stored) return;
    if (yield* purgeIfExpiredEffect(host, stored, now)) return;

    const purgeScheduledAt = typeof stored.purgeScheduledAt === "number" && Number.isFinite(stored.purgeScheduledAt)
      ? stored.purgeScheduledAt
      : null;
    if (purgeScheduledAt === null || now < purgeScheduledAt) return;

    if (host.getSessionCount() > 0) {
      yield* cancelEmptyRoomPurgeEffect(host, now);
      return;
    }

    yield* Effect.promise(() => host.purgeRoom(EMPTY_ROOM_PURGE_REASON));
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
