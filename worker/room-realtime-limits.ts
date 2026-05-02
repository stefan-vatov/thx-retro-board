import {
  MAX_ROOM_WEBSOCKET_MESSAGES_PER_WINDOW,
  MAX_WEBSOCKET_MESSAGES_PER_WINDOW,
  WEBSOCKET_RATE_WINDOW_MS,
} from "./room-types";

type WindowCounter = { startedAt: number; count: number };

export class RoomRealtimeLimiter {
  private participantWindows = new Map<string, WindowCounter>();
  private roomWindow: WindowCounter | null = null;

  allow(participantId: string, now = Date.now()): { allowed: true } | { allowed: false; reason: string } {
    const participant = this.participantWindows.get(participantId);
    if (!participant || now - participant.startedAt >= WEBSOCKET_RATE_WINDOW_MS) {
      this.participantWindows.set(participantId, { startedAt: now, count: 1 });
    } else {
      if (participant.count >= MAX_WEBSOCKET_MESSAGES_PER_WINDOW) {
        return { allowed: false, reason: "Too many realtime updates. Reconnect and slow down." };
      }
      participant.count += 1;
    }

    if (!this.roomWindow || now - this.roomWindow.startedAt >= WEBSOCKET_RATE_WINDOW_MS) {
      this.roomWindow = { startedAt: now, count: 1 };
      return { allowed: true };
    }
    if (this.roomWindow.count >= MAX_ROOM_WEBSOCKET_MESSAGES_PER_WINDOW) {
      return { allowed: false, reason: "This room is receiving too many realtime updates. Please slow down." };
    }
    this.roomWindow.count += 1;
    return { allowed: true };
  }

  removeParticipant(participantId: string): void {
    this.participantWindows.delete(participantId);
  }
}
