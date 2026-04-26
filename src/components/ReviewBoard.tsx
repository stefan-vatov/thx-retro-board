import { useMemo, useState } from "react";
import type { RoomState, VoteTarget } from "../domain";
import { getGroupedItems, getReviewTargets, sortReviewTargets, voteTargetKey } from "../domain";

interface ReviewBoardProps {
  roomState: RoomState;
}

export function ReviewBoard({ roomState }: ReviewBoardProps) {
  const sortedTargets = useMemo(() => sortReviewTargets(getReviewTargets(roomState), roomState.columns), [roomState]);
  const [activeTargetKey, setActiveTargetKey] = useState<string | null>(() => getStoredReviewSlideKey(roomState.roomId));
  const activeIndex = Math.max(0, sortedTargets.findIndex((target) => voteTargetKey(target.target) === activeTargetKey));
  const activeReviewTarget = sortedTargets[activeIndex] ?? null;

  if (sortedTargets.length === 0 || activeReviewTarget === null) {
    return (
      <div className="glass-panel" style={{ textAlign: "center" }}>
        <div className="review-banner" role="status" aria-live="polite" style={{ justifyContent: "center", marginBottom: "var(--space-4)" }}>
          <span>📋</span>
          <span>Review Phase — Results are read-only</span>
        </div>
        <div className="empty-state">
          <div className="empty-state__icon">📋</div>
          <p className="empty-state__text">No review targets yet.</p>
          <p className="text-muted" style={{ margin: 0 }}>
            Add ungrouped items or create groups before review to produce slides.
          </p>
        </div>
      </div>
    );
  }

  const activeTarget = activeReviewTarget.target;
  const targetKey = voteTargetKey(activeTarget);
  const activeGroup = activeTarget.type === "group" ? roomState.groups.find((group) => group.id === activeTarget.id) ?? null : null;
  const activeItem = activeTarget.type === "item" ? roomState.items.find((item) => item.id === activeTarget.id) ?? null : null;
  const columnId = activeGroup?.columnId ?? activeItem?.columnId ?? activeReviewTarget.columnId;
  const columnName = roomState.columns.find((column) => column.id === columnId)?.name ?? "Unknown column";
  const totalVotes = activeReviewTarget.totalVotes;
  const canGoPrevious = activeIndex > 0;
  const canGoNext = activeIndex < sortedTargets.length - 1;

  return (
    <div className="review-slideshow" aria-label="Review target slideshow">
      <div className="review-banner" role="status" aria-live="polite">
        <span>📋</span>
        <span>Review Phase — Results are read-only</span>
      </div>

      <div className="review-slideshow__controls" aria-label="Review navigation">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => setActiveReviewTarget(roomState.roomId, sortedTargets[Math.max(0, activeIndex - 1)]?.target ?? activeTarget, setActiveTargetKey)}
          disabled={!canGoPrevious}
          aria-label="Previous review target"
        >
          ← Previous
        </button>
        <span className="review-slideshow__counter" aria-live="polite">
          Slide {activeIndex + 1} of {sortedTargets.length}
        </span>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => setActiveReviewTarget(roomState.roomId, sortedTargets[Math.min(sortedTargets.length - 1, activeIndex + 1)]?.target ?? activeTarget, setActiveTargetKey)}
          disabled={!canGoNext}
          aria-label="Next review target"
        >
          Next →
        </button>
      </div>

      {activeTarget.type === "group" && activeGroup !== null ? (
        <GroupReviewSlide roomState={roomState} group={activeGroup} columnName={columnName} totalVotes={totalVotes} targetKey={targetKey} />
      ) : activeTarget.type === "item" && activeItem !== null ? (
        <ItemReviewSlide item={activeItem} columnName={columnName} totalVotes={totalVotes} targetKey={targetKey} />
      ) : (
        <article className="group-panel review-slide" data-review-target-key={targetKey} aria-label="Review slide for unavailable target">
          <div className="empty-state">
            <div className="empty-state__icon">📋</div>
            <p className="empty-state__text">This review target is no longer available.</p>
          </div>
        </article>
      )}
    </div>
  );
}

function GroupReviewSlide({
  roomState,
  group,
  columnName,
  totalVotes,
  targetKey,
}: {
  roomState: RoomState;
  group: { id: string; name: string };
  columnName: string;
  totalVotes: number;
  targetKey: string;
}) {
  const groupItems = getGroupedItems(roomState.items, group.id);
  return (
    <article className="group-panel review-slide" data-review-target-key={targetKey} data-review-group-id={group.id} aria-label={`Review slide for ${group.name}`}>
      <div className="group-panel__header review-slide__header">
        <div>
          <p className="review-slide__eyebrow">Group result</p>
          <h4 className="group-panel__title review-slide__title">{group.name}</h4>
        </div>
        <ReviewVoteTotal totalVotes={totalVotes} />
      </div>
      <div className="review-slide__meta">
        <span className="review-section-count">{columnName}</span>
        <span className="review-section-count">{groupItems.length} item{groupItems.length !== 1 ? "s" : ""}</span>
      </div>
      {groupItems.length === 0 ? (
        <p className="text-muted review-empty-group">No items in this group.</p>
      ) : (
        <ul className="item-list" aria-label={`Items in ${group.name}`}>
          {groupItems.map((item) => (
            <ReviewItemRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </article>
  );
}

function ItemReviewSlide({
  item,
  columnName,
  totalVotes,
  targetKey,
}: {
  item: { id: string; text: string };
  columnName: string;
  totalVotes: number;
  targetKey: string;
}) {
  return (
    <article className="group-panel review-slide" data-review-target-key={targetKey} data-review-item-id={item.id} aria-label={`Review slide for ${item.text}`}>
      <div className="group-panel__header review-slide__header">
        <div>
          <p className="review-slide__eyebrow">Item result</p>
          <h4 className="group-panel__title review-slide__title">{item.text}</h4>
        </div>
        <ReviewVoteTotal totalVotes={totalVotes} />
      </div>
      <div className="review-slide__meta">
        <span className="review-section-count">{columnName}</span>
        <span className="review-section-count">Ungrouped item</span>
      </div>
      <p className="text-muted review-empty-group">
        This item stayed ungrouped and was reviewed as its own vote target.
      </p>
    </article>
  );
}

function ReviewVoteTotal({ totalVotes }: { totalVotes: number }) {
  return (
    <div className={`review-slide__votes${totalVotes > 0 ? " review-slide__votes--emphasized" : ""}`} aria-label={`${totalVotes} vote${totalVotes !== 1 ? "s" : ""}`}>
      <span className="review-slide__vote-number">{totalVotes}</span>
      <span className="review-slide__vote-label">vote{totalVotes !== 1 ? "s" : ""}</span>
    </div>
  );
}

function ReviewItemRow({ item }: { item: { id: string; text: string } }) {
  return (
    <li className="item-row review-item-row">
      <span className="item-row__text">{item.text}</span>
    </li>
  );
}

function getReviewSlideStorageKey(roomId: string): string {
  return `retro-review-slide:${roomId}`;
}

function getStoredReviewSlideKey(roomId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(getReviewSlideStorageKey(roomId));
}

function setActiveReviewTarget(roomId: string, target: VoteTarget, setActiveTargetKey: (targetKey: string) => void): void {
  const targetKey = voteTargetKey(target);
  setActiveTargetKey(targetKey);
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(getReviewSlideStorageKey(roomId), targetKey);
  }
}
