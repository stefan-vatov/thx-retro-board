import { Effect } from "effect";
import type { ServerToClientMessage } from "../src/domain";
import { toRoomState } from "./room-presenter";
import type { StoredState } from "./room-types";
import { getWebSocketTicketEffect } from "./room-tickets";

export interface RoomWebSocketHost {
  consumeWebSocketTicket(ticket: string | null): Promise<{ success: true; participantId: string } | { success: false; error: string }>;
  loadState(): Promise<StoredState>;
  cancelEmptyRoomPurge(): Promise<void>;
  closeParticipantSocket(participantId: string, reason: string): void;
  setSession(participantId: string, socket: WebSocket): void;
  acceptWebSocket(socket: WebSocket): void;
  broadcast(message: ServerToClientMessage, excludeId?: string): void;
}

export interface RoomWebSocketDeps {
  getWebSocketTicket: (request: Request) => Effect.Effect<string | null>;
}

export const roomWebSocketDeps: RoomWebSocketDeps = {
  getWebSocketTicket: getWebSocketTicketEffect,
};

export async function handleRoomWebSocketRequest(host: RoomWebSocketHost, request: Request): Promise<Response | null> {
  return Effect.runPromise(handleRoomWebSocketRequestEffect(host, request));
}

export function handleRoomWebSocketRequestEffect(
  host: RoomWebSocketHost,
  request: Request,
  deps: RoomWebSocketDeps = roomWebSocketDeps,
): Effect.Effect<Response | null> {
  return Effect.gen(function* () {
  const url = new URL(request.url);
  if (url.pathname !== "/ws" || request.headers.get("Upgrade") !== "websocket") {
    return null;
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

  const ticketValue = yield* deps.getWebSocketTicket(request);
  const ticket = yield* Effect.promise(() => host.consumeWebSocketTicket(ticketValue));
  if (!ticket.success) {
    return new Response(JSON.stringify({ error: ticket.error }), { status: 403 });
  }

  const participantId = ticket.participantId;
  const s = yield* Effect.promise(() => host.loadState());
  yield* Effect.promise(() => host.cancelEmptyRoomPurge());
  host.closeParticipantSocket(participantId, "Participant opened a new connection");
  host.setSession(participantId, server);
  server.serializeAttachment({ participantId });
  host.acceptWebSocket(server);

  const participant = s.participants.find((p) => p.id === participantId);
  if (participant) {
    host.broadcast({ type: "participant-joined", participant }, participantId);
  }

  server.send(JSON.stringify({ type: "snapshot", state: toRoomState(s, participantId) }));

  return new Response(null, {
    status: 101,
    webSocket: client,
    headers: { "Sec-WebSocket-Protocol": "retro-board" },
  });
  });
}
