// @ts-expect-error -- cloudflare:workers vitest module
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker, { type Env } from "./index";

describe("Worker fetch", () => {
  it("returns JSON from GET /api/rooms", async () => {
    const response = await exports.default.fetch("http://localhost/api/rooms");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ message: "Retro Board API" });
  });

  it("returns public anti-abuse config without exposing Turnstile secrets", async () => {
    const response = await worker.fetch(
      new Request("http://localhost/api/config"),
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

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ turnstileSiteKey: "site-key" });
  });

  it("returns 404 for unknown routes", async () => {
    const response = await exports.default.fetch("http://localhost/nonexistent-path");
    expect(response.status).toBe(404);
  });

  it("serves SPA assets for non-API routes when an assets binding is present", async () => {
    const response = await worker.fetch(
      new Request("http://localhost/room/example"),
      {
        ASSETS: {
          fetch: async () =>
            new Response("<html>app</html>", {
              headers: { "Content-Type": "text/html" },
            }),
        } as Fetcher,
        RETRO_ROOM: undefined as unknown as Env["RETRO_ROOM"],
      },
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>app</html>");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("returns 404 for malformed room paths", async () => {
    const response = await exports.default.fetch("http://localhost/api/rooms//join");
    expect(response.status).toBe(404);
  });

  it("rejects malformed room ids before touching Durable Objects", async () => {
    const response = await worker.fetch(
      new Request("http://localhost/api/rooms/not-a-valid-room-id"),
      {
        ASSETS: undefined,
        RETRO_ROOM: {
          idFromName: () => {
            throw new Error("RETRO_ROOM should not be touched for malformed ids");
          },
        } as unknown as Env["RETRO_ROOM"],
      },
      {} as ExecutionContext,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Room not found" });
  });

  it("returns controlled 404s for valid-looking room ids that have no stored room", async () => {
    const roomId = "ABCDEFGHIJKLMNOPQRSTU";

    const getResponse = await exports.default.fetch(`http://localhost/api/rooms/${roomId}`);
    expect(getResponse.status).toBe(404);
    await expect(getResponse.json()).resolves.toEqual({ error: "Room not found" });

    const mutationResponse = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/vote-budget`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "fac", connectionToken: "wrong", budget: 10 }),
    });
    expect(mutationResponse.status).toBe(404);
    await expect(mutationResponse.json()).resolves.toEqual({ success: false, error: "Room not found" });
  });

  it("returns 404 for unsupported methods on valid paths", async () => {
    const response = await exports.default.fetch("http://localhost/api/rooms", {
      method: "DELETE",
    });
    expect(response.status).toBe(404);
  });
});
