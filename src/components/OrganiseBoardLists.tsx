import { Fragment } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical, Pencil, Trash2 } from "lucide-react";
import type { Group, RetroItem, RoomState } from "../domain";
import { groupVoteTarget, itemVoteTarget, MAX_COLUMN_NAME_LENGTH } from "../domain";
import { submitFormOnModEnter } from "./form-shortcuts";
import { ReactionBar } from "./Reactions";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "./ui/card";
import { Input } from "./ui/input";

export interface DropTarget {
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
  draggingSourceColumnId: string | null;
  activeDrop: DropTarget | null;
  onDragStart: (event: ReactPointerEvent, itemId: string) => void;
  editingGroupId: string | null;
  editingGroupName: string;
  onEditNameChange: (name: string) => void;
  onStartEdit: (group: Group) => void;
  onSubmitEdit: (group: Group) => void;
  onCancelEdit: () => void;
  onDelete: (group: Group) => void;
  feedbackId?: string;
  roomState: RoomState;
  participantId: string;
  send: (message: unknown) => boolean;
}

export function GroupSection({ group, items, groupIndex, totalGroups, isOrganise, onReorderGroups, draggingItemId, draggingSourceColumnId, activeDrop, onDragStart, editingGroupId, editingGroupName, onEditNameChange, onStartEdit, onSubmitEdit, onCancelEdit, onDelete, feedbackId, roomState, participantId, send }: GroupSectionProps) {
  const isEditing = editingGroupId === group.id;
  return (
    <Card className="group-panel" data-group-id={group.id}>
      <CardHeader className="group-panel__header">
        {isEditing ? (
          <form
            className="input-row"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmitEdit(group);
            }}
          >
            <Input
              className="input"
              value={editingGroupName}
              onChange={(event) => onEditNameChange(event.target.value)}
              onKeyDown={submitFormOnModEnter}
              maxLength={MAX_COLUMN_NAME_LENGTH}
              aria-label={`Edit ${group.name} group name`}
              aria-describedby={feedbackId}
            />
            <Button type="submit" variant="secondary" size="sm" className="btn btn--secondary btn--sm">Save</Button>
            <Button type="button" variant="ghost" size="sm" className="btn btn--ghost btn--sm" onClick={onCancelEdit}>Cancel</Button>
          </form>
        ) : (
          <div>
            <h4 className="group-panel__title">{group.name}</h4>
            <CardDescription>{items.length} grouped {items.length === 1 ? "item" : "items"}</CardDescription>
          </div>
        )}
        {!isEditing && (
          <ReactionBar roomState={roomState} target={groupVoteTarget(group.id)} participantId={participantId} send={send} label={group.name} compact />
        )}
        {isOrganise && (
          <span className="group-panel__controls">
            <Button type="button" variant="ghost" size="icon" className="reorder-btn" disabled={groupIndex === 0} onClick={() => onReorderGroups(groupIndex, groupIndex - 1)} title="Move group up" aria-label="Move group up">
              <ArrowUp aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="reorder-btn" disabled={groupIndex === totalGroups - 1} onClick={() => onReorderGroups(groupIndex, groupIndex + 1)} title="Move group down" aria-label="Move group down">
              <ArrowDown aria-hidden="true" />
            </Button>
            {!isEditing && (
              <Button type="button" variant="ghost" size="icon" className="reorder-btn" onClick={() => onStartEdit(group)} aria-label={`Rename ${group.name}`} title="Rename group">
                <Pencil aria-hidden="true" />
              </Button>
            )}
            <Button type="button" variant="ghost" size="icon" className="reorder-btn reorder-btn--danger" onClick={() => onDelete(group)} aria-label={`Delete ${group.name}`} title="Delete group">
              <Trash2 aria-hidden="true" />
            </Button>
          </span>
        )}
      </CardHeader>
      <CardContent className="group-panel__content">
        <DragList
          title={group.name}
          columnId={group.columnId}
          groupId={group.id}
          items={items}
          emptyText="No items in this group."
          isOrganise={isOrganise}
          draggingItemId={draggingItemId}
          draggingSourceColumnId={draggingSourceColumnId}
          activeDrop={activeDrop}
          onDragStart={onDragStart}
          roomState={roomState}
          participantId={participantId}
          send={send}
        />
      </CardContent>
    </Card>
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
  draggingSourceColumnId: string | null;
  activeDrop: DropTarget | null;
  onDragStart: (event: ReactPointerEvent, itemId: string) => void;
  className?: string;
  roomState: RoomState;
  participantId: string;
  send: (message: unknown) => boolean;
}

export function DragList({ title, columnId, groupId, items, emptyText, isOrganise, draggingItemId, draggingSourceColumnId, activeDrop, onDragStart, className, roomState, participantId, send }: DragListProps) {
  const visibleItems = items.filter((item) => item.id !== draggingItemId);
  const groupKey = groupId ?? "__ungrouped__";
  const isActiveList = draggingItemId !== null && activeDrop?.groupId === groupId && activeDrop?.columnId === columnId;
  const isCompatibleDropList = draggingItemId !== null && draggingSourceColumnId === columnId;
  const isInvalidDropList = draggingItemId !== null && draggingSourceColumnId !== null && draggingSourceColumnId !== columnId;
  const dropZone = (index: number) => {
    const isActive = isActiveList && activeDrop?.index === index;
    return (
      <li key={`drop-${groupKey}-${index}`} className={`drag-drop-zone${isActive ? " drag-drop-zone--active" : ""}`} data-drop-zone="true" data-group-id={groupKey} data-drop-column-id={columnId} data-index={index} data-active={isActive ? "true" : "false"} aria-hidden={draggingItemId ? undefined : "true"}>
        <span className="drag-drop-zone__line" />
      </li>
    );
  };

  return (
    <div className={`${className ?? ""}${isActiveList ? " drag-list--active" : ""}${isCompatibleDropList ? " drag-list--compatible" : ""}${isInvalidDropList ? " drag-list--invalid" : ""}`} data-drop-list={groupKey} data-drop-column-id={columnId} data-drop-list-active={isActiveList ? "true" : "false"} aria-label={`${title} drop target`}>
      {className && (
        <div className="section-header">
          <span className="section-title">{title}</span>
        </div>
      )}
      {visibleItems.length === 0 && <p className="text-muted drag-list__empty">{emptyText}</p>}
      <ul className="item-list drag-list">
        {isOrganise && dropZone(0)}
        {visibleItems.map((item, idx) => (
          <Fragment key={`item-and-drop-${item.id}`}>
            <li className={`item-row item-row--draggable${draggingItemId === item.id ? " item-row--dragging" : ""}`} data-drag-item-id={item.id} aria-grabbed={draggingItemId === item.id}>
              <button
                type="button"
                className="drag-handle"
                aria-label={`Drag ${item.text}`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  onDragStart(event, item.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                  }
                }}
              >
                <GripVertical aria-hidden="true" />
              </button>
              <span className="item-row__text">{item.text}</span>
              <ReactionBar roomState={roomState} target={itemVoteTarget(item.id)} participantId={participantId} send={send} label={item.text} compact />
            </li>
            {isOrganise && dropZone(idx + 1)}
          </Fragment>
        ))}
      </ul>
    </div>
  );
}
