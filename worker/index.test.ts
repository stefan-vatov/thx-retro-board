// @ts-expect-error -- cloudflare:workers vitest module
import { exports } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

describe("Worker fetch", () => {
  it("returns JSON from GET /api/rooms", async () => {
    const response = await exports.default.fetch("http://localhost/api/rooms");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ message: "Retro Board API" });
  });

  it("returns 404 for unknown routes", async () => {
    const response = await exports.default.fetch("http://localhost/nonexistent-path");
    expect(response.status).toBe(404);
  });
});

describe("POST /api/rooms", () => {
  it("creates a room and returns roomId", async () => {
    const response = await exports.default.fetch("http://localhost/api/rooms", {
      method: "POST",
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { roomId: string };
    expect(typeof body.roomId).toBe("string");
    expect(body.roomId.length).toBe(21);
  });

  it("creates unique room ids on successive calls", async () => {
    const res1 = await exports.default.fetch("http://localhost/api/rooms", { method: "POST" });
    const res2 = await exports.default.fetch("http://localhost/api/rooms", { method: "POST" });
    const body1 = await res1.json() as { roomId: string };
    const body2 = await res2.json() as { roomId: string };
    expect(body1.roomId).not.toBe(body2.roomId);
  });
});

describe("GET /api/rooms/:roomId", () => {
  it("returns room state for an existing room", async () => {
    const createRes = await exports.default.fetch("http://localhost/api/rooms", { method: "POST" });
    const { roomId } = await createRes.json() as { roomId: string };

    const getRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}`);
    expect(getRes.status).toBe(200);
    const state = await getRes.json() as { roomId: string; phase: string };
    expect(state.roomId).toBe(roomId);
    expect(state.phase).toBe("write");
  });

  it("returns 404 for non-existent room", async () => {
    const res = await exports.default.fetch("http://localhost/api/rooms/nonexistent-room");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/rooms/:roomId/join", () => {
  it("joins a room with a valid display name", async () => {
    const createRes = await exports.default.fetch("http://localhost/api/rooms", { method: "POST" });
    const { roomId } = await createRes.json() as { roomId: string };

    const joinRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", displayName: "Alice" }),
    });
    expect(joinRes.status).toBe(200);
    const result = await joinRes.json() as { success: boolean; state?: { participants: Array<{ id: string }> } };
    expect(result.success).toBe(true);
    expect(result.state?.participants).toHaveLength(1);
  });

  it("rejects blank display names", async () => {
    const createRes = await exports.default.fetch("http://localhost/api/rooms", { method: "POST" });
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
    const createRes = await exports.default.fetch("http://localhost/api/rooms", { method: "POST" });
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
    const createRes = await exports.default.fetch("http://localhost/api/rooms", { method: "POST" });
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
});
