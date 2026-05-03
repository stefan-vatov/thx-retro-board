import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Effect } from "effect";
import type { RoomState, Group, Column } from "../domain";
import {
  sanitizeGroupName,
  isValidGroupName,
  hasDuplicateGroupNameInColumn,
} from "../domain";
import { scheduleFocusRestoreEffect } from "./focus-restore";
import {
  buildMoveItemCommandEffect,
  getDropTargetFromListEffect,
  getDropTargetFromZoneEffect,
  shouldBeginPointerDragEffect,
  type OrganiseDragStart,
} from "./organise-drag-effect";
import { OrganiseBoardColumn } from "./OrganiseBoardColumn";
import { OrganiseBoardStatus } from "./OrganiseBoardStatus";
import type { DropTarget } from "./OrganiseBoardLists";

interface OrganiseBoardProps {
  roomState: RoomState;
  isFacilitator: boolean;
  participantId: string;
  send: (message: unknown) => boolean;
  serverError?: string | null;
  clearServerError?: () => void;
}

interface DragPosition {
  x: number;
  y: number;
}

export function OrganiseBoard({
  roomState,
  participantId,
  send,
  serverError = null,
  clearServerError,
}: OrganiseBoardProps) {
  const [newGroupNames, setNewGroupNames] = useState<Record<string, string>>(
    {},
  );
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [groupError, setGroupError] = useState<string | null>(null);
  const [pendingMutation, setPendingMutation] = useState(false);
  const pendingVersionRef = useRef<number | null>(null);
  const restoreGroupFocusRef = useRef<string | null>(null);
  const groupInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [draggingSourceColumnId, setDraggingSourceColumnId] = useState<
    string | null
  >(null);
  const [draggingItemText, setDraggingItemText] = useState("");
  const [dragPosition, setDragPosition] = useState<DragPosition | null>(null);
  const [activeDrop, setActiveDrop] = useState<DropTarget | null>(null);
  const [organiseActionError, setOrganiseActionError] = useState<string | null>(
    null,
  );
  const activeDragCleanupRef = useRef<(() => void) | null>(null);

  const isOrganise = roomState.phase === "organise";

  const sortedColumns = [...(roomState.columns ?? [])].sort(
    (a, b) => a.order - b.order,
  );
  const sortedGroups = [...roomState.groups].sort((a, b) => a.order - b.order);
  const serverOrganiseError = serverError;
  const feedbackMessages = [groupError, serverOrganiseError].filter(
    (message, index, messages): message is string =>
      typeof message === "string" && messages.indexOf(message) === index,
  );

  function restoreGroupInputFocus(columnId: string) {
    const focusInput = () => groupInputRefs.current[columnId]?.focus();
    scheduleFocusRestoreEffect({
      restore: focusInput,
      delays: [50],
      requestAnimationFrame: (callback) =>
        window.requestAnimationFrame(callback),
      setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    }).pipe(Effect.runSync);
  }

  function handleCreateGroup(e: React.FormEvent, column: Column) {
    e.preventDefault();
    if (pendingMutation) return;
    setGroupError(null);
    const rawName = newGroupNames[column.id] ?? "";
    if (!isValidGroupName(rawName)) {
      setGroupError("Group name cannot be empty.");
      return;
    }
    if (hasDuplicateGroupNameInColumn(roomState.groups, column.id, rawName)) {
      setGroupError("Group name already exists in this column.");
      return;
    }
    clearServerError?.();
    if (
      !send({
        type: "create-group",
        name: sanitizeGroupName(rawName),
        columnId: column.id,
      })
    ) {
      setGroupError(
        "Group creation not sent. Please try again once the room is connected.",
      );
      return;
    }
    pendingVersionRef.current = roomState.version;
    setPendingMutation(true);
    setNewGroupNames((current) => ({ ...current, [column.id]: "" }));
    restoreGroupFocusRef.current = column.id;
    restoreGroupInputFocus(column.id);
  }

  useEffect(() => {
    if (pendingMutation && pendingVersionRef.current !== roomState.version) {
      pendingVersionRef.current = null;
      setPendingMutation(false);
    }
  }, [pendingMutation, roomState.version]);

  useEffect(() => {
    const columnId = restoreGroupFocusRef.current;
    if (!columnId || pendingMutation) return;
    restoreGroupFocusRef.current = null;
    restoreGroupInputFocus(columnId);
  }, [pendingMutation, roomState.version]);

  useEffect(() => {
    if (serverOrganiseError) {
      const timeout = window.setTimeout(() => {
        pendingVersionRef.current = null;
        setPendingMutation(false);
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [serverOrganiseError]);

  const handleReorderGroups = useCallback(
    (columnId: string, fromIdx: number, toIdx: number) => {
      setOrganiseActionError(null);
      clearServerError?.();
      const reordered = sortedGroups.filter(
        (group) => group.columnId === columnId,
      );
      const [moved] = reordered.splice(fromIdx, 1);
      if (!moved) return;
      reordered.splice(toIdx, 0, moved);
      if (
        !send({
          type: "reorder-groups",
          groupIds: reordered.map((g) => g.id),
          expectedVersion: roomState.version,
        })
      ) {
        setOrganiseActionError(
          "Column order not sent. Please try again once the room is connected.",
        );
      }
    },
    [clearServerError, roomState.version, send, sortedGroups],
  );

  function startEditGroup(group: Group) {
    setGroupError(null);
    setEditingGroupId(group.id);
    setEditingGroupName(group.name);
  }

  function submitEditGroup(group: Group) {
    setGroupError(null);
    if (!isValidGroupName(editingGroupName)) {
      setGroupError("Group name cannot be empty.");
      return;
    }
    if (
      hasDuplicateGroupNameInColumn(
        roomState.groups,
        group.columnId,
        editingGroupName,
        group.id,
      )
    ) {
      setGroupError("Group name already exists in this column.");
      return;
    }
    clearServerError?.();
    if (
      !send({
        type: "edit-group",
        groupId: group.id,
        name: sanitizeGroupName(editingGroupName),
      })
    ) {
      setGroupError(
        "Group rename not sent. Please try again once the room is connected.",
      );
      return;
    }
    pendingVersionRef.current = roomState.version;
    setPendingMutation(true);
    setEditingGroupId(null);
    setEditingGroupName("");
  }

  function deleteGroup(group: Group) {
    setGroupError(null);
    clearServerError?.();
    if (!send({ type: "delete-group", groupId: group.id })) {
      setGroupError(
        "Group deletion not sent. Please try again once the room is connected.",
      );
      return;
    }
    pendingVersionRef.current = roomState.version;
    setPendingMutation(true);
    if (editingGroupId === group.id) {
      setEditingGroupId(null);
      setEditingGroupName("");
    }
  }

  const cancelDrag = useCallback(() => {
    activeDragCleanupRef.current?.();
    activeDragCleanupRef.current = null;
    setDraggingItemId(null);
    setDraggingSourceColumnId(null);
    setDraggingItemText("");
    setDragPosition(null);
    setActiveDrop(null);
  }, []);

  const readDropTarget = useCallback(
    (event: PointerEvent): DropTarget | null => {
      const elementAtPoint = document.elementFromPoint(
        event.clientX,
        event.clientY,
      );
      const eventTarget = (
        event.target as Element | null
      )?.closest<HTMLElement>("[data-drop-zone='true']");
      const target =
        eventTarget ??
        elementAtPoint?.closest<HTMLElement>("[data-drop-zone='true']");
      if (target) {
        return Effect.runSync(getDropTargetFromZoneEffect(target.dataset));
      }

      const list = elementAtPoint?.closest<HTMLElement>("[data-drop-list]");
      if (!list) return null;
      return Effect.runSync(
        getDropTargetFromListEffect({
          dropList: list.dataset.dropList,
          dropColumnId: list.dataset.dropColumnId,
          pointerY: event.clientY,
          rows: [
            ...list.querySelectorAll<HTMLElement>("[data-drag-item-id]"),
          ].map((row) => ({
            top: row.getBoundingClientRect().top,
            height: row.offsetHeight,
          })),
        }),
      );
    },
    [],
  );

  const updateActiveDrop = useCallback(
    (event: PointerEvent): DropTarget | null => {
      setDragPosition({ x: event.clientX, y: event.clientY });
      const target = readDropTarget(event);
      setActiveDrop(target);
      return target;
    },
    [readDropTarget],
  );

  const startDrag = useCallback(
    (itemId: string): OrganiseDragStart | null => {
      setOrganiseActionError(null);
      clearServerError?.();
      const item = roomState.items.find((candidate) => candidate.id === itemId);
      if (!item) return null;
      const nextDragStart = {
        itemId,
        itemText: item.text,
        columnId: item.columnId,
        expectedVersion: roomState.version,
        sourceGroupId: item.groupId,
        sourceIndex: item.order,
      };
      setDraggingItemId(itemId);
      setDraggingSourceColumnId(item.columnId);
      setDraggingItemText(item.text);
      setActiveDrop(null);
      return nextDragStart;
    },
    [clearServerError, roomState.items, roomState.version],
  );

  const finishPointerDrag = useCallback(
    (event: PointerEvent, currentDragStart: OrganiseDragStart) => {
      const target = updateActiveDrop(event);
      const result = Effect.runSync(
        buildMoveItemCommandEffect(currentDragStart, target),
      );
      if (!result.success) {
        if (result.error) setOrganiseActionError(result.error);
        cancelDrag();
        return;
      }
      setOrganiseActionError(null);
      clearServerError?.();
      const sent = send(result.command);
      if (!sent) {
        setOrganiseActionError(
          "Item move not sent. Please try again once the room is connected.",
        );
      }
      cancelDrag();
    },
    [cancelDrag, clearServerError, send, updateActiveDrop],
  );

  const beginPointerDrag = useCallback(
    (event: ReactPointerEvent, itemId: string) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const startPoint = { x: event.clientX, y: event.clientY };
      let currentDragStart: OrganiseDragStart | null = null;

      const beginDragIfNeeded = (pointerEvent: PointerEvent) => {
        if (currentDragStart) return true;
        const shouldBegin = Effect.runSync(
          shouldBeginPointerDragEffect({
            start: startPoint,
            current: { x: pointerEvent.clientX, y: pointerEvent.clientY },
            threshold: 6,
          }),
        );
        if (!shouldBegin) return false;
        currentDragStart = startDrag(itemId);
        if (!currentDragStart) return false;
        setDragPosition({ x: pointerEvent.clientX, y: pointerEvent.clientY });
        return true;
      };

      const onPointerMove = (pointerEvent: PointerEvent) => {
        if (!beginDragIfNeeded(pointerEvent)) return;
        updateActiveDrop(pointerEvent);
      };
      const onPointerUp = (pointerEvent: PointerEvent) => {
        if (currentDragStart) {
          finishPointerDrag(pointerEvent, currentDragStart);
        } else {
          cancelDrag();
        }
      };
      const onPointerCancel = () => cancelDrag();
      const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Escape") cancelDrag();
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
        window.removeEventListener("keydown", onKeyDown);
      };

      activeDragCleanupRef.current?.();
      activeDragCleanupRef.current = cleanup;
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp, { once: true });
      window.addEventListener("pointercancel", onPointerCancel, { once: true });
      window.addEventListener("keydown", onKeyDown);
    },
    [cancelDrag, finishPointerDrag, startDrag, updateActiveDrop],
  );

  useEffect(() => () => cancelDrag(), [cancelDrag]);

  return (
    <div>
      <OrganiseBoardStatus
        draggingItemId={draggingItemId}
        draggingItemText={draggingItemText}
        dragPosition={dragPosition}
        organiseActionError={organiseActionError}
        serverOrganiseError={serverOrganiseError}
        feedbackMessages={feedbackMessages}
        showEmptyColumns={sortedColumns.length === 0}
      />

      {sortedColumns.length > 0 && (
        <div className="column-board" aria-label="Organise phase columns">
          {sortedColumns.map((column) => {
            const columnGroups = sortedGroups.filter(
              (group) => group.columnId === column.id,
            );
            const ungrouped = roomState.items
              .filter(
                (item) => item.columnId === column.id && item.groupId === null,
              )
              .sort((a, b) => a.order - b.order);
            const itemCount = roomState.items.filter(
              (item) => item.columnId === column.id,
            ).length;
            return (
              <OrganiseBoardColumn
                key={column.id}
                column={column}
                columnGroups={columnGroups}
                ungrouped={ungrouped}
                itemCount={itemCount}
                roomState={roomState}
                isOrganise={isOrganise}
                participantId={participantId}
                send={send}
                newGroupName={newGroupNames[column.id] ?? ""}
                feedbackMessages={feedbackMessages}
                pendingMutation={pendingMutation}
                draggingItemId={draggingItemId}
                draggingSourceColumnId={draggingSourceColumnId}
                activeDrop={activeDrop}
                editingGroupId={editingGroupId}
                editingGroupName={editingGroupName}
                setGroupInputRef={(columnId, element) => {
                  groupInputRefs.current[columnId] = element;
                }}
                onNewGroupNameChange={(columnId, value) => {
                  setNewGroupNames((current) => ({
                    ...current,
                    [columnId]: value,
                  }));
                  if (groupError) setGroupError(null);
                }}
                onCreateGroup={handleCreateGroup}
                onReorderGroups={handleReorderGroups}
                onDragStart={beginPointerDrag}
                onEditNameChange={setEditingGroupName}
                onStartEdit={startEditGroup}
                onSubmitEdit={submitEditGroup}
                onCancelEdit={() => {
                  setEditingGroupId(null);
                  setEditingGroupName("");
                }}
                onDelete={deleteGroup}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
