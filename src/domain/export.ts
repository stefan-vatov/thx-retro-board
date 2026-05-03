import { Effect } from "effect";
import type { ActionItem, RankingMethod, RoomState, VoteTarget } from "./types";
import { getVoteTarget, pairwiseComparisonKey, voteTargetKey } from "./state";

export interface AnonymousRetroExport {
  schemaVersion: 1;
  exportedAt: string;
  roomId: string;
  rankingMethod: RankingMethod;
  columns: Array<{ id: string; name: string; order: number }>;
  items: Array<{ id: string; text: string; columnId: string; groupId: string | null; order: number }>;
  groups: Array<{ id: string; name: string; columnId: string; order: number }>;
  votes: Array<{ target: VoteTarget; totalVotes: number }>;
  pairwiseChoices: Array<{ winner: VoteTarget; loser: VoteTarget; count: number }>;
  actions: Array<{ id: string; text: string; order: number }>;
}

export function buildAnonymousRetroExport(state: RoomState, exportedAt = new Date().toISOString()): AnonymousRetroExport {
  return {
    schemaVersion: 1,
    exportedAt,
    roomId: state.roomId,
    rankingMethod: state.rankingMethod,
    columns: [...state.columns]
      .sort((a, b) => a.order - b.order)
      .map(({ id, name, order }) => ({ id, name, order })),
    items: [...state.items]
      .sort((a, b) => a.order - b.order)
      .map(({ id, text, columnId, groupId, order }) => ({ id, text, columnId, groupId, order })),
    groups: [...state.groups]
      .sort((a, b) => a.order - b.order)
      .map(({ id, name, columnId, order }) => ({ id, name, columnId, order })),
    votes: aggregateAnonymousVotes(state),
    pairwiseChoices: aggregateAnonymousPairwiseChoices(state),
    actions: getAnonymousActions(state.actions),
  };
}

export function buildAnonymousRetroExportEffect(
  state: RoomState,
  exportedAt = new Date().toISOString(),
): Effect.Effect<AnonymousRetroExport> {
  return Effect.sync(() => buildAnonymousRetroExport(state, exportedAt));
}

export function getAnonymousActions(actions: ActionItem[]): AnonymousRetroExport["actions"] {
  return [...actions]
    .sort((a, b) => a.order - b.order)
    .map(({ id, text, order }) => ({ id, text, order }));
}

export function getAnonymousActionsEffect(actions: ActionItem[]): Effect.Effect<AnonymousRetroExport["actions"]> {
  return Effect.sync(() => getAnonymousActions(actions));
}

export function formatRetroExportJson(exportData: AnonymousRetroExport): string {
  return `${JSON.stringify(exportData, null, 2)}\n`;
}

export function formatRetroExportJsonEffect(exportData: AnonymousRetroExport): Effect.Effect<string> {
  return Effect.sync(() => formatRetroExportJson(exportData));
}

export function formatActionsJson(actions: AnonymousRetroExport["actions"]): string {
  return `${JSON.stringify(actions, null, 2)}\n`;
}

export function formatActionsJsonEffect(actions: AnonymousRetroExport["actions"]): Effect.Effect<string> {
  return Effect.sync(() => formatActionsJson(actions));
}

export function formatRetroExportMarkdown(exportData: AnonymousRetroExport): string {
  const lines = [
    `# Retro export`,
    ``,
    `- Room: ${exportData.roomId}`,
    `- Exported: ${exportData.exportedAt}`,
    `- Ranking method: ${exportData.rankingMethod === "pairwise" ? "Pairwise ranking" : "Score voting"}`,
    `- Columns: ${exportData.columns.length}`,
    `- Items: ${exportData.items.length}`,
    `- Groups: ${exportData.groups.length}`,
    `- Actions: ${exportData.actions.length}`,
    ``,
    `## Board`,
    ``,
  ];

  for (const column of exportData.columns) {
    const groups = exportData.groups.filter((group) => group.columnId === column.id).sort((a, b) => a.order - b.order);
    const ungroupedItems = exportData.items.filter((item) => item.columnId === column.id && item.groupId === null).sort((a, b) => a.order - b.order);
    lines.push(`### ${escapeMarkdownText(column.name)}`, ``);

    if (groups.length === 0 && ungroupedItems.length === 0) {
      lines.push(`_No items._`, ``);
      continue;
    }

    for (const group of groups) {
      const totalVotes = getTotalVotes(exportData.votes, { type: "group", id: group.id });
      lines.push(`#### ${escapeMarkdownText(group.name)} (${formatResultLabel(exportData.rankingMethod, totalVotes, { type: "group", id: group.id }, exportData)})`);
      const groupItems = exportData.items.filter((item) => item.groupId === group.id).sort((a, b) => a.order - b.order);
      if (groupItems.length === 0) {
        lines.push(`- _No items in group._`);
      } else {
        for (const item of groupItems) {
          lines.push(`- ${escapeMarkdownText(item.text)}`);
        }
      }
      lines.push(``);
    }

    for (const item of ungroupedItems) {
      const totalVotes = getTotalVotes(exportData.votes, { type: "item", id: item.id });
      lines.push(`- ${escapeMarkdownText(item.text)} (${formatResultLabel(exportData.rankingMethod, totalVotes, { type: "item", id: item.id }, exportData)})`);
    }
    if (ungroupedItems.length > 0) lines.push(``);
  }

  lines.push(`## Actions`, ``);
  lines.push(formatActionsMarkdown(exportData.actions).trimEnd());
  lines.push(``);
  return `${lines.join("\n")}\n`;
}

