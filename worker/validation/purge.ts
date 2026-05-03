import { Effect } from "effect";
import type { StoredState } from "../room-types";
import { RoomMutationValidationError } from "./shared";

const FACILITATOR_PURGE_REASON = "The facilitator deleted this room's data.";

type RoomPurgeValidationState = Pick<StoredState, "facilitatorId" | "participants">;

export function validateRoomPurgeEffect(
  state: RoomPurgeValidationState,
  participantId: string,
): Effect.Effect<{ reason: string }, RoomMutationValidationError> {
  return Effect.gen(function* () {
    if (!state.participants.some((participant) => participant.id === participantId)) {
      return yield* Effect.fail(new RoomMutationValidationError("Participant not found"));
    }
    if (state.facilitatorId !== participantId) {
      return yield* Effect.fail(new RoomMutationValidationError("Only the facilitator can delete room data"));
    }
    return { reason: FACILITATOR_PURGE_REASON };
  });
}
