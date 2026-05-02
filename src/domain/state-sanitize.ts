import type { Group } from "./types";

export const MAX_COLUMN_NAME_LENGTH = 100;
export const MAX_ACTION_TEXT_LENGTH = 240;

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

export function sanitizeActionText(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, MAX_ACTION_TEXT_LENGTH);
}

export function isValidActionText(text: string): boolean {
  return sanitizeActionText(text).length > 0;
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

export function hasDuplicateGroupNameInColumn(
  groups: Group[],
  columnId: string,
  rawName: string,
  excludedGroupId?: string,
): boolean {
  const sanitized = sanitizeGroupName(rawName);
  return groups.some((group) =>
    group.columnId === columnId
    && group.id !== excludedGroupId
    && sanitizeGroupName(group.name) === sanitized,
  );
}
