import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { ClientToServerMessage, ServerToClientMessage } from "../src/domain";
import { handleRoomWebSocketCloseEffect, handleRoomWebSocketMessageEffect } from "./room-websocket-events";

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
  const removedSessions: string[] = [];
  const removedParticipants: string[] = [];
  const broadcasts: ServerToClientMessage[] = [];
  let purgeSchedules = 0;
  return {
    getSession: (participantId: string) => participantId === "p1" ? socket as unknown as WebSocket : undefined,
    removeSession: (participantId: string) => {
      removedSessions.push(participantId);
    },
    removeRealtimeParticipant: (participantId: string) => {
      removedParticipants.push(participantId);
    },
    allowWebSocketMessage: () => ({ allowed: true as const }),
    handleRealtimeMessage: async (_participantId: string, message: ClientToServerMessage) => {
      await onMessage(message);
    },
    broadcast: (message: ServerToClientMessage) => {
      broadcasts.push(message);
    },
    scheduleEmptyRoomPurge: async () => {
      purgeSchedules += 1;
    },
    removedSessions,
    removedParticipants,
    broadcasts,
    get purgeSchedules() {
      return purgeSchedules;
    },
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

  it("removes connected participants and schedules purge through the close Effect", async () => {
    const socket = new TestSocket("p1");
    const host = hostFor(socket);

    await Effect.runPromise(handleRoomWebSocketCloseEffect(host, socket as unknown as WebSocket));

    expect(host.removedSessions).toEqual(["p1"]);
    expect(host.removedParticipants).toEqual(["p1"]);
    expect(host.broadcasts).toEqual([{ type: "participant-left", participantId: "p1" }]);
    expect(host.purgeSchedules).toBe(1);
  });

  it("ignores close events for obsolete sockets through the close Effect", async () => {
    const activeSocket = new TestSocket("p1");
    const staleSocket = new TestSocket("p1");
    const host = hostFor(activeSocket);

    await Effect.runPromise(handleRoomWebSocketCloseEffect(host, staleSocket as unknown as WebSocket));

    expect(host.removedSessions).toEqual([]);
    expect(host.broadcasts).toEqual([]);
    expect(host.purgeSchedules).toBe(0);
  });
});
