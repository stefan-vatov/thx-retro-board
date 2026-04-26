import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { RoomState, RetroItem, Group, Column } from "../domain";
import {
  getGroupedItems,
  sanitizeGroupName,
  isValidGroupName,
  MAX_COLUMN_NAME_LENGTH,
} from "../domain";

interface OrganiseBoardProps {
  roomState: RoomState;
  isFacilitator: boolean;
  send: (message: unknown) => boolean;
  serverError?: string | null;
  clearServerError?: () => void;
}

export function OrganiseBoard({ roomState, send, serverError = null, clearServerError }: OrganiseBoardProps) {
  const [newGroupNames, setNewGroupNames] = useState<Record<string, string>>({});
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [groupError, setGroupError] = useState<string | null>(null);
  const [pendingMutation, setPendingMutation] = useState(false);
  const pendingVersionRef = useRef<number | null>(null);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState<{ itemId: string; columnId: string; expectedVersion: number; sourceGroupId: string | null; sourceIndex: number } | null>(null);
  const [activeDrop, setActiveDrop] = useState<DropTarget | null>(null);
  const [organiseActionError, setOrganiseActionError] = useState<string | null>(null);

  const isOrganise = roomState.phase === "organise";

  const sortedColumns = [...(roomState.columns ?? [])].sort((a, b) => a.order - b.order);
  const sortedGroups = [...roomState.groups].sort((a, b) => a.order - b.order);
  const serverOrganiseError = serverError;
  const feedbackMessages = [
    groupError,
    serverOrganiseError,
  ].filter((message, index, messages): message is string => typeof message === "string" && messages.indexOf(message) === index);

  function handleCreateGroup(e: React.FormEvent, column: Column) {
    e.preventDefault();
    setGroupError(null);
    const rawName = newGroupNames[column.id] ?? "";
    if (!isValidGroupName(rawName)) {
      setGroupError("Group name cannot be empty.");
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
  }

  useEffect(() => {
    if (pendingMutation && pendingVersionRef.current !== roomState.version) {
      pendingVersionRef.current = null;
      setPendingMutation(false);
    }
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
      if (!send({ type: "reorder-groups", groupIds: reordered.map((g) => g.id) })) {
        setOrganiseActionError("Column order not sent. Please try again once the room is connected.");
      }
    },
    [clearServerError, send, sortedGroups],
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
    setDraggingItemId(null);
    setDragStart(null);
    setActiveDrop(null);
  }, []);

  useEffect(() => {
    if (!draggingItemId) return;

    function updateActiveDrop(event: PointerEvent) {
      const eventTarget = (event.target as Element | null)?.closest<HTMLElement>("[data-drop-zone='true']");
      const target = eventTarget ?? document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-drop-zone='true']");
      if (!target) {
        setActiveDrop(null);
        return;
      }
      const groupId = target.dataset.groupId === "__ungrouped__" ? null : target.dataset.groupId ?? null;
      const columnId = target.dataset.dropColumnId ?? null;
      const index = Number(target.dataset.index);
      if (!Number.isInteger(index) || !columnId) {
        setActiveDrop(null);
        return;
      }
      setActiveDrop({ groupId, columnId, index });
    }

    function onPointerMove(event: PointerEvent) {
      updateActiveDrop(event);
    }

    function onPointerUp(event: PointerEvent) {
      updateActiveDrop(event);
      const target = (event.target as Element | null)?.closest<HTMLElement>("[data-drop-zone='true']")
        ?? document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-drop-zone='true']");
      if (target) {
        const groupId = target.dataset.groupId === "__ungrouped__" ? null : target.dataset.groupId ?? null;
        const targetColumnId = target.dataset.dropColumnId ?? null;
        const index = Number(target.dataset.index);
        if (Number.isInteger(index) && targetColumnId && dragStart?.itemId === draggingItemId) {
          setOrganiseActionError(null);
          clearServerError?.();
          if (targetColumnId !== dragStart.columnId) {
            setOrganiseActionError("Items can only be moved within their original column.");
            cancelDrag();
            return;
          }
          const sent = send({
            type: "move-item-to-group",
            itemId: draggingItemId,
            groupId,
            index,
            expectedVersion: dragStart.expectedVersion,
            sourceGroupId: dragStart.sourceGroupId,
            sourceIndex: dragStart.sourceIndex,
          });
          if (!sent) {
            setOrganiseActionError("Item move not sent. Please try again once the room is connected.");
          }
        }
      }
      cancelDrag();
    }

    function onPointerCancel() {
      cancelDrag();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        cancelDrag();
      }
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [cancelDrag, clearServerError, dragStart, draggingItemId, send]);

  function startDrag(itemId: string) {
    setOrganiseActionError(null);
    clearServerError?.();
    const item = roomState.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    setDraggingItemId(itemId);
    setDragStart({
      itemId,
      columnId: item.columnId,
      expectedVersion: roomState.version,
      sourceGroupId: item.groupId,
      sourceIndex: item.order,
    });
    setActiveDrop(null);
  }

  useEffect(() => {
    function onNativePointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      const row = (event.target as Element | null)?.closest<HTMLElement>("[data-drag-item-id]");
      const itemId = row?.dataset.dragItemId;
      if (itemId) {
        event.preventDefault();
        startDrag(itemId);
      }
    }

    document.addEventListener("pointerdown", onNativePointerDown);
    return () => document.removeEventListener("pointerdown", onNativePointerDown);
  });

  return (
    <div>
      {draggingItemId && (
        <div className="status-msg status-msg--info drag-status" role="status" aria-live="polite">
          Dragging item. Drop on an insertion line, or press Escape to cancel.
        </div>
      )}

      {(organiseActionError || serverOrganiseError) && (
        <div className="status-msg status-msg--error" role="alert" style={{ marginBottom: "var(--space-3)" }}>
          {organiseActionError ?? serverOrganiseError}
        </div>
      )}
      {feedbackMessages.length > 0 && !organiseActionError && (
        <div id="organise-group-feedback" style={{ display: "grid", gap: "var(--space-1)", marginBottom: "var(--space-3)" }}>
          {feedbackMessages.map((message) => (
            <span key={message} className="status-msg status-msg--error" style={{ padding: "var(--space-1) var(--space-2)", fontSize: "var(--text-xs)" }} role="alert">
              {message}
            </span>
          ))}
        </div>
      )}

      {sortedColumns.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">🧭</div>
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
              <section key={column.id} className="column-board__column" aria-labelledby={`organise-column-${column.id}`} data-column-id={column.id}>
                <div className="column-board__header">
                  <h3 id={`organise-column-${column.id}`} className="column-board__title" title={column.name}>{column.name}</h3>
                  <span className="column-board__count" aria-label={`${itemCount} items`}>{itemCount}</span>
                </div>
                {isOrganise && (
                  <form className="input-row" style={{ marginBottom: "var(--space-3)" }} onSubmit={(event) => handleCreateGroup(event, column)}>
                    <input
                      type="text"
                      className="input"
                      value={newGroupNames[column.id] ?? ""}
                      onChange={(e) => {
                        setNewGroupNames((current) => ({ ...current, [column.id]: e.target.value }));
                        if (groupError) setGroupError(null);
                      }}
                      maxLength={MAX_COLUMN_NAME_LENGTH}
                      placeholder="New group name…"
                      aria-label={`New group name for ${column.name}`}
                      aria-describedby={feedbackMessages.length > 0 ? "organise-group-feedback" : undefined}
                      disabled={pendingMutation}
                    />
                    <button type="submit" className="btn btn--secondary btn--sm" disabled={pendingMutation} aria-busy={pendingMutation}>
                      Create group
                    </button>
                  </form>
                )}
                {columnGroups.length === 0 && ungrouped.length === 0 && (
                  <p className="text-muted column-board__empty">No items or groups in this lane yet.</p>
                )}
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
                    activeDrop={activeDrop}
                    onDragStart={startDrag}
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
                  />
                ))}
                <DragList
                  title={`${column.name} ungrouped`}
                  columnId={column.id}
                  groupId={null}
                  items={ungrouped}
                  emptyText="No ungrouped items."
                  isOrganise={isOrganise}
                  draggingItemId={draggingItemId}
                  activeDrop={activeDrop}
                  onDragStart={startDrag}
                  className="ungrouped-section"
                />
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface DropTarget {
  groupId: string | null;
  columnId: string;
  index: number;
}

