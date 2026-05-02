import type { RetroItem } from "./types";

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
