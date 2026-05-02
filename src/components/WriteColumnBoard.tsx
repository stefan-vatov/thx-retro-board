import { Loader2, Pencil, Plus, Save, Trash2, X, Columns3 } from "lucide-react";
import type { RetroItem, RoomState } from "../domain";
import { itemVoteTarget } from "../domain";
import { submitFormOnModEnter } from "./form-shortcuts";
import { ReactionBar } from "./Reactions";
import { getSortedColumns } from "./room-columns";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export interface WriteColumnBoardProps {
  roomState: RoomState;
  participantId: string;
  connected: boolean;
  columnInputs: Record<string, string>;
  columnErrors: Record<string, string | undefined>;
  pendingColumnId: string | null;
  editingItemId: string | null;
  editingItemText: string;
  pendingItemId: string | null;
  onColumnInputChange: (columnId: string, value: string) => void;
  onAddItem: (event: React.FormEvent, columnId: string) => void;
  onStartEdit: (item: RetroItem) => void;
  onEditTextChange: (value: string) => void;
  onSubmitEdit: (event: React.FormEvent, itemId: string) => void;
  onCancelEdit: () => void;
  onDeleteItem: (itemId: string) => void;
  send: (message: unknown) => boolean;
  columnInputRefs: React.MutableRefObject<Record<string, HTMLTextAreaElement | null>>;
}

