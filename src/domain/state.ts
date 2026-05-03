import type { RetroItem, Group, Column, VoteAllocation } from "./types";

import {
  getVoteTarget,
  groupVoteTarget,
  sameVoteTarget,
} from "./state-targets";
import { applyReorderGroups } from "./state-reorder";
import {
  hasDuplicateGroupNameInColumn,
  isValidColumnName,
  isValidGroupName,
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
export {
  applyMoveItemToGroup,
  applyReorderColumnGroups,
  applyReorderGroups,
  applyReorderItems,
  ReorderValidationError,
  validateGroupReorderPayload,
  validateGroupReorderPayloadEffect,
  validateItemReorderPayload,
  validateItemReorderPayloadEffect,
} from "./state-reorder";

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
