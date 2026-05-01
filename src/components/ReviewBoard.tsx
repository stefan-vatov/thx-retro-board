import { type FormEvent, useMemo, useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import type { ActionItem, RoomState } from "../domain";
import { getGroupedItems, getReviewTargets, groupVoteTarget, isValidActionText, itemVoteTarget, MAX_ACTION_TEXT_LENGTH, sanitizeActionText, sortReviewTargets, voteTargetKey } from "../domain";
import { submitFormOnModEnter } from "./form-shortcuts";
import { ReactionBar } from "./Reactions";

interface ReviewBoardProps {
  roomState: RoomState;
  participantId: string;
  isFacilitator: boolean;
  send?: (message: unknown) => boolean;
  serverError?: string | null;
  clearServerError?: () => void;
}

export function ReviewBoard({ roomState, participantId, isFacilitator, send = () => false, serverError, clearServerError }: ReviewBoardProps) {
  const sortedTargets = useMemo(() => sortReviewTargets(getReviewTargets(roomState), roomState.columns), [roomState]);
  const syncedTargetIndex = sortedTargets.findIndex((target) => voteTargetKey(target.target) === roomState.reviewTargetKey);
  const activeIndex = syncedTargetIndex >= 0 ? syncedTargetIndex : 0;
  const activeReviewTarget = sortedTargets[activeIndex] ?? null;

  if (sortedTargets.length === 0 || activeReviewTarget === null) {
    return (
      <div className="review-discussion-layout">
        <div className="glass-panel review-empty-panel review-results-pane">
          <div className="review-banner review-banner--centered" role="status" aria-live="polite">
            <span className="review-banner__mark" aria-hidden="true">Review</span>
            <span>Review phase: discuss outcomes and capture actions</span>
          </div>
          <div className="empty-state">
            <div className="empty-state__icon empty-state__icon--review" aria-hidden="true">Review</div>
            <p className="empty-state__text">No review targets yet.</p>
            <p className="empty-state__subtext">
              Add ungrouped items or create groups before review to produce slides.
            </p>
          </div>
        </div>
        <ActionItemsPanel
          actions={roomState.actions}
          send={send}
          serverError={serverError}
          clearServerError={clearServerError}
        />
      </div>
    );
  }

  const activeTarget = activeReviewTarget.target;
  const targetKey = voteTargetKey(activeTarget);
  const activeGroup = activeTarget.type === "group" ? roomState.groups.find((group) => group.id === activeTarget.id) ?? null : null;
  const activeItem = activeTarget.type === "item" ? roomState.items.find((item) => item.id === activeTarget.id) ?? null : null;
  const columnId = activeGroup?.columnId ?? activeItem?.columnId ?? activeReviewTarget.columnId;
  const columnName = roomState.columns.find((column) => column.id === columnId)?.name ?? "Unknown column";
  const activeItemGroup = activeItem?.groupId ? roomState.groups.find((group) => group.id === activeItem.groupId) ?? null : null;
  const resultTotal = roomState.rankingMethod === "pairwise" ? activeReviewTarget.wins : activeReviewTarget.totalVotes;
  const resultLabel = roomState.rankingMethod === "pairwise" ? "win" : "vote";
  const canGoPrevious = activeIndex > 0;
  const canGoNext = activeIndex < sortedTargets.length - 1;
  const canNavigatePrevious = isFacilitator && canGoPrevious;
  const canNavigateNext = isFacilitator && canGoNext;

  function setActiveReviewIndex(nextIndex: number) {
    if (!isFacilitator) return;
    const nextTarget = sortedTargets[nextIndex]?.target;
    if (!nextTarget) return;
    clearServerError?.();
    send({ type: "set-review-target", reviewTargetKey: voteTargetKey(nextTarget) });
  }

  return (
    <div className="review-discussion-layout">
      <div className="review-results-pane review-slideshow" aria-label="Review target slideshow">
        <div className="review-banner" role="status" aria-live="polite">
          <span className="review-banner__mark" aria-hidden="true">Review</span>
          <span>Review phase: discuss outcomes and capture actions</span>
        </div>

        <div className="review-slideshow__controls" aria-label="Review navigation">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setActiveReviewIndex(activeIndex - 1)}
            disabled={!canNavigatePrevious}
            aria-label="Previous review target"
            title={isFacilitator ? "Previous review target" : "Only the facilitator can change the review slide"}
          >
            ← Previous
          </button>
          <div className="review-slideshow__status">
            <span className="review-slideshow__counter" aria-live="polite">
              Slide {activeIndex + 1} of {sortedTargets.length}
            </span>
            {!isFacilitator ? (
              <span className="review-slideshow__lock">Facilitator controls this for everyone</span>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setActiveReviewIndex(activeIndex + 1)}
            disabled={!canNavigateNext}
            aria-label="Next review target"
            title={isFacilitator ? "Next review target" : "Only the facilitator can change the review slide"}
          >
            Next →
          </button>
        </div>

        {activeTarget.type === "group" && activeGroup !== null ? (
          <GroupReviewSlide roomState={roomState} participantId={participantId} send={send} group={activeGroup} columnName={columnName} totalVotes={resultTotal} voteLabel={resultLabel} targetKey={targetKey} />
        ) : activeTarget.type === "item" && activeItem !== null ? (
          <ItemReviewSlide roomState={roomState} participantId={participantId} send={send} item={activeItem} columnName={columnName} groupName={activeItemGroup?.name ?? null} totalVotes={resultTotal} voteLabel={resultLabel} targetKey={targetKey} />
        ) : (
          <article className="group-panel review-slide" data-review-target-key={targetKey} aria-label="Review slide for unavailable target">
            <div className="empty-state">
              <div className="empty-state__icon empty-state__icon--review" aria-hidden="true">Review</div>
              <p className="empty-state__text">This review target is no longer available.</p>
            </div>
          </article>
        )}
      </div>
      <ActionItemsPanel
        actions={roomState.actions}
        send={send}
        serverError={serverError}
        clearServerError={clearServerError}
      />
    </div>
  );
}

function ActionItemsPanel({
  actions,
  send,
  serverError,
  clearServerError,
}: {
  actions: ActionItem[];
  send: (message: unknown) => boolean;
  serverError?: string | null;
  clearServerError?: () => void;
}) {
  const sortedActions = useMemo(() => [...(actions ?? [])].sort((a, b) => a.order - b.order), [actions]);
  const [newActionText, setNewActionText] = useState("");
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = sanitizeActionText(newActionText);
    if (!isValidActionText(text)) {
      setLocalError("Add a clear action before saving.");
      return;
    }
    clearServerError?.();
    setLocalError(null);
    const sent = send({ type: "create-action", text });
    if (!sent) {
      setLocalError("Action not saved. Reconnect and try again.");
      return;
    }
    setNewActionText("");
  }

  function startEdit(action: ActionItem) {
    clearServerError?.();
    setLocalError(null);
    setEditingActionId(action.id);
    setEditingText(action.text);
  }

  function cancelEdit() {
    setEditingActionId(null);
    setEditingText("");
  }

  function saveEdit(actionId: string) {
    const text = sanitizeActionText(editingText);
    if (!isValidActionText(text)) {
      setLocalError("Action text cannot be empty.");
      return;
    }
    clearServerError?.();
    setLocalError(null);
    const sent = send({ type: "edit-action", actionId, text });
    if (!sent) {
      setLocalError("Action not updated. Reconnect and try again.");
      return;
    }
    cancelEdit();
  }

  function deleteAction(actionId: string) {
    clearServerError?.();
    setLocalError(null);
    const sent = send({ type: "delete-action", actionId });
    if (!sent) {
      setLocalError("Action not deleted. Reconnect and try again.");
      return;
    }
    if (editingActionId === actionId) cancelEdit();
  }

  return (
    <aside className="review-actions-panel" aria-label="Action items">
      <div className="review-actions-panel__header">
        <div>
          <p className="review-slide__eyebrow">Action items</p>
          <h3>Assign next steps</h3>
        </div>
        <span className="review-section-count">{sortedActions.length}</span>
      </div>

      <form className="review-action-form" onSubmit={handleCreate}>
        <label className="sr-only" htmlFor="review-action-input">New action item</label>
        <input
          id="review-action-input"
          className="input review-action-form__input"
          maxLength={MAX_ACTION_TEXT_LENGTH}
          value={newActionText}
          onChange={(event) => {
            setNewActionText(event.target.value);
            setLocalError(null);
          }}
          onKeyDown={submitFormOnModEnter}
          placeholder="Add a concrete owner/action..."
        />
        <button type="submit" className="btn btn--primary review-action-form__button">
          Add
        </button>
      </form>

      {(localError || serverError) ? (
        <p className="status-msg status-msg--error review-action-error" role="alert">
          {localError ?? serverError}
        </p>
      ) : null}

      {sortedActions.length === 0 ? (
        <div className="review-action-empty">
          <p>No actions assigned yet.</p>
          <span>Capture decisions as short, concrete follow-ups while the team is aligned.</span>
        </div>
      ) : (
        <ol className="review-action-list">
          {sortedActions.map((action, index) => {
            const isEditing = editingActionId === action.id;
            return (
              <li key={action.id} className="review-action-row">
                <span className="review-action-row__index" aria-hidden="true">{index + 1}</span>
                <div className="review-action-row__body">
                  {isEditing ? (
                    <div className="review-action-edit">
                      <input
                        className="input review-action-edit__input"
                        maxLength={MAX_ACTION_TEXT_LENGTH}
                        value={editingText}
                        onChange={(event) => {
                          setEditingText(event.target.value);
                          setLocalError(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                            event.preventDefault();
                            saveEdit(action.id);
                          }
                        }}
                        aria-label={`Edit action ${index + 1}`}
                      />
                      <div className="review-action-row__controls">
                        <button type="button" className="review-action-icon review-action-icon--save" onClick={() => saveEdit(action.id)} aria-label={`Save action ${index + 1}`} title="Save">
                          <Check size={14} aria-hidden="true" />
                        </button>
                        <button type="button" className="review-action-icon" onClick={cancelEdit} aria-label={`Cancel editing action ${index + 1}`} title="Cancel">
                          <X size={14} aria-hidden="true" />
                        </button>
                        <button type="button" className="review-action-icon review-action-icon--danger" onClick={() => deleteAction(action.id)} aria-label={`Delete action ${index + 1}`} title="Delete">
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="review-action-row__text">{action.text}</p>
                      <div className="review-action-row__controls">
                        <button type="button" className="review-action-icon" onClick={() => startEdit(action)} aria-label={`Edit action ${index + 1}`} title="Edit">
                          <Pencil size={14} aria-hidden="true" />
                        </button>
                        <button type="button" className="review-action-icon review-action-icon--danger" onClick={() => deleteAction(action.id)} aria-label={`Delete action ${index + 1}`} title="Delete">
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}

function GroupReviewSlide({
  roomState,
  participantId,
  send,
  group,
  columnName,
  totalVotes,
  voteLabel,
  targetKey,
}: {
  roomState: RoomState;
  participantId: string;
  send: (message: unknown) => boolean;
  group: { id: string; name: string };
  columnName: string;
  totalVotes: number;
  voteLabel: string;
  targetKey: string;
}) {
  const groupItems = getGroupedItems(roomState.items, group.id);
  return (
    <article className="group-panel review-slide" data-review-target-key={targetKey} data-review-group-id={group.id} aria-label={`Review slide for ${group.name}`}>
      <div className="review-target-summary">
        <div className="group-panel__header review-slide__header">
          <div>
            <p className="review-slide__eyebrow">Group result</p>
            <h4 className="group-panel__title review-slide__title">{group.name}</h4>
          </div>
          <ReviewVoteTotal totalVotes={totalVotes} voteLabel={voteLabel} />
        </div>
        <div className="review-slide__meta">
          <span className="review-section-count">{columnName}</span>
          <span className="review-section-count">{groupItems.length} item{groupItems.length !== 1 ? "s" : ""}</span>
        </div>
        <ReactionBar roomState={roomState} target={groupVoteTarget(group.id)} participantId={participantId} send={send} label={group.name} />
      </div>
      {groupItems.length === 0 ? (
        <p className="text-muted review-empty-group">No items in this group.</p>
      ) : (
        <ul className="item-list" aria-label={`Items in ${group.name}`}>
          {groupItems.map((item) => (
            <ReviewItemRow key={item.id} roomState={roomState} participantId={participantId} send={send} item={item} />
          ))}
        </ul>
      )}
    </article>
  );
}

function ItemReviewSlide({
  roomState,
  participantId,
  send,
  item,
  columnName,
  groupName,
  totalVotes,
  voteLabel,
  targetKey,
}: {
  roomState: RoomState;
  participantId: string;
  send: (message: unknown) => boolean;
  item: { id: string; text: string };
  columnName: string;
  groupName: string | null;
  totalVotes: number;
  voteLabel: string;
  targetKey: string;
}) {
  return (
    <article className="group-panel review-slide" data-review-target-key={targetKey} data-review-item-id={item.id} aria-label={`Review slide for ${item.text}`}>
      <div className="review-target-summary">
        <div className="group-panel__header review-slide__header">
          <div>
            <p className="review-slide__eyebrow">Item result</p>
            <h4 className="group-panel__title review-slide__title">{item.text}</h4>
          </div>
          <ReviewVoteTotal totalVotes={totalVotes} voteLabel={voteLabel} />
        </div>
        <div className="review-slide__meta">
          <span className="review-section-count">{columnName}</span>
          <span className="review-section-count">{groupName ? `Grouped in ${groupName}` : "Ungrouped item"}</span>
        </div>
        <ReactionBar roomState={roomState} target={itemVoteTarget(item.id)} participantId={participantId} send={send} label={item.text} />
      </div>
      <p className="text-muted review-empty-group">
        {groupName ? `This card was grouped under “${groupName}” and ranked as an individual card.` : "This item stayed ungrouped and was reviewed as its own vote target."}
      </p>
    </article>
  );
}

function ReviewVoteTotal({ totalVotes, voteLabel }: { totalVotes: number; voteLabel: string }) {
  const label = `${voteLabel}${totalVotes !== 1 ? "s" : ""}`;
  return (
    <div className={`review-slide__votes${totalVotes > 0 ? " review-slide__votes--emphasized" : ""}`} aria-label={`${totalVotes} ${label}`}>
      <span className="review-slide__vote-number">{totalVotes}</span>
      <span className="review-slide__vote-label">{label}</span>
    </div>
  );
}

function ReviewItemRow({
  roomState,
  participantId,
  send,
  item,
}: {
  roomState: RoomState;
  participantId: string;
  send: (message: unknown) => boolean;
  item: { id: string; text: string };
}) {
  return (
    <li className="item-row review-item-row">
      <span className="item-row__text">{item.text}</span>
      <ReactionBar roomState={roomState} target={itemVoteTarget(item.id)} participantId={participantId} send={send} label={item.text} compact />
    </li>
  );
}
