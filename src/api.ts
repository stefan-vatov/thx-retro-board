import type { RoomState, Phase, RetroItem, RankingMethod } from "./domain";

export interface PublicConfig {
  turnstileSiteKey: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function getPublicConfig(): Promise<PublicConfig> {
  const res = await fetch("/api/config");
  if (!res.ok) return { turnstileSiteKey: null };
  return res.json() as Promise<PublicConfig>;
}

export async function createRoom(turnstileToken?: string): Promise<{ roomId: string }> {
  const res = await fetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turnstileToken }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to create room");
  }
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
  connectionToken?: string,
): Promise<{ success: boolean; error?: string; state?: RoomState; connectionToken?: string }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, displayName, connectionToken }),
  });
  return res.json() as Promise<{ success: boolean; error?: string; state?: RoomState; connectionToken?: string }>;
}

export async function createWebSocketTicket(
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
): Promise<{ success: boolean; error?: string; ticket?: string }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/ws-ticket`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, connectionToken }),
  });
  return res.json() as Promise<{ success: boolean; error?: string; ticket?: string }>;
}

export async function setVoteBudget(
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
  budget: number,
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/vote-budget`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, connectionToken, budget }),
  });
  return res.json() as Promise<{ success: boolean; error?: string }>;
}

export async function setRankingMethod(
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
  rankingMethod: RankingMethod,
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/ranking-method`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, connectionToken, rankingMethod }),
  });
  return res.json() as Promise<{ success: boolean; error?: string }>;
}

export async function setPhase(
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
  phase: Phase,
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/phase`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, connectionToken, phase }),
  });
  return res.json() as Promise<{ success: boolean; error?: string }>;
}

export async function addItem(
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
  text: string,
  columnId: string,
): Promise<{ success: boolean; error?: string; item?: RetroItem }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, connectionToken, text, columnId }),
  });
  return res.json() as Promise<{ success: boolean; error?: string; item?: RetroItem }>;
}

export async function editItem(
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
  itemId: string,
  text: string,
): Promise<{ success: boolean; error?: string; item?: RetroItem }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, connectionToken, text }),
  });
  return res.json() as Promise<{ success: boolean; error?: string; item?: RetroItem }>;
}

export async function deleteItem(
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
  itemId: string,
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, connectionToken }),
  });
  return res.json() as Promise<{ success: boolean; error?: string }>;
}

export async function setTimer(
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
  durationSeconds: number,
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/timer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, connectionToken, durationSeconds }),
  });
  return res.json() as Promise<{ success: boolean; error?: string }>;
}

export async function purgeRoom(
  roomId: string,
  participantId: string,
  connectionToken: string | undefined,
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/purge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, connectionToken }),
  });
  return res.json() as Promise<{ success: boolean; error?: string }>;
}
