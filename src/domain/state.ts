import type { Phase, Participant, RetroItem, Group, VoteAllocation, TimerState, RoomState } from "./types";

export function createRoomState(roomId: string, voteBudget: number = 5): RoomState {
  return {
    roomId,
    phase: "write",
    participants: [],
    items: [],
    groups: [],
    votes: [],
    timer: { startedAt: null, durationSeconds: null, expired: false },
    voteBudget,
  };
}

export function createParticipant(id: string, displayName: string, isFacilitator: boolean): Participant {
  return { id, displayName, isFacilitator };
}

export function createItem(id: string, text: string, authorId: string, order: number): RetroItem {
  return { id, text, authorId, groupId: null, order };
}

export function createGroup(id: string, name: string, order: number): Group {
  return { id, name, order };
}

export const PHASE_ORDER: readonly Phase[] = ["write", "organise", "vote", "review"] as const;

export function canTransition(from: Phase, to: Phase): boolean {
  const fromIndex = PHASE_ORDER.indexOf(from);
  const toIndex = PHASE_ORDER.indexOf(to);
  return toIndex === fromIndex + 1;
}

export function isPhaseAllowed(actionPhase: Phase, currentPhase: Phase): boolean {
  return actionPhase === currentPhase;
}

export function getVotesForItem(votes: VoteAllocation[], itemId: string): number {
  return votes
    .filter((v) => v.itemId === itemId)
    .reduce((sum, v) => sum + v.count, 0);
}

export function getVotesByParticipant(votes: VoteAllocation[], participantId: string): number {
  return votes
    .filter((v) => v.participantId === participantId)
    .reduce((sum, v) => sum + v.count, 0);
}

export function getRemainingBudget(votes: VoteAllocation[], participantId: string, budget: number): number {
  return budget - getVotesByParticipant(votes, participantId);
}

export function isTimerExpired(timer: TimerState): boolean {
  if (timer.startedAt === null || timer.durationSeconds === null) return false;
  const elapsed = (Date.now() - timer.startedAt) / 1000;
  return elapsed >= timer.durationSeconds;
}

export function sanitizeDisplayName(name: string): string {
  return name.trim().slice(0, 50);
}

export function isValidDisplayName(name: string): boolean {
  return sanitizeDisplayName(name).length > 0;
}

export function sanitizeItemText(text: string): string {
  return text.trim().slice(0, 500);
}

export function isValidItemText(text: string): boolean {
  return sanitizeItemText(text).length > 0;
}

export function reorderList<T>(list: T[], orderedIds: string[], idExtractor: (item: T) => string): T[] {
  const map = new Map(list.map((item) => [idExtractor(item), item]));
  return orderedIds
    .map((id) => map.get(id))
    .filter((item): item is T => item !== undefined);
}
