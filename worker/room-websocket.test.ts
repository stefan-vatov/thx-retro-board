import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { createInitialStoredState } from "./room-storage";
import { handleRoomWebSocketRequest, handleRoomWebSocketRequestEffect } from "./room-websocket";

describe("room websocket request handling", () => {
  it("ignores non-websocket requests", async () => {
    const response = await handleRoomWebSocketRequest({} as never, new Request("https://example.test/room"));

    expect(response).toBeNull();
  });

  it("ignores non-websocket requests through the Effect API", async () => {
    const response = await Effect.runPromise(handleRoomWebSocketRequestEffect({} as never, new Request("https://example.test/room")));

    expect(response).toBeNull();
  });

  it("rejects invalid websocket tickets through the Effect API", async () => {
    let consumedTicket: string | null | undefined;
    const response = await Effect.runPromise(handleRoomWebSocketRequestEffect({
      consumeWebSocketTicket: async (ticket) => {
        consumedTicket = ticket;
        return { success: false, error: "Missing or invalid websocket ticket" };
      },
      loadState: async () => {
        throw new Error("should not load state");
      },
      cancelEmptyRoomPurge: async () => {},
      closeParticipantSocket: () => {},
      setSession: () => {},
      acceptWebSocket: () => {},
      broadcast: () => {},
    }, new Request("https://example.test/ws", { headers: { Upgrade: "websocket" } }), {
      getWebSocketTicket: () => Effect.succeed("deterministic-ticket"),
      consumeWebSocketTicket: (host, ticket) => Effect.promise(() => host.consumeWebSocketTicket(ticket)),
      loadState: (host) => Effect.promise(() => host.loadState()),
      cancelEmptyRoomPurge: (host) => Effect.promise(() => host.cancelEmptyRoomPurge()),
      closeParticipantSocket: (host, participantId, reason) =>
        Effect.sync(() => host.closeParticipantSocket(participantId, reason)),
      setSession: (host, participantId, socket) => Effect.sync(() => host.setSession(participantId, socket)),
      serializeAttachment: (socket, attachment) => Effect.sync(() => socket.serializeAttachment(attachment)),
      acceptWebSocket: (host, socket) => Effect.sync(() => host.acceptWebSocket(socket)),
      broadcast: (host, message, excludeId) => Effect.sync(() => host.broadcast(message, excludeId)),
      sendSnapshot: (socket, snapshot) => Effect.sync(() => socket.send(JSON.stringify(snapshot))),
    }));

    expect(consumedTicket).toBe("deterministic-ticket");
    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ error: "Missing or invalid websocket ticket" });
  });

  it("accepts websocket requests through injected Effect dependencies", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "p1", displayName: "Pat", isFacilitator: true }];
    state.facilitatorId = "p1";
    const calls: string[] = [];

    const response = await Effect.runPromise(handleRoomWebSocketRequestEffect({
      closeParticipantSocket: (participantId) => {
        calls.push(`close:${participantId}`);
      },
      setSession: (participantId) => {
        calls.push(`session:${participantId}`);
      },
      acceptWebSocket: (socket) => {
        socket.accept();
        calls.push("accept");
      },
      broadcast: (message, excludeId) => {
        calls.push(`broadcast:${message.type}:${excludeId}`);
      },
    } as never, new Request("https://example.test/ws?ticket=ticket-a", {
      headers: { Upgrade: "websocket" },
    }), {
      getWebSocketTicket: () => Effect.succeed("ticket-a"),
      consumeWebSocketTicket: (_host, ticket) => Effect.sync(() => {
        calls.push(`consume:${ticket}`);
        return { success: true as const, participantId: "p1" };
      }),
      loadState: () => Effect.sync(() => {
        calls.push("load");
        return state;
      }),
      cancelEmptyRoomPurge: () => Effect.sync(() => {
        calls.push("cancel-purge");
      }),
      closeParticipantSocket: (host, participantId, reason) =>
        Effect.sync(() => host.closeParticipantSocket(participantId, reason)),
      setSession: (host, participantId, socket) => Effect.sync(() => host.setSession(participantId, socket)),
      serializeAttachment: (socket, attachment) => Effect.sync(() => socket.serializeAttachment(attachment)),
      acceptWebSocket: (host, socket) => Effect.sync(() => host.acceptWebSocket(socket)),
      broadcast: (host, message, excludeId) => Effect.sync(() => host.broadcast(message, excludeId)),
      sendSnapshot: (socket, snapshot) => Effect.sync(() => socket.send(JSON.stringify(snapshot))),
    }));

    expect(response?.status).toBe(101);
    expect(calls).toEqual([
      "consume:ticket-a",
      "load",
      "cancel-purge",
      "close:p1",
      "session:p1",
      "accept",
      "broadcast:participant-joined:p1",
    ]);
  });

  it("accepts websocket requests without direct host side effects", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "p1", displayName: "Pat", isFacilitator: true }];
    state.facilitatorId = "p1";
    const calls: string[] = [];

    const response = await Effect.runPromise(handleRoomWebSocketRequestEffect({} as never, new Request("https://example.test/ws", {
      headers: { Upgrade: "websocket" },
    }), {
      getWebSocketTicket: () => Effect.succeed("ticket-a"),
      consumeWebSocketTicket: (_host, ticket) => Effect.sync(() => {
        calls.push(`consume:${ticket}`);
        return { success: true as const, participantId: "p1" };
      }),
      loadState: () => Effect.sync(() => {
        calls.push("load");
        return state;
      }),
      cancelEmptyRoomPurge: () => Effect.sync(() => {
        calls.push("cancel-purge");
      }),
      closeParticipantSocket: (_host, participantId, reason) => Effect.sync(() => {
        calls.push(`close:${participantId}:${reason}`);
      }),
      setSession: (_host, participantId) => Effect.sync(() => {
        calls.push(`session:${participantId}`);
      }),
      serializeAttachment: (_socket, attachment) => Effect.sync(() => {
        calls.push(`attach:${attachment.participantId}`);
      }),
      acceptWebSocket: () => Effect.sync(() => {
        calls.push("accept");
      }),
      broadcast: (_host, message, excludeId) => Effect.sync(() => {
        calls.push(`broadcast:${message.type}:${excludeId}`);
      }),
      sendSnapshot: (_socket, snapshot) => Effect.sync(() => {
        calls.push(`snapshot:${snapshot.type}`);
      }),
    }));

    expect(response?.status).toBe(101);
    expect(calls).toEqual([
      "consume:ticket-a",
      "load",
      "cancel-purge",
      "close:p1:Participant opened a new connection",
      "session:p1",
      "attach:p1",
      "accept",
      "broadcast:participant-joined:p1",
      "snapshot:snapshot",
    ]);
  });
});
