import { Effect } from "effect";

import type { RetroItem } from "./types";

export function getUngroupedItems(items: RetroItem[]): RetroItem[] {
  return items
    .filter((item) => item.groupId === null)
    .sort((a, b) => a.order - b.order);
}

export function getUngroupedItemsEffect(items: RetroItem[]): Effect.Effect<RetroItem[]> {
  return Effect.sync(() => getUngroupedItems(items));
}

export function getGroupedItems(items: RetroItem[], groupId: string): RetroItem[] {
  return items
    .filter((item) => item.groupId === groupId)
    .sort((a, b) => a.order - b.order);
}

export function getGroupedItemsEffect(items: RetroItem[], groupId: string): Effect.Effect<RetroItem[]> {
  return Effect.sync(() => getGroupedItems(items, groupId));
}
