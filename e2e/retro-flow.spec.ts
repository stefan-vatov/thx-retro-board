import { test, expect, type Page } from "@playwright/test";

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
  });

  test.describe("Two-user flow", () => {
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

      // Refresh
      await page.reload();
      await expect(page.getByText("Persisted item")).toBeVisible({ timeout: 5000 });
      await expect(page.getByText(/Phase: WRITE/i)).toBeVisible();

      await ctx.close();
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
