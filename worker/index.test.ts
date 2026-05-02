// @ts-expect-error -- cloudflare:workers vitest module
import { exports } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import worker, { type Env } from "./index";

let createRoomRequestIndex = 0;

function createRoomRequest(): Request {
  createRoomRequestIndex += 1;
  return new Request("http://localhost/api/rooms", {
    method: "POST",
    headers: { "CF-Connecting-IP": `203.0.113.${createRoomRequestIndex}` },
  });
}

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
          fetch: async () => new Response("<html>app</html>", {
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

  it("returns 404 for unsupported methods on valid paths", async () => {
    const response = await exports.default.fetch("http://localhost/api/rooms", {
      method: "DELETE",
    });
    expect(response.status).toBe(404);
  });
});

describe("POST /api/rooms", () => {
  it("rate limits room creation before allocating a Durable Object", async () => {
    const response = await worker.fetch(
      new Request("http://localhost/api/rooms", {
        method: "POST",
        headers: { "CF-Connecting-IP": "198.51.100.10" },
      }),
      {
        ASSETS: undefined,
        RETRO_ROOM: undefined as unknown as Env["RETRO_ROOM"],
        ROOM_CREATE_RATE_LIMITER: {
          limit: async () => ({ success: false }),
        },
      },
      {} as ExecutionContext,
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "Too many rooms created from this network. Please wait a minute and try again.",
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

  it("creates a room and returns roomId", async () => {
    const response = await exports.default.fetch(createRoomRequest());
    expect(response.status).toBe(200);
    const body = await response.json() as { roomId: string };
    expect(typeof body.roomId).toBe("string");
    expect(body.roomId.length).toBe(21);
  });

  it("creates unique room ids on successive calls", async () => {
    const res1 = await exports.default.fetch(createRoomRequest());
    const res2 = await exports.default.fetch(createRoomRequest());
    const body1 = await res1.json() as { roomId: string };
    const body2 = await res2.json() as { roomId: string };
    expect(body1.roomId).not.toBe(body2.roomId);
  });

  it("room ID contains only URL-safe characters", async () => {
    const response = await exports.default.fetch(createRoomRequest());
    const { roomId } = await response.json() as { roomId: string };
    expect(roomId).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("GET /api/rooms/:roomId", () => {
  it("returns room state for an existing room", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = await createRes.json() as { roomId: string };

    const getRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}`);
    expect(getRes.status).toBe(200);
    const state = await getRes.json() as { roomId: string; phase: string; version: number };
    expect(state.roomId).toBe(roomId);
    expect(state.phase).toBe("setup");
    expect(typeof state.version).toBe("number");
  });

  it("returns 404 for non-existent room", async () => {
    const res = await exports.default.fetch("http://localhost/api/rooms/nonexistent-room");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/rooms/:roomId/join", () => {
  it("joins a room with a valid display name and returns connectionToken", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = await createRes.json() as { roomId: string };

    const joinRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", displayName: "Alice" }),
    });
    expect(joinRes.status).toBe(200);
    const result = await joinRes.json() as { success: boolean; connectionToken?: string; state?: { participants: Array<{ id: string }> } };
    expect(result.success).toBe(true);
    expect(result.state?.participants).toHaveLength(1);
    expect(typeof result.connectionToken).toBe("string");
    expect(result.connectionToken!.length).toBeGreaterThan(0);
  });

  it("rejects blank display names", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = await createRes.json() as { roomId: string };

    const joinRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", displayName: "   " }),
    });
    const result = await joinRes.json() as { success: boolean; error?: string };
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("first participant becomes facilitator", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = await createRes.json() as { roomId: string };

    const joinRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", displayName: "Alice" }),
    });
    const result = await joinRes.json() as { success: boolean; state?: { participants: Array<{ isFacilitator: boolean }> } };
    expect(result.success).toBe(true);
    expect(result.state?.participants[0]?.isFacilitator).toBe(true);
  });

  it("second participant is not facilitator", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = await createRes.json() as { roomId: string };

    await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", displayName: "Alice" }),
    });

    const joinRes2 = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p2", displayName: "Bob" }),
    });
    const result2 = await joinRes2.json() as { success: boolean; state?: { participants: Array<{ id: string; isFacilitator: boolean }> } };
    expect(result2.success).toBe(true);
    const p2 = result2.state?.participants.find((p) => p.id === "p2");
    expect(p2?.isFacilitator).toBe(false);
  });

  it("rejects re-joining an existing participant without the current connection token", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = await createRes.json() as { roomId: string };

    await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", displayName: "Alice" }),
    });

    const joinRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", displayName: "Alice" }),
    });
    const result = await joinRes.json() as { success: boolean; error?: string };

    expect(result).toEqual({ success: false, error: "Invalid participant credentials" });
  });

  it("does not cancel room cleanup on rejected rejoin attempts", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = await createRes.json() as { roomId: string };

    await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", displayName: "Alice" }),
    });
    const beforeRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}`);
    const before = await beforeRes.json() as { purgeScheduledAt: number | null };
    expect(before.purgeScheduledAt).not.toBeNull();

    await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", displayName: "Alice" }),
    });
    const afterRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}`);
    const after = await afterRes.json() as { purgeScheduledAt: number | null };

    expect(after.purgeScheduledAt).toBe(before.purgeScheduledAt);
  });

  it("re-joining same participant with the current connection token returns a new token", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = await createRes.json() as { roomId: string };

    const joinRes1 = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", displayName: "Alice" }),
    });
    const result1 = await joinRes1.json() as { success: boolean; connectionToken?: string };

    const joinRes2 = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", displayName: "Alice", connectionToken: result1.connectionToken }),
    });
    const result2 = await joinRes2.json() as { success: boolean; connectionToken?: string };
    expect(result2.success).toBe(true);
    expect(typeof result2.connectionToken).toBe("string");
    expect(result2.connectionToken).not.toBe(result1.connectionToken);
  });
});

describe("POST /api/rooms/:roomId/vote-budget", () => {
  it("sets vote budget for facilitator", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = await createRes.json() as { roomId: string };

    const joinRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "fac", displayName: "Facilitator" }),
    });
    const join = await joinRes.json() as { connectionToken?: string };

    const budgetRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/vote-budget`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "fac", connectionToken: join.connectionToken, budget: 10 }),
    });
    expect(budgetRes.status).toBe(200);
    const result = await budgetRes.json() as { success: boolean };
    expect(result.success).toBe(true);
  });

  it("rejects mutating HTTP requests without a valid participant token", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = await createRes.json() as { roomId: string };

    await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "fac", displayName: "Facilitator" }),
    });

    const budgetRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/vote-budget`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "fac", budget: 10 }),
    });

    expect(budgetRes.status).toBe(403);
    await expect(budgetRes.json()).resolves.toEqual({
      success: false,
      error: "Invalid participant credentials",
    });
  });
});
