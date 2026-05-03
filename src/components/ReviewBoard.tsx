import type { RoomState } from "../domain";
import { voteTargetKey } from "../domain";
import { ActionItemsPanel } from "./ReviewActionsPanel";
import { buildReviewSlideshowModel } from "./review-board-effect";
import { GroupReviewSlide, ItemReviewSlide } from "./ReviewSlides";

interface ReviewBoardProps {
  roomState: RoomState;
  participantId: string;
  isFacilitator: boolean;
  send?: (message: unknown) => boolean;
  serverError?: string | null;
  clearServerError?: () => void;
}

export function ReviewBoard({
  roomState,
  participantId,
  isFacilitator,
  send = () => false,
  serverError,
  clearServerError,
}: ReviewBoardProps) {
  const {
    sortedTargets,
    activeReviewTarget,
    activeIndex,
    totalTargets,
    canNavigatePrevious,
    canNavigateNext,
  } = buildReviewSlideshowModel(roomState, isFacilitator);

  if (sortedTargets.length === 0 || activeReviewTarget === null) {
    return (
      <div className="review-discussion-layout">
        <div className="glass-panel review-empty-panel review-results-pane">
          <div
            className="review-banner review-banner--centered"
            role="status"
            aria-live="polite"
          >
            <span className="review-banner__mark" aria-hidden="true">
              Review
            </span>
            <span>Review phase: discuss outcomes and capture actions</span>
          </div>
          <div className="empty-state">
            <div
              className="empty-state__icon empty-state__icon--review"
              aria-hidden="true"
            >
              Review
            </div>
            <p className="empty-state__text">No review targets yet.</p>
            <p className="empty-state__subtext">
              Add ungrouped items or create groups before review to produce
              slides.
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
  const activeGroup =
    activeTarget.type === "group"
      ? (roomState.groups.find((group) => group.id === activeTarget.id) ?? null)
      : null;
  const activeItem =
    activeTarget.type === "item"
      ? (roomState.items.find((item) => item.id === activeTarget.id) ?? null)
      : null;
  const columnId =
    activeGroup?.columnId ??
    activeItem?.columnId ??
    activeReviewTarget.columnId;
  const columnName =
    roomState.columns.find((column) => column.id === columnId)?.name ??
    "Unknown column";
  const activeItemGroup = activeItem?.groupId
    ? (roomState.groups.find((group) => group.id === activeItem.groupId) ??
      null)
    : null;
  const resultTotal =
    roomState.rankingMethod === "pairwise"
      ? activeReviewTarget.wins
      : activeReviewTarget.totalVotes;
  const resultLabel = roomState.rankingMethod === "pairwise" ? "win" : "vote";

  function setActiveReviewIndex(nextIndex: number) {
    if (!isFacilitator) return;
    const nextTarget = sortedTargets[nextIndex]?.target;
    if (!nextTarget) return;
    clearServerError?.();
    send({
      type: "set-review-target",
      reviewTargetKey: voteTargetKey(nextTarget),
    });
  }

  return (
    <div className="review-discussion-layout">
      <div
        className="review-results-pane review-slideshow"
        aria-label="Review target slideshow"
      >
        <div className="review-banner" role="status" aria-live="polite">
          <span className="review-banner__mark" aria-hidden="true">
            Review
          </span>
          <span>Review phase: discuss outcomes and capture actions</span>
        </div>

        <div
          className="review-slideshow__controls"
          aria-label="Review navigation"
        >
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setActiveReviewIndex(activeIndex - 1)}
            disabled={!canNavigatePrevious}
            aria-label="Previous review target"
            title={
              isFacilitator
                ? "Previous review target"
                : "Only the facilitator can change the review slide"
            }
          >
            ← Previous
          </button>
          <div className="review-slideshow__status">
            <span className="review-slideshow__counter" aria-live="polite">
              Slide {activeIndex + 1} of {totalTargets}
            </span>
            {!isFacilitator ? (
              <span className="review-slideshow__lock">
                Facilitator controls this for everyone
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setActiveReviewIndex(activeIndex + 1)}
            disabled={!canNavigateNext}
            aria-label="Next review target"
            title={
              isFacilitator
                ? "Next review target"
                : "Only the facilitator can change the review slide"
            }
          >
            Next →
          </button>
        </div>

        {activeTarget.type === "group" && activeGroup !== null ? (
          <GroupReviewSlide
            roomState={roomState}
            participantId={participantId}
            send={send}
            group={activeGroup}
            columnName={columnName}
            totalVotes={resultTotal}
            voteLabel={resultLabel}
            targetKey={targetKey}
          />
        ) : activeTarget.type === "item" && activeItem !== null ? (
          <ItemReviewSlide
            roomState={roomState}
            participantId={participantId}
            send={send}
            item={activeItem}
            columnName={columnName}
            groupName={activeItemGroup?.name ?? null}
            totalVotes={resultTotal}
            voteLabel={resultLabel}
            targetKey={targetKey}
          />
        ) : (
          <article
            className="group-panel review-slide"
            data-review-target-key={targetKey}
            aria-label="Review slide for unavailable target"
          >
            <div className="empty-state">
              <div
                className="empty-state__icon empty-state__icon--review"
                aria-hidden="true"
              >
                Review
              </div>
              <p className="empty-state__text">
                This review target is no longer available.
              </p>
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
