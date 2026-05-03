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

export type WriteCardMutationResult = {
  success: boolean;
  error?: string;
};

export type WriteCardMutationWithStateResult = WriteCardMutationResult & {
  state: RoomState | null;
};

export type RunWriteCardMutationInput<Result extends WriteCardMutationResult> =
  {
    mutation: Effect.Effect<Result, unknown>;
    currentState: RoomState | null;
    loadFreshState: Effect.Effect<RoomState, unknown>;
    fallback: (currentState: RoomState, result: Result) => RoomState;
  };

export function runWriteCardMutationEffect<
  Result extends WriteCardMutationResult,
>({
  mutation,
  currentState,
  loadFreshState,
  fallback,
}: RunWriteCardMutationInput<Result>): Effect.Effect<
  Result & WriteCardMutationWithStateResult,
  unknown
> {
  return Effect.gen(function* () {
    const result = yield* mutation;
    if (!result.success) return { ...result, state: null };

    const state = yield* refreshRoomStateAfterMutationEffect(
      currentState,
      loadFreshState,
      (current) => fallback(current, result),
    );
    return { ...result, state };
  });
}
