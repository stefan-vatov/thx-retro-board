import { Effect } from "effect";

import type {
  ActionItem,
  Column,
  Group,
  PairwiseChoice,
  Participant,
  RankingMethod,
  Reaction,
  RetroItem,
  VoteAllocation,
  VoteTarget,
} from "../src/domain";
import {
  groupVoteTarget,
  isAllowedReactionEmoji,
  itemVoteTarget,
  pairwiseComparisonKey,
  sameVoteTarget,
  sanitizeActionText,
  sanitizeColumnName,
  voteTargetKey,
} from "../src/domain";
import type { StoredState } from "./room-types";

export function normalizeColumns(stored: Pick<StoredState, "columns" | "groups">): Column[] {
  const source = stored.columns;
  if (!Array.isArray(source)) {
    return [];
  }
  return source
    .filter((column): column is Column => Boolean(column) && typeof column.id === "string" && typeof column.name === "string")
    .map((column, index) => ({
      id: column.id,
      name: sanitizeColumnName(column.name) || `Column ${index + 1}`,
      order: Number.isInteger(column.order) ? column.order : index,
    }))
    .sort((a, b) => a.order - b.order)
    .map((column, index) => ({ ...column, order: index }));
}

export function normalizeColumnsEffect(stored: Pick<StoredState, "columns" | "groups">): Effect.Effect<Column[]> {
  return Effect.sync(() => normalizeColumns(stored));
}

export function isV2StoredState(stored: Partial<StoredState>): boolean {
  if (stored.schemaVersion !== 2) return false;
  if (!Array.isArray(stored.columns) || !Array.isArray(stored.groups)) return false;
  if (!Array.isArray(stored.items) || !Array.isArray(stored.votes)) return false;
  return true;
}

export function isV2StoredStateEffect(stored: Partial<StoredState>): Effect.Effect<boolean> {
  return Effect.sync(() => isV2StoredState(stored));
}

export function normalizeGroups(groups: Group[], columns: Column[]): Group[] {
  const validColumnIds = new Set(columns.map((column) => column.id));
  const normalized = groups
    .filter((group): group is Group =>
      Boolean(group)
      && typeof group.id === "string"
      && typeof group.name === "string"
      && typeof group.columnId === "string"
      && validColumnIds.has(group.columnId),
    )
    .map((group, index) => ({
      id: group.id,
      name: sanitizeColumnName(group.name) || `Group ${index + 1}`,
      columnId: group.columnId,
      order: Number.isInteger(group.order) ? group.order : index,
    }))
    .sort((a, b) => a.order - b.order);

  const nextOrderByColumn = new Map<string, number>();
  return normalized.map((group) => {
    const order = nextOrderByColumn.get(group.columnId) ?? 0;
    nextOrderByColumn.set(group.columnId, order + 1);
    return { ...group, order };
  });
}

export function normalizeGroupsEffect(groups: Group[], columns: Column[]): Effect.Effect<Group[]> {
  return Effect.sync(() => normalizeGroups(groups, columns));
}

export function normalizeItems(items: RetroItem[], columns: Column[], groups: Group[]): RetroItem[] {
  const validColumnIds = new Set(columns.map((column) => column.id));
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const normalized = items.flatMap((item) => {
    if (!item || typeof item.id !== "string" || typeof item.text !== "string" || typeof item.authorId !== "string") {
      return [];
    }
    const columnId = item.columnId;
    if (typeof columnId !== "string" || !validColumnIds.has(columnId)) return [];
    const groupId = typeof item.groupId === "string" && groupsById.get(item.groupId)?.columnId === columnId ? item.groupId : null;
    return {
      ...item,
      columnId,
      groupId,
      order: Number.isInteger(item.order) ? item.order : 0,
    };
  }).sort((a, b) => a.order - b.order);

  const nextOrderByList = new Map<string, number>();
  return normalized.map((item) => {
    const listKey = `${item.columnId}:${item.groupId ?? "__ungrouped__"}`;
    const order = nextOrderByList.get(listKey) ?? 0;
    nextOrderByList.set(listKey, order + 1);
    return { ...item, order };
  });
}

