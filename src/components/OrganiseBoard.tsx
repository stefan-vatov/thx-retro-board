import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { AlertCircle, Columns3, GripVertical, Plus } from "lucide-react";
import type { RoomState, Group, Column } from "../domain";
import {
  getGroupedItems,
  sanitizeGroupName,
  isValidGroupName,
  hasDuplicateGroupNameInColumn,
  MAX_COLUMN_NAME_LENGTH,
} from "../domain";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "./ui/card";
import { Input } from "./ui/input";
import { submitFormOnModEnter } from "./form-shortcuts";
import { DragList, GroupSection, type DropTarget } from "./OrganiseBoardLists";

interface OrganiseBoardProps {
  roomState: RoomState;
  isFacilitator: boolean;
  participantId: string;
  send: (message: unknown) => boolean;
  serverError?: string | null;
  clearServerError?: () => void;
}

interface DragStart {
  itemId: string;
  itemText: string;
  columnId: string;
  expectedVersion: number;
  sourceGroupId: string | null;
  sourceIndex: number;
}

interface DragPosition {
  x: number;
  y: number;
}

export function OrganiseBoard({ roomState, participantId, send, serverError = null, clearServerError }: OrganiseBoardProps) {
  const [newGroupNames, setNewGroupNames] = useState<Record<string, string>>({});
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [groupError, setGroupError] = useState<string | null>(null);
  const [pendingMutation, setPendingMutation] = useState(false);
  const pendingVersionRef = useRef<number | null>(null);
  const restoreGroupFocusRef = useRef<string | null>(null);
  const groupInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [draggingSourceColumnId, setDraggingSourceColumnId] = useState<string | null>(null);
  const [draggingItemText, setDraggingItemText] = useState("");
  const [dragPosition, setDragPosition] = useState<DragPosition | null>(null);
  const [activeDrop, setActiveDrop] = useState<DropTarget | null>(null);
  const [organiseActionError, setOrganiseActionError] = useState<string | null>(null);
  const activeDragCleanupRef = useRef<(() => void) | null>(null);

  const isOrganise = roomState.phase === "organise";

  const sortedColumns = [...(roomState.columns ?? [])].sort((a, b) => a.order - b.order);
  const sortedGroups = [...roomState.groups].sort((a, b) => a.order - b.order);
  const serverOrganiseError = serverError;
  const feedbackMessages = [
    groupError,
    serverOrganiseError,
  ].filter((message, index, messages): message is string => typeof message === "string" && messages.indexOf(message) === index);

  function restoreGroupInputFocus(columnId: string) {
    const focusInput = () => groupInputRefs.current[columnId]?.focus();
    window.requestAnimationFrame(focusInput);
    window.setTimeout(focusInput, 50);
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
    if (!send({ type: "create-group", name: sanitizeGroupName(rawName), columnId: column.id })) {
      setGroupError("Group creation not sent. Please try again once the room is connected.");
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
      const reordered = sortedGroups.filter((group) => group.columnId === columnId);
      const [moved] = reordered.splice(fromIdx, 1);
      if (!moved) return;
      reordered.splice(toIdx, 0, moved);
      if (!send({ type: "reorder-groups", groupIds: reordered.map((g) => g.id), expectedVersion: roomState.version })) {
        setOrganiseActionError("Column order not sent. Please try again once the room is connected.");
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
    if (hasDuplicateGroupNameInColumn(roomState.groups, group.columnId, editingGroupName, group.id)) {
      setGroupError("Group name already exists in this column.");
      return;
    }
    clearServerError?.();
    if (!send({ type: "edit-group", groupId: group.id, name: sanitizeGroupName(editingGroupName) })) {
      setGroupError("Group rename not sent. Please try again once the room is connected.");
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
      setGroupError("Group deletion not sent. Please try again once the room is connected.");
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

  const readDropTarget = useCallback((event: PointerEvent): DropTarget | null => {
    const elementAtPoint = document.elementFromPoint(event.clientX, event.clientY);
    const eventTarget = (event.target as Element | null)?.closest<HTMLElement>("[data-drop-zone='true']");
    const target = eventTarget ?? elementAtPoint?.closest<HTMLElement>("[data-drop-zone='true']");
    if (target) {
      const groupId = target.dataset.groupId === "__ungrouped__" ? null : target.dataset.groupId ?? null;
      const columnId = target.dataset.dropColumnId ?? null;
      const index = Number(target.dataset.index);
      if (!Number.isInteger(index) || !columnId) return null;
      return { groupId, columnId, index };
    }

    const list = elementAtPoint?.closest<HTMLElement>("[data-drop-list]");
    if (!list) return null;
    const groupKey = list.dataset.dropList;
    const groupId = groupKey === "__ungrouped__" ? null : groupKey ?? null;
    const columnId = list.dataset.dropColumnId ?? null;
    if (!columnId) return null;

    const rows = [...list.querySelectorAll<HTMLElement>("[data-drag-item-id]")];
    const index = rows.findIndex((row) => event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2);
    return { groupId, columnId, index: index === -1 ? rows.length : index };
  }, []);

  const updateActiveDrop = useCallback((event: PointerEvent): DropTarget | null => {
    setDragPosition({ x: event.clientX, y: event.clientY });
    const target = readDropTarget(event);
    setActiveDrop(target);
    return target;
  }, [readDropTarget]);

  const startDrag = useCallback((itemId: string): DragStart | null => {
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
  }, [clearServerError, roomState.items, roomState.version]);

  const finishPointerDrag = useCallback((event: PointerEvent, currentDragStart: DragStart) => {
    const target = updateActiveDrop(event);
    if (target) {
      setOrganiseActionError(null);
      clearServerError?.();
      if (target.columnId !== currentDragStart.columnId) {
        setOrganiseActionError("Items can only be moved within their original column.");
        cancelDrag();
        return;
      }
      const sent = send({
        type: "move-item-to-group",
        itemId: currentDragStart.itemId,
        groupId: target.groupId,
        index: target.index,
        expectedVersion: currentDragStart.expectedVersion,
        sourceGroupId: currentDragStart.sourceGroupId,
        sourceIndex: currentDragStart.sourceIndex,
      });
      if (!sent) {
        setOrganiseActionError("Item move not sent. Please try again once the room is connected.");
      }
    }
    cancelDrag();
  }, [cancelDrag, clearServerError, send, updateActiveDrop]);

  const beginPointerDrag = useCallback((event: ReactPointerEvent, itemId: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startPoint = { x: event.clientX, y: event.clientY };
    let currentDragStart: DragStart | null = null;

    const beginDragIfNeeded = (pointerEvent: PointerEvent) => {
      if (currentDragStart) return true;
      const distance = Math.hypot(pointerEvent.clientX - startPoint.x, pointerEvent.clientY - startPoint.y);
      if (distance < 6) return false;
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
  }, [cancelDrag, finishPointerDrag, startDrag, updateActiveDrop]);

  useEffect(() => () => cancelDrag(), [cancelDrag]);

  return (
    <div>
      {draggingItemId && (
        <Alert className="status-msg status-msg--info drag-status" role="status" aria-live="polite">
          <GripVertical aria-hidden="true" />
          <AlertTitle>Dragging item</AlertTitle>
          <AlertDescription>Drop anywhere in a group or ungrouped area in the same column, or press Escape to cancel.</AlertDescription>
        </Alert>
      )}

      {draggingItemId && dragPosition && (
        <div
          className="drag-preview"
          style={{ transform: `translate3d(${dragPosition.x + 14}px, ${dragPosition.y + 14}px, 0)` }}
          aria-hidden="true"
        >
          <GripVertical size={16} />
          <span>{draggingItemText}</span>
        </div>
      )}

      {(organiseActionError || serverOrganiseError) && (
        <Alert variant="destructive" className="status-msg status-msg--error organise-error">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Organise change was not applied</AlertTitle>
          <AlertDescription>{organiseActionError ?? serverOrganiseError}</AlertDescription>
        </Alert>
      )}
      {feedbackMessages.length > 0 && !organiseActionError && (
        <div id="organise-group-feedback" className="organise-feedback-stack">
          {feedbackMessages.map((message) => (
            <Alert key={message} variant="destructive" className="status-msg status-msg--error organise-feedback-alert">
              <AlertCircle aria-hidden="true" />
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {sortedColumns.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon empty-state__icon--block" aria-hidden="true">
            <Columns3 size={28} />
          </div>
          <p className="empty-state__text">No columns to organise yet. Ask the facilitator to create columns.</p>
        </div>
      ) : (
        <div className="column-board" aria-label="Organise phase columns">
          {sortedColumns.map((column) => {
            const columnGroups = sortedGroups.filter((group) => group.columnId === column.id);
            const ungrouped = roomState.items
              .filter((item) => item.columnId === column.id && item.groupId === null)
              .sort((a, b) => a.order - b.order);
            const itemCount = roomState.items.filter((item) => item.columnId === column.id).length;
            return (
              <Card key={column.id} className="column-board__column" role="region" aria-labelledby={`organise-column-${column.id}`} data-column-id={column.id}>
                <CardHeader className="column-board__header">
                  <div className="column-board__title-wrap">
                    <Badge variant="secondary" className="organise-lane-badge">Organise lane</Badge>
                    <h3 id={`organise-column-${column.id}`} className="column-board__title" title={column.name}>{column.name}</h3>
                    <CardDescription className="organise-lane-description">
                      Create groups in this lane, then drag items only within {column.name}. Existing content remains readable while disconnected.
                    </CardDescription>
                  </div>
                  <Badge variant="secondary" className="column-board__count" aria-label={`${itemCount} items`}>{itemCount}</Badge>
                </CardHeader>
                <CardContent className="organise-lane-content">
                <div className="organise-lane-meta" role="status" aria-live="polite">
                  <Badge variant="outline">Same-column grouping only</Badge>
                  <span className="text-muted">{columnGroups.length} groups · {ungrouped.length} ungrouped</span>
                </div>
                {isOrganise && (
                  <form className="input-row organise-group-form" onSubmit={(event) => handleCreateGroup(event, column)}>
                    <Input
                      ref={(element) => {
                        groupInputRefs.current[column.id] = element;
                      }}
                      type="text"
                      className="input"
                      value={newGroupNames[column.id] ?? ""}
                      onChange={(e) => {
                        setNewGroupNames((current) => ({ ...current, [column.id]: e.target.value }));
                        if (groupError) setGroupError(null);
                      }}
                      onKeyDown={submitFormOnModEnter}
                      maxLength={MAX_COLUMN_NAME_LENGTH}
                      placeholder="New group name…"
                      aria-label={`New group name for ${column.name}`}
                      aria-describedby={feedbackMessages.length > 0 ? "organise-group-feedback" : undefined}
                    />
                    <Button type="submit" variant="secondary" size="sm" className="btn btn--secondary btn--sm" disabled={pendingMutation} aria-busy={pendingMutation}>
                      <Plus aria-hidden="true" />
                      Create group
                    </Button>
                  </form>
                )}
                {columnGroups.length === 0 && ungrouped.length === 0 && (
                  <Alert className="column-board__empty" role="status">
                    <AlertTitle>No items or groups in this lane yet</AlertTitle>
                    <AlertDescription>Items keep their original column context. Add write-phase items or create a group when feedback arrives.</AlertDescription>
                  </Alert>
                )}
                <div className="organise-group-stack">
                {columnGroups.map((group, groupIdx) => (
                  <GroupSection
                    key={group.id}
                    group={group}
                    items={getGroupedItems(roomState.items, group.id)}
                    groupIndex={groupIdx}
                    totalGroups={columnGroups.length}
                    isOrganise={isOrganise}
                    onReorderGroups={(fromIdx, toIdx) => handleReorderGroups(column.id, fromIdx, toIdx)}
                    draggingItemId={draggingItemId}
                    draggingSourceColumnId={draggingSourceColumnId}
                    activeDrop={activeDrop}
                    onDragStart={beginPointerDrag}
                    editingGroupId={editingGroupId}
                    editingGroupName={editingGroupName}
                    onEditNameChange={setEditingGroupName}
                    onStartEdit={startEditGroup}
                    onSubmitEdit={submitEditGroup}
                    onCancelEdit={() => {
                      setEditingGroupId(null);
                      setEditingGroupName("");
                    }}
                    onDelete={deleteGroup}
                    feedbackId={feedbackMessages.length > 0 ? "organise-group-feedback" : undefined}
                    roomState={roomState}
                    participantId={participantId}
                    send={send}
                  />
                ))}
                </div>
                <DragList
                  title={`${column.name} ungrouped`}
                  columnId={column.id}
                  groupId={null}
                  items={ungrouped}
                  emptyText="No ungrouped items."
                  isOrganise={isOrganise}
                  draggingItemId={draggingItemId}
                  draggingSourceColumnId={draggingSourceColumnId}
                  activeDrop={activeDrop}
                  onDragStart={beginPointerDrag}
                  className="ungrouped-section"
                  roomState={roomState}
                  participantId={participantId}
                  send={send}
                />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
