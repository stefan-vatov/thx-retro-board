import type { PointerEvent as ReactPointerEvent } from "react";
import { Plus } from "lucide-react";
import type { Column, Group, RoomState } from "../domain";
import {
  getGroupedItems,
  MAX_COLUMN_NAME_LENGTH,
  type RetroItem,
} from "../domain";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "./ui/card";
import { Input } from "./ui/input";
import { submitFormOnModEnter } from "./form-shortcuts";
import { DragList, GroupSection, type DropTarget } from "./OrganiseBoardLists";

type OrganiseBoardColumnProps = {
  column: Column;
  columnGroups: Group[];
  ungrouped: RetroItem[];
  itemCount: number;
  roomState: RoomState;
  isOrganise: boolean;
  participantId: string;
  send: (message: unknown) => boolean;
  newGroupName: string;
  feedbackMessages: string[];
  pendingMutation: boolean;
  draggingItemId: string | null;
  draggingSourceColumnId: string | null;
  activeDrop: DropTarget | null;
  editingGroupId: string | null;
  editingGroupName: string;
  setGroupInputRef: (
    columnId: string,
    element: HTMLInputElement | null,
  ) => void;
  onNewGroupNameChange: (columnId: string, value: string) => void;
  onCreateGroup: (event: React.FormEvent, column: Column) => void;
  onReorderGroups: (columnId: string, fromIdx: number, toIdx: number) => void;
  onDragStart: (event: ReactPointerEvent, itemId: string) => void;
  onEditNameChange: (value: string) => void;
  onStartEdit: (group: Group) => void;
  onSubmitEdit: (group: Group) => void;
  onCancelEdit: () => void;
  onDelete: (group: Group) => void;
};

export function OrganiseBoardColumn({
  column,
  columnGroups,
  ungrouped,
  itemCount,
  roomState,
  isOrganise,
  participantId,
  send,
  newGroupName,
  feedbackMessages,
  pendingMutation,
  draggingItemId,
  draggingSourceColumnId,
  activeDrop,
  editingGroupId,
  editingGroupName,
  setGroupInputRef,
  onNewGroupNameChange,
  onCreateGroup,
  onReorderGroups,
  onDragStart,
  onEditNameChange,
  onStartEdit,
  onSubmitEdit,
  onCancelEdit,
  onDelete,
}: OrganiseBoardColumnProps) {
  const feedbackId =
    feedbackMessages.length > 0 ? "organise-group-feedback" : undefined;

  return (
    <Card
      className="column-board__column"
      role="region"
      aria-labelledby={`organise-column-${column.id}`}
      data-column-id={column.id}
    >
      <CardHeader className="column-board__header">
        <div className="column-board__title-wrap">
          <Badge variant="secondary" className="organise-lane-badge">
            Organise lane
          </Badge>
          <h3
            id={`organise-column-${column.id}`}
            className="column-board__title"
            title={column.name}
          >
            {column.name}
          </h3>
          <CardDescription className="organise-lane-description">
            Create groups in this lane, then drag items only within{" "}
            {column.name}. Existing content remains readable while disconnected.
          </CardDescription>
        </div>
        <Badge
          variant="secondary"
          className="column-board__count"
          aria-label={`${itemCount} items`}
        >
          {itemCount}
        </Badge>
      </CardHeader>
      <CardContent className="organise-lane-content">
        <div className="organise-lane-meta" role="status" aria-live="polite">
          <Badge variant="outline">Same-column grouping only</Badge>
          <span className="text-muted">
            {columnGroups.length} groups · {ungrouped.length} ungrouped
          </span>
        </div>
        {isOrganise && (
          <form
            className="input-row organise-group-form"
            onSubmit={(event) => onCreateGroup(event, column)}
          >
            <Input
              ref={(element) => setGroupInputRef(column.id, element)}
              type="text"
              className="input"
              value={newGroupName}
              onChange={(event) =>
                onNewGroupNameChange(column.id, event.target.value)
              }
              onKeyDown={submitFormOnModEnter}
              maxLength={MAX_COLUMN_NAME_LENGTH}
              placeholder="New group name…"
              aria-label={`New group name for ${column.name}`}
              aria-describedby={feedbackId}
            />
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              className="btn btn--secondary btn--sm"
              disabled={pendingMutation}
              aria-busy={pendingMutation}
            >
              <Plus aria-hidden="true" />
              Create group
            </Button>
          </form>
        )}
        {columnGroups.length === 0 && ungrouped.length === 0 && (
          <Alert className="column-board__empty" role="status">
            <AlertTitle>No items or groups in this lane yet</AlertTitle>
            <AlertDescription>
              Items keep their original column context. Add write-phase items or
              create a group when feedback arrives.
            </AlertDescription>
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
              onReorderGroups={(fromIdx, toIdx) =>
                onReorderGroups(column.id, fromIdx, toIdx)
              }
              draggingItemId={draggingItemId}
              draggingSourceColumnId={draggingSourceColumnId}
              activeDrop={activeDrop}
              onDragStart={onDragStart}
              editingGroupId={editingGroupId}
              editingGroupName={editingGroupName}
              onEditNameChange={onEditNameChange}
              onStartEdit={onStartEdit}
              onSubmitEdit={onSubmitEdit}
              onCancelEdit={onCancelEdit}
              onDelete={onDelete}
              feedbackId={feedbackId}
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
          onDragStart={onDragStart}
          className="ungrouped-section"
          roomState={roomState}
          participantId={participantId}
          send={send}
        />
      </CardContent>
    </Card>
  );
}
