import { Effect } from "effect";
import type { StoredState } from "./room-types";
import { validateRoomPurgeEffect } from "./validation";

export async function purgeRoomByFacilitator(
  state: StoredState,
  participantId: string,
  purgeRoom: (reason: string) => Promise<void>,
): Promise<{ success: boolean; error?: string }> {
  return Effect.runPromise(purgeRoomByFacilitatorEffect(state, participantId, purgeRoom));
}

export function purgeRoomByFacilitatorEffect(
  state: StoredState,
  participantId: string,
  purgeRoom: (reason: string) => Promise<void>,
): Effect.Effect<{ success: boolean; error?: string }> {
  return Effect.gen(function* () {
    const validation = yield* Effect.either(validateRoomPurgeEffect(state, participantId));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }
    yield* Effect.promise(() => purgeRoom(validation.right.reason));
    return { success: true };
  });
}
