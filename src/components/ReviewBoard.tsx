import { useMemo, useState } from "react";
import type { Group, RoomState } from "../domain";
import { getGroupedItems, getVotesForGroup } from "../domain";

interface ReviewBoardProps {
  roomState: RoomState;
}

export function ReviewBoard({ roomState }: ReviewBoardProps) {
  const sortedGroups = useMemo(() => getSortedReviewGroups(roomState), [roomState]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(() => getStoredReviewSlideId(roomState.roomId));
  const activeIndex = Math.max(0, sortedGroups.findIndex((group) => group.id === activeGroupId));
  const activeGroup = sortedGroups[activeIndex] ?? null;

  if (sortedGroups.length === 0 || activeGroup === null) {
    return (
      <div className="glass-panel" style={{ textAlign: "center" }}>
        <div className="review-banner" role="status" aria-live="polite" style={{ justifyContent: "center", marginBottom: "var(--space-4)" }}>
          <span>📋</span>
          <span>Review Phase — Results are read-only</span>
        </div>
        <div className="empty-state">
          <div className="empty-state__icon">📋</div>
          <p className="empty-state__text">No groups to review.</p>
          <p className="text-muted" style={{ margin: 0 }}>
            Create groups during organise to produce review slides.
          </p>
        </div>
      </div>
    );
  }

  const groupItems = getGroupedItems(roomState.items, activeGroup.id);
  const totalVotes = getVotesForGroup(roomState.votes, activeGroup.id);
  const canGoPrevious = activeIndex > 0;
  const canGoNext = activeIndex < sortedGroups.length - 1;

  return (
    <div className="review-slideshow" aria-label="Review group slideshow">
      <div className="review-banner" role="status" aria-live="polite">
        <span>📋</span>
        <span>Review Phase — Results are read-only</span>
      </div>

      <div className="review-slideshow__controls" aria-label="Review navigation">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => setActiveReviewGroup(roomState.roomId, sortedGroups[Math.max(0, activeIndex - 1)]?.id ?? activeGroup.id, setActiveGroupId)}
          disabled={!canGoPrevious}
          aria-label="Previous group"
        >
          ← Previous
        </button>
        <span className="review-slideshow__counter" aria-live="polite">
          Slide {activeIndex + 1} of {sortedGroups.length}
        </span>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => setActiveReviewGroup(roomState.roomId, sortedGroups[Math.min(sortedGroups.length - 1, activeIndex + 1)]?.id ?? activeGroup.id, setActiveGroupId)}
          disabled={!canGoNext}
          aria-label="Next group"
        >
          Next →
        </button>
      </div>

      <article className="group-panel review-slide" data-review-group-id={activeGroup.id} aria-label={`Review slide for ${activeGroup.name}`}>
        <div className="group-panel__header review-slide__header">
          <div>
            <p className="review-slide__eyebrow">Group result</p>
            <h4 className="group-panel__title review-slide__title">{activeGroup.name}</h4>
          </div>
          <div className={`review-slide__votes${totalVotes > 0 ? " review-slide__votes--emphasized" : ""}`} aria-label={`${totalVotes} vote${totalVotes !== 1 ? "s" : ""}`}>
            <span className="review-slide__vote-number">{totalVotes}</span>
            <span className="review-slide__vote-label">vote{totalVotes !== 1 ? "s" : ""}</span>
          </div>
        </div>
        <div className="review-slide__meta">
          <span className="review-section-count">{groupItems.length} item{groupItems.length !== 1 ? "s" : ""}</span>
        </div>
        {groupItems.length === 0 ? (
          <p className="text-muted review-empty-group">No items in this group.</p>
        ) : (
          <ul className="item-list" aria-label={`Items in ${activeGroup.name}`}>
            {groupItems.map((item) => (
              <ReviewItemRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </article>
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

function getSortedReviewGroups(roomState: RoomState): Group[] {
  const columnOrder = new Map(roomState.columns.map((column) => [column.id, column.order]));

  return [...roomState.groups].sort((a, b) => {
    const voteDifference = getVotesForGroup(roomState.votes, b.id) - getVotesForGroup(roomState.votes, a.id);
    if (voteDifference !== 0) return voteDifference;

    const columnDifference = (columnOrder.get(a.columnId) ?? Number.MAX_SAFE_INTEGER) - (columnOrder.get(b.columnId) ?? Number.MAX_SAFE_INTEGER);
    if (columnDifference !== 0) return columnDifference;

    const groupOrderDifference = a.order - b.order;
    if (groupOrderDifference !== 0) return groupOrderDifference;

    return a.id.localeCompare(b.id);
  });
}

function getReviewSlideStorageKey(roomId: string): string {
  return `retro-review-slide:${roomId}`;
}

function getStoredReviewSlideId(roomId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(getReviewSlideStorageKey(roomId));
}

function setActiveReviewGroup(roomId: string, groupId: string, setActiveGroupId: (groupId: string) => void): void {
  setActiveGroupId(groupId);
  window.sessionStorage.setItem(getReviewSlideStorageKey(roomId), groupId);
}
