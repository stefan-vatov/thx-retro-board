import { Effect } from "effect";
import type { RoomState, ServerToClientMessage } from "../src/domain";
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
  consumeWebSocketTicket: (
    host: RoomWebSocketHost,
    ticket: string | null,
  ) => Effect.Effect<{ success: true; participantId: string } | { success: false; error: string }>;
  loadState: (host: RoomWebSocketHost) => Effect.Effect<StoredState>;
  cancelEmptyRoomPurge: (host: RoomWebSocketHost) => Effect.Effect<void>;
  closeParticipantSocket: (host: RoomWebSocketHost, participantId: string, reason: string) => Effect.Effect<void>;
  setSession: (host: RoomWebSocketHost, participantId: string, socket: WebSocket) => Effect.Effect<void>;
  serializeAttachment: (socket: WebSocket, attachment: { participantId: string }) => Effect.Effect<void>;
  acceptWebSocket: (host: RoomWebSocketHost, socket: WebSocket) => Effect.Effect<void>;
  broadcast: (
    host: RoomWebSocketHost,
    message: ServerToClientMessage,
    excludeId?: string,
  ) => Effect.Effect<void>;
  sendSnapshot: (socket: WebSocket, snapshot: { type: "snapshot"; state: RoomState }) => Effect.Effect<void>;
}

export const roomWebSocketDeps: RoomWebSocketDeps = {
  getWebSocketTicket: getWebSocketTicketEffect,
  consumeWebSocketTicket: (host, ticket) => Effect.promise(() => host.consumeWebSocketTicket(ticket)),
  loadState: (host) => Effect.promise(() => host.loadState()),
  cancelEmptyRoomPurge: (host) => Effect.promise(() => host.cancelEmptyRoomPurge()),
  closeParticipantSocket: (host, participantId, reason) => Effect.sync(() => {
    host.closeParticipantSocket(participantId, reason);
  }),
  setSession: (host, participantId, socket) => Effect.sync(() => {
    host.setSession(participantId, socket);
  }),
  serializeAttachment: (socket, attachment) => Effect.sync(() => {
    socket.serializeAttachment(attachment);
  }),
  acceptWebSocket: (host, socket) => Effect.sync(() => {
    host.acceptWebSocket(socket);
  }),
  broadcast: (host, message, excludeId) => Effect.sync(() => {
    host.broadcast(message, excludeId);
  }),
  sendSnapshot: (socket, snapshot) => Effect.sync(() => {
    socket.send(JSON.stringify(snapshot));
  }),
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
  const ticket = yield* deps.consumeWebSocketTicket(host, ticketValue);
  if (!ticket.success) {
    return new Response(JSON.stringify({ error: ticket.error }), { status: 403 });
  }

  const participantId = ticket.participantId;
  const s = yield* deps.loadState(host);
  yield* deps.cancelEmptyRoomPurge(host);
  yield* deps.closeParticipantSocket(host, participantId, "Participant opened a new connection");
  yield* deps.setSession(host, participantId, server);
  yield* deps.serializeAttachment(server, { participantId });
  yield* deps.acceptWebSocket(host, server);

  const participant = s.participants.find((p) => p.id === participantId);
  if (participant) {
    yield* deps.broadcast(host, { type: "participant-joined", participant }, participantId);
  }

  yield* deps.sendSnapshot(server, { type: "snapshot", state: toRoomState(s, participantId) });

  return new Response(null, {
    status: 101,
    webSocket: client,
    headers: { "Sec-WebSocket-Protocol": "retro-board" },
  });
  });
}
