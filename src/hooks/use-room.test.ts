import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeRealtimeMessageEffect,
  openRealtimeWebSocketEffect,
  prepareRealtimeSendEffect,
  runRealtimeMessageDecode,
} from "./use-room";

describe("realtime message decoding", () => {
  it("decodes valid realtime error messages as an Effect", async () => {
    await expect(
      Effect.runPromise(
        decodeRealtimeMessageEffect(
          JSON.stringify({
            type: "error",
            message: "Nope",
          }),
        ),
      ),
    ).resolves.toEqual({
      type: "error",
      message: "Nope",
    });
  });

  it("rejects malformed realtime snapshot payloads instead of trusting unknown JSON", async () => {
    const exit = await Effect.runPromiseExit(
      decodeRealtimeMessageEffect(
        JSON.stringify({
          type: "snapshot",
          state: {
            roomId: "ROOM123",
          },
        }),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("rejects non-json websocket payloads as typed failures", async () => {
    const exit = await Effect.runPromiseExit(
      decodeRealtimeMessageEffect("{not json"),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("bridges realtime decoding to nullable Promise values for React event handlers", async () => {
    await expect(
      runRealtimeMessageDecode(
        JSON.stringify({
          type: "error",
          message: "Nope",
        }),
      ),
    ).resolves.toEqual({
      type: "error",
      message: "Nope",
    });
    await expect(runRealtimeMessageDecode("{not json")).resolves.toBeNull();
  });
});

describe("realtime outbound message encoding", () => {
  it("serializes valid client commands through an Effect boundary", async () => {
    await expect(
      Effect.runPromise(
        prepareRealtimeSendEffect({
          type: "set-phase",
          phase: "vote",
        }),
      ),
    ).resolves.toBe(
      JSON.stringify({
        type: "set-phase",
        phase: "vote",
      }),
    );
  });

  it("rejects invalid client commands before sending", async () => {
    const exit = await Effect.runPromiseExit(
      prepareRealtimeSendEffect({
        type: "set-phase",
        phase: "done",
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("realtime websocket creation", () => {
  it("creates websocket connections only after a successful ticket", async () => {
    const calls: string[] = [];
    const socket = {} as WebSocket;

    const result = await Effect.runPromise(
      openRealtimeWebSocketEffect(
        {
          roomId: "room id",
          participantId: "p1",
          connectionToken: "token",
          protocol: "wss:",
          host: "retro.test",
        },
        {
          createTicket: (roomId, participantId, connectionToken) =>
            Effect.sync(() => {
              calls.push(
                `ticket:${roomId}:${participantId}:${connectionToken}`,
              );
              return { success: true, ticket: "ticket-a" };
            }),
          createSocket: (url, protocols) =>
            Effect.sync(() => {
              calls.push(`socket:${url}:${protocols.join(",")}`);
              return socket;
            }),
        },
      ),
    );

    expect(result).toEqual({ success: true, socket });
    expect(calls).toEqual([
      "ticket:room id:p1:token",
      "socket:wss://retro.test/api/rooms/room%20id/ws:retro-board,ticket-ticket-a",
    ]);
  });

  it("returns ticket errors without opening a websocket", async () => {
    const result = await Effect.runPromise(
      openRealtimeWebSocketEffect(
        {
          roomId: "room",
          participantId: "p1",
          connectionToken: "token",
          protocol: "ws:",
          host: "localhost",
        },
        {
          createTicket: () =>
            Effect.succeed({ success: false, error: "No ticket" }),
          createSocket: () =>
            Effect.sync(() => {
              throw new Error("socket should not open");
            }),
        },
      ),
    );

    expect(result).toEqual({ success: false, error: "No ticket" });
  });
});
