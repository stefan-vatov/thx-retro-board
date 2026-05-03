import { Effect } from "effect";

export type ReactionMenuAnchorRect = {
  top: number;
  right: number;
  bottom: number;
};

export type ReactionMenuViewport = {
  width: number;
  height: number;
};

export type ReactionMenuPickerMetrics = {
  width: number;
  height: number;
  gutter: number;
  offset: number;
};

export type ReactionMenuPositionInput = {
  anchorRect: ReactionMenuAnchorRect;
  viewport: ReactionMenuViewport;
  picker: ReactionMenuPickerMetrics;
};

export type ReactionMenuPosition = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export function getReactionMenuPositionEffect({
  anchorRect,
  viewport,
  picker,
}: ReactionMenuPositionInput): Effect.Effect<ReactionMenuPosition> {
  return Effect.sync(() => {
    const width = Math.min(picker.width, viewport.width - picker.gutter * 2);
    const height = Math.min(picker.height, viewport.height - picker.gutter * 2);
    const spaceAbove = anchorRect.top - picker.gutter;
    const spaceBelow = viewport.height - anchorRect.bottom - picker.gutter;
    const shouldOpenAbove = spaceAbove >= height || spaceAbove > spaceBelow;
    const rawTop = shouldOpenAbove
      ? anchorRect.top - height - picker.offset
      : anchorRect.bottom + picker.offset;
    const top = Math.max(
      picker.gutter,
      Math.min(rawTop, viewport.height - height - picker.gutter),
    );
    const rawLeft = anchorRect.right - width + picker.offset;
    const left = Math.max(
      picker.gutter,
      Math.min(rawLeft, viewport.width - width - picker.gutter),
    );

    return { top, left, width, height };
  });
}
