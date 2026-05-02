// @ts-expect-error -- cloudflare:workers vitest module
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createRoomRequest } from "./index-test-helpers";

describe("GET /api/rooms/:roomId", () => {
  it("returns only room metadata for an existing room before participant auth", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = (await createRes.json()) as { roomId: string };

    const getRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}`);
    expect(getRes.status).toBe(200);
    const state = (await getRes.json()) as { roomId: string; phase: string; version: number };
    expect(state.roomId).toBe(roomId);
    expect(state).not.toHaveProperty("phase");
    expect(state).not.toHaveProperty("participants");
  });

  it("returns 404 for non-existent room", async () => {
    const res = await exports.default.fetch("http://localhost/api/rooms/nonexistent-room");
    expect(res.status).toBe(404);
  });

  it("requires participant credentials before returning full room state", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId, facilitatorClaimToken } = (await createRes.json()) as {
      roomId: string;
      facilitatorClaimToken: string;
    };

    const joinRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "fac", displayName: "Facilitator", facilitatorClaimToken }),
    });
    const join = (await joinRes.json()) as { connectionToken?: string };

    const unauthenticated = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "fac", connectionToken: "wrong" }),
    });
    expect(unauthenticated.status).toBe(403);

    const authenticated = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "fac", connectionToken: join.connectionToken }),
    });
    expect(authenticated.status).toBe(200);
    const result = (await authenticated.json()) as { success: boolean; state?: { roomId: string; phase: string } };
    expect(result).toMatchObject({ success: true, state: { roomId, phase: "setup" } });
  });
});

describe("POST /api/rooms/:roomId/join", () => {
  it("joins a room with a valid display name and returns connectionToken", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = (await createRes.json()) as { roomId: string };

    const joinRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", displayName: "Alice" }),
    });
    expect(joinRes.status).toBe(200);
    const result = (await joinRes.json()) as {
      success: boolean;
      connectionToken?: string;
      state?: { participants: Array<{ id: string }> };
    };
    expect(result.success).toBe(true);
    expect(result.state?.participants).toHaveLength(1);
    expect(typeof result.connectionToken).toBe("string");
    expect(result.connectionToken!.length).toBeGreaterThan(0);
  });

  it("rejects blank display names", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = (await createRes.json()) as { roomId: string };

    const joinRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", displayName: "   " }),
    });
    const result = (await joinRes.json()) as { success: boolean; error?: string };
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("first participant becomes facilitator", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId, facilitatorClaimToken } = (await createRes.json()) as {
      roomId: string;
      facilitatorClaimToken: string;
    };

    const joinRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", displayName: "Alice", facilitatorClaimToken }),
    });
    const result = (await joinRes.json()) as {
      success: boolean;
      state?: { participants: Array<{ isFacilitator: boolean }> };
    };
    expect(result.success).toBe(true);
    expect(result.state?.participants[0]?.isFacilitator).toBe(true);
  });

  it("does not let an early invite opener claim facilitator without the creator token", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId, facilitatorClaimToken } = (await createRes.json()) as {
      roomId: string;
      facilitatorClaimToken: string;
    };

    const earlyJoinRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "early", displayName: "Early opener" }),
    });
    const earlyJoin = (await earlyJoinRes.json()) as {
      success: boolean;
      state?: { participants: Array<{ id: string; isFacilitator: boolean }> };
    };
    expect(earlyJoin.success).toBe(true);
    expect(earlyJoin.state?.participants.find((participant) => participant.id === "early")?.isFacilitator).toBe(false);

    const creatorJoinRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "creator", displayName: "Creator", facilitatorClaimToken }),
    });
    const creatorJoin = (await creatorJoinRes.json()) as {
      success: boolean;
      state?: { participants: Array<{ id: string; isFacilitator: boolean }> };
    };
    expect(creatorJoin.success).toBe(true);
    expect(creatorJoin.state?.participants.find((participant) => participant.id === "creator")?.isFacilitator).toBe(true);
  });

  it("second participant is not facilitator", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId, facilitatorClaimToken } = (await createRes.json()) as {
      roomId: string;
      facilitatorClaimToken: string;
    };

    await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", displayName: "Alice", facilitatorClaimToken }),
    });

    const joinRes2 = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p2", displayName: "Bob" }),
    });
    const result2 = (await joinRes2.json()) as {
      success: boolean;
      state?: { participants: Array<{ id: string; isFacilitator: boolean }> };
    };
    expect(result2.success).toBe(true);
    const p2 = result2.state?.participants.find((p) => p.id === "p2");
    expect(p2?.isFacilitator).toBe(false);
  });

  it("rejects re-joining an existing participant without the current connection token", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = (await createRes.json()) as { roomId: string };

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
    const result = (await joinRes.json()) as { success: boolean; error?: string };

    expect(result).toEqual({ success: false, error: "Invalid participant credentials" });
  });

  it("does not cancel room cleanup on rejected rejoin attempts", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = (await createRes.json()) as { roomId: string };

    const joinRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", displayName: "Alice" }),
    });
    const join = (await joinRes.json()) as { connectionToken?: string };
    const beforeRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", connectionToken: join.connectionToken }),
    });
    const beforeBody = (await beforeRes.json()) as { state: { purgeScheduledAt: number | null } };
    const before = beforeBody.state;
    expect(before.purgeScheduledAt).not.toBeNull();

    await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", displayName: "Alice" }),
    });
    const afterRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", connectionToken: join.connectionToken }),
    });
    const afterBody = (await afterRes.json()) as { state: { purgeScheduledAt: number | null } };
    const after = afterBody.state;

    expect(after.purgeScheduledAt).toBe(before.purgeScheduledAt);
  });

  it("re-joining same participant with the current connection token returns a new token", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = (await createRes.json()) as { roomId: string };

    const joinRes1 = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", displayName: "Alice" }),
    });
    const result1 = (await joinRes1.json()) as { success: boolean; connectionToken?: string };

    const joinRes2 = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", displayName: "Alice", connectionToken: result1.connectionToken }),
    });
    const result2 = (await joinRes2.json()) as { success: boolean; connectionToken?: string };
    expect(result2.success).toBe(true);
    expect(typeof result2.connectionToken).toBe("string");
    expect(result2.connectionToken).not.toBe(result1.connectionToken);
  });

  it("issues websocket tickets only for valid participant credentials", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = (await createRes.json()) as { roomId: string };

    const joinRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", displayName: "Alice" }),
    });
    const join = (await joinRes.json()) as { connectionToken?: string };

    const rejected = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/ws-ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", connectionToken: "wrong" }),
    });
    expect(rejected.status).toBe(403);
    await expect(rejected.json()).resolves.toEqual({
      success: false,
      error: "Invalid participant credentials",
    });

    const accepted = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/ws-ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1", connectionToken: join.connectionToken }),
    });
    expect(accepted.status).toBe(200);
    const ticket = (await accepted.json()) as { success: boolean; ticket?: string };
    expect(ticket.success).toBe(true);
    expect(ticket.ticket).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("POST /api/rooms/:roomId/vote-budget", () => {
  it("sets vote budget for facilitator", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId, facilitatorClaimToken } = (await createRes.json()) as {
      roomId: string;
      facilitatorClaimToken: string;
    };

    const joinRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "fac", displayName: "Facilitator", facilitatorClaimToken }),
    });
    const join = (await joinRes.json()) as { connectionToken?: string };

    const budgetRes = await exports.default.fetch(`http://localhost/api/rooms/${roomId}/vote-budget`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "fac", connectionToken: join.connectionToken, budget: 10 }),
    });
    expect(budgetRes.status).toBe(200);
    const result = (await budgetRes.json()) as { success: boolean };
    expect(result.success).toBe(true);
  });

  it("rejects mutating HTTP requests without a valid participant token", async () => {
    const createRes = await exports.default.fetch(createRoomRequest());
    const { roomId } = (await createRes.json()) as { roomId: string };

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