export function formatRetroExportMarkdownEffect(exportData: AnonymousRetroExport): Effect.Effect<string> {
  return Effect.sync(() => formatRetroExportMarkdown(exportData));
}

export function formatActionsMarkdown(actions: AnonymousRetroExport["actions"]): string {
  if (actions.length === 0) return `_No actions captured._\n`;
  return `${actions.map((action) => `- [ ] ${escapeMarkdownText(action.text)}`).join("\n")}\n`;
}

export function formatActionsMarkdownEffect(actions: AnonymousRetroExport["actions"]): Effect.Effect<string> {
  return Effect.sync(() => formatActionsMarkdown(actions));
}

export function formatActionsCsv(actions: AnonymousRetroExport["actions"]): string {
  const rows = [["order", "text"], ...actions.map((action) => [String(action.order + 1), action.text])];
  return `${rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n")}\n`;
}

export function formatActionsCsvEffect(actions: AnonymousRetroExport["actions"]): Effect.Effect<string> {
  return Effect.sync(() => formatActionsCsv(actions));
}

function aggregateAnonymousVotes(state: RoomState): AnonymousRetroExport["votes"] {
  const totals = new Map<string, { target: VoteTarget; totalVotes: number }>();
  for (const vote of state.votes) {
    const target = getVoteTarget(vote);
    if (target === null) continue;
    const key = voteTargetKey(target);
    const existing = totals.get(key);
    totals.set(key, {
      target,
      totalVotes: (existing?.totalVotes ?? 0) + vote.count,
    });
  }
  return [...totals.values()].sort((a, b) => voteTargetKey(a.target).localeCompare(voteTargetKey(b.target)));
}

function aggregateAnonymousPairwiseChoices(state: RoomState): AnonymousRetroExport["pairwiseChoices"] {
  const totals = new Map<string, { winner: VoteTarget; loser: VoteTarget; count: number }>();
  for (const choice of state.pairwiseChoices ?? []) {
    const comparisonKey = pairwiseComparisonKey(choice.winner, choice.loser);
    const key = `${comparisonKey}:${voteTargetKey(choice.winner)}`;
    const existing = totals.get(key);
    totals.set(key, {
      winner: choice.winner,
      loser: choice.loser,
      count: (existing?.count ?? 0) + (Number.isInteger(choice.count) && choice.count !== undefined && choice.count > 0 ? choice.count : 1),
    });
  }
  return [...totals.values()].sort((a, b) => {
    const comparison = pairwiseComparisonKey(a.winner, a.loser).localeCompare(pairwiseComparisonKey(b.winner, b.loser));
    if (comparison !== 0) return comparison;
    return voteTargetKey(a.winner).localeCompare(voteTargetKey(b.winner));
  });
}

function getTotalVotes(votes: AnonymousRetroExport["votes"], target: VoteTarget): number {
  return votes.find((vote) => voteTargetKey(vote.target) === voteTargetKey(target))?.totalVotes ?? 0;
}

function getTotalPairwiseWins(exportData: AnonymousRetroExport, target: VoteTarget): number {
  const key = voteTargetKey(target);
  return exportData.pairwiseChoices
    .filter((choice) => voteTargetKey(choice.winner) === key)
    .reduce((sum, choice) => sum + choice.count, 0);
}

function formatResultLabel(method: RankingMethod, totalVotes: number, target: VoteTarget, exportData: AnonymousRetroExport): string {
  if (method === "pairwise") {
    const wins = getTotalPairwiseWins(exportData, target);
    return `${wins} win${wins === 1 ? "" : "s"}`;
  }
  return `${totalVotes} vote${totalVotes === 1 ? "" : "s"}`;
}

function escapeCsvCell(value: string): string {
  const spreadsheetSafeValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(spreadsheetSafeValue) ? `"${spreadsheetSafeValue.replaceAll("\"", "\"\"")}"` : spreadsheetSafeValue;
}

function escapeMarkdownText(value: string): string {
  const markdownSpecialCharacters = new Set(["\\", "`", "*", "_", "{", "}", "[", "]", "(", ")", "#", "+", ".", "!", "|", "-"]);
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .split("")
    .map((char) => markdownSpecialCharacters.has(char) ? `\\${char}` : char)
    .join("");
}
