// @ts-expect-error -- cloudflare:workers vitest module
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker, { type Env } from "./index";
import { createRoomRequest } from "./index-test-helpers";

describe("POST /api/rooms", () => {
  it("rate limits room creation before allocating a Durable Object", async () => {
    const response = await worker.fetch(
      new Request("https://retro.thethracian.com/api/rooms", {
        method: "POST",
        headers: { "CF-Connecting-IP": "198.51.100.10" },
      }),
      {
        ASSETS: undefined,
        RETRO_ROOM: undefined as unknown as Env["RETRO_ROOM"],
        TURNSTILE_SITE_KEY: "site-key",
        TURNSTILE_SECRET_KEY: "secret-key",
        ROOM_CREATE_RATE_LIMITER: {
          limit: async () => ({ success: false }),
        },
        ROOM_ACCESS_RATE_LIMITER: {
          limit: async () => ({ success: true }),
        },
      },
      {} as ExecutionContext,
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "Too many rooms created from this network. Please wait a minute and try again.",
    });
  });

  it("rate limits all production room-scoped routes before touching Durable Objects", async () => {
    const roomId = "ABCDEFGHIJKLMNOPQRSTU";
    const response = await worker.fetch(
      new Request(`https://retro.thethracian.com/api/rooms/${roomId}/vote-budget`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.11" },
        body: JSON.stringify({ participantId: "fac", connectionToken: "wrong", budget: 10 }),
      }),
      {
        ASSETS: undefined,
        RETRO_ROOM: {
          idFromName: () => {
            throw new Error("RETRO_ROOM should not be touched after access rate limit rejects");
          },
        } as unknown as Env["RETRO_ROOM"],
        ROOM_ACCESS_RATE_LIMITER: {
          limit: async () => ({ success: false }),
        },
      },
      {} as ExecutionContext,
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "Too many room attempts from this network. Please wait a minute and try again.",
    });
  });

  it("rejects oversized JSON bodies before forwarding room mutations", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = (await createRes.json()) as { roomId: string };

    const response = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/vote-budget`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantId: "fac",
        connectionToken: "wrong",
        budget: 10,
        padding: "x".repeat(40 * 1024),
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Valid JSON body is required",
    });
  });

  it("rejects malformed join bodies before forwarding to the Durable Object", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = (await createRes.json()) as { roomId: string };

    const response = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Valid JSON body is required",
    });
  });

  it("rejects malformed room mutation bodies through Effect schema validation", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = (await createRes.json()) as { roomId: string };

    const response = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/phase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "fac", connectionToken: "wrong", phase: "done" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Valid JSON body is required",
    });
  });

  it("requires Turnstile when the secret is configured", async () => {
    const response = await worker.fetch(
      new Request("http://localhost/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      {
        ASSETS: undefined,
        RETRO_ROOM: undefined as unknown as Env["RETRO_ROOM"],
        TURNSTILE_SECRET_KEY: "secret-key",
      },
      {} as ExecutionContext,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Verification is required before creating a room.",
    });
  });

  it("fails closed with a controlled response when Turnstile verification cannot be reached", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
        throw new TypeError("turnstile unavailable");
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const response = await worker.fetch(
        new Request("https://retro.thethracian.com/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.21" },
          body: JSON.stringify({ turnstileToken: "token" }),
        }),
        {
          ASSETS: undefined,
          RETRO_ROOM: undefined as unknown as Env["RETRO_ROOM"],
          TURNSTILE_SITE_KEY: "site-key",
          TURNSTILE_SECRET_KEY: "secret-key",
          ROOM_CREATE_RATE_LIMITER: {
            limit: async () => ({ success: true }),
          },
          ROOM_ACCESS_RATE_LIMITER: {
            limit: async () => ({ success: true }),
          },
        },
        {} as ExecutionContext,
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "Verification failed. Please retry and create the room again.",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails closed for production room creation when anti-abuse config is incomplete", async () => {
    const response = await worker.fetch(
      new Request("https://retro.thethracian.com/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.20" },
        body: JSON.stringify({ turnstileToken: "token" }),
      }),
      {
        ASSETS: undefined,
        RETRO_ROOM: undefined as unknown as Env["RETRO_ROOM"],
        TURNSTILE_SITE_KEY: "site-key",
        TURNSTILE_SECRET_KEY: "secret-key",
        ROOM_CREATE_RATE_LIMITER: {
          limit: async () => ({ success: true }),
        },
      },
      {} as ExecutionContext,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Room creation is temporarily unavailable.",
    });
  });

  it("creates a room and returns roomId", async () => {
    const response = await exports.default.fetch(createRoomRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { roomId: string };
    expect(typeof body.roomId).toBe("string");
    expect(body.roomId.length).toBe(21);
  });

  it("creates unique room ids on successive calls", async () => {
    const res1 = await exports.default.fetch(createRoomRequest());
    const res2 = await exports.default.fetch(createRoomRequest());
    const body1 = (await res1.json()) as { roomId: string };
    const body2 = (await res2.json()) as { roomId: string };
    expect(body1.roomId).not.toBe(body2.roomId);
  });

  it("room ID contains only URL-safe characters", async () => {
    const response = await exports.default.fetch(createRoomRequest());
    const { roomId } = (await response.json()) as { roomId: string };
    expect(roomId).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
