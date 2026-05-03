import type { RoomState } from "../domain";

export function PairwiseProgressSummary({
  progressPulse,
  answeredCount,
  total,
}: {
  progressPulse: boolean;
  answeredCount: number;
  total: number;
}) {
  return (
    <div
      className={`vote-budget-bar${progressPulse ? " vote-budget-bar--pulse" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="vote-budget-bar__label">Pairwise ranking:</span>
      <span className="vote-budget-bar__value">
        {answeredCount} of {total} comparisons complete
      </span>
    </div>
  );
}

export function PairwiseProgressPanel({
  progress,
  teamPercent,
  allComplete,
  currentParticipantId,
}: {
  progress: Array<{
    participant: RoomState["participants"][number];
    answered: number;
    total: number;
    percent: number;
    complete: boolean;
  }>;
  teamPercent: number;
  allComplete: boolean;
  currentParticipantId: string;
}) {
  if (progress.length === 0) return null;

  return (
    <section
      className={`pairwise-progress${allComplete ? " pairwise-progress--complete" : ""}`}
      aria-label="Participant ranking progress"
    >
      <div className="pairwise-progress__header">
        <div>
          <strong>Ranking progress</strong>
          <span>
            {allComplete
              ? "Everyone has ranked"
              : "Visible to everyone in the room"}
          </span>
        </div>
        <div
          key={teamPercent}
          className={`pairwise-progress__meter${allComplete ? " pairwise-progress__meter--complete" : ""}`}
          aria-label={`${teamPercent}% of participant ranking complete`}
        >
          <span>{teamPercent}%</span>
        </div>
      </div>
      <ul className="pairwise-progress__list">
        {progress.map((item) => (
          <li
            key={item.participant.id}
            className={`pairwise-progress__item${item.complete ? " pairwise-progress__item--complete" : ""}`}
          >
            <span className="pairwise-progress__status" aria-hidden="true" />
            <span className="pairwise-progress__name">
              {item.participant.displayName}
            </span>
            {item.participant.id === currentParticipantId && (
              <span className="pairwise-progress__self">You</span>
            )}
            <span className="pairwise-progress__count">
              {item.answered}/{item.total}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PairwiseColumnBreakdown({
  summaries,
  totalPairs,
  answeredPairs,
}: {
  summaries: Array<{ id: string; name: string; targetCount: number }>;
  totalPairs: number;
  answeredPairs: number;
}) {
  return (
    <section
      className="pairwise-breakdown"
      aria-label="Pairwise comparison coverage"
    >
      <div className="pairwise-breakdown__header">
        <strong>Comparison coverage</strong>
        <span>
          {answeredPairs}/{totalPairs} global pairs. Groups and ungrouped cards
          are compared across the whole board.
        </span>
      </div>
      <ul className="pairwise-breakdown__list">
        {summaries.map((summary) => (
          <li
            key={summary.id}
            className={
              summary.targetCount === 0
                ? "pairwise-breakdown__item pairwise-breakdown__item--muted"
                : "pairwise-breakdown__item"
            }
          >
            <span>{summary.name}</span>
            <small>
              {summary.targetCount} target{summary.targetCount === 1 ? "" : "s"}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}
