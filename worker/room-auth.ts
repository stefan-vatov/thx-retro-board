import { Effect } from "effect";
import type { StoredState } from "./room-types";
import { authorizeParticipantEffect } from "./validation";

export type AuthorizedParticipantResult =
  | { success: true; participantId: string; state: StoredState }
  | { success: false; error: string };

export function authorizeLoadedParticipantResultEffect(
  state: StoredState,
  participantId: unknown,
  connectionToken: unknown,
): Effect.Effect<AuthorizedParticipantResult> {
  return Effect.gen(function* () {
    const auth = yield* Effect.either(authorizeParticipantEffect(state, participantId, connectionToken));
    return auth._tag === "Left"
      ? { success: false, error: auth.left.message }
      : { success: true, participantId: auth.right.participantId, state };
  });
}

export function authorizeLoadedParticipantResult(
  state: StoredState,
  participantId: unknown,
  connectionToken: unknown,
): Promise<AuthorizedParticipantResult> {
  return Effect.runPromise(authorizeLoadedParticipantResultEffect(state, participantId, connectionToken));
}
