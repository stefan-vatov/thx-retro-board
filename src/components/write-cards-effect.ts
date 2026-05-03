import { Effect } from "effect";
import type { RoomState } from "../domain";

export function refreshRoomStateAfterMutationEffect(
  currentState: RoomState | null,
  loadFreshState: Effect.Effect<RoomState, unknown>,
  fallback: (currentState: RoomState) => RoomState,
): Effect.Effect<RoomState | null> {
  return loadFreshState.pipe(
    Effect.catchAll(() =>
      Effect.succeed(currentState ? fallback(currentState) : null),
    ),
  );
}
