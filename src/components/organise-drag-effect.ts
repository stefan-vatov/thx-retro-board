import { Effect } from "effect";
import type { DropTarget } from "./OrganiseBoardLists";

export type DragPoint = {
  x: number;
  y: number;
};

export type OrganiseDragStart = {
  itemId: string;
  itemText: string;
  columnId: string;
  expectedVersion: number;
  sourceGroupId: string | null;
  sourceIndex: number;
};

export type MoveItemToGroupCommand = {
  type: "move-item-to-group";
  itemId: string;
  groupId: string | null;
  index: number;
  expectedVersion: number;
  sourceGroupId: string | null;
  sourceIndex: number;
};

export type BuildMoveItemCommandResult =
  | { success: true; command: MoveItemToGroupCommand }
  | { success: false; error: string | null };

export function shouldBeginPointerDragEffect({
  start,
  current,
  threshold,
}: {
  start: DragPoint;
  current: DragPoint;
  threshold: number;
}): Effect.Effect<boolean> {
  return Effect.sync(
    () => Math.hypot(current.x - start.x, current.y - start.y) >= threshold,
  );
}

export function buildMoveItemCommandEffect(
  dragStart: OrganiseDragStart,
  target: DropTarget | null,
): Effect.Effect<BuildMoveItemCommandResult> {
  return Effect.sync(() => {
    if (!target) return { success: false, error: null };
    if (target.columnId !== dragStart.columnId) {
      return {
        success: false,
        error: "Items can only be moved within their original column.",
      };
    }
    return {
      success: true,
      command: {
        type: "move-item-to-group",
        itemId: dragStart.itemId,
        groupId: target.groupId,
        index: target.index,
        expectedVersion: dragStart.expectedVersion,
        sourceGroupId: dragStart.sourceGroupId,
        sourceIndex: dragStart.sourceIndex,
      },
    };
  });
}
