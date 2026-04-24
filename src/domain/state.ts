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
    version: 0,
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

export function sanitizeGroupName(name: string): string {
  return name.trim().slice(0, 100);
}

export function isValidGroupName(name: string): boolean {
  return sanitizeGroupName(name).length > 0;
}

export function getUngroupedItems(items: RetroItem[]): RetroItem[] {
  return items
    .filter((item) => item.groupId === null)
    .sort((a, b) => a.order - b.order);
}

export function getGroupedItems(items: RetroItem[], groupId: string): RetroItem[] {
  return items
    .filter((item) => item.groupId === groupId)
    .sort((a, b) => a.order - b.order);
}

export function applyReorderItems(items: RetroItem[], orderedIds: string[]): RetroItem[] {
  const reordered = reorderList(items, orderedIds, (item) => item.id);
  return reordered.map((item, idx) => ({ ...item, order: idx }));
}

export function applyReorderGroups(groups: Group[], orderedIds: string[]): Group[] {
  const reordered = reorderList(groups, orderedIds, (g) => g.id);
  return reordered.map((g, idx) => ({ ...g, order: idx }));
}

export function applyMoveItemToGroup(
  items: RetroItem[],
  itemId: string,
  targetGroupId: string | null,
  targetIndex: number,
): RetroItem[] {
  const itemIndex = items.findIndex((i) => i.id === itemId);
  if (itemIndex === -1) return items;

  const moved: RetroItem = { ...items[itemIndex]!, groupId: targetGroupId };
  const otherItems = items.filter((i) => i.id !== itemId);

  const sameGroup = otherItems.filter((i) => i.groupId === targetGroupId);
  const before = sameGroup.slice(0, targetIndex);
  const after = sameGroup.slice(targetIndex);

  const updatedSameGroup: RetroItem[] = [...before, moved, ...after].map((i, idx) => ({ ...i, order: idx }));
  const differentGroup = otherItems.filter((i) => i.groupId !== targetGroupId);

  return [...differentGroup, ...updatedSameGroup];
}
