import { Fragment, useCallback, useEffect, useState } from "react";
import type { RoomState, RetroItem, Group } from "../domain";
import {
  getUngroupedItems,
  getGroupedItems,
  sanitizeColumnName,
  isValidColumnName,
  MAX_COLUMN_NAME_LENGTH,
  MAX_COLUMNS,
} from "../domain";

interface OrganiseBoardProps {
  roomState: RoomState;
  isFacilitator: boolean;
  send: (message: unknown) => void;
  serverError?: string | null;
  clearServerError?: () => void;
}

export function OrganiseBoard({ roomState, isFacilitator, send, serverError = null, clearServerError }: OrganiseBoardProps) {
  const [newGroupName, setNewGroupName] = useState("");
  const [groupError, setGroupError] = useState<string | null>(null);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [activeDrop, setActiveDrop] = useState<DropTarget | null>(null);

  const isOrganise = roomState.phase === "organise";

  const sortedGroups = [...roomState.groups].sort((a, b) => a.order - b.order);
  const ungrouped = getUngroupedItems(roomState.items);
  const isAtMaxColumns = sortedGroups.length >= MAX_COLUMNS;
  const maxColumnsMessage = `Rooms can have at most ${MAX_COLUMNS} columns.`;
  const serverColumnError = serverError && /column/i.test(serverError) ? serverError : null;
  const feedbackMessages = [
    groupError,
    isAtMaxColumns ? maxColumnsMessage : null,
    serverColumnError,
  ].filter((message, index, messages): message is string => typeof message === "string" && messages.indexOf(message) === index);

  function handleCreateColumn(e: React.FormEvent) {
    e.preventDefault();
    setGroupError(null);
    if (isAtMaxColumns) {
      setGroupError(maxColumnsMessage);
      return;
    }
    if (!isValidColumnName(newGroupName)) {
      setGroupError("Column name cannot be empty.");
      return;
    }
    clearServerError?.();
    send({ type: "create-column", name: sanitizeColumnName(newGroupName) });
    setNewGroupName("");
  }

  const handleReorderGroups = useCallback(
    (fromIdx: number, toIdx: number) => {
      const reordered = [...sortedGroups];
      const [moved] = reordered.splice(fromIdx, 1);
      if (!moved) return;
      reordered.splice(toIdx, 0, moved);
      send({ type: "reorder-groups", groupIds: reordered.map((g) => g.id) });
    },
    [send, sortedGroups],
  );

  const cancelDrag = useCallback(() => {
    setDraggingItemId(null);
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
      const index = Number(target.dataset.index);
      if (!Number.isInteger(index)) {
        setActiveDrop(null);
        return;
      }
      setActiveDrop({ groupId, index });
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
        const index = Number(target.dataset.index);
        if (Number.isInteger(index)) {
          send({ type: "move-item-to-group", itemId: draggingItemId, groupId, index });
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
  }, [cancelDrag, draggingItemId, send]);

  function startDrag(itemId: string) {
    clearServerError?.();
    setDraggingItemId(itemId);
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

  const allItemsEmpty = roomState.items.length === 0;

  return (
    <div>
      {isOrganise && isFacilitator && (
        <div style={{ marginBottom: "var(--space-4)", display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
          <form onSubmit={handleCreateColumn} className="input-row" style={{ flex: 1 }}>
            <input
              type="text"
              className="input"
              value={newGroupName}
              onChange={(e) => {
                setNewGroupName(e.target.value);
                if (groupError) setGroupError(null);
              }}
              maxLength={MAX_COLUMN_NAME_LENGTH}
              placeholder="New group name / column name…"
              aria-label="New column name"
              disabled={isAtMaxColumns}
              aria-describedby={feedbackMessages.length > 0 ? "organise-column-feedback" : undefined}
              aria-invalid={groupError || serverColumnError ? "true" : undefined}
            />
            <button type="submit" className="btn btn--secondary btn--sm" aria-label="Create group / column" disabled={isAtMaxColumns}>Create Column</button>
          </form>
          {feedbackMessages.length > 0 && (
            <div id="organise-column-feedback" style={{ display: "grid", gap: "var(--space-1)" }}>
              {feedbackMessages.map((message) => (
                <span key={message} className="status-msg status-msg--error" style={{ padding: "var(--space-1) var(--space-2)", fontSize: "var(--text-xs)" }} role="alert">
                  {message}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {draggingItemId && (
        <div className="status-msg status-msg--info drag-status" role="status" aria-live="polite">
          Dragging item. Drop on an insertion line, or press Escape to cancel.
        </div>
      )}

      {allItemsEmpty ? (
        <div className="empty-state">
          <div className="empty-state__icon">📋</div>
          <p className="empty-state__text">No items to organise.</p>
        </div>
      ) : (
        <>
          {/* Ordered groups */}
          {sortedGroups.map((group, groupIdx) => {
            const groupItems = getGroupedItems(roomState.items, group.id);
            return (
              <GroupSection
                key={group.id}
                group={group}
                items={groupItems}
                groupIndex={groupIdx}
                totalGroups={sortedGroups.length}
                isOrganise={isOrganise}
                isFacilitator={isFacilitator}
                onReorderGroups={handleReorderGroups}
                draggingItemId={draggingItemId}
                activeDrop={activeDrop}
                onDragStart={startDrag}
              />
            );
          })}

          {/* Ungrouped items */}
          <DragList
            title="Ungrouped"
            groupId={null}
            items={ungrouped}
            emptyText="No ungrouped items."
            isOrganise={isOrganise}
            draggingItemId={draggingItemId}
            activeDrop={activeDrop}
            onDragStart={startDrag}
            className="ungrouped-section"
          />
        </>
      )}
    </div>
  );
}

interface DropTarget {
  groupId: string | null;
  index: number;
}

interface GroupSectionProps {
  group: Group;
  items: RetroItem[];
  groupIndex: number;
  totalGroups: number;
  isOrganise: boolean;
  isFacilitator: boolean;
  onReorderGroups: (fromIdx: number, toIdx: number) => void;
  draggingItemId: string | null;
  activeDrop: DropTarget | null;
  onDragStart: (itemId: string) => void;
}

function GroupSection({ group, items, groupIndex, totalGroups, isOrganise, isFacilitator, onReorderGroups, draggingItemId, activeDrop, onDragStart }: GroupSectionProps) {
  return (
    <div className="group-panel">
      <div className="group-panel__header">
        <h4 className="group-panel__title">{group.name}</h4>
        {isOrganise && isFacilitator && (
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
          </span>
        )}
      </div>
      <DragList
        title={group.name}
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
  groupId: string | null;
  items: RetroItem[];
  emptyText: string;
  isOrganise: boolean;
  draggingItemId: string | null;
  activeDrop: DropTarget | null;
  onDragStart: (itemId: string) => void;
  className?: string;
}

function DragList({ title, groupId, items, emptyText, isOrganise, draggingItemId, activeDrop, onDragStart, className }: DragListProps) {
  const visibleItems = items.filter((item) => item.id !== draggingItemId);
  const groupKey = groupId ?? "__ungrouped__";
  const isActiveList = draggingItemId !== null && activeDrop?.groupId === groupId;
  const dropZone = (index: number) => {
    const isActive = isActiveList && activeDrop?.index === index;
    return (
      <li
        key={`drop-${groupKey}-${index}`}
        className={`drag-drop-zone${isActive ? " drag-drop-zone--active" : ""}`}
        data-drop-zone="true"
        data-group-id={groupKey}
        data-index={index}
        data-active={isActive ? "true" : "false"}
        aria-hidden={draggingItemId ? undefined : "true"}
      >
        <span className="drag-drop-zone__line" />
      </li>
    );
  };

  return (
    <div className={`${className ?? ""}${isActiveList ? " drag-list--active" : ""}`} data-drop-list={groupKey} data-drop-list-active={isActiveList ? "true" : "false"} aria-label={`${title} drop target`}>
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
                event.currentTarget.setPointerCapture?.(event.pointerId);
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
                  event.currentTarget.setPointerCapture?.(event.pointerId);
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