interface GroupSectionProps {
  group: Group;
  items: RetroItem[];
  groupIndex: number;
  totalGroups: number;
  isOrganise: boolean;
  onReorderGroups: (fromIdx: number, toIdx: number) => void;
  draggingItemId: string | null;
  activeDrop: DropTarget | null;
  onDragStart: (itemId: string) => void;
  editingGroupId: string | null;
  editingGroupName: string;
  onEditNameChange: (name: string) => void;
  onStartEdit: (group: Group) => void;
  onSubmitEdit: (group: Group) => void;
  onCancelEdit: () => void;
  onDelete: (group: Group) => void;
}

function GroupSection({ group, items, groupIndex, totalGroups, isOrganise, onReorderGroups, draggingItemId, activeDrop, onDragStart, editingGroupId, editingGroupName, onEditNameChange, onStartEdit, onSubmitEdit, onCancelEdit, onDelete }: GroupSectionProps) {
  const isEditing = editingGroupId === group.id;
  return (
    <div className="group-panel">
      <div className="group-panel__header">
        {isEditing ? (
          <form
            className="input-row"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmitEdit(group);
            }}
          >
            <input
              className="input"
              value={editingGroupName}
              onChange={(event) => onEditNameChange(event.target.value)}
              maxLength={MAX_COLUMN_NAME_LENGTH}
              aria-label={`Edit ${group.name} group name`}
            />
            <button type="submit" className="btn btn--secondary btn--sm">Save</button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onCancelEdit}>Cancel</button>
          </form>
        ) : (
          <h4 className="group-panel__title">{group.name}</h4>
        )}
        {isOrganise && (
          <span className="group-panel__controls">
            <button
              className="reorder-btn"
              disabled={groupIndex === 0}
              onClick={() => onReorderGroups(groupIndex, groupIndex - 1)}
              title="Move group up"
              aria-label="Move group up"
            >
              ↑
            </button>
            <button
              className="reorder-btn"
              disabled={groupIndex === totalGroups - 1}
              onClick={() => onReorderGroups(groupIndex, groupIndex + 1)}
              title="Move group down"
              aria-label="Move group down"
            >
              ↓
            </button>
            {!isEditing && (
              <button className="reorder-btn" onClick={() => onStartEdit(group)} aria-label={`Rename ${group.name}`} title="Rename group">
                ✎
              </button>
            )}
            <button className="reorder-btn" onClick={() => onDelete(group)} aria-label={`Delete ${group.name}`} title="Delete group">
              ×
            </button>
          </span>
        )}
      </div>
      <DragList
        title={group.name}
        columnId={group.columnId}
        groupId={group.id}
        items={items}
        emptyText="No items in this group."
        isOrganise={isOrganise}
        draggingItemId={draggingItemId}
        activeDrop={activeDrop}
        onDragStart={onDragStart}
      />
    </div>
  );
}

