import type { RoomState, Phase } from "./domain";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function createRoom(): Promise<{ roomId: string }> {
  const res = await fetch("/api/rooms", { method: "POST" });
  if (!res.ok) throw new Error("Failed to create room");
  return res.json() as Promise<{ roomId: string }>;
}

export async function getRoomState(roomId: string): Promise<RoomState> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`);
  if (!res.ok) {
    const message = res.status === 404 ? "Room not found" : "Failed to load room";
    throw new ApiError(message, res.status);
  }
  return res.json() as Promise<RoomState>;
}

export async function joinRoom(
  roomId: string,
  participantId: string,
  displayName: string,
): Promise<{ success: boolean; error?: string; state?: RoomState; connectionToken?: string }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, displayName }),
  });
  return res.json() as Promise<{ success: boolean; error?: string; state?: RoomState; connectionToken?: string }>;
}

export async function setVoteBudget(
  roomId: string,
  participantId: string,
  budget: number,
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/vote-budget`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, budget }),
  });
  return res.json() as Promise<{ success: boolean; error?: string }>;
}

export async function setPhase(
  roomId: string,
  participantId: string,
  phase: Phase,
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/phase`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, phase }),
  });
  return res.json() as Promise<{ success: boolean; error?: string }>;
}
