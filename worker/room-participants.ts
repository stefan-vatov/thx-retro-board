import { Effect } from "effect";
import type { Participant, RoomState, ServerToClientMessage } from "../src/domain";
import { toRoomState } from "./room-presenter";
import { generateToken } from "./room-tickets";
import { validateParticipantJoinEffect } from "./validation";
import type { RoomCommandHost } from "./room-command-host";

export interface RoomParticipantHost extends RoomCommandHost {
  cancelEmptyRoomPurge(): Promise<void>;
  closeParticipantSocket(participantId: string, reason: string): void;
  deleteOutstandingWebSocketTicket(participantId: string): Promise<void>;
  scheduleEmptyRoomPurge(): Promise<void>;
  getSessionCount(): number;
}

export async function joinRoomParticipant(
  host: RoomParticipantHost,
  participantId: string,
  displayName: string,
  connectionToken?: string,
  facilitatorClaimToken?: unknown,
): Promise<{ success: boolean; error?: string; state?: RoomState; connectionToken?: string }> {
  const s = await host.loadState();
  const validation = await Effect.runPromise(Effect.either(validateParticipantJoinEffect(
    s,
    participantId,
    displayName,
    connectionToken,
    facilitatorClaimToken,
  )));
  if (validation._tag === "Left") {
    return { success: false, error: validation.left.message };
  }
  const validated = validation.right;

  if (validated.existing) {
    if (validated.shouldClaimFacilitator) {
      s.facilitatorId = participantId;
      s.facilitatorClaimToken = null;
      s.participants = s.participants.map((participant) =>
        participant.id === participantId ? { ...participant, isFacilitator: true } : participant,
      );
    }
    await host.cancelEmptyRoomPurge();
    host.closeParticipantSocket(participantId, "Participant reconnected");
    await host.deleteOutstandingWebSocketTicket(participantId);
    const token = generateToken();
    s.connectionTokens[participantId] = token;
    await host.saveState();

    host.broadcast({
      type: "participant-joined",
      participant: validated.existing,
    }, participantId);

    if (host.getSessionCount() === 0) {
      await host.scheduleEmptyRoomPurge();
    }

    return { success: true, state: toRoomState(s, participantId), connectionToken: token };
  }

  await host.cancelEmptyRoomPurge();
  const participant: Participant = {
    id: participantId,
    displayName: validated.displayName,
    isFacilitator: validated.isFacilitator,
  };
  s.participants.push(participant);
  if (validated.isFacilitator) {
    s.facilitatorId = participantId;
    s.facilitatorClaimToken = null;
  }
  const token = generateToken();
  s.connectionTokens[participantId] = token;
  await host.saveState();

  const broadcast: ServerToClientMessage = {
    type: "participant-joined",
    participant,
  };
  host.broadcast(broadcast, participantId);
  host.broadcastState(s, participantId);

  if (host.getSessionCount() === 0) {
    await host.scheduleEmptyRoomPurge();
  }

  return { success: true, state: toRoomState(s, participantId), connectionToken: token };
}
