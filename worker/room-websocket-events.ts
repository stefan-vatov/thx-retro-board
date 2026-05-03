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
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const attachment = ws.deserializeAttachment() as { participantId: string } | null;
    const participantId = attachment?.participantId;
    if (!participantId) return;
    if (host.getSession(participantId) !== ws) {
      try {
        ws.close(1008, "Obsolete realtime session");
      } catch {
        // Ignore already-closing sockets.
      }
      return;
    }

    const rateLimit = host.allowWebSocketMessage(participantId);
    if (!rateLimit.allowed) {
      ws.send(JSON.stringify({ type: "error", message: rateLimit.reason }));
      ws.close(1008, "Realtime rate limit exceeded");
      return;
    }
    const messageSize = typeof message === "string" ? message.length : message.byteLength;
    if (messageSize > MAX_WEBSOCKET_MESSAGE_BYTES) {
      ws.send(JSON.stringify({ type: "error", message: "Message is too large" }));
      return;
    }
    const msg = yield* Effect.either(parseClientWebSocketMessageEffect(message));
    if (msg._tag === "Left") {
      ws.send(JSON.stringify({ type: "error", message: "Invalid message" }));
      return;
    }
    const handled = yield* Effect.either(Effect.promise(() => host.handleRealtimeMessage(participantId, msg.right)));
    if (handled._tag === "Left") {
      ws.send(JSON.stringify({ type: "error", message: "Invalid message" }));
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
