import { test, expect, type Page } from "@playwright/test";

async function dragItemToDropZone(page: Page, itemText: string, groupId: string | null, index: number) {
  const item = page.locator("[data-drag-item-id]", { hasText: itemText }).first();
  await expect(item).toBeVisible();
  const handle = item.getByRole("button", { name: new RegExp(`drag ${itemText}`, "i") });
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  await handle.dispatchEvent("pointerdown", {
    pointerId: 3,
    pointerType: "mouse",
    button: 0,
    clientX: handleBox!.x + handleBox!.width / 2,
    clientY: handleBox!.y + handleBox!.height / 2,
  });
  const groupKey = groupId ?? "__ungrouped__";
  const dropZone = page.locator(`[data-drop-zone="true"][data-group-id="${groupKey}"][data-index="${index}"]`).first();
  await expect(dropZone).toBeVisible();
  const dropBox = await dropZone.boundingBox();
  expect(dropBox).not.toBeNull();
  const x = dropBox!.x + dropBox!.width / 2;
  const y = dropBox!.y + dropBox!.height / 2;
  await dropZone.dispatchEvent("pointermove", { pointerId: 3, pointerType: "mouse", button: 0, clientX: x, clientY: y });
  await expect(dropZone).toHaveAttribute("data-active", "true");
  await dropZone.dispatchEvent("pointerup", { pointerId: 3, pointerType: "mouse", button: 0, clientX: x, clientY: y });
}

async function touchDragItemToDropZone(page: Page, itemText: string, groupId: string | null, index: number) {
  const item = page.locator("[data-drag-item-id]", { hasText: itemText }).first();
  await expect(item).toBeVisible();
  const groupKey = groupId ?? "__ungrouped__";
  const handle = item.getByRole("button", { name: new RegExp(`drag ${itemText}`, "i") });
  await handle.dispatchEvent("pointerdown", { pointerId: 7, pointerType: "touch", button: 0, clientX: 20, clientY: 20 });
  const dropZone = page.locator(`[data-drop-zone="true"][data-group-id="${groupKey}"][data-index="${index}"]`).first();
  await expect(dropZone).toBeVisible();
  const dropBox = await dropZone.boundingBox();
  expect(dropBox).not.toBeNull();
  const x = dropBox!.x + dropBox!.width / 2;
  const y = dropBox!.y + dropBox!.height / 2;
  await dropZone.dispatchEvent("pointermove", { pointerId: 7, pointerType: "touch", button: 0, clientX: x, clientY: y });
  await expect(dropZone).toHaveAttribute("data-active", "true");
  await dropZone.dispatchEvent("pointerup", { pointerId: 7, pointerType: "touch", button: 0, clientX: x, clientY: y });
}

