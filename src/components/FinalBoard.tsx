import { useMemo, useState } from "react";
import type { RoomState } from "../domain";
import {
  buildAnonymousRetroExport,
  formatActionsCsv,
  formatActionsJson,
  formatActionsMarkdown,
  formatRetroExportJson,
  formatRetroExportMarkdown,
  getAnonymousActions,
} from "../domain";

interface ExportCard {
  id: string;
  title: string;
  description: string;
  filename: string;
  mimeType: string;
  content: string;
}

export function FinalBoard({ roomState }: { roomState: RoomState }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const exportData = useMemo(() => buildAnonymousRetroExport(roomState), [roomState]);
  const actionExports = useMemo(() => getAnonymousActions(roomState.actions), [roomState.actions]);
  const cards = useMemo<ExportCard[]>(() => [
    {
      id: "retro-json",
      title: "Full retro JSON",
      description: "Anonymous structured export for later analysis.",
      filename: `retro-${roomState.roomId}.json`,
      mimeType: "application/json",
      content: formatRetroExportJson(exportData),
    },
    {
      id: "retro-markdown",
      title: "Full retro Markdown",
      description: "Readable summary with columns, groups, votes, and actions.",
      filename: `retro-${roomState.roomId}.md`,
      mimeType: "text/markdown",
      content: formatRetroExportMarkdown(exportData),
    },
    {
      id: "actions-json",
      title: "Actions JSON",
      description: "Action-only structured export.",
      filename: `retro-${roomState.roomId}-actions.json`,
      mimeType: "application/json",
      content: formatActionsJson(actionExports),
    },
    {
      id: "actions-markdown",
      title: "Actions Markdown",
      description: "Action checklist for docs or issue trackers.",
      filename: `retro-${roomState.roomId}-actions.md`,
      mimeType: "text/markdown",
      content: formatActionsMarkdown(actionExports),
    },
    {
      id: "actions-csv",
      title: "Actions CSV",
      description: "Spreadsheet-ready action list for Excel.",
      filename: `retro-${roomState.roomId}-actions.csv`,
      mimeType: "text/csv",
      content: formatActionsCsv(actionExports),
    },
  ], [actionExports, exportData, roomState.roomId]);

  async function handleCopy(card: ExportCard) {
    try {
      await navigator.clipboard.writeText(card.content);
      setCopiedId(card.id);
      window.setTimeout(() => setCopiedId((current) => current === card.id ? null : current), 1800);
    } catch {
      setCopiedId(null);
    }
  }

  return (
    <section className="finalize-board" aria-label="Finalize retro exports">
      <div className="finalize-hero">
        <div>
          <p className="review-slide__eyebrow">Finalize</p>
          <h3>Export this retro</h3>
          <p>
            Save an anonymous copy of the retro for analysis. Exports include columns, items, groups,
            aggregate votes, and action items without participant names or IDs.
          </p>
        </div>
        <div className="finalize-stats" aria-label="Export summary">
          <span><strong>{roomState.columns.length}</strong> columns</span>
          <span><strong>{roomState.items.length}</strong> items</span>
          <span><strong>{roomState.groups.length}</strong> groups</span>
          <span><strong>{roomState.actions.length}</strong> actions</span>
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
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => handleCopy(card)}>
                {copiedId === card.id ? "Copied" : "Copy"}
              </button>
              <button type="button" className="btn btn--primary btn--sm" onClick={() => downloadExport(card)}>
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
        <pre>{formatActionsMarkdown(actionExports)}</pre>
      </div>
    </section>
  );
}

function downloadExport(card: ExportCard) {
  const blob = new Blob([card.content], { type: `${card.mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = card.filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
