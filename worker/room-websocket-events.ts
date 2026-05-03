import { Effect } from "effect";
import type { ClientToServerMessage, ServerToClientMessage } from "../src/domain";
import { parseClientWebSocketMessageEffect } from "./validation";
import { MAX_WEBSOCKET_MESSAGE_BYTES } from "./room-types";

export interface RoomWebSocketEventHost {
  getSession(participantId: string): WebSocket | undefined;
  removeSession(participantId: string): void;
  removeRealtimeParticipant(participantId: string): void;
  allowWebSocketMessage(participantId: string): { allowed: true } | { allowed: false; reason: string };
  handleRealtimeMessage(participantId: string, message: ClientToServerMessage): Promise<void>;
  broadcast(message: ServerToClientMessage, excludeId?: string): void;
  scheduleEmptyRoomPurge(): Promise<void>;
}

export interface RoomWebSocketCloseDeps {
  getSession: (host: RoomWebSocketEventHost, participantId: string) => Effect.Effect<WebSocket | undefined>;
  removeSession: (host: RoomWebSocketEventHost, participantId: string) => Effect.Effect<void>;
  removeRealtimeParticipant: (host: RoomWebSocketEventHost, participantId: string) => Effect.Effect<void>;
  broadcast: (host: RoomWebSocketEventHost, message: ServerToClientMessage) => Effect.Effect<void>;
  scheduleEmptyRoomPurge: (host: RoomWebSocketEventHost) => Effect.Effect<void>;
}

export const roomWebSocketCloseDeps: RoomWebSocketCloseDeps = {
  getSession: (host, participantId) => Effect.sync(() => host.getSession(participantId)),
  removeSession: (host, participantId) => Effect.sync(() => {
    host.removeSession(participantId);
  }),
  removeRealtimeParticipant: (host, participantId) => Effect.sync(() => {
    host.removeRealtimeParticipant(participantId);
  }),
  broadcast: (host, message) => Effect.sync(() => {
    host.broadcast(message);
  }),
  scheduleEmptyRoomPurge: (host) => Effect.promise(() => host.scheduleEmptyRoomPurge()),
};

export interface RoomWebSocketMessageDeps {
  getSession: (host: RoomWebSocketEventHost, participantId: string) => Effect.Effect<WebSocket | undefined>;
  closeSocket: (ws: WebSocket, code: number, reason: string) => Effect.Effect<void>;
  allowWebSocketMessage: (
    host: RoomWebSocketEventHost,
    participantId: string,
  ) => Effect.Effect<{ allowed: true } | { allowed: false; reason: string }>;
  sendSocketError: (ws: WebSocket, message: string) => Effect.Effect<void>;
  handleRealtimeMessage: (
    host: RoomWebSocketEventHost,
    participantId: string,
    message: ClientToServerMessage,
  ) => Effect.Effect<void>;
}

export const roomWebSocketMessageDeps: RoomWebSocketMessageDeps = {
  getSession: (host, participantId) => Effect.sync(() => host.getSession(participantId)),
  closeSocket: (ws, code, reason) => Effect.sync(() => {
    try {
      ws.close(code, reason);
    } catch {
      // Ignore already-closing sockets.
    }
  }),
  allowWebSocketMessage: (host, participantId) => Effect.sync(() => host.allowWebSocketMessage(participantId)),
  sendSocketError: (ws, message) => Effect.sync(() => {
    ws.send(JSON.stringify({ type: "error", message }));
  }),
  handleRealtimeMessage: (host, participantId, message) =>
    Effect.promise(() => host.handleRealtimeMessage(participantId, message)),
};

export async function handleRoomWebSocketMessage(
  host: RoomWebSocketEventHost,
  ws: WebSocket,
  message: string | ArrayBuffer,
): Promise<void> {
  return Effect.runPromise(handleRoomWebSocketMessageEffect(host, ws, message));
}

export function handleRoomWebSocketMessageEffect(
  host: RoomWebSocketEventHost,
  ws: WebSocket,
  message: string | ArrayBuffer,
  deps: RoomWebSocketMessageDeps = roomWebSocketMessageDeps,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const attachment = ws.deserializeAttachment() as { participantId: string } | null;
    const participantId = attachment?.participantId;
    if (!participantId) return;
    if ((yield* deps.getSession(host, participantId)) !== ws) {
      yield* deps.closeSocket(ws, 1008, "Obsolete realtime session");
      return;
    }

    const rateLimit = yield* deps.allowWebSocketMessage(host, participantId);
    if (!rateLimit.allowed) {
      yield* deps.sendSocketError(ws, rateLimit.reason);
      yield* deps.closeSocket(ws, 1008, "Realtime rate limit exceeded");
      return;
    }
    const messageSize = typeof message === "string" ? message.length : message.byteLength;
    if (messageSize > MAX_WEBSOCKET_MESSAGE_BYTES) {
      yield* deps.sendSocketError(ws, "Message is too large");
      return;
    }
    const msg = yield* Effect.either(parseClientWebSocketMessageEffect(message));
    if (msg._tag === "Left") {
      yield* deps.sendSocketError(ws, "Invalid message");
      return;
    }
    const handled = yield* Effect.either(deps.handleRealtimeMessage(host, participantId, msg.right));
    if (handled._tag === "Left") {
      yield* deps.sendSocketError(ws, "Invalid message");
    }
  });
}

export function handleRoomWebSocketClose(host: RoomWebSocketEventHost, ws: WebSocket): void {
  void Effect.runPromise(handleRoomWebSocketCloseEffect(host, ws));
}

export function handleRoomWebSocketCloseEffect(
  host: RoomWebSocketEventHost,
  ws: WebSocket,
  deps: RoomWebSocketCloseDeps = roomWebSocketCloseDeps,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const attachment = ws.deserializeAttachment() as { participantId: string } | null;
    const participantId = attachment?.participantId;
    if (!participantId) return;

    if ((yield* deps.getSession(host, participantId)) !== ws) return;
    yield* deps.removeSession(host, participantId);
    yield* deps.removeRealtimeParticipant(host, participantId);
    yield* deps.broadcast(host, { type: "participant-left", participantId });
    yield* deps.scheduleEmptyRoomPurge(host);
  });
}