export function normalizeItemsEffect(items: RetroItem[], columns: Column[], groups: Group[]): Effect.Effect<RetroItem[]> {
  return Effect.sync(() => normalizeItems(items, columns, groups));
}

function normalizeVoteTarget(vote: VoteAllocation, groups: Group[], items: RetroItem[]): VoteTarget | null {
  const validGroupIds = new Set(groups.map((group) => group.id));
  const validUngroupedItemIds = new Set(items.filter((item) => item.groupId === null).map((item) => item.id));
  const canonicalTarget = vote.target
    && (vote.target.type === "group" || vote.target.type === "item")
    && typeof vote.target.id === "string"
    ? vote.target
    : null;
  const legacyGroupTarget = typeof vote.groupId === "string" ? groupVoteTarget(vote.groupId) : null;
  const legacyItemId = typeof vote.itemId === "string" ? vote.itemId : null;
  const legacyItemTarget = legacyItemId === null
    ? null
    : validGroupIds.has(legacyItemId)
      ? groupVoteTarget(legacyItemId)
      : itemVoteTarget(legacyItemId);

  const target = canonicalTarget ?? legacyGroupTarget ?? legacyItemTarget;
  if (target === null) return null;
  const aliases = [legacyGroupTarget, legacyItemTarget].filter((alias): alias is VoteTarget => alias !== null);
  if (aliases.some((alias) => !sameVoteTarget(alias, target))) return null;
  if (target.type === "group") {
    return validGroupIds.has(target.id) ? target : null;
  }
  return validUngroupedItemIds.has(target.id) ? target : null;
}

export function normalizeVotes(votes: VoteAllocation[], participants: Participant[], groups: Group[], items: RetroItem[]): VoteAllocation[] {
  const validParticipantIds = new Set(participants.map((participant) => participant.id));
  const merged = new Map<string, VoteAllocation>();
  for (const vote of votes) {
    if (
      !vote
      || typeof vote.participantId !== "string"
      || !validParticipantIds.has(vote.participantId)
      || typeof vote.count !== "number"
      || !Number.isInteger(vote.count)
      || vote.count < 1
    ) {
      continue;
    }
    const target = normalizeVoteTarget(vote, groups, items);
    if (target === null) continue;
    const key = `${vote.participantId}:${voteTargetKey(target)}`;
    const existing = merged.get(key);
    merged.set(key, {
      participantId: vote.participantId,
      target,
      count: (existing?.count ?? 0) + vote.count,
    });
  }
  return [...merged.values()];
}

export function normalizeVotesEffect(
  votes: VoteAllocation[],
  participants: Participant[],
  groups: Group[],
  items: RetroItem[],
): Effect.Effect<VoteAllocation[]> {
  return Effect.sync(() => normalizeVotes(votes, participants, groups, items));
}

export function normalizeRankingMethod(method: unknown): RankingMethod {
  return method === "pairwise" ? "pairwise" : "score";
}

export function normalizeRankingMethodEffect(method: unknown): Effect.Effect<RankingMethod> {
  return Effect.sync(() => normalizeRankingMethod(method));
}

export function normalizePairwiseChoices(
  choices: PairwiseChoice[] | undefined,
  participants: Participant[],
  groups: Group[],
  items: RetroItem[],
): PairwiseChoice[] {
  if (!Array.isArray(choices)) return [];
  const validParticipantIds = new Set(participants.map((participant) => participant.id));
  const merged = new Map<string, PairwiseChoice>();
  for (const choice of choices) {
    if (!choice || typeof choice.participantId !== "string" || !validParticipantIds.has(choice.participantId)) {
      continue;
    }
    const winner = normalizeVoteTarget({ participantId: choice.participantId, target: choice.winner, count: 1 }, groups, items);
    const loser = normalizeVoteTarget({ participantId: choice.participantId, target: choice.loser, count: 1 }, groups, items);
    if (winner === null || loser === null || sameVoteTarget(winner, loser)) continue;
    const key = `${choice.participantId}:${pairwiseComparisonKey(winner, loser)}`;
    merged.set(key, { participantId: choice.participantId, winner, loser });
  }
  return [...merged.values()];
}

