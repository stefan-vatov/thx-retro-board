import { Effect } from "effect";
import type { Column, RoomState } from "../domain";

export function getSortedColumns(roomState: RoomState): Column[] {
  return [...(roomState.columns ?? roomState.groups)].sort((a, b) => a.order - b.order);
}

export function getSortedColumnsEffect(roomState: RoomState): Effect.Effect<Column[]> {
  return Effect.sync(() => getSortedColumns(roomState));
}
