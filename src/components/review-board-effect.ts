import { Effect } from "effect";
import {
  getReviewTargets,
  sortReviewTargets,
  type RoomState,
  voteTargetKey,
} from "../domain";
import type { ReviewTarget } from "../domain/state-review";

export interface ReviewSlideshowModel {
  sortedTargets: ReviewTarget[];
  activeReviewTarget: ReviewTarget | null;
  activeTargetKey: string | null;
  activeIndex: number;
  totalTargets: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  canNavigatePrevious: boolean;
  canNavigateNext: boolean;
}

export function buildReviewSlideshowModel(
  roomState: RoomState,
  isFacilitator: boolean,
): ReviewSlideshowModel {
  const sortedTargets = sortReviewTargets(
    getReviewTargets(roomState),
    roomState.columns,
  );
  const syncedTargetIndex = sortedTargets.findIndex(
    (target) => voteTargetKey(target.target) === roomState.reviewTargetKey,
  );
  const activeIndex = syncedTargetIndex >= 0 ? syncedTargetIndex : 0;
  const activeReviewTarget = sortedTargets[activeIndex] ?? null;
  const canGoPrevious = activeIndex > 0;
  const canGoNext = activeIndex < sortedTargets.length - 1;

  return {
    sortedTargets,
    activeReviewTarget,
    activeTargetKey: activeReviewTarget
      ? voteTargetKey(activeReviewTarget.target)
      : null,
    activeIndex,
    totalTargets: sortedTargets.length,
    canGoPrevious,
    canGoNext,
    canNavigatePrevious: isFacilitator && canGoPrevious,
    canNavigateNext: isFacilitator && canGoNext,
  };
}

export function buildReviewSlideshowModelEffect(
  roomState: RoomState,
  isFacilitator: boolean,
): Effect.Effect<ReviewSlideshowModel> {
  return Effect.sync(() => buildReviewSlideshowModel(roomState, isFacilitator));
}
