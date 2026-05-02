import type { StoredState } from "./room-types";

export async function purgeRoomByFacilitator(
  state: StoredState,
  participantId: string,
  purgeRoom: (reason: string) => Promise<void>,
): Promise<{ success: boolean; error?: string }> {
  if (!state.participants.some((participant) => participant.id === participantId)) {
    return { success: false, error: "Participant not found" };
  }
  if (state.facilitatorId !== participantId) {
    return { success: false, error: "Only the facilitator can delete room data" };
  }
  await purgeRoom("The facilitator deleted this room's data.");
  return { success: true };
}
