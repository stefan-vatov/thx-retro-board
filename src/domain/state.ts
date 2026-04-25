import type { Phase, Participant, RetroItem, Group, Column, VoteAllocation, TimerState, RoomState } from "./types";

export const DEFAULT_COLUMNS: readonly Column[] = [
  { id: "start", name: "Start", order: 0 },
  { id: "stop", name: "Stop", order: 1 },
  { id: "continue", name: "Continue", order: 2 },
] as const;

export const MAX_COLUMN_NAME_LENGTH = 100;
export const MAX_COLUMNS = 8;

export function getDefaultColumns(): Column[] {
  return DEFAULT_COLUMNS.map((column) => ({ ...column }));
}

export function createRoomState(roomId: string, voteBudget: number = 5): RoomState {
  return {
    roomId,
    phase: "write",
    participants: [],
    items: [],
    columns: getDefaultColumns(),
    groups: getDefaultColumns(),
    votes: [],
    timer: { startedAt: null, durationSeconds: null, expired: false },
    voteBudget,
    version: 0,
  };
}

export function createParticipant(id: string, displayName: string, isFacilitator: boolean): Participant {
  return { id, displayName, isFacilitator };
}

export function createItem(id: string, text: string, authorId: string, order: number, columnId: string | null = null): RetroItem {
  return { id, text, authorId, columnId, groupId: columnId, order };
}

export function createGroup(id: string, name: string, order: number): Group {
  return { id, name, order };
}

export function createColumn(id: string, name: string, order: number): Column {
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
  return name.trim().slice(0, MAX_COLUMN_NAME_LENGTH);
}

export function isValidGroupName(name: string): boolean {
  return sanitizeGroupName(name).length > 0;
}

export const sanitizeColumnName = sanitizeGroupName;
export const isValidColumnName = isValidGroupName;

export function getUngroupedItems(items: RetroItem[]): RetroItem[] {
  return items
    .filter((item) => (item.columnId ?? item.groupId) === null)
    .sort((a, b) => a.order - b.order);
}

export function getGroupedItems(items: RetroItem[], groupId: string): RetroItem[] {
  return items
    .filter((item) => (item.columnId ?? item.groupId) === groupId)
    .sort((a, b) => a.order - b.order);
}

export function applyReorderItems(items: RetroItem[], orderedIds: string[]): RetroItem[] {
  const idSet = new Set(orderedIds);
  const reordered = reorderList(items, orderedIds, (item) => item.id);
  const untouched = items.filter((item) => !idSet.has(item.id));

  // Place reordered items first, then untouched items preserve their relative order
  const result: RetroItem[] = [
    ...reordered.map((item, idx) => ({ ...item, order: idx })),
    ...untouched,
  ];

  // Reassign contiguous order indices
  return result.map((item, idx) => ({ ...item, order: idx }));
}

export function applyReorderGroups(groups: Group[], orderedIds: string[]): Group[] {
  const reordered = reorderList(groups, orderedIds, (g) => g.id);
  return reordered.map((g, idx) => ({ ...g, order: idx }));
}

export function validateFullColumnPermutation(columns: Column[], orderedIds: unknown): { valid: true; ids: string[] } | { valid: false; error: string } {
  if (!Array.isArray(orderedIds)) {
    return { valid: false, error: "Column order must be an array" };
  }
  if (!orderedIds.every((id): id is string => typeof id === "string")) {
    return { valid: false, error: "Column order must contain only IDs" };
  }
  if (orderedIds.length !== columns.length) {
    return { valid: false, error: "Column reorder must include every column exactly once" };
  }
  const existingIds = new Set(columns.map((column) => column.id));
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (!existingIds.has(id)) {
      return { valid: false, error: "Column reorder contains an unknown column" };
    }
    if (seen.has(id)) {
      return { valid: false, error: "Column reorder contains a duplicate column" };
    }
    seen.add(id);
  }
  return { valid: true, ids: orderedIds };
}

export function applyReorderColumns(columns: Column[], orderedIds: string[]): Column[] {
  return applyReorderGroups(columns, orderedIds);
}

export function applyEditColumn(columns: Column[], columnId: string, rawName: string): { columns: Column[]; error?: string } {
  const sanitized = sanitizeColumnName(rawName);
  if (!isValidColumnName(rawName)) {
    return { columns, error: "Column name cannot be empty" };
  }
  if (!columns.some((column) => column.id === columnId)) {
    return { columns, error: "Column not found" };
  }
  return { columns: columns.map((column) => column.id === columnId ? { ...column, name: sanitized } : column) };
}

export function applyMoveItemToGroup(
  items: RetroItem[],
  itemId: string,
  targetGroupId: string | null,
  targetIndex: number,
): RetroItem[] {
  const itemIndex = items.findIndex((i) => i.id === itemId);
  if (itemIndex === -1) return items;

  const moved: RetroItem = { ...items[itemIndex]!, columnId: targetGroupId, groupId: targetGroupId };
  const otherItems = items.filter((i) => i.id !== itemId);

  const sameGroup = otherItems
    .filter((i) => (i.columnId ?? i.groupId) === targetGroupId)
    .sort((a, b) => a.order - b.order);
  const before = sameGroup.slice(0, targetIndex);
  const after = sameGroup.slice(targetIndex);

  const updatedSameGroup: RetroItem[] = [...before, moved, ...after].map((i, idx) => ({ ...i, order: idx }));
  const affectedSourceGroupId = items[itemIndex]!.columnId ?? items[itemIndex]!.groupId;
  const differentGroup = otherItems.filter((i) => (i.columnId ?? i.groupId) !== targetGroupId);
  const compactedDifferentGroup = differentGroup.map((item) => {
    const itemGroupId = item.columnId ?? item.groupId;
    if (itemGroupId !== affectedSourceGroupId || affectedSourceGroupId === targetGroupId) {
      return item;
    }
    const sourceIndex = differentGroup
      .filter((candidate) => (candidate.columnId ?? candidate.groupId) === affectedSourceGroupId)
      .sort((a, b) => a.order - b.order)
      .findIndex((candidate) => candidate.id === item.id);
    return { ...item, order: sourceIndex };
  });

  return [...compactedDifferentGroup, ...updatedSameGroup];
}

export function applyCastVote(
  votes: VoteAllocation[],
  participantId: string,
  itemId: string,
  count: number,
  budget: number,
): { votes: VoteAllocation[]; error?: string } {
  if (count < 1 || !Number.isInteger(count)) {
    return { votes, error: "Vote count must be a positive integer" };
  }

  const currentUsed = getVotesByParticipant(votes, participantId);
  const remaining = budget - currentUsed;
  if (count > remaining) {
    return { votes, error: `Over budget: ${remaining} votes remaining` };
  }

  const existing = votes.find(
    (v) => v.participantId === participantId && v.itemId === itemId,
  );

  if (existing) {
    const updated = votes.map((v) =>
      v.participantId === participantId && v.itemId === itemId
        ? { ...v, count: v.count + count }
        : v,
    );
    return { votes: updated };
  }

  return { votes: [...votes, { participantId, itemId, count }] };
}

export function applyRemoveVote(
  votes: VoteAllocation[],
  participantId: string,
  itemId: string,
): VoteAllocation[] {
  const existing = votes.find(
    (v) => v.participantId === participantId && v.itemId === itemId,
  );
  if (!existing) return votes;

  if (existing.count <= 1) {
    return votes.filter(
      (v) => !(v.participantId === participantId && v.itemId === itemId),
    );
  }

  return votes.map((v) =>
    v.participantId === participantId && v.itemId === itemId
      ? { ...v, count: v.count - 1 }
      : v,
  );
}
