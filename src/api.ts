import type { RoomState } from "./domain";

export async function createRoom(): Promise<{ roomId: string }> {
  const res = await fetch("/api/rooms", { method: "POST" });
  if (!res.ok) throw new Error("Failed to create room");
  return res.json() as Promise<{ roomId: string }>;
}

export async function getRoomState(roomId: string): Promise<RoomState> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`);
  if (!res.ok) throw new Error("Room not found");
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