interface DragListProps {
  title: string;
  columnId: string;
  groupId: string | null;
  items: RetroItem[];
  emptyText: string;
  isOrganise: boolean;
  draggingItemId: string | null;
  activeDrop: DropTarget | null;
  onDragStart: (itemId: string) => void;
  className?: string;
}

function DragList({ title, columnId, groupId, items, emptyText, isOrganise, draggingItemId, activeDrop, onDragStart, className }: DragListProps) {
  const visibleItems = items.filter((item) => item.id !== draggingItemId);
  const groupKey = groupId ?? "__ungrouped__";
  const isActiveList = draggingItemId !== null && activeDrop?.groupId === groupId && activeDrop?.columnId === columnId;
  const dropZone = (index: number) => {
    const isActive = isActiveList && activeDrop?.index === index;
    return (
      <li
        key={`drop-${groupKey}-${index}`}
        className={`drag-drop-zone${isActive ? " drag-drop-zone--active" : ""}`}
        data-drop-zone="true"
        data-group-id={groupKey}
        data-drop-column-id={columnId}
        data-index={index}
        data-active={isActive ? "true" : "false"}
        aria-hidden={draggingItemId ? undefined : "true"}
      >
        <span className="drag-drop-zone__line" />
      </li>
    );
  };

  return (
    <div className={`${className ?? ""}${isActiveList ? " drag-list--active" : ""}`} data-drop-list={groupKey} data-drop-column-id={columnId} data-drop-list-active={isActiveList ? "true" : "false"} aria-label={`${title} drop target`}>
      {className && (
        <div className="section-header">
          <span className="section-title">{title}</span>
        </div>
      )}
      {visibleItems.length === 0 && <p className="text-muted" style={{ fontSize: "var(--text-sm)", margin: 0 }}>{emptyText}</p>}
      <ul className="item-list drag-list">
        {isOrganise && dropZone(0)}
        {visibleItems.map((item, idx) => (
          <Fragment key={`item-and-drop-${item.id}`}>
            <li
              className={`item-row item-row--draggable${draggingItemId === item.id ? " item-row--dragging" : ""}`}
              data-drag-item-id={item.id}
              aria-grabbed={draggingItemId === item.id}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                onDragStart(item.id);
              }}
              onMouseDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                onDragStart(item.id);
              }}
              onTouchStart={() => onDragStart(item.id)}
              onClick={() => onDragStart(item.id)}
            >
              <button
                type="button"
                className="drag-handle"
                aria-label={`Drag ${item.text}`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  onDragStart(item.id);
                }}
                onMouseDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  onDragStart(item.id);
                }}
                onTouchStart={() => onDragStart(item.id)}
                onClick={() => onDragStart(item.id)}
              >
                ⋮⋮
              </button>
              <span className="item-row__text">{item.text}</span>
            </li>
            {isOrganise && dropZone(idx + 1)}
          </Fragment>
        ))}
      </ul>
    </div>
  );
}
