import { Effect } from "effect";
import { generateToken } from "./room-tickets";
import { WEBSOCKET_TICKET_TTL_MS, type StoredState, type WebSocketTicket } from "./room-types";
import { authorizeParticipantEffect } from "./validation";

export interface WebSocketTicketStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<unknown>;
}

export interface WebSocketTicketHost extends WebSocketTicketStorage {
  loadState(): Promise<StoredState>;
}

export async function deleteOutstandingWebSocketTicketForRoom(
  storage: WebSocketTicketStorage,
  participantId: string,
): Promise<void> {
  await Effect.runPromise(deleteOutstandingWebSocketTicketForRoomEffect(storage, participantId));
}

export function deleteOutstandingWebSocketTicketForRoomEffect(
  storage: WebSocketTicketStorage,
  participantId: string,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const existingTicket = yield* Effect.promise(() => storage.get<string>(`ws-ticket-by-participant:${participantId}`));
    if (existingTicket) {
      yield* Effect.promise(() => storage.delete(`ws-ticket:${existingTicket}`));
    }
    yield* Effect.promise(() => storage.delete(`ws-ticket-by-participant:${participantId}`));
  });
}

export async function createWebSocketTicketForRoom(
  host: WebSocketTicketHost,
  participantId: string,
  connectionToken: unknown,
  now = Date.now(),
): Promise<{ success: boolean; error?: string; ticket?: string }> {
  return Effect.runPromise(createWebSocketTicketForRoomEffect(host, participantId, connectionToken, now));
}

export function createWebSocketTicketForRoomEffect(
  host: WebSocketTicketHost,
  participantId: string,
  connectionToken: unknown,
  now = Date.now(),
): Effect.Effect<{ success: boolean; error?: string; ticket?: string }> {
  return Effect.gen(function* () {
    const s = yield* Effect.promise(() => host.loadState());
    const auth = yield* Effect.either(authorizeParticipantEffect(s, participantId, connectionToken));
    if (auth._tag === "Left") return { success: false, error: auth.left.message };

    yield* deleteOutstandingWebSocketTicketForRoomEffect(host, auth.right.participantId);

    const ticket = generateToken();
    const record: WebSocketTicket = {
      participantId: auth.right.participantId,
      expiresAt: now + WEBSOCKET_TICKET_TTL_MS,
    };
    yield* Effect.all([
      Effect.promise(() => host.put(`ws-ticket:${ticket}`, record)),
      Effect.promise(() => host.put(`ws-ticket-by-participant:${auth.right.participantId}`, ticket)),
    ], { concurrency: "unbounded" });
    return { success: true, ticket };
  });
}

export async function consumeWebSocketTicketForRoom(
  host: WebSocketTicketHost & { hasParticipant(participantId: string): Promise<boolean> },
  ticket: string | null,
  now = Date.now(),
): Promise<{ success: true; participantId: string } | { success: false; error: string }> {
  return Effect.runPromise(consumeWebSocketTicketForRoomEffect(host, ticket, now));
}

export function consumeWebSocketTicketForRoomEffect(
  host: WebSocketTicketHost & { hasParticipant(participantId: string): Promise<boolean> },
  ticket: string | null,
  now = Date.now(),
): Effect.Effect<{ success: true; participantId: string } | { success: false; error: string }> {
  return Effect.gen(function* () {
    if (typeof ticket !== "string" || ticket.length !== 64 || !/^[a-f0-9]+$/.test(ticket)) {
      return { success: false, error: "Missing or invalid websocket ticket" };
    }

    const key = `ws-ticket:${ticket}`;
    const record = yield* Effect.promise(() => host.get<WebSocketTicket>(key));
    yield* Effect.promise(() => host.delete(key));
    if (
      !record
      || typeof record.participantId !== "string"
      || typeof record.expiresAt !== "number"
    ) {
      return { success: false, error: "Missing or invalid websocket ticket" };
    }
    const participantTicketKey = `ws-ticket-by-participant:${record.participantId}`;
    const currentParticipantTicket = yield* Effect.promise(() => host.get<string>(participantTicketKey));
    if (currentParticipantTicket === ticket) {
      yield* Effect.promise(() => host.delete(participantTicketKey));
    }
    if (record.expiresAt < now) {
      return { success: false, error: "Websocket ticket expired" };
    }

    const hasParticipant = yield* Effect.promise(() => host.hasParticipant(record.participantId));
    if (!hasParticipant) {
      return { success: false, error: "Participant not found" };
    }
    return { success: true, participantId: record.participantId };
  });
}
