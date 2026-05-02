import type { Column, RoomState } from "../domain";

export function getSortedColumns(roomState: RoomState): Column[] {
  return [...(roomState.columns ?? roomState.groups)].sort((a, b) => a.order - b.order);
}
