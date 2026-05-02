import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { handleRoomApiRequestEffect } from "./index-room-route";
import type { Env } from "./index";

interface ForwardedRequest {
  url: string;
  method: string;
  body: unknown;
}

function createEnv(options: {
  hasRoom?: boolean;
  forwarded?: ForwardedRequest[];
  accessLimiter?: RateLimit;
  failOnDurableObject?: boolean;
} = {}): Env {
  const forwarded = options.forwarded ?? [];
  return {
    ASSETS: undefined,
    RETRO_ROOM: {
      idFromName: (name: string) => {
        if (options.failOnDurableObject) throw new Error("RETRO_ROOM should not be touched");
        return ({ name }) as DurableObjectId;
      },
      get: () => ({
        hasRoom: async () => options.hasRoom ?? true,
        fetch: async (request: Request) => {
          const text = await request.text();
          forwarded.push({
            url: request.url,
            method: request.method,
            body: text.length > 0 ? JSON.parse(text) : null,
          });
          return Response.json({ ok: true });
        },
      }) as unknown as DurableObjectStub,
    } as unknown as Env["RETRO_ROOM"],
    ROOM_ACCESS_RATE_LIMITER: options.accessLimiter,
  };
}

describe("handleRoomApiRequestEffect", () => {
  it("rejects malformed room ids before touching Durable Objects", async () => {
    const response = await Effect.runPromise(handleRoomApiRequestEffect(
      new Request("http://localhost/api/rooms/not-a-valid-room-id"),
      createEnv({ failOnDurableObject: true }),
      new URL("http://localhost/api/rooms/not-a-valid-room-id"),
    ));

    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toEqual({ error: "Room not found" });
  });

  it("fails closed for production room access without an access limiter", async () => {
    const response = await Effect.runPromise(handleRoomApiRequestEffect(
      new Request("https://retro.thethracian.com/api/rooms/ABCDEFGHIJKLMNOPQRSTU"),
      createEnv({ failOnDurableObject: true }),
      new URL("https://retro.thethracian.com/api/rooms/ABCDEFGHIJKLMNOPQRSTU"),
    ));

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({ error: "Room access is temporarily unavailable." });
  });

  it("returns controlled 404s for missing rooms", async () => {
    const metadata = await Effect.runPromise(handleRoomApiRequestEffect(
      new Request("http://localhost/api/rooms/ABCDEFGHIJKLMNOPQRSTU"),
      createEnv({ hasRoom: false }),
      new URL("http://localhost/api/rooms/ABCDEFGHIJKLMNOPQRSTU"),
    ));
    const mutation = await Effect.runPromise(handleRoomApiRequestEffect(
      new Request("http://localhost/api/rooms/ABCDEFGHIJKLMNOPQRSTU/vote-budget", { method: "POST" }),
      createEnv({ hasRoom: false }),
      new URL("http://localhost/api/rooms/ABCDEFGHIJKLMNOPQRSTU/vote-budget"),
    ));

    expect(metadata?.status).toBe(404);
    await expect(metadata?.json()).resolves.toEqual({ error: "Room not found" });
    expect(mutation?.status).toBe(404);
    await expect(mutation?.json()).resolves.toEqual({ success: false, error: "Room not found" });
  });

  it("validates room mutation bodies before forwarding", async () => {
    const forwarded: ForwardedRequest[] = [];
    const response = await Effect.runPromise(handleRoomApiRequestEffect(
      new Request("http://localhost/api/rooms/ABCDEFGHIJKLMNOPQRSTU/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId: "p1" }),
      }),
      createEnv({ forwarded }),
      new URL("http://localhost/api/rooms/ABCDEFGHIJKLMNOPQRSTU/join"),
    ));

    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      success: false,
      error: "Valid JSON body is required",
    });
    expect(forwarded).toEqual([]);
  });

  it("forwards valid room mutations to the matching Durable Object route", async () => {
    const forwarded: ForwardedRequest[] = [];
    const response = await Effect.runPromise(handleRoomApiRequestEffect(
      new Request("http://localhost/api/rooms/ABCDEFGHIJKLMNOPQRSTU/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId: "p1", displayName: "Pat" }),
      }),
      createEnv({ forwarded }),
      new URL("http://localhost/api/rooms/ABCDEFGHIJKLMNOPQRSTU/join"),
    ));

    expect(response?.status).toBe(200);
    expect(forwarded).toEqual([{
      url: "http://do/join",
      method: "POST",
      body: { participantId: "p1", displayName: "Pat" },
    }]);
  });

  it("returns null when the request is not a room API route", async () => {
    const response = await Effect.runPromise(handleRoomApiRequestEffect(
      new Request("http://localhost/api/config"),
      createEnv({ failOnDurableObject: true }),
      new URL("http://localhost/api/config"),
    ));

    expect(response).toBeNull();
  });
});
