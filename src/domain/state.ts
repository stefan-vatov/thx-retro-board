import type { Phase, Participant, RetroItem, Group, Column, VoteAllocation, TimerState, RoomState } from "./types";

export const DEFAULT_COLUMNS: readonly Column[] = [
] as const;

export const MAX_COLUMN_NAME_LENGTH = 100;
export const MAX_COLUMNS = 8;

export function getDefaultColumns(): Column[] {
  return DEFAULT_COLUMNS.map((column) => ({ ...column }));
}

export function createRoomState(roomId: string, voteBudget: number = 5): RoomState {
  return {
    roomId,
    schemaVersion: 2,
    phase: "write",
    participants: [],
    items: [],
    columns: getDefaultColumns(),
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

export function createItem(id: string, text: string, authorId: string, order: number, columnId: string, groupId: string | null = null): RetroItem {
  return { id, text, authorId, columnId, groupId, order };
}

export function createGroup(id: string, name: string, columnId: string | number, order?: number): Group {
  if (typeof columnId === "number") {
    return { id, name, columnId: "", order: columnId };
  }
  return { id, name, columnId, order: order ?? 0 };
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
    .filter((v) => v.groupId === itemId || v.itemId === itemId)
    .reduce((sum, v) => sum + v.count, 0);
}

export const getVotesForGroup = getVotesForItem;

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

export function validateExistingColumnId(
  columns: Column[],
  columnId: unknown,
): { valid: true; columnId: string } | { valid: false; error: string } {
  if (typeof columnId !== "string" || columnId.trim().length === 0) {
    return { valid: false, error: "Column is required" };
  }
  if (!columns.some((column) => column.id === columnId)) {
    return { valid: false, error: "Column not found" };
  }
  return { valid: true, columnId };
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
  if (reordered.length === 0) return items;

  const targetColumnId = reordered[0]!.columnId;
  const targetGroupId = reordered[0]!.groupId;
  const orderedIdSet = new Set(orderedIds);
  const remainingTargetItems = items
    .filter((item) => item.columnId === targetColumnId && item.groupId === targetGroupId && !orderedIdSet.has(item.id))
    .sort((a, b) => a.order - b.order);
  const nextTargetItems = [...reordered, ...remainingTargetItems].map((item, order) => ({ ...item, order }));
  const untouchedItems = items.filter((item) => item.columnId !== targetColumnId || item.groupId !== targetGroupId);

  return [
    ...nextTargetItems,
    ...untouchedItems,
  ];
}

export function validateItemReorderPayload(
  items: RetroItem[],
  orderedIds: unknown,
): { valid: true; ids: string[] } | { valid: false; error: string } {
  if (!Array.isArray(orderedIds)) {
    return { valid: false, error: "Item order must be an array" };
  }
  if (!orderedIds.every((id): id is string => typeof id === "string")) {
    return { valid: false, error: "Item order must contain only item IDs" };
  }
  if (orderedIds.length === 0) {
    return { valid: false, error: "Item reorder must include every item in one list exactly once" };
  }

  const itemsById = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  let targetColumnId: string | undefined;
  let targetGroupId: string | null | undefined;
  let targetColumnIdSet = false;

  for (const id of orderedIds) {
    if (seen.has(id)) {
      return { valid: false, error: "Item reorder contains a duplicate item" };
    }
    seen.add(id);

    const item = itemsById.get(id);
    if (!item) {
      return { valid: false, error: "Item reorder contains an unknown item" };
    }

    const itemColumnId = item.columnId;
    if (!targetColumnIdSet) {
      targetColumnId = itemColumnId;
      targetGroupId = item.groupId;
      targetColumnIdSet = true;
    }
    if (itemColumnId !== targetColumnId || item.groupId !== targetGroupId) {
      return { valid: false, error: "Item reorder must be scoped to a single column group" };
    }
  }

  const scopedItemIds = items
    .filter((item) => item.columnId === targetColumnId && item.groupId === targetGroupId)
    .map((item) => item.id);

  if (scopedItemIds.length !== orderedIds.length) {
    return { valid: false, error: "Item reorder must include every item in one list exactly once" };
  }

  for (const id of scopedItemIds) {
    if (!seen.has(id)) {
      return { valid: false, error: "Item reorder is missing an item from the target column" };
    }
  }

  return { valid: true, ids: orderedIds };
}

export function applyReorderGroups<T extends { id: string; order: number }>(groups: T[], orderedIds: string[]): T[] {
  const reordered = reorderList(groups, orderedIds, (g) => g.id);
  return reordered.map((g, idx) => ({ ...g, order: idx }));
}

export function validateGroupReorderPayload(
  groups: Group[],
  orderedIds: unknown,
): { valid: true; ids: string[] } | { valid: false; error: string } {
  if (!Array.isArray(orderedIds)) {
    return { valid: false, error: "Group order must be an array" };
  }
  if (!orderedIds.every((id): id is string => typeof id === "string")) {
    return { valid: false, error: "Group order must contain only group IDs" };
  }
  if (orderedIds.length === 0) {
    return { valid: false, error: "Group reorder must include every group in one column exactly once" };
  }

  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const seen = new Set<string>();
  let targetColumnId: string | undefined;

  for (const id of orderedIds) {
    if (seen.has(id)) {
      return { valid: false, error: "Group reorder contains a duplicate group" };
    }
    seen.add(id);

    const group = groupsById.get(id);
    if (!group) {
      return { valid: false, error: "Group reorder contains an unknown group" };
    }
    targetColumnId ??= group.columnId;
    if (group.columnId !== targetColumnId) {
      return { valid: false, error: "Group reorder must be scoped to a single column" };
    }
  }

  const scopedGroupIds = groups
    .filter((group) => group.columnId === targetColumnId)
    .map((group) => group.id);
  if (scopedGroupIds.length !== orderedIds.length) {
    return { valid: false, error: "Group reorder must include every group in one column exactly once" };
  }
  for (const id of scopedGroupIds) {
    if (!seen.has(id)) {
      return { valid: false, error: "Group reorder is missing a group from the target column" };
    }
  }

  return { valid: true, ids: orderedIds };
}

export function applyReorderColumnGroups(groups: Group[], orderedIds: string[]): Group[] {
  const orderedIdSet = new Set(orderedIds);
  const targetColumnId = groups.find((group) => group.id === orderedIds[0])?.columnId;
  if (targetColumnId === undefined) return groups;

  const reorderedGroups = applyReorderGroups(
    groups.filter((group) => orderedIdSet.has(group.id)),
    orderedIds,
  );
  const reorderedById = new Map(reorderedGroups.map((group) => [group.id, group]));

  return groups.map((group) => reorderedById.get(group.id) ?? group);
}

export function applyEditGroup(groups: Group[], groupId: string, rawName: string): { groups: Group[]; error?: string } {
  const sanitized = sanitizeGroupName(rawName);
  if (!isValidGroupName(rawName)) {
    return { groups, error: "Group name cannot be empty" };
  }
  if (!groups.some((group) => group.id === groupId)) {
    return { groups, error: "Group not found" };
  }
  return { groups: groups.map((group) => group.id === groupId ? { ...group, name: sanitized } : group) };
}

export function applyDeleteGroup(
  groups: Group[],
  items: RetroItem[],
  votes: VoteAllocation[],
  groupId: string,
): { groups: Group[]; items: RetroItem[]; votes: VoteAllocation[]; error?: string } {
  const deletedGroup = groups.find((group) => group.id === groupId);
  if (!deletedGroup) {
    return { groups, items, votes, error: "Group not found" };
  }

  const remainingGroups = groups
    .filter((group) => group.id !== groupId)
    .sort((a, b) => a.order - b.order)
    .map((group, _index, allGroups) => ({
      ...group,
      order: allGroups.filter((candidate) => candidate.columnId === group.columnId && candidate.order < group.order).length,
    }));
  const ungroupedOrderStart = items.filter((item) => item.columnId === deletedGroup.columnId && item.groupId === null).length;
  let nextUngroupedOrder = ungroupedOrderStart;
  const nextItems = items.map((item) => {
    if (item.groupId !== groupId) return item;
    const ungroupedItem = { ...item, groupId: null, order: nextUngroupedOrder };
    nextUngroupedOrder += 1;
    return ungroupedItem;
  });
  const nextVotes = votes.filter((vote) => (vote.groupId ?? vote.itemId) !== groupId);

  return { groups: remainingGroups, items: nextItems, votes: nextVotes };
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

export function applyDeleteColumn(
  columns: Column[],
  groups: Group[],
  items: RetroItem[],
  votes: VoteAllocation[],
  columnId: string,
): { columns: Column[]; groups: Group[]; items: RetroItem[]; votes: VoteAllocation[]; error?: string } {
  if (!columns.some((column) => column.id === columnId)) {
    return { columns, groups, items, votes, error: "Column not found" };
  }

  const deletedGroupIds = new Set(groups.filter((group) => group.columnId === columnId).map((group) => group.id));
  const remainingColumns = columns
    .filter((column) => column.id !== columnId)
    .sort((a, b) => a.order - b.order)
    .map((column, order) => ({ ...column, order }));
  const remainingGroups = groups
    .filter((group) => group.columnId !== columnId)
    .sort((a, b) => a.order - b.order)
    .map((group, _index, allGroups) => ({
      ...group,
      order: allGroups.filter((candidate) => candidate.columnId === group.columnId && candidate.order < group.order).length,
    }));
  const remainingItems = items
    .filter((item) => item.columnId !== columnId)
    .sort((a, b) => a.order - b.order)
    .map((item, _index, allItems) => ({
      ...item,
      order: allItems.filter((candidate) => candidate.columnId === item.columnId && candidate.groupId === item.groupId && candidate.order < item.order).length,
    }));
  const remainingVotes = votes.filter((vote) => {
    const groupId = vote.groupId ?? vote.itemId;
    return typeof groupId === "string" && !deletedGroupIds.has(groupId);
  });

  return {
    columns: remainingColumns,
    groups: remainingGroups,
    items: remainingItems,
    votes: remainingVotes,
  };
}

export function applyMoveItemToGroup(
  items: RetroItem[],
  itemId: string,
  targetGroupId: string | null,
  targetIndex: number,
): RetroItem[] {
  const itemIndex = items.findIndex((i) => i.id === itemId);
  if (itemIndex === -1) return items;

  const source = items[itemIndex]!;
  const moved: RetroItem = { ...source, groupId: targetGroupId };
  const otherItems = items.filter((i) => i.id !== itemId);

  const sameGroup = otherItems
    .filter((i) => i.columnId === moved.columnId && i.groupId === targetGroupId)
    .sort((a, b) => a.order - b.order);
  const before = sameGroup.slice(0, targetIndex);
  const after = sameGroup.slice(targetIndex);

  const updatedSameGroup: RetroItem[] = [...before, moved, ...after].map((i, idx) => ({ ...i, order: idx }));
  const affectedSourceGroupId = items[itemIndex]!.groupId;
  const differentGroup = otherItems.filter((i) => i.columnId !== moved.columnId || i.groupId !== targetGroupId);
  const compactedDifferentGroup = differentGroup.map((item) => {
    if (item.columnId !== moved.columnId || item.groupId !== affectedSourceGroupId || affectedSourceGroupId === targetGroupId) {
      return item;
    }
    const sourceIndex = differentGroup
      .filter((candidate) => candidate.columnId === moved.columnId && candidate.groupId === affectedSourceGroupId)
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
    (v) => v.participantId === participantId && (v.groupId === itemId || v.itemId === itemId),
  );

  if (existing) {
    const updated = votes.map((v) =>
      v.participantId === participantId && (v.groupId === itemId || v.itemId === itemId)
        ? { ...v, count: v.count + count }
        : v,
    );
    return { votes: updated };
  }

  return { votes: [...votes, { participantId, groupId: itemId, itemId, count }] };
}

export function applyRemoveVote(
  votes: VoteAllocation[],
  participantId: string,
  itemId: string,
): VoteAllocation[] {
  const existing = votes.find(
    (v) => v.participantId === participantId && (v.groupId === itemId || v.itemId === itemId),
  );
  if (!existing) return votes;

  if (existing.count <= 1) {
    return votes.filter(
      (v) => !(v.participantId === participantId && (v.groupId === itemId || v.itemId === itemId)),
    );
  }

  return votes.map((v) =>
    v.participantId === participantId && (v.groupId === itemId || v.itemId === itemId)
      ? { ...v, count: v.count - 1 }
      : v,
  );
}
