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

export async function handleRoomWebSocketMessage(
  host: RoomWebSocketEventHost,
  ws: WebSocket,
  message: string | ArrayBuffer,
): Promise<void> {
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

  try {
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
    const msg = await Effect.runPromise(parseClientWebSocketMessageEffect(message));
    await host.handleRealtimeMessage(participantId, msg);
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "Invalid message" }));
  }
}

export function handleRoomWebSocketClose(host: RoomWebSocketEventHost, ws: WebSocket): void {
  const attachment = ws.deserializeAttachment() as { participantId: string } | null;
  const participantId = attachment?.participantId;
  if (!participantId) return;

  if (host.getSession(participantId) !== ws) return;
  host.removeSession(participantId);
  host.removeRealtimeParticipant(participantId);
  host.broadcast({ type: "participant-left", participantId });
  void host.scheduleEmptyRoomPurge();
}