export function normalizePairwiseChoicesEffect(
  choices: PairwiseChoice[] | undefined,
  participants: Participant[],
  groups: Group[],
  items: RetroItem[],
): Effect.Effect<PairwiseChoice[]> {
  return Effect.sync(() => normalizePairwiseChoices(choices, participants, groups, items));
}

export function normalizeReviewTargetKey(targetKey: unknown, groups: Group[], items: RetroItem[]): string | null {
  if (typeof targetKey !== "string") return null;
  const validTargetKeys = new Set<string>([
    ...groups.map((group) => voteTargetKey(groupVoteTarget(group.id))),
    ...items.filter((item) => item.groupId === null).map((item) => voteTargetKey(itemVoteTarget(item.id))),
  ]);
  return validTargetKeys.has(targetKey) ? targetKey : null;
}

export function normalizeReviewTargetKeyEffect(
  targetKey: unknown,
  groups: Group[],
  items: RetroItem[],
): Effect.Effect<string | null> {
  return Effect.sync(() => normalizeReviewTargetKey(targetKey, groups, items));
}

export function normalizeActions(actions: ActionItem[] | undefined, participants: Participant[]): ActionItem[] {
  if (!Array.isArray(actions)) return [];
  const participantIds = new Set(participants.map((participant) => participant.id));
  return actions
    .filter((action): action is ActionItem =>
      Boolean(action)
      && typeof action.id === "string"
      && typeof action.text === "string"
      && typeof action.authorId === "string",
    )
    .map((action, index) => ({
      id: action.id,
      text: sanitizeActionText(action.text) || `Action ${index + 1}`,
      authorId: participantIds.has(action.authorId) ? action.authorId : "",
      order: Number.isInteger(action.order) ? action.order : index,
    }))
    .sort((a, b) => a.order - b.order)
    .map((action, index) => ({ ...action, order: index }));
}

export function normalizeActionsEffect(
  actions: ActionItem[] | undefined,
  participants: Participant[],
): Effect.Effect<ActionItem[]> {
  return Effect.sync(() => normalizeActions(actions, participants));
}

export function normalizeReactions(
  reactions: Reaction[] | undefined,
  participants: Participant[],
  groups: Group[],
  items: RetroItem[],
): Reaction[] {
  if (!Array.isArray(reactions)) return [];
  const participantIds = new Set(participants.map((participant) => participant.id));
  const groupIds = new Set(groups.map((group) => group.id));
  const itemIds = new Set(items.map((item) => item.id));
  const merged = new Map<string, Reaction>();
  for (const reaction of reactions) {
    if (
      !reaction
      || typeof reaction.participantId !== "string"
      || !participantIds.has(reaction.participantId)
      || typeof reaction.emoji !== "string"
      || !isAllowedReactionEmoji(reaction.emoji)
      || !reaction.target
      || (reaction.target.type !== "group" && reaction.target.type !== "item")
      || typeof reaction.target.id !== "string"
    ) {
      continue;
    }
    if (reaction.target.type === "group" && !groupIds.has(reaction.target.id)) continue;
    if (reaction.target.type === "item" && !itemIds.has(reaction.target.id)) continue;
    const key = `${reaction.participantId}:${voteTargetKey(reaction.target)}:${reaction.emoji}`;
    merged.set(key, { participantId: reaction.participantId, target: reaction.target, emoji: reaction.emoji });
  }
  return [...merged.values()];
}

export function normalizeReactionsEffect(
  reactions: Reaction[] | undefined,
  participants: Participant[],
  groups: Group[],
  items: RetroItem[],
): Effect.Effect<Reaction[]> {
  return Effect.sync(() => normalizeReactions(reactions, participants, groups, items));
}
