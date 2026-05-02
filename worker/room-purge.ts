import { Effect } from "effect";
import type { StoredState } from "./room-types";

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
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return { success: false, error: "Participant not found" };
    }
    if (state.facilitatorId !== participantId) {
      return { success: false, error: "Only the facilitator can delete room data" };
    }
    yield* Effect.promise(() => purgeRoom("The facilitator deleted this room's data."));
    return { success: true };
  });
}
