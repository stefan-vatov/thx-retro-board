import { Effect } from "effect";
import type { StoredState } from "./room-types";
import { authorizeParticipantEffect } from "./validation";

export type AuthorizedParticipantResult =
  | { success: true; participantId: string; state: StoredState }
  | { success: false; error: string };

export interface AuthorizeParticipantFromStateDeps {
  loadState: (loadState: () => Promise<StoredState>) => Effect.Effect<StoredState>;
}

export const authorizeParticipantFromStateDeps: AuthorizeParticipantFromStateDeps = {
  loadState: (loadState) => Effect.promise(loadState),
};

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

export function authorizeParticipantFromStateEffect(
  loadState: () => Promise<StoredState>,
  participantId: unknown,
  connectionToken: unknown,
  deps: AuthorizeParticipantFromStateDeps = authorizeParticipantFromStateDeps,
): Effect.Effect<AuthorizedParticipantResult> {
  return Effect.gen(function* () {
    const state = yield* deps.loadState(loadState);
    return yield* authorizeLoadedParticipantResultEffect(state, participantId, connectionToken);
  });
}

export function authorizeParticipantFromState(
  loadState: () => Promise<StoredState>,
  participantId: unknown,
  connectionToken: unknown,
): Promise<AuthorizedParticipantResult> {
  return Effect.runPromise(authorizeParticipantFromStateEffect(loadState, participantId, connectionToken));
}