test.describe("Retro Board E2E", () => {
  test.describe("Foundation", () => {
    test("root page shows create room control", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator("h1")).toContainText("Retro Board");
      await expect(page.getByRole("button", { name: /create room/i })).toBeVisible();
    });

    test("creating a room navigates to a room URL", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: /create room/i }).click();
      await page.waitForURL(/\/room\//);
      expect(page.url()).toMatch(/\/room\//);
    });

    test("direct room URL shows join flow", async ({ browser }) => {
      // Create a room first
      const page = await browser.newPage();
      await page.goto("/");
      await page.getByRole("button", { name: /create room/i }).click();
      await page.waitForURL(/\/room\//);
      const roomUrl = page.url();

      // Open in a new context
      const page2 = await browser.newPage();
      await page2.goto(roomUrl);

      // Should show join form (display name input)
      await expect(page2.getByLabel(/display name/i)).toBeVisible();
      await expect(page2.getByRole("button", { name: /join/i })).toBeVisible();
      await page2.close();
      await page.close();
    });

    test("blank display name is rejected", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: /create room/i }).click();
      await page.waitForURL(/\/room\//);

      await page.getByLabel(/display name/i).fill("   ");
      await page.getByRole("button", { name: /join/i }).click();

      // Should show validation error
      await expect(page.getByText(/please enter a display name/i)).toBeVisible();
    });

    test("joining with a valid name enters the room", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: /create room/i }).click();
      await page.waitForURL(/\/room\//);

      await page.getByLabel(/display name/i).fill("Alice");
      await page.getByRole("button", { name: /join/i }).click();

      // Should show the board
      await expect(page.getByText(/Phase: WRITE/i)).toBeVisible();
      await expect(page.getByText(/Alice/i)).toBeVisible();
      await expect(page.getByText(/⭐ Facilitator/)).toBeVisible();
    });

    test("phase mutation exposes pending state and blocks duplicate submissions", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: /create room/i }).click();
      await page.waitForURL(/\/room\//);
      const roomId = new URL(page.url()).pathname.split("/").pop()!;

      await page.getByLabel(/display name/i).fill("Alice");
      await page.getByRole("button", { name: /join/i }).click();
      await expect(page.getByText(/Phase: WRITE/i)).toBeVisible();

      let phaseRequests = 0;
      await page.route(`**/api/rooms/${roomId}/phase`, async (route) => {
        phaseRequests += 1;
        await new Promise((resolve) => setTimeout(resolve, 300));
        await route.continue();
      });

      const advance = page.getByRole("button", { name: /advance to next phase/i });
      await advance.click();
      await advance.click({ force: true });
      await expect(advance).toBeDisabled();
      await expect(advance).toHaveAttribute("aria-busy", "true");
      await expect(page.getByText(/Phase: ORGANISE/i)).toBeVisible({ timeout: 5000 });
      expect(phaseRequests).toBe(1);
    });
  });

  test.describe("Two-user flow", () => {
    test("facilitator configures columns, write placement syncs, and custom labels persist through review", async ({ browser }) => {
      const ctx1 = await browser.newContext();
      const alice = await ctx1.newPage();
      await alice.goto("/");
      await alice.getByRole("button", { name: /create room/i }).click();
      await alice.waitForURL(/\/room\//);
      const roomUrl = alice.url();
      const roomId = new URL(roomUrl).pathname.split("/").pop()!;

      await alice.getByLabel(/display name/i).fill("Alice");
      await alice.getByRole("button", { name: /join/i }).click();
      await expect(alice.getByText(/Phase: WRITE/i)).toBeVisible();
      await expect(alice.getByRole("button", { name: /configure columns/i })).toBeVisible();

      const ctx2 = await browser.newContext();
      const bob = await ctx2.newPage();
      await bob.goto(roomUrl);
      await bob.getByLabel(/display name/i).fill("Bob");
      await bob.getByRole("button", { name: /join/i }).click();
      await expect(bob.getByText(/Phase: WRITE/i)).toBeVisible();
      await expect(bob.getByRole("button", { name: /configure columns/i })).toHaveCount(0);

      await alice.getByRole("button", { name: /configure columns/i }).click();
      await alice.getByLabel(/new column name/i).fill("  Learn  ");
      await alice.getByRole("button", { name: /add column/i }).click();
      await expect(alice.getByRole("heading", { name: "Learn" })).toBeVisible({ timeout: 5000 });
      await expect(bob.getByRole("heading", { name: "Learn" })).toBeVisible({ timeout: 5000 });

      await alice.locator(".column-config__item", { hasText: "Learn" }).getByRole("button", { name: "Edit" }).click();
      await alice.getByLabel(/edit Learn column name/i).fill("Team Wins");
      await alice.getByRole("button", { name: "Save" }).click();
      await expect(bob.getByRole("heading", { name: "Team Wins" })).toBeVisible({ timeout: 5000 });

      const ctx3 = await browser.newContext();
      const carol = await ctx3.newPage();
      await carol.goto(roomUrl);
      await carol.getByLabel(/display name/i).fill("Carol");
      await carol.getByRole("button", { name: /join/i }).click();
      await expect(carol.getByRole("heading", { name: "Team Wins" })).toBeVisible({ timeout: 5000 });

      await alice.getByLabel(/column for new item/i).selectOption({ label: "Team Wins" });
      await alice.getByPlaceholder(/add a retro item/i).fill("Column-specific item");
      await alice.getByRole("button", { name: /add item/i }).click();
      await expect(bob.locator(".column-board__column", { hasText: "Team Wins" }).getByText("Column-specific item")).toBeVisible({ timeout: 5000 });

      const stateAfterItem = await alice.evaluate(async (id) => {
        const response = await fetch(`/api/rooms/${id}`);
        return response.json();
      }, roomId) as { columns: { id: string; name: string; order: number }[]; items: { text: string; columnId: string | null }[] };
      const teamWins = stateAfterItem.columns.find((column) => column.name === "Team Wins")!;
      expect(stateAfterItem.items.find((item) => item.text === "Column-specific item")?.columnId).toBe(teamWins.id);

      await alice.locator(".column-config__item", { hasText: "Team Wins" }).getByRole("button", { name: /move Team Wins column left/i }).click();
      const stateAfterReorder = await alice.evaluate(async (id) => {
        const response = await fetch(`/api/rooms/${id}`);
        return response.json();
      }, roomId) as { columns: { id: string; name: string; order: number }[] };
      expect(stateAfterReorder.columns.map((column) => column.order)).toEqual([0, 1, 2, 3]);
      expect(stateAfterReorder.columns.findIndex((column) => column.name === "Team Wins")).toBeLessThan(3);

      await alice.getByRole("button", { name: /advance to next phase/i }).click();
      await expect(alice.getByText(/Phase: ORGANISE/i)).toBeVisible({ timeout: 5000 });
      await expect(bob.getByRole("button", { name: /create group/i })).toHaveCount(0);
      await expect(alice.getByRole("heading", { name: "Team Wins" })).toBeVisible();

      await alice.getByRole("button", { name: /advance to next phase/i }).click();
      await expect(alice.getByText(/Phase: VOTE/i)).toBeVisible({ timeout: 5000 });
      await expect(alice.getByRole("heading", { name: "Team Wins" })).toBeVisible();

      await alice.getByRole("button", { name: /advance to next phase/i }).click();
      await expect(alice.getByText(/Phase: REVIEW/i)).toBeVisible({ timeout: 5000 });
      await expect(alice.getByRole("heading", { name: "Team Wins" })).toBeVisible();
      await expect(alice.getByText("Column-specific item")).toBeVisible();

      await ctx1.close();
      await ctx2.close();
      await ctx3.close();
    });

    test("organise create-column form blocks maximum columns with visible feedback", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: /create room/i }).click();
      await page.waitForURL(/\/room\//);

      await page.getByLabel(/display name/i).fill("Alice");
      await page.getByRole("button", { name: /join/i }).click();
      await expect(page.getByText(/Phase: WRITE/i)).toBeVisible();

      await page.getByRole("button", { name: /configure columns/i }).click();
      for (const name of ["One", "Two", "Three", "Four", "Five"]) {
        await page.locator(".column-config__form").getByLabel(/new column name/i).fill(name);
        await page.getByRole("button", { name: /add column/i }).click();
        await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 5000 });
      }

      await page.getByRole("button", { name: /configure columns/i }).click();
      await page.getByRole("button", { name: /advance to next phase/i }).click();
      await expect(page.getByText(/Phase: ORGANISE/i)).toBeVisible({ timeout: 5000 });

      const board = page.locator(".board-area");
      await expect(board.getByText(/Rooms can have at most 8 columns\./i)).toBeVisible();
      await expect(board.getByLabel(/new column name/i)).toBeDisabled();
      await expect(board.getByRole("button", { name: /create group \/ column/i })).toBeDisabled();
    });

    test("organise drag/drop moves, reorders, cancels, and syncs across participants", async ({ browser }) => {
      const ctx1 = await browser.newContext();
      const alice = await ctx1.newPage();
      await alice.goto("/");
      await alice.getByRole("button", { name: /create room/i }).click();
      await alice.waitForURL(/\/room\//);
      const roomUrl = alice.url();
      const roomId = new URL(roomUrl).pathname.split("/").pop()!;

      await alice.getByLabel(/display name/i).fill("Alice");
      await alice.getByRole("button", { name: /join/i }).click();
      await expect(alice.getByText(/Phase: WRITE/i)).toBeVisible();

      for (const text of ["Drag A", "Drag B", "Drag C"]) {
        await alice.getByPlaceholder(/add a retro item/i).fill(text);
        await alice.getByRole("button", { name: /add item/i }).click();
        await expect(alice.getByText(text)).toBeVisible();
      }

      const ctx2 = await browser.newContext();
      const bob = await ctx2.newPage();
      await bob.goto(roomUrl);
      await bob.getByLabel(/display name/i).fill("Bob");
      await bob.getByRole("button", { name: /join/i }).click();
      await expect(bob.getByText(/Phase: WRITE/i)).toBeVisible();

      await alice.getByRole("button", { name: /advance to next phase/i }).click();
      await expect(alice.getByText(/Phase: ORGANISE/i)).toBeVisible({ timeout: 5000 });
      await expect(bob.getByText(/Phase: ORGANISE/i)).toBeVisible({ timeout: 5000 });

      await expect(alice.getByRole("dialog", { name: /move item/i })).toHaveCount(0);
      const stateBefore = await alice.evaluate(async (id) => {
        const response = await fetch(`/api/rooms/${id}`);
        return response.json();
      }, roomId) as { columns: { id: string; name: string }[]; items: { id: string; text: string; columnId: string | null; order: number }[]; version: number };
      const stopColumnId = stateBefore.columns.find((column) => column.name === "Stop")!.id;

      await dragItemToDropZone(alice, "Drag A", stopColumnId, 0);
      await expect(bob.locator(`[data-drop-list="${stopColumnId}"]`, { hasText: "Drag A" })).toBeVisible({ timeout: 5000 });

      await dragItemToDropZone(alice, "Drag B", stopColumnId, 0);
      await expect(bob.locator(`[data-drop-list="${stopColumnId}"] [data-drag-item-id]`).first()).toContainText("Drag B", { timeout: 5000 });

      const stateAfterMoves = await alice.evaluate(async (id) => {
        const response = await fetch(`/api/rooms/${id}`);
        return response.json();
      }, roomId) as { items: { id: string; text: string; columnId: string | null; order: number }[]; version: number };
      expect(stateAfterMoves.version).toBeGreaterThan(stateBefore.version);
      expect(stateAfterMoves.items.filter((item) => item.columnId === stopColumnId).sort((a, b) => a.order - b.order).map((item) => item.text)).toEqual(["Drag B", "Drag A"]);
      expect(stateAfterMoves.items.find((item) => item.text === "Drag A")?.id).toBe(stateBefore.items.find((item) => item.text === "Drag A")?.id);

      const itemC = alice.locator("[data-drag-item-id]", { hasText: "Drag C" }).first();
      const itemCHandle = itemC.getByRole("button", { name: /drag Drag C/i });
      const itemCBox = await itemCHandle.boundingBox();
      expect(itemCBox).not.toBeNull();
      await itemCHandle.dispatchEvent("pointerdown", {
        pointerId: 5,
        pointerType: "mouse",
        button: 0,
        clientX: itemCBox!.x + itemCBox!.width / 2,
        clientY: itemCBox!.y + itemCBox!.height / 2,
      });
      await expect(alice.locator("[data-drop-zone='true']").first()).toBeVisible();
      await alice.keyboard.press("Escape");
      await expect(alice.locator("[data-drop-zone='true']").first()).not.toBeVisible();

      const stateAfterCancel = await alice.evaluate(async (id) => {
        const response = await fetch(`/api/rooms/${id}`);
        return response.json();
      }, roomId) as { items: { text: string; columnId: string | null; order: number }[]; version: number };
      expect(stateAfterCancel).toEqual(stateAfterMoves);

      await ctx1.close();
      await ctx2.close();
    });

    test("touch drag works in a scrollable organise container", async ({ browser }) => {
      const ctx = await browser.newContext({
        hasTouch: true,
        isMobile: true,
        viewport: { width: 390, height: 844 },
      });
      const page = await ctx.newPage();
      await page.goto("/");
      await page.getByRole("button", { name: /create room/i }).click();
      await page.waitForURL(/\/room\//);
      const roomId = new URL(page.url()).pathname.split("/").pop()!;
      await page.getByLabel(/display name/i).fill("Alice");
      await page.getByRole("button", { name: /join/i }).click();
      await expect(page.getByText(/Phase: WRITE/i)).toBeVisible();

      for (const text of ["Touch A", "Touch B", "Touch C", "Touch D", "Touch E"]) {
        await page.getByPlaceholder(/add a retro item/i).fill(text);
        await page.getByRole("button", { name: /add item/i }).click();
        await expect(page.getByText(text)).toBeVisible();
      }

      await page.getByRole("button", { name: /advance to next phase/i }).click();
      await expect(page.getByText(/Phase: ORGANISE/i)).toBeVisible({ timeout: 5000 });
      const stateBefore = await page.evaluate(async (id) => {
        const response = await fetch(`/api/rooms/${id}`);
        return response.json();
      }, roomId) as { columns: { id: string; name: string }[]; version: number };
      const continueColumnId = stateBefore.columns.find((column) => column.name === "Continue")!.id;

      await page.locator(`[data-drop-list="${continueColumnId}"]`).scrollIntoViewIfNeeded();
      await touchDragItemToDropZone(page, "Touch E", continueColumnId, 0);

      const stateAfter = await page.evaluate(async (id) => {
        const response = await fetch(`/api/rooms/${id}`);
        return response.json();
      }, roomId) as { items: { text: string; columnId: string | null; order: number }[]; version: number };
      expect(stateAfter.version).toBeGreaterThan(stateBefore.version);
      expect(stateAfter.items.find((item) => item.text === "Touch E")?.columnId).toBe(continueColumnId);

      await ctx.close();
    });

    test("mobile repeated controls meet touch target baseline", async ({ browser }) => {
      const ctx = await browser.newContext({
        hasTouch: true,
        isMobile: true,
        viewport: { width: 390, height: 844 },
      });
      const page = await ctx.newPage();
      await page.goto("/");
      await page.getByRole("button", { name: /create room/i }).click();
      await page.waitForURL(/\/room\//);
      await page.getByLabel(/display name/i).fill("Alice");
      await page.getByRole("button", { name: /join/i }).click();
      await expect(page.getByText(/Phase: WRITE/i)).toBeVisible();

      await page.getByPlaceholder(/add a retro item/i).fill("Touch target item");
      await page.getByRole("button", { name: /add item/i }).click();
      await page.getByRole("button", { name: /advance to next phase/i }).click();
      await expect(page.getByText(/Phase: ORGANISE/i)).toBeVisible({ timeout: 5000 });

      const controls = [
        page.getByRole("button", { name: /drag Touch target item/i }).first(),
        page.getByRole("button", { name: /create group \/ column/i }),
        page.getByRole("button", { name: /advance to next phase/i }),
      ];

      for (const control of controls) {
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }

      await ctx.close();
    });

    test("full two-user retro flow through all phases", async ({ browser }) => {
      // Create room as Alice (facilitator)
      const ctx1 = await browser.newContext();
      const alice = await ctx1.newPage();
      await alice.goto("/");
      await alice.getByRole("button", { name: /create room/i }).click();
      await alice.waitForURL(/\/room\//);
      const roomUrl = alice.url();

      await alice.getByLabel(/display name/i).fill("Alice");
      await alice.getByRole("button", { name: /join/i }).click();
      await expect(alice.getByText(/Phase: WRITE/i)).toBeVisible();

      // Bob joins
      const ctx2 = await browser.newContext();
      const bob = await ctx2.newPage();
      await bob.goto(roomUrl);
      await bob.getByLabel(/display name/i).fill("Bob");
      await bob.getByRole("button", { name: /join/i }).click();
      await expect(bob.getByText(/Phase: WRITE/i)).toBeVisible();

      // Both see each other
      await expect(alice.getByText(/Bob/)).toBeVisible({ timeout: 5000 });
      await expect(bob.getByText(/Alice/)).toBeVisible({ timeout: 5000 });

      // === WRITE PHASE ===
      // Alice adds items
      await alice.getByPlaceholder(/add a retro item/i).fill("Improve standups");
      await alice.getByRole("button", { name: /add/i }).click();
      await alice.getByPlaceholder(/add a retro item/i).fill("Better docs");
      await alice.getByRole("button", { name: /add/i }).click();

      // Bob sees the items
      await expect(bob.getByText("Improve standups")).toBeVisible({ timeout: 5000 });
      await expect(bob.getByText("Better docs")).toBeVisible({ timeout: 5000 });

      // Bob adds an item
      await bob.getByPlaceholder(/add a retro item/i).fill("More pair programming");
      await bob.getByRole("button", { name: /add/i }).click();

      // Alice sees Bob's item
      await expect(alice.getByText("More pair programming")).toBeVisible({ timeout: 5000 });

      // === ADVANCE TO ORGANISE ===
      await alice.getByRole("button", { name: /advance to next phase/i }).click();
      await expect(alice.getByText(/Phase: ORGANISE/i)).toBeVisible({ timeout: 5000 });
      await expect(bob.getByText(/Phase: ORGANISE/i)).toBeVisible({ timeout: 5000 });

      // Bob cannot advance phase (no facilitator controls)
      await expect(bob.getByRole("button", { name: /advance to next phase/i })).toHaveCount(0);

      // Create a group
      await alice.getByPlaceholder(/new group name/i).fill("Process");
      await alice.getByRole("button", { name: /create group/i }).click();
      await expect(alice.getByText("Process")).toBeVisible();

      // === ADVANCE TO VOTE ===
      await alice.getByRole("button", { name: /advance to next phase/i }).click();
      await expect(alice.getByText(/Phase: VOTE/i)).toBeVisible({ timeout: 5000 });
      await expect(bob.getByText(/Phase: VOTE/i)).toBeVisible({ timeout: 5000 });

      // Both can vote
      const aliceVoteButtons = alice.locator("li button[title='Add a vote']");
      await expect(aliceVoteButtons.first()).toBeVisible({ timeout: 5000 });
      await aliceVoteButtons.first().click();
      await alice.locator("li button[title='Add a vote']").first().click();

      const bobVoteButtons = bob.locator("li button[title='Add a vote']");
      await expect(bobVoteButtons.first()).toBeVisible({ timeout: 5000 });
      await bobVoteButtons.first().click();

      // Wait for vote sync
      await alice.waitForTimeout(2000);

      // Check vote totals are present (the first item should have votes)
      await expect(alice.locator("li", { hasText: /3 votes?/ })).toBeVisible({ timeout: 5000 });

      // === ADVANCE TO REVIEW ===
      await alice.getByRole("button", { name: /advance to next phase/i }).click();
      await expect(alice.getByText(/Phase: REVIEW/i)).toBeVisible({ timeout: 5000 });
      await expect(bob.getByText(/Phase: REVIEW/i)).toBeVisible({ timeout: 5000 });

      // Review shows results
      await expect(alice.getByText(/Results are read-only/i)).toBeVisible();
      await expect(bob.getByText(/Results are read-only/i)).toBeVisible();

      // Items are present in review
      await expect(alice.getByText("Improve standups")).toBeVisible();
      await expect(alice.getByText("Better docs")).toBeVisible();
      await expect(alice.getByText("More pair programming")).toBeVisible();

      await ctx1.close();
      await ctx2.close();
    });

    test("room isolation: separate rooms are independent", async ({ browser }) => {
      // Create Room A
      const ctxA = await browser.newContext();
      const pageA = await ctxA.newPage();
      await pageA.goto("/");
      await pageA.getByRole("button", { name: /create room/i }).click();
      await pageA.waitForURL(/\/room\//);
      const roomAUrl = pageA.url();
      await pageA.getByLabel(/display name/i).fill("Alice");
      await pageA.getByRole("button", { name: /join/i }).click();
      await expect(pageA.getByText(/Phase: WRITE/i)).toBeVisible();

      // Create Room B
      const ctxB = await browser.newContext();
      const pageB = await ctxB.newPage();
      await pageB.goto("/");
      await pageB.getByRole("button", { name: /create room/i }).click();
      await pageB.waitForURL(/\/room\//);
      const roomBUrl = pageB.url();
      await pageB.getByLabel(/display name/i).fill("Bob");
      await pageB.getByRole("button", { name: /join/i }).click();
      await expect(pageB.getByText(/Phase: WRITE/i)).toBeVisible();

      // Room URLs should be different
      expect(roomAUrl).not.toBe(roomBUrl);

      // Add item in Room A
      await pageA.getByPlaceholder(/add a retro item/i).fill("Room A item");
      await pageA.getByRole("button", { name: /add/i }).click();

      // Room B should not see Room A's item
      await expect(pageB.getByText("Room A item")).not.toBeVisible({ timeout: 3000 });

      // Add item in Room B
      await pageB.getByPlaceholder(/add a retro item/i).fill("Room B item");
      await pageB.getByRole("button", { name: /add/i }).click();

      // Room A should not see Room B's item
      await expect(pageA.getByText("Room B item")).not.toBeVisible({ timeout: 3000 });

      await ctxA.close();
      await ctxB.close();
    });

    test("refresh preserves room state in each phase", async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto("/");
      await page.getByRole("button", { name: /create room/i }).click();
      await page.waitForURL(/\/room\//);
      await page.getByLabel(/display name/i).fill("Alice");
      await page.getByRole("button", { name: /join/i }).click();
      await expect(page.getByText(/Phase: WRITE/i)).toBeVisible();

      // Add an item
      await page.getByPlaceholder(/add a retro item/i).fill("Persisted item");
      await page.getByRole("button", { name: /add/i }).click();
      await expect(page.getByText("Persisted item")).toBeVisible();

      // Refresh in WRITE phase
      await page.reload();
      await expect(page.getByText("Persisted item")).toBeVisible({ timeout: 5000 });
      await expect(page.getByText(/Phase: WRITE/i)).toBeVisible();

      // Advance to ORGANISE phase
      await page.getByRole("button", { name: /advance to next phase/i }).click();
      await expect(page.getByText(/Phase: ORGANISE/i)).toBeVisible({ timeout: 5000 });

      // Add a group
      await page.getByPlaceholder(/new group name/i).fill("My Group");
      await page.getByRole("button", { name: /create group/i }).click();
      await expect(page.getByText("My Group")).toBeVisible();

      // Refresh in ORGANISE phase
      await page.reload();
      await expect(page.getByText("Persisted item")).toBeVisible({ timeout: 5000 });
      await expect(page.getByText(/Phase: ORGANISE/i)).toBeVisible({ timeout: 5000 });
      await expect(page.getByText("My Group")).toBeVisible({ timeout: 5000 });

      // Advance to VOTE phase
      await page.getByRole("button", { name: /advance to next phase/i }).click();
      await expect(page.getByText(/Phase: VOTE/i)).toBeVisible({ timeout: 5000 });

      // Refresh in VOTE phase
      await page.reload();
      await expect(page.getByText("Persisted item")).toBeVisible({ timeout: 5000 });
      await expect(page.getByText(/Phase: VOTE/i)).toBeVisible({ timeout: 5000 });

      // Advance to REVIEW phase
      await page.getByRole("button", { name: /advance to next phase/i }).click();
      await expect(page.getByText(/Phase: REVIEW/i)).toBeVisible({ timeout: 5000 });

      // Refresh in REVIEW phase
      await page.reload();
      await expect(page.getByText("Persisted item")).toBeVisible({ timeout: 5000 });
      await expect(page.getByText(/Phase: REVIEW/i)).toBeVisible({ timeout: 5000 });
      await expect(page.getByText(/Results are read-only/i)).toBeVisible();

      await ctx.close();
    });

    test("facilitator phase advance after reload updates UI without relying on WebSocket broadcast", async ({ browser }) => {
      // This tests the fix for VAL-CROSS-002: after reload, a successful facilitator
      // phase advance can leave the UI stuck on stale WRITE state if the WebSocket
      // broadcast is missed during reconnect. The fix refetches authoritative room
      // state after a successful HTTP phase mutation.
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto("/");
      await page.getByRole("button", { name: /create room/i }).click();
      await page.waitForURL(/\/room\//);
      await page.getByLabel(/display name/i).fill("Alice");
      await page.getByRole("button", { name: /join/i }).click();
      await expect(page.getByText(/Phase: WRITE/i)).toBeVisible();

      // Add an item so there's something to see
      await page.getByPlaceholder(/add a retro item/i).fill("Item before reload");
      await page.getByRole("button", { name: /add/i }).click();
      await expect(page.getByText("Item before reload")).toBeVisible();

      // Reload as the facilitator to simulate post-reload state
      await page.reload();
      await expect(page.getByText(/Phase: WRITE/i)).toBeVisible({ timeout: 5000 });
      await expect(page.getByText("Item before reload")).toBeVisible({ timeout: 5000 });

      // Advance phase — should update UI even if WebSocket broadcast is missed
      await page.getByRole("button", { name: /advance to next phase/i }).click();
      await expect(page.getByText(/Phase: ORGANISE/i)).toBeVisible({ timeout: 5000 });

      // Verify we are actually in organise (group creation is visible)
      await expect(page.getByPlaceholder(/new group name/i)).toBeVisible({ timeout: 3000 });

      await ctx.close();
    });

    test("late join reconstructs state in each phase", async ({ browser }) => {
      // Alice creates room and advances through phases
      const ctx1 = await browser.newContext();
      const alice = await ctx1.newPage();
      await alice.goto("/");
      await alice.getByRole("button", { name: /create room/i }).click();
      await alice.waitForURL(/\/room\//);
      const roomUrl = alice.url();
      await alice.getByLabel(/display name/i).fill("Alice");
      await alice.getByRole("button", { name: /join/i }).click();
      await expect(alice.getByText(/Phase: WRITE/i)).toBeVisible();

      // Add items
      await alice.getByPlaceholder(/add a retro item/i).fill("Alice's item");
      await alice.getByRole("button", { name: /add/i }).click();
      await expect(alice.getByText("Alice's item")).toBeVisible();

      // Advance to ORGANISE
      await alice.getByRole("button", { name: /advance to next phase/i }).click();
      await expect(alice.getByText(/Phase: ORGANISE/i)).toBeVisible({ timeout: 5000 });

      // Create a group
      await alice.getByPlaceholder(/new group name/i).fill("Late Group");
      await alice.getByRole("button", { name: /create group/i }).click();
      await expect(alice.getByText("Late Group")).toBeVisible();

      // Bob joins late during ORGANISE phase
      const ctx2 = await browser.newContext();
      const bob = await ctx2.newPage();
      await bob.goto(roomUrl);
      await bob.getByLabel(/display name/i).fill("Bob");
      await bob.getByRole("button", { name: /join/i }).click();

      // Bob sees ORGANISE phase and existing items/groups
      await expect(bob.getByText(/Phase: ORGANISE/i)).toBeVisible({ timeout: 5000 });
      await expect(bob.getByText("Alice's item")).toBeVisible({ timeout: 5000 });
      await expect(bob.getByText("Late Group")).toBeVisible({ timeout: 5000 });

      // Advance to VOTE
      await alice.getByRole("button", { name: /advance to next phase/i }).click();
      await expect(alice.getByText(/Phase: VOTE/i)).toBeVisible({ timeout: 5000 });
      await expect(bob.getByText(/Phase: VOTE/i)).toBeVisible({ timeout: 5000 });

      // Carol joins late during VOTE phase
      const ctx3 = await browser.newContext();
      const carol = await ctx3.newPage();
      await carol.goto(roomUrl);
      await carol.getByLabel(/display name/i).fill("Carol");
      await carol.getByRole("button", { name: /join/i }).click();

      // Carol sees VOTE phase and existing items
      await expect(carol.getByText(/Phase: VOTE/i)).toBeVisible({ timeout: 5000 });
      await expect(carol.getByText("Alice's item")).toBeVisible({ timeout: 5000 });

      // Advance to REVIEW
      await alice.getByRole("button", { name: /advance to next phase/i }).click();
      await expect(alice.getByText(/Phase: REVIEW/i)).toBeVisible({ timeout: 5000 });
      await expect(bob.getByText(/Phase: REVIEW/i)).toBeVisible({ timeout: 5000 });
      await expect(carol.getByText(/Phase: REVIEW/i)).toBeVisible({ timeout: 5000 });

      // Dave joins late during REVIEW phase
      const ctx4 = await browser.newContext();
      const dave = await ctx4.newPage();
      await dave.goto(roomUrl);
      await dave.getByLabel(/display name/i).fill("Dave");
      await dave.getByRole("button", { name: /join/i }).click();

      // Dave sees REVIEW phase and results
      await expect(dave.getByText(/Phase: REVIEW/i)).toBeVisible({ timeout: 5000 });
      await expect(dave.getByText("Alice's item")).toBeVisible({ timeout: 5000 });
      await expect(dave.getByText(/Results are read-only/i)).toBeVisible({ timeout: 5000 });

      await ctx1.close();
      await ctx2.close();
      await ctx3.close();
      await ctx4.close();
    });
  });

  test.describe("Phase-specific controls", () => {
    test("write phase shows add item form, other phases do not", async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto("/");
      await page.getByRole("button", { name: /create room/i }).click();
      await page.waitForURL(/\/room\//);
      await page.getByLabel(/display name/i).fill("Alice");
      await page.getByRole("button", { name: /join/i }).click();
      await expect(page.getByText(/Phase: WRITE/i)).toBeVisible();

      // Write phase has add item form
      await expect(page.getByPlaceholder(/add a retro item/i)).toBeVisible();

      // Advance to organise
      await page.getByRole("button", { name: /advance to next phase/i }).click();
      await expect(page.getByText(/Phase: ORGANISE/i)).toBeVisible({ timeout: 5000 });

      // Organise phase should not have add item form
      await expect(page.getByPlaceholder(/add a retro item/i)).not.toBeVisible();

      // Advance to vote
      await page.getByRole("button", { name: /advance to next phase/i }).click();
      await expect(page.getByText(/Phase: VOTE/i)).toBeVisible({ timeout: 5000 });

      // Vote phase should not have add item form
      await expect(page.getByPlaceholder(/add a retro item/i)).not.toBeVisible();

      // Advance to review
      await page.getByRole("button", { name: /advance to next phase/i }).click();
      await expect(page.getByText(/Phase: REVIEW/i)).toBeVisible({ timeout: 5000 });

      // Review phase should not have add item form
      await expect(page.getByPlaceholder(/add a retro item/i)).not.toBeVisible();

      await ctx.close();
    });
  });
});
