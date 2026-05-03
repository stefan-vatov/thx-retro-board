import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { handleCreateRoomRequestEffect } from "./index-effect";
import type { Env } from "./index";

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: undefined,
    RETRO_ROOM: {
      idFromName: (name: string) => ({ name }) as DurableObjectId,
      get: (id: DurableObjectId) => ({
        initRoom: async (roomId: string, facilitatorClaimToken: string) => ({
          roomId,
          facilitatorClaimToken,
          id,
        }),
      }) as unknown as DurableObjectStub,
    } as unknown as Env["RETRO_ROOM"],
    ...overrides,
  };
}

describe("handleCreateRoomRequestEffect", () => {
  it("rate limits production room creation before allocating a Durable Object", async () => {
    const response = await Effect.runPromise(handleCreateRoomRequestEffect(
      new Request("https://retro.thethracian.com/api/rooms", {
        method: "POST",
        headers: { "CF-Connecting-IP": "198.51.100.10" },
      }),
      createEnv({
        RETRO_ROOM: {
          idFromName: () => {
            throw new Error("RETRO_ROOM should not be touched");
          },
        } as unknown as Env["RETRO_ROOM"],
        TURNSTILE_SITE_KEY: "site-key",
        TURNSTILE_SECRET_KEY: "secret-key",
        ROOM_CREATE_RATE_LIMITER: {
          limit: async () => ({ success: false }),
        },
        ROOM_ACCESS_RATE_LIMITER: {
          limit: async () => ({ success: true }),
        },
      }),
      new URL("https://retro.thethracian.com/api/rooms"),
      { generateRoomId: () => Effect.succeed("ABCDEFGHIJKLMNOPQRSTU"), generateFacilitatorClaimToken: () => Effect.succeed("claim") },
    ));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "Too many rooms created from this network. Please wait a minute and try again.",
    });
  });

  it("fails closed in production when anti-abuse config is incomplete", async () => {
    const response = await Effect.runPromise(handleCreateRoomRequestEffect(
      new Request("https://retro.thethracian.com/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnstileToken: "token" }),
      }),
      createEnv({
        TURNSTILE_SITE_KEY: "site-key",
        TURNSTILE_SECRET_KEY: "secret-key",
        ROOM_CREATE_RATE_LIMITER: {
          limit: async () => ({ success: true }),
        },
      }),
      new URL("https://retro.thethracian.com/api/rooms"),
      { generateRoomId: () => Effect.succeed("ABCDEFGHIJKLMNOPQRSTU"), generateFacilitatorClaimToken: () => Effect.succeed("claim") },
    ));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Room creation is temporarily unavailable.",
    });
  });

  it("creates a room after permissive local verification", async () => {
    const response = await Effect.runPromise(handleCreateRoomRequestEffect(
      new Request("http://localhost/api/rooms", { method: "POST" }),
      createEnv(),
      new URL("http://localhost/api/rooms"),
      { generateRoomId: () => Effect.succeed("ABCDEFGHIJKLMNOPQRSTU"), generateFacilitatorClaimToken: () => Effect.succeed("claim-token") },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      roomId: "ABCDEFGHIJKLMNOPQRSTU",
      facilitatorClaimToken: "claim-token",
    });
  });
});
