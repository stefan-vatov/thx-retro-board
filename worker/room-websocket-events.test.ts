import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { ClientToServerMessage, ServerToClientMessage } from "../src/domain";
import { handleRoomWebSocketMessageEffect } from "./room-websocket-events";

class TestSocket {
  readonly sent: string[] = [];
  readonly closed: Array<{ code: number; reason: string }> = [];

  constructor(private readonly participantId: string | null) {}

  deserializeAttachment() {
    return this.participantId ? { participantId: this.participantId } : null;
  }

  send(message: string) {
    this.sent.push(message);
  }

  close(code: number, reason: string) {
    this.closed.push({ code, reason });
  }
}

function hostFor(socket: TestSocket, onMessage: (message: ClientToServerMessage) => void | Promise<void> = () => {}) {
  return {
    getSession: (participantId: string) => participantId === "p1" ? socket as unknown as WebSocket : undefined,
    removeSession: () => {},
    removeRealtimeParticipant: () => {},
    allowWebSocketMessage: () => ({ allowed: true as const }),
    handleRealtimeMessage: async (_participantId: string, message: ClientToServerMessage) => {
      await onMessage(message);
    },
    broadcast: (_message: ServerToClientMessage) => {},
    scheduleEmptyRoomPurge: async () => {},
  };
}

describe("room websocket event handling", () => {
  it("routes parsed client messages through the Effect API", async () => {
    const socket = new TestSocket("p1");
    let routed: ClientToServerMessage | null = null;

    await Effect.runPromise(handleRoomWebSocketMessageEffect(
      hostFor(socket, (message) => {
        routed = message;
      }),
      socket as unknown as WebSocket,
      JSON.stringify({ type: "add-item", text: "Card", columnId: "mad" }),
    ));

    expect(routed).toEqual({ type: "add-item", text: "Card", columnId: "mad" });
    expect(socket.sent).toEqual([]);
    expect(socket.closed).toEqual([]);
  });

  it("reports invalid messages without throwing", async () => {
    const socket = new TestSocket("p1");

    await Effect.runPromise(handleRoomWebSocketMessageEffect(hostFor(socket), socket as unknown as WebSocket, "{bad json"));

    expect(socket.sent).toEqual([JSON.stringify({ type: "error", message: "Invalid message" })]);
  });

  it("closes obsolete sessions before parsing messages", async () => {
    const socket = new TestSocket("p2");

    await Effect.runPromise(handleRoomWebSocketMessageEffect(hostFor(socket), socket as unknown as WebSocket, "{}"));

    expect(socket.closed).toEqual([{ code: 1008, reason: "Obsolete realtime session" }]);
  });
});
