import type { RetroItem, Group, Column, VoteAllocation } from "./types";

import {
  getVoteTarget,
  groupVoteTarget,
  sameVoteTarget,
} from "./state-targets";
import {
  hasDuplicateGroupNameInColumn,
  isValidColumnName,
  isValidGroupName,
  reorderList,
  sanitizeColumnName,
  sanitizeGroupName,
} from "./state-sanitize";

export {
  canTransition,
  ColumnValidationError,
  createActionItem,
  createColumn,
  createGroup,
  createItem,
  createParticipant,
  createRoomState,
  createRoomStateEffect,
  DEFAULT_COLUMNS,
  getDefaultColumns,
  isPhaseAllowed,
  isTimerExpired,
  MAX_COLUMNS,
  PHASE_ORDER,
  validateExistingColumnId,
  validateExistingColumnIdEffect,
} from "./state-core";
export {
  getGroupedItems,
  getUngroupedItems,
} from "./state-items";
export {
  getDecisionTargets,
  getPairwiseChoice,
  getPairwiseComparisons,
  getReviewTargets,
  sortReviewTargets,
  type DecisionTarget,
  type PairwiseComparison,
  type ReviewTarget,
} from "./state-review";
export {
  getReactionsForTarget,
  getReactionCount,
  hasParticipantReaction,
  isAllowedReactionEmoji,
} from "./state-reactions";
export {
  hasDuplicateGroupNameInColumn,
  isValidActionText,
  isValidColumnName,
  isValidDisplayName,
  isValidGroupName,
  isValidItemText,
  MAX_ACTION_TEXT_LENGTH,
  MAX_COLUMN_NAME_LENGTH,
  reorderList,
  sanitizeActionText,
  sanitizeColumnName,
  sanitizeDisplayName,
  sanitizeGroupName,
  sanitizeItemText,
} from "./state-sanitize";
export {
  getVoteTarget,
  groupVoteTarget,
  itemVoteTarget,
  pairwiseComparisonKey,
  sameVoteTarget,
  voteTargetKey,
} from "./state-targets";
export {
  applyCastVote,
  applyRemoveVote,
  getRemainingBudget,
  getVotesByParticipant,
  getVotesForGroup,
  getVotesForItem,
  getVotesForTarget,
  getVotesForUngroupedItem,
} from "./state-votes";

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
  const existingGroup = groups.find((group) => group.id === groupId);
  if (!existingGroup) {
    return { groups, error: "Group not found" };
  }
  if (hasDuplicateGroupNameInColumn(groups, existingGroup.columnId, sanitized, groupId)) {
    return { groups, error: "Group name already exists in this column" };
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
  const nextVotes = votes.filter((vote) => {
    const target = getVoteTarget(vote);
    return target === null || !sameVoteTarget(target, groupVoteTarget(groupId));
  });

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
  const deletedItemIds = new Set(items.filter((item) => item.columnId === columnId).map((item) => item.id));
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
    const target = getVoteTarget(vote);
    if (target === null) return false;
    if (target.type === "group") return !deletedGroupIds.has(target.id);
    return !deletedItemIds.has(target.id);
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
