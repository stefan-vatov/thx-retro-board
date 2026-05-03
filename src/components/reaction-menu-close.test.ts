import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  shouldCloseReactionMenuForKeyEffect,
  shouldCloseReactionMenuForPointerEffect,
} from "./reaction-menu-close";

function fakeNode() {
  return {} as Node;
}

function containsOnly(match: Node) {
  return {
    contains: (node: Node) => node === match,
  };
}

describe("reaction menu close decisions", () => {
  it("keeps the menu open for clicks inside the menu or add button", async () => {
    const menuNode = fakeNode();
    const buttonNode = fakeNode();

    await expect(
      Effect.runPromise(
        shouldCloseReactionMenuForPointerEffect({
          targetNode: menuNode,
          menu: containsOnly(menuNode),
          addButton: containsOnly(buttonNode),
        }),
      ),
    ).resolves.toBe(false);

    await expect(
      Effect.runPromise(
        shouldCloseReactionMenuForPointerEffect({
          targetNode: buttonNode,
          menu: containsOnly(menuNode),
          addButton: containsOnly(buttonNode),
        }),
      ),
    ).resolves.toBe(false);
  });

  it("closes the menu for outside clicks", async () => {
    await expect(
      Effect.runPromise(
        shouldCloseReactionMenuForPointerEffect({
          targetNode: fakeNode(),
          menu: containsOnly(fakeNode()),
          addButton: containsOnly(fakeNode()),
        }),
      ),
    ).resolves.toBe(true);
  });

  it("only closes on Escape key presses", async () => {
    await expect(
      Effect.runPromise(shouldCloseReactionMenuForKeyEffect("Escape")),
    ).resolves.toBe(true);
    await expect(
      Effect.runPromise(shouldCloseReactionMenuForKeyEffect("Enter")),
    ).resolves.toBe(false);
  });
});
