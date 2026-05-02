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
  const existingTicket = await storage.get<string>(`ws-ticket-by-participant:${participantId}`);
  if (existingTicket) {
    await storage.delete(`ws-ticket:${existingTicket}`);
  }
  await storage.delete(`ws-ticket-by-participant:${participantId}`);
}

export async function createWebSocketTicketForRoom(
  host: WebSocketTicketHost,
  participantId: string,
  connectionToken: unknown,
  now = Date.now(),
): Promise<{ success: boolean; error?: string; ticket?: string }> {
  const s = await host.loadState();
  const auth = await Effect.runPromise(Effect.either(authorizeParticipantEffect(s, participantId, connectionToken)));
  if (auth._tag === "Left") return { success: false, error: auth.left.message };

  await deleteOutstandingWebSocketTicketForRoom(host, auth.right.participantId);

  const ticket = generateToken();
  const record: WebSocketTicket = {
    participantId: auth.right.participantId,
    expiresAt: now + WEBSOCKET_TICKET_TTL_MS,
  };
  await Promise.all([
    host.put(`ws-ticket:${ticket}`, record),
    host.put(`ws-ticket-by-participant:${auth.right.participantId}`, ticket),
  ]);
  return { success: true, ticket };
}

export async function consumeWebSocketTicketForRoom(
  host: WebSocketTicketHost & { hasParticipant(participantId: string): Promise<boolean> },
  ticket: string | null,
  now = Date.now(),
): Promise<{ success: true; participantId: string } | { success: false; error: string }> {
  if (typeof ticket !== "string" || ticket.length !== 64 || !/^[a-f0-9]+$/.test(ticket)) {
    return { success: false, error: "Missing or invalid websocket ticket" };
  }

  const key = `ws-ticket:${ticket}`;
  const record = await host.get<WebSocketTicket>(key);
  await host.delete(key);
  if (
    !record
    || typeof record.participantId !== "string"
    || typeof record.expiresAt !== "number"
  ) {
    return { success: false, error: "Missing or invalid websocket ticket" };
  }
  const participantTicketKey = `ws-ticket-by-participant:${record.participantId}`;
  const currentParticipantTicket = await host.get<string>(participantTicketKey);
  if (currentParticipantTicket === ticket) {
    await host.delete(participantTicketKey);
  }
  if (record.expiresAt < now) {
    return { success: false, error: "Websocket ticket expired" };
  }

  if (!await host.hasParticipant(record.participantId)) {
    return { success: false, error: "Participant not found" };
  }
  return { success: true, participantId: record.participantId };
}
