import { Effect } from "effect";

import type { RetroItem, Group, VoteAllocation } from "./types";

import {
  getVoteTarget,
  groupVoteTarget,
  sameVoteTarget,
} from "./state-targets";
import {
  hasDuplicateGroupNameInColumn,
  isValidGroupName,
  sanitizeGroupName,
} from "./state-sanitize";

export {
  canTransition,
  canTransitionEffect,
  ColumnValidationError,
  createActionItem,
  createActionItemEffect,
  createColumn,
  createColumnEffect,
  createGroup,
  createGroupEffect,
  createItem,
  createItemEffect,
  createParticipant,
  createParticipantEffect,
  createRoomState,
  createRoomStateEffect,
  DEFAULT_COLUMNS,
  getDefaultColumns,
  getDefaultColumnsEffect,
  isPhaseAllowed,
  isPhaseAllowedEffect,
  isTimerExpired,
  isTimerExpiredEffect,
  MAX_COLUMNS,
  PHASE_ORDER,
  validateExistingColumnId,
  validateExistingColumnIdEffect,
} from "./state-core";
export {
  getGroupedItems,
  getGroupedItemsEffect,
  getUngroupedItems,
  getUngroupedItemsEffect,
} from "./state-items";
export {
  getDecisionTargets,
  getDecisionTargetsEffect,
  getPairwiseChoice,
  getPairwiseChoiceEffect,
  getPairwiseComparisons,
  getPairwiseComparisonsEffect,
  getReviewTargets,
  getReviewTargetsEffect,
  sortReviewTargets,
  sortReviewTargetsEffect,
  type DecisionTarget,
  type PairwiseComparison,
  type ReviewTarget,
} from "./state-review";
export {
  getReactionsForTarget,
  getReactionsForTargetEffect,
  getReactionCount,
  getReactionCountEffect,
  hasParticipantReaction,
  hasParticipantReactionEffect,
  isAllowedReactionEmoji,
  isAllowedReactionEmojiEffect,
} from "./state-reactions";
export {
  hasDuplicateGroupNameInColumn,
  hasDuplicateGroupNameInColumnEffect,
  isValidActionText,
  isValidActionTextEffect,
  isValidColumnName,
  isValidColumnNameEffect,
  isValidDisplayName,
  isValidDisplayNameEffect,
  isValidGroupName,
  isValidGroupNameEffect,
  isValidItemText,
  isValidItemTextEffect,
  MAX_ACTION_TEXT_LENGTH,
  MAX_COLUMN_NAME_LENGTH,
  reorderList,
  reorderListEffect,
  sanitizeActionText,
  sanitizeActionTextEffect,
  sanitizeColumnName,
  sanitizeColumnNameEffect,
  sanitizeDisplayName,
  sanitizeDisplayNameEffect,
  sanitizeGroupName,
  sanitizeGroupNameEffect,
  sanitizeItemText,
  sanitizeItemTextEffect,
} from "./state-sanitize";
export {
  getVoteTarget,
  getVoteTargetEffect,
  groupVoteTarget,
  groupVoteTargetEffect,
  itemVoteTarget,
  itemVoteTargetEffect,
  pairwiseComparisonKey,
  pairwiseComparisonKeyEffect,
  sameVoteTarget,
  sameVoteTargetEffect,
  voteTargetKey,
  voteTargetKeyEffect,
} from "./state-targets";
export {
  applyCastVote,
  applyCastVoteEffect,
  applyRemoveVote,
  applyRemoveVoteEffect,
  getRemainingBudget,
  getRemainingBudgetEffect,
  getVotesByParticipant,
  getVotesByParticipantEffect,
  getVotesForGroup,
  getVotesForGroupEffect,
  getVotesForItem,
  getVotesForTarget,
  getVotesForTargetEffect,
  getVotesForUngroupedItem,
  getVotesForUngroupedItemEffect,
} from "./state-votes";
export {
  applyMoveItemToGroup,
  applyMoveItemToGroupEffect,
  applyReorderColumnGroups,
  applyReorderColumnGroupsEffect,
  applyReorderGroups,
  applyReorderGroupsEffect,
  applyReorderItems,
  applyReorderItemsEffect,
  ReorderValidationError,
  validateGroupReorderPayload,
  validateGroupReorderPayloadEffect,
  validateItemReorderPayload,
  validateItemReorderPayloadEffect,
} from "./state-reorder";
export {
  applyDeleteColumn,
  applyDeleteColumnEffect,
  applyEditColumn,
  applyEditColumnEffect,
  applyReorderColumns,
  applyReorderColumnsEffect,
  ColumnPermutationError,
  validateFullColumnPermutation,
  validateFullColumnPermutationEffect,
} from "./state-columns";

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

export function applyEditGroupEffect(
  groups: Group[],
  groupId: string,
  rawName: string,
): Effect.Effect<{ groups: Group[]; error?: string }> {
  return Effect.sync(() => applyEditGroup(groups, groupId, rawName));
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

export function applyDeleteGroupEffect(
  groups: Group[],
  items: RetroItem[],
  votes: VoteAllocation[],
  groupId: string,
): Effect.Effect<{ groups: Group[]; items: RetroItem[]; votes: VoteAllocation[]; error?: string }> {
  return Effect.sync(() => applyDeleteGroup(groups, items, votes, groupId));
}
