import { Effect } from "effect";
import type { RoomState } from "../domain";

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