export function WriteColumnBoard(props: WriteColumnBoardProps) {
  const columns = getSortedColumns(props.roomState);
  const unassigned = props.roomState.items
    .filter((item) => (item.columnId ?? item.groupId) === null)
    .sort((a, b) => a.order - b.order);

  function renderItem(item: RetroItem, index: number) {
    const isLong = item.text.length > 400;
    const author = props.roomState.participants.find((participant) => participant.id === item.authorId);
    const isOwner = item.authorId === props.participantId;
    const isEditing = props.editingItemId === item.id;
    const editErrorId = `edit-item-error-${item.id}`;

    if (isEditing) {
      return (
        <li key={item.id} className={`item-card item-card--editing${isLong ? " item-card--long" : ""}`}>
          <form className="item-card__edit-form" onSubmit={(event) => props.onSubmitEdit(event, item.id)}>
            <label className="sr-only" htmlFor={`edit-item-${item.id}`}>Edit card</label>
            <textarea
              id={`edit-item-${item.id}`}
              className="input write-card-composer__textarea item-card__edit-input"
              value={props.editingItemText}
              onChange={(event) => props.onEditTextChange(event.target.value)}
              onKeyDown={submitFormOnModEnter}
              maxLength={500}
              rows={3}
              aria-describedby={editErrorId}
              autoFocus
            />
            <div className="item-card__edit-footer">
              <span id={editErrorId} className="item-card__char-count">{props.editingItemText.length}/500</span>
              <div className="item-card__actions">
                <Button type="button" variant="ghost" size="sm" onClick={props.onCancelEdit} disabled={props.pendingItemId === item.id}>
                  <X aria-hidden="true" /> Cancel
                </Button>
                <Button type="submit" size="sm" disabled={props.pendingItemId === item.id || !props.editingItemText.trim()} aria-busy={props.pendingItemId === item.id}>
                  {props.pendingItemId === item.id ? <Loader2 className="loading-spinner" aria-hidden="true" /> : <Save aria-hidden="true" />}
                  Save
                </Button>
              </div>
            </div>
          </form>
        </li>
      );
    }

    return (
      <li key={item.id} className={`item-card${isLong ? " item-card--long" : ""}`}>
        <div className="item-card__content">
          <span className="item-card__text">{item.text}</span>
          {isLong && <span className="item-card__length-indicator" aria-label={`${item.text.length} characters`}>{item.text.length}/500</span>}
        </div>
        <div className="item-card__meta">
          <span className="item-card__author">{author?.displayName ?? "Unknown"}</span>
          <span className="item-card__index" aria-label={`Item ${index + 1}`}>#{index + 1}</span>
        </div>
        <ReactionBar roomState={props.roomState} target={itemVoteTarget(item.id)} participantId={props.participantId} send={props.send} label={item.text} />
        {isOwner && (
          <div className="item-card__actions" aria-label={`Actions for ${item.text}`}>
            <Button type="button" variant="ghost" size="sm" onClick={() => props.onStartEdit(item)} disabled={props.pendingItemId === item.id}>
              <Pencil aria-hidden="true" /> Edit
            </Button>
            <Button type="button" variant="ghost" size="sm" className="item-card__delete" onClick={() => props.onDeleteItem(item.id)} disabled={props.pendingItemId === item.id} aria-busy={props.pendingItemId === item.id}>
              {props.pendingItemId === item.id ? <Loader2 className="loading-spinner" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
              Delete
            </Button>
          </div>
        )}
      </li>
    );
  }

  if (columns.length === 0) {
    return (
      <div className="write-empty-state empty-state" role="status" aria-live="polite">
        <div className="empty-state__icon empty-state__icon--block" aria-hidden="true"><Columns3 size={28} /></div>
        <h3 className="empty-state__title">Create your first column</h3>
        <p className="empty-state__text">This room starts with an empty kanban board. Ask the facilitator to configure list-style columns before adding retro items.</p>
      </div>
    );
  }

  return (
    <div className="column-board" aria-label="Write phase columns">
      {columns.map((column) => {
        const items = props.roomState.items.filter((item) => item.columnId === column.id && item.groupId === null).sort((a, b) => a.order - b.order);
        const inputValue = props.columnInputs[column.id] ?? "";
        const columnError = props.columnErrors[column.id];
        const composerId = `write-card-input-${column.id}`;
        const errorId = `write-card-error-${column.id}`;
        const isPending = props.pendingColumnId === column.id;
        const isNearLimit = inputValue.length > 400;
        return (
          <Card key={column.id} className="column-board__column" role="region" aria-labelledby={`write-column-${column.id}`} data-column-id={column.id}>
            <CardHeader className="column-board__header px-0">
              <CardTitle id={`write-column-${column.id}`} role="heading" aria-level={3} className="column-board__title" title={column.name}>{column.name}</CardTitle>
              <Badge variant="secondary" className="column-board__count" aria-label={`${items.length} items`}>{items.length}</Badge>
            </CardHeader>
            <CardContent className="px-0">
              <form className="write-card-composer" onSubmit={(event) => props.onAddItem(event, column.id)} aria-label={`Add card to ${column.name}`}>
                <label className="sr-only" htmlFor={composerId}>Add a card to {column.name}</label>
                <textarea
                  ref={(element) => {
                    props.columnInputRefs.current[column.id] = element;
                  }}
                  id={composerId}
                  className={`input write-card-composer__textarea${columnError ? " input--error" : ""}`}
                  value={inputValue}
                  onChange={(event) => props.onColumnInputChange(column.id, event.target.value)}
                  onKeyDown={submitFormOnModEnter}
                  maxLength={500}
                  rows={3}
                  placeholder={`Write a ${column.name} card…`}
                  aria-describedby={[columnError ? errorId : "", isNearLimit ? `${composerId}-count` : ""].filter(Boolean).join(" ") || undefined}
                  aria-invalid={columnError ? "true" : undefined}
                  disabled={isPending}
                />
                <div className="write-card-composer__footer">
                  <span id={`${composerId}-count`} className="write-card-composer__count" aria-live="polite">
                    {isNearLimit ? `${inputValue.length}/500` : props.connected ? "Visible to the room after adding" : "Reconnect to add"}
                  </span>
                  <Button type="submit" size="sm" className="write-card-composer__submit" disabled={isPending || !props.connected || !inputValue.trim()} aria-busy={isPending}>
                    {isPending ? <Loader2 className="loading-spinner" aria-hidden="true" /> : <Plus aria-hidden="true" />}
                    Add card
                  </Button>
                </div>
                {columnError && <div id={errorId} className="status-msg status-msg--error write-card-composer__error" role="alert">{columnError}</div>}
              </form>
              {items.length === 0 ? (
                <p className="text-muted column-board__empty">No cards in this lane yet. Add one directly above.</p>
              ) : (
                <ul className="item-list" aria-label={`${column.name} items`}>{items.map((item, index) => renderItem(item, index))}</ul>
              )}
            </CardContent>
          </Card>
        );
      })}

      {unassigned.length > 0 && (
        <Card className="column-board__column column-board__column--secondary" aria-labelledby="write-column-unassigned">
          <CardHeader className="column-board__header px-0">
            <CardTitle id="write-column-unassigned" role="heading" aria-level={3} className="column-board__title">Unassigned</CardTitle>
            <Badge variant="secondary" className="column-board__count">{unassigned.length}</Badge>
          </CardHeader>
          <CardContent className="px-0">
            <ul className="item-list">{unassigned.map((item, index) => renderItem(item, index))}</ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
