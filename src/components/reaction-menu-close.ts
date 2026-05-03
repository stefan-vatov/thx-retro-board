import { Effect } from "effect";

export type ReactionMenuContainment = {
  contains(node: Node): boolean;
};

export type ReactionMenuPointerCloseInput = {
  targetNode: Node | null;
  menu: ReactionMenuContainment | null | undefined;
  addButton: ReactionMenuContainment | null | undefined;
};

export function shouldCloseReactionMenuForPointerEffect({
  targetNode,
  menu,
  addButton,
}: ReactionMenuPointerCloseInput): Effect.Effect<boolean> {
  return Effect.sync(() => {
    if (!targetNode) return false;
    if (menu?.contains(targetNode)) return false;
    if (addButton?.contains(targetNode)) return false;
    return true;
  });
}

export function shouldCloseReactionMenuForKeyEffect(
  key: string,
): Effect.Effect<boolean> {
  return Effect.sync(() => key === "Escape");
}
