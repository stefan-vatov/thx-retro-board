import { Effect } from "effect";
import type { Phase, RoomState } from "../domain";

export type InitialRoomLoadInput = {
  roomId: string | undefined;
  displayName: string;
  connectionToken: string | undefined;
};

export type InitialRoomLoadPlan =
  | { action: "show-join" }
  | {
      action: "request-join";
      roomId: string;
      displayName: string;
      connectionToken: string;
    };

export type InitialJoinResult = {
  success: boolean;
  state?: RoomState;
  connectionToken?: string;
};

export type InitialJoinResolution =
  | { action: "reset-to-join" }
  | {
      action: "show-room";
      state: RoomState | null;
      connectionToken: string | undefined;
    };

export type RoomUpdateMarker = {
  phase: Phase;
  version: number;
};

export type FocusLocation = "document" | "interactive";

export function planInitialRoomLoadEffect({
  roomId,
  displayName,
  connectionToken,
}: InitialRoomLoadInput): Effect.Effect<InitialRoomLoadPlan | null> {
  return Effect.sync(() => {
    if (!roomId) return null;
    if (!displayName || !connectionToken) return { action: "show-join" };
    return {
      action: "request-join",
      roomId,
      displayName,
      connectionToken,
    };
  });
}

export function resolveInitialJoinResultEffect(
  result: InitialJoinResult,
): Effect.Effect<InitialJoinResolution> {
  return Effect.sync(() => {
    if (!result.success) return { action: "reset-to-join" };
    return {
      action: "show-room",
      state: result.state ?? null,
      connectionToken: result.connectionToken,
    };
  });
}

export function shouldRestoreRoomFocusEffect({
  pageState,
  previous,
  current,
  focusLocation,
}: {
  pageState: string;
  previous: RoomUpdateMarker | null;
  current: RoomUpdateMarker;
  focusLocation: FocusLocation;
}): Effect.Effect<boolean> {
  return Effect.sync(() => {
    if (pageState !== "room") return false;
    if (!previous) return false;
    const changed =
      previous.phase !== current.phase || previous.version !== current.version;
    return changed && focusLocation === "document";
  });
}
