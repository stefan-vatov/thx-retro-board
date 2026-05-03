import { Effect } from "effect";
import {
  formatActionsCsvEffect,
  formatActionsJsonEffect,
  formatActionsMarkdownEffect,
  formatRetroExportJsonEffect,
  formatRetroExportMarkdownEffect,
  type AnonymousRetroExport,
  type RoomState,
} from "../domain";

export interface ExportCard {
  id: string;
  title: string;
  description: string;
  filename: string;
  mimeType: string;
  content: string;
}

export type FinalizeStats = {
  columns: number;
  items: number;
  groups: number;
  actions: number;
};

export function buildFinalizeStatsEffect(
  roomState: RoomState,
): Effect.Effect<FinalizeStats> {
  return Effect.succeed({
    columns: roomState.columns.length,
    items: roomState.items.length,
    groups: roomState.groups.length,
    actions: roomState.actions.length,
  });
}

export function buildFinalizeExportCardsEffect({
  roomId,
  exportData,
  actions,
}: {
  roomId: string;
  exportData: AnonymousRetroExport;
  actions: AnonymousRetroExport["actions"];
}): Effect.Effect<ExportCard[]> {
  return Effect.gen(function* () {
    const retroJson = yield* formatRetroExportJsonEffect(exportData);
    const retroMarkdown = yield* formatRetroExportMarkdownEffect(exportData);
    const actionsJson = yield* formatActionsJsonEffect(actions);
    const actionsMarkdown = yield* formatActionsMarkdownEffect(actions);
    const actionsCsv = yield* formatActionsCsvEffect(actions);

    return [
      {
        id: "retro-json",
        title: "Full retro JSON",
        description: "Anonymous structured export for later analysis.",
        filename: `retro-${roomId}.json`,
        mimeType: "application/json",
        content: retroJson,
      },
      {
        id: "retro-markdown",
        title: "Full retro Markdown",
        description:
          "Readable summary with columns, groups, votes, and actions.",
        filename: `retro-${roomId}.md`,
        mimeType: "text/markdown",
        content: retroMarkdown,
      },
      {
        id: "actions-json",
        title: "Actions JSON",
        description: "Action-only structured export.",
        filename: `retro-${roomId}-actions.json`,
        mimeType: "application/json",
        content: actionsJson,
      },
      {
        id: "actions-markdown",
        title: "Actions Markdown",
        description: "Action checklist for docs or issue trackers.",
        filename: `retro-${roomId}-actions.md`,
        mimeType: "text/markdown",
        content: actionsMarkdown,
      },
      {
        id: "actions-csv",
        title: "Actions CSV",
        description: "Spreadsheet-ready action list for Excel.",
        filename: `retro-${roomId}-actions.csv`,
        mimeType: "text/csv",
        content: actionsCsv,
      },
    ];
  });
}
