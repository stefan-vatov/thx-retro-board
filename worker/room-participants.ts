import { Effect } from "effect";
import type { Participant, RoomState, ServerToClientMessage } from "../src/domain";
import { toRoomStateEffect } from "./room-presenter";
import { generateTokenEffect } from "./room-tickets";
import { validateParticipantJoinEffect } from "./validation";
import type { RoomCommandHost } from "./room-command-host";
import type { StoredState } from "./room-types";

export interface RoomParticipantHost extends RoomCommandHost {
  cancelEmptyRoomPurge(): Promise<void>;
  closeParticipantSocket(participantId: string, reason: string): void;
  deleteOutstandingWebSocketTicket(participantId: string): Promise<void>;
  scheduleEmptyRoomPurge(): Promise<void>;
  getSessionCount(): number;
}

export interface RoomParticipantDeps {
  loadState: (host: RoomParticipantHost) => Effect.Effect<StoredState>;
  cancelEmptyRoomPurge: (host: RoomParticipantHost) => Effect.Effect<void>;
  closeParticipantSocket: (host: RoomParticipantHost, participantId: string, reason: string) => Effect.Effect<void>;
  deleteOutstandingWebSocketTicket: (host: RoomParticipantHost, participantId: string) => Effect.Effect<void>;
  generateConnectionToken: () => Effect.Effect<string>;
  saveState: (host: RoomParticipantHost) => Effect.Effect<void>;
  broadcast: (
    host: RoomParticipantHost,
    message: ServerToClientMessage,
    exceptParticipantId?: string,
  ) => Effect.Effect<void>;
  broadcastState: (
    host: RoomParticipantHost,
    state: StoredState,
    exceptParticipantId?: string,
  ) => Effect.Effect<void>;
  getSessionCount: (host: RoomParticipantHost) => Effect.Effect<number>;
  scheduleEmptyRoomPurge: (host: RoomParticipantHost) => Effect.Effect<void>;
}

export const roomParticipantDeps: RoomParticipantDeps = {
  loadState: (host) => Effect.promise(() => host.loadState()),
  cancelEmptyRoomPurge: (host) => Effect.promise(() => host.cancelEmptyRoomPurge()),
  closeParticipantSocket: (host, participantId, reason) => Effect.sync(() => {
    host.closeParticipantSocket(participantId, reason);
  }),
  deleteOutstandingWebSocketTicket: (host, participantId) =>
    Effect.promise(() => host.deleteOutstandingWebSocketTicket(participantId)),
  generateConnectionToken: generateTokenEffect,
  saveState: (host) => Effect.promise(() => host.saveState()),
  broadcast: (host, message, exceptParticipantId) => Effect.sync(() => {
    host.broadcast(message, exceptParticipantId);
  }),
  broadcastState: (host, state, exceptParticipantId) => Effect.sync(() => {
    host.broadcastState(state, exceptParticipantId);
  }),
  getSessionCount: (host) => Effect.sync(() => host.getSessionCount()),
  scheduleEmptyRoomPurge: (host) => Effect.promise(() => host.scheduleEmptyRoomPurge()),
};

export async function joinRoomParticipant(
  host: RoomParticipantHost,
  participantId: string,
  displayName: string,
  connectionToken?: string,
  facilitatorClaimToken?: unknown,
): Promise<{ success: boolean; error?: string; state?: RoomState; connectionToken?: string }> {
  return Effect.runPromise(joinRoomParticipantEffect(host, participantId, displayName, connectionToken, facilitatorClaimToken));
}

export function joinRoomParticipantEffect(
  host: RoomParticipantHost,
  participantId: string,
  displayName: string,
  connectionToken?: string,
  facilitatorClaimToken?: unknown,
  deps: Partial<RoomParticipantDeps> = {},
): Effect.Effect<{ success: boolean; error?: string; state?: RoomState; connectionToken?: string }> {
  return Effect.gen(function* () {
    const d = { ...roomParticipantDeps, ...deps };
    const s = yield* d.loadState(host);
    const validation = yield* Effect.either(validateParticipantJoinEffect(
      s,
      participantId,
      displayName,
      connectionToken,
      facilitatorClaimToken,
    ));
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
      yield* d.cancelEmptyRoomPurge(host);
      yield* d.closeParticipantSocket(host, participantId, "Participant reconnected");
      yield* d.deleteOutstandingWebSocketTicket(host, participantId);
      const token = yield* d.generateConnectionToken();
      s.connectionTokens[participantId] = token;
      yield* d.saveState(host);

      yield* d.broadcast(host, {
        type: "participant-joined",
        participant: validated.existing,
      }, participantId);

      if ((yield* d.getSessionCount(host)) === 0) {
        yield* d.scheduleEmptyRoomPurge(host);
      }

      const state = yield* toRoomStateEffect(s, participantId);
      return { success: true, state, connectionToken: token };
    }

    yield* d.cancelEmptyRoomPurge(host);
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
    const token = yield* d.generateConnectionToken();
    s.connectionTokens[participantId] = token;
    yield* d.saveState(host);

    const broadcast: ServerToClientMessage = {
      type: "participant-joined",
      participant,
    };
    yield* d.broadcast(host, broadcast, participantId);
    yield* d.broadcastState(host, s, participantId);

    if ((yield* d.getSessionCount(host)) === 0) {
      yield* d.scheduleEmptyRoomPurge(host);
    }

    const state = yield* toRoomStateEffect(s, participantId);
    return { success: true, state, connectionToken: token };
  });
}
