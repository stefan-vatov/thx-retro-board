import { useMemo, useState } from "react";
import { Effect } from "effect";
import type { RoomState } from "../domain";
import {
  buildAnonymousRetroExportEffect,
  formatActionsMarkdownEffect,
  getAnonymousActionsEffect,
} from "../domain";
import {
  copyExportCardEffect,
  downloadExportCardEffect,
} from "./clipboard-effect";
import {
  buildFinalizeExportCardsEffect,
  buildFinalizeStatsEffect,
  type ExportCard,
} from "./final-board-effect";

export function FinalBoard({ roomState }: { roomState: RoomState }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const exportData = useMemo(
    () => Effect.runSync(buildAnonymousRetroExportEffect(roomState)),
    [roomState],
  );
  const actionExports = useMemo(
    () => Effect.runSync(getAnonymousActionsEffect(roomState.actions)),
    [roomState.actions],
  );
  const cards = useMemo(
    () =>
      Effect.runSync(
        buildFinalizeExportCardsEffect({
          roomId: roomState.roomId,
          exportData,
          actions: actionExports,
        }),
      ),
    [actionExports, exportData, roomState.roomId],
  );
  const stats = useMemo(
    () => Effect.runSync(buildFinalizeStatsEffect(roomState)),
    [roomState],
  );

  async function handleCopy(card: ExportCard) {
    const result = await Effect.runPromise(
      copyExportCardEffect(card, navigator.clipboard),
    );
    setCopiedId(result.copiedId);
    if (result.copiedId) {
      window.setTimeout(
        () =>
          setCopiedId((current) =>
            current === result.copiedId ? null : current,
          ),
        1800,
      );
    }
  }

  return (
    <section className="finalize-board" aria-label="Finalize retro exports">
      <div className="finalize-hero">
        <div>
          <p className="review-slide__eyebrow">Finalize</p>
          <h3>Export this retro</h3>
          <p>
            Save an anonymous copy of the retro for analysis. Exports include
            columns, items, groups, aggregate votes, and action items without
            participant names or IDs.
          </p>
        </div>
        <div className="finalize-stats" aria-label="Export summary">
          <span>
            <strong>{stats.columns}</strong> columns
          </span>
          <span>
            <strong>{stats.items}</strong> items
          </span>
          <span>
            <strong>{stats.groups}</strong> groups
          </span>
          <span>
            <strong>{stats.actions}</strong> actions
          </span>
        </div>
      </div>

      <div className="export-grid">
        {cards.map((card) => (
          <article key={card.id} className="export-card">
            <div>
              <h4>{card.title}</h4>
              <p>{card.description}</p>
            </div>
            <div className="export-card__actions">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => handleCopy(card)}
              >
                {copiedId === card.id ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => {
                  void Effect.runPromise(
                    downloadExportCardEffect(card, {
                      createBlob: (parts, options) => new Blob(parts, options),
                      createObjectUrl: (blob) => URL.createObjectURL(blob),
                      createLink: () => document.createElement("a"),
                      appendLink: (link) => document.body.append(link),
                      revokeObjectUrl: (url) => URL.revokeObjectURL(url),
                    }),
                  );
                }}
              >
                Download
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="finalize-preview" aria-label="Action export preview">
        <div className="finalize-preview__header">
          <p className="review-slide__eyebrow">Actions preview</p>
          <span className="review-section-count">{actionExports.length}</span>
        </div>
        <pre>{Effect.runSync(formatActionsMarkdownEffect(actionExports))}</pre>
      </div>
    </section>
  );
}
