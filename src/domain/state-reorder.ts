import { Effect } from "effect";
import type { Group, RetroItem } from "./types";
import { reorderList } from "./state-sanitize";

export class ReorderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReorderValidationError";
  }
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

export function validateItemReorderPayloadEffect(
  items: RetroItem[],
  orderedIds: unknown,
): Effect.Effect<string[], ReorderValidationError> {
  return Effect.gen(function* () {
    const validation = validateItemReorderPayload(items, orderedIds);
    if (!validation.valid) {
      return yield* Effect.fail(new ReorderValidationError(validation.error));
    }
    return validation.ids;
  });
}

export function applyReorderGroups<T extends { id: string; order: number }>(groups: T[], orderedIds: string[]): T[] {
  const reordered = reorderList(groups, orderedIds, (group) => group.id);
  return reordered.map((group, index) => ({ ...group, order: index }));
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

export function validateGroupReorderPayloadEffect(
  groups: Group[],
  orderedIds: unknown,
): Effect.Effect<string[], ReorderValidationError> {
  return Effect.gen(function* () {
    const validation = validateGroupReorderPayload(groups, orderedIds);
    if (!validation.valid) {
      return yield* Effect.fail(new ReorderValidationError(validation.error));
    }
    return validation.ids;
  });
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

export function applyMoveItemToGroup(
  items: RetroItem[],
  itemId: string,
  targetGroupId: string | null,
  targetIndex: number,
): RetroItem[] {
  const itemIndex = items.findIndex((item) => item.id === itemId);
  if (itemIndex === -1) return items;

  const source = items[itemIndex]!;
  const moved: RetroItem = { ...source, groupId: targetGroupId };
  const otherItems = items.filter((item) => item.id !== itemId);

  const sameGroup = otherItems
    .filter((item) => item.columnId === moved.columnId && item.groupId === targetGroupId)
    .sort((a, b) => a.order - b.order);
  const before = sameGroup.slice(0, targetIndex);
  const after = sameGroup.slice(targetIndex);

  const updatedSameGroup: RetroItem[] = [...before, moved, ...after].map((item, index) => ({ ...item, order: index }));
  const affectedSourceGroupId = source.groupId;
  const differentGroup = otherItems.filter((item) => item.columnId !== moved.columnId || item.groupId !== targetGroupId);
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
