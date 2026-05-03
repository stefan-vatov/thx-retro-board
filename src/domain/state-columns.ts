import { Effect } from "effect";
import type { Column, Group, RetroItem, VoteAllocation } from "./types";
import { applyReorderGroups } from "./state-reorder";
import {
  isValidColumnName,
  sanitizeColumnName,
} from "./state-sanitize";
import {
  getVoteTarget,
} from "./state-targets";

export class ColumnPermutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ColumnPermutationError";
  }
}

export function validateFullColumnPermutation(
  columns: Column[],
  orderedIds: unknown,
): { valid: true; ids: string[] } | { valid: false; error: string } {
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

export function validateFullColumnPermutationEffect(
  columns: Column[],
  orderedIds: unknown,
): Effect.Effect<string[], ColumnPermutationError> {
  return Effect.gen(function* () {
    const validation = validateFullColumnPermutation(columns, orderedIds);
    if (!validation.valid) {
      return yield* Effect.fail(new ColumnPermutationError(validation.error));
    }
    return validation.ids;
  });
}

export function applyReorderColumns(columns: Column[], orderedIds: string[]): Column[] {
  return applyReorderGroups(columns, orderedIds);
}

export function applyReorderColumnsEffect(columns: Column[], orderedIds: string[]): Effect.Effect<Column[]> {
  return Effect.sync(() => applyReorderColumns(columns, orderedIds));
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

export function applyEditColumnEffect(
  columns: Column[],
  columnId: string,
  rawName: string,
): Effect.Effect<{ columns: Column[]; error?: string }> {
  return Effect.sync(() => applyEditColumn(columns, columnId, rawName));
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

export function applyDeleteColumnEffect(
  columns: Column[],
  groups: Group[],
  items: RetroItem[],
  votes: VoteAllocation[],
  columnId: string,
): Effect.Effect<{ columns: Column[]; groups: Group[]; items: RetroItem[]; votes: VoteAllocation[]; error?: string }> {
  return Effect.sync(() => applyDeleteColumn(columns, groups, items, votes, columnId));
}
