import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";
import { safeDisplayText } from "./text-safety.ts";

export const UI_PANEL_EVENT = "ui:panel-update";
export const UI_MODE_STATUS_EVENT = "ui:mode-status-update";
export const UI_WIDGET_NAME = "pi-config-panels";

export type UiPanelId = "todo";
export type UiModeStatusId = "goal" | "ponytail";
export type UiPanelRenderer = (width: number, theme: Theme) => string[];

export interface UiPanelUpdate {
  id: UiPanelId;
  render?: UiPanelRenderer;
}

export interface UiModeStatusUpdate {
  id: UiModeStatusId;
  text?: string;
}

export function isVisuallyBlank(line: string): boolean {
  return stripTerminalSequences(line).trim().length === 0;
}

export function collapseBlankLines(lines: readonly string[]): string[] {
  const collapsed: string[] = [];
  let previousBlank = false;
  for (const line of lines) {
    const blank = isVisuallyBlank(line);
    if (blank && previousBlank) continue;
    collapsed.push(blank ? "" : line);
    previousBlank = blank;
  }
  return collapsed;
}

export function normalizeDisplayText(value: unknown): string {
  return collapseBlankLines(safeDisplayText(value).split("\n")).join("\n");
}

function trimBlankEdges(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && isVisuallyBlank(lines[start])) start++;
  while (end > start && isVisuallyBlank(lines[end - 1])) end--;
  return lines.slice(start, end);
}

export function applyUiGutter(lines: readonly string[], width: number): string[] {
  const safeWidth = Math.max(1, Math.floor(width));
  const contentWidth = Math.max(0, safeWidth - 1);
  return lines.map((line) => {
    if (contentWidth === 0) return " ";
    const content = isVisuallyBlank(line) ? "" : truncateToWidth(line, contentWidth, "");
    return ` ${content}`;
  });
}

export function budgetUiBlocks(
  blocks: readonly (readonly string[])[],
  maxRows: number,
  trailingBlank = false,
): string[][] {
  const normalized = blocks.map((block) => trimBlankEdges(collapseBlankLines(block))).filter((block) => block.length > 0);
  if (normalized.length === 0) return [];
  const fixedRows = Math.max(0, normalized.length - 1) + (trailingBlank ? 1 : 0);
  const available = Math.max(normalized.length, Math.floor(maxRows) - fixedRows);
  if (normalized.reduce((total, block) => total + block.length, fixedRows) <= maxRows) return normalized;

  const slots = normalized.map(() => 0);
  let remaining = available - normalized.length;
  for (let changed = true; remaining > 0 && changed;) {
    changed = false;
    for (let index = 0; index < normalized.length && remaining > 0; index++) {
      const bodyRows = normalized[index].length - 1;
      if (slots[index] >= bodyRows) continue;
      slots[index]++;
      remaining--;
      changed = true;
    }
  }
  return normalized.map((block, index) => {
    const body = block.slice(1);
    const slotCount = slots[index];
    if (body.length <= slotCount) return [...block];
    if (slotCount === 0) return [`${block[0]} - ${body.length} more`];
    const shown = Math.max(0, slotCount - 1);
    return [block[0], ...body.slice(0, shown), `... ${body.length - shown} more`];
  });
}

export function composeUiBlocks(blocks: readonly (readonly string[])[], width: number, trailingBlank = false): string[] {
  const logical: string[] = [];
  for (const block of blocks) {
    const normalized = trimBlankEdges(collapseBlankLines(block));
    if (normalized.length === 0) continue;
    if (logical.length > 0) logical.push("");
    logical.push(...normalized);
  }
  if (trailingBlank && logical.length > 0) logical.push("");
  return applyUiGutter(collapseBlankLines(logical), width);
}
