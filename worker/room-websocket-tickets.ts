import { Effect } from "effect";
import { generateTokenEffect } from "./room-tickets";
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

export class WebSocketTicketValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebSocketTicketValidationError";
  }
}

export interface CreateWebSocketTicketDeps {
  loadState: (host: WebSocketTicketHost) => Effect.Effect<StoredState>;
  deleteOutstandingTicket: (host: WebSocketTicketHost, participantId: string) => Effect.Effect<void>;
  generateTicket: () => Effect.Effect<string>;
  put: (host: WebSocketTicketHost, key: string, value: unknown) => Effect.Effect<void>;
}

export const createWebSocketTicketDeps: CreateWebSocketTicketDeps = {
  loadState: (host) => Effect.promise(() => host.loadState()),
  deleteOutstandingTicket: deleteOutstandingWebSocketTicketForRoomEffect,
  generateTicket: generateTokenEffect,
  put: (host, key, value) => Effect.promise(() => host.put(key, value)),
};

export function validateWebSocketTicketStringEffect(
  ticket: string | null,
): Effect.Effect<string, WebSocketTicketValidationError> {
  return Effect.gen(function* () {
    if (typeof ticket !== "string" || ticket.length !== 64 || !/^[a-f0-9]+$/.test(ticket)) {
      return yield* Effect.fail(new WebSocketTicketValidationError("Missing or invalid websocket ticket"));
    }
    return ticket;
  });
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
  deps: CreateWebSocketTicketDeps = createWebSocketTicketDeps,
): Effect.Effect<{ success: boolean; error?: string; ticket?: string }> {
  return Effect.gen(function* () {
    const s = yield* deps.loadState(host);
    const auth = yield* Effect.either(authorizeParticipantEffect(s, participantId, connectionToken));
    if (auth._tag === "Left") return { success: false, error: auth.left.message };

    yield* deps.deleteOutstandingTicket(host, auth.right.participantId);

    const ticket = yield* deps.generateTicket();
    const record: WebSocketTicket = {
      participantId: auth.right.participantId,
      expiresAt: now + WEBSOCKET_TICKET_TTL_MS,
    };
    yield* Effect.all([
      deps.put(host, `ws-ticket:${ticket}`, record),
      deps.put(host, `ws-ticket-by-participant:${auth.right.participantId}`, ticket),
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
    const validatedTicket = yield* Effect.either(validateWebSocketTicketStringEffect(ticket));
    if (validatedTicket._tag === "Left") {
      return { success: false, error: validatedTicket.left.message };
    }

    const key = `ws-ticket:${validatedTicket.right}`;
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
    if (currentParticipantTicket === validatedTicket.right) {
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
