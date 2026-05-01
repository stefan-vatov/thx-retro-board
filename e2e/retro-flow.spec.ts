import { test, expect, type Page } from "@playwright/test";

const createRoomButton = /start a retro/i;

async function expectPhase(page: Page, phase: string) {
  await expect(page.locator(".phase-status__value")).toHaveText(new RegExp(`^${phase}$`, "i"), { timeout: 5_000 });
}

async function createJoinedRoom(page: Page, displayName = "Alice") {
  await page.goto("/");
  await page.getByRole("button", { name: createRoomButton }).click();
  await page.waitForURL(/\/room\//);
  await page.getByLabel(/display name/i).fill(displayName);
  await page.getByRole("button", { name: /^join room$/i }).click();
  await expect(page.getByText(/Set up the board/i)).toBeVisible({ timeout: 5_000 });
  await expectPhase(page, "Setup");
  return new URL(page.url()).pathname.split("/").pop()!;
}

async function advanceTo(page: Page, phase: "Write" | "Organise" | "Vote" | "Review" | "Finalize") {
  await page.getByRole("button", { name: new RegExp(`advance to ${phase}`, "i") }).click();
  await expectPhase(page, phase);
}

async function addItem(page: Page, text: string, column = "Mad") {
  const composer = page.getByRole("form", { name: new RegExp(`add card to ${column}`, "i") });
  const input = composer.getByLabel(new RegExp(`add a card to ${column}`, "i"));
  await input.fill(text);
  await input.press("ControlOrMeta+Enter");
  await expect(page.getByLabel(new RegExp(`${column} items`, "i")).getByText(text)).toBeVisible({ timeout: 5_000 });
}

async function expectFocused(locator: ReturnType<Page["locator"]>) {
  await expect.poll(async () => locator.evaluate((element) => element === document.activeElement)).toBe(true);
}

async function chooseVisiblePairwiseOption(page: Page) {
  await page.locator(".pairwise-option").first().click();
}

test.describe("Retro Board current flow", () => {
  test("home page creates a room and shows setup", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /run better team retros/i })).toBeVisible();
    await page.getByRole("button", { name: createRoomButton }).click();
    await page.waitForURL(/\/room\//);
    await page.getByLabel(/display name/i).fill("Alice");
    await page.getByRole("button", { name: /^join room$/i }).click();
    await expect(page.getByText(/Set up the board/i)).toBeVisible();
    await expect(page.getByRole("radio", { name: /Score voting/i })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText(/Mad/i)).toBeVisible();
    await expect(page.getByText(/Glad/i)).toBeVisible();
    await expect(page.getByText(/Sad/i)).toBeVisible();
  });

  test("setup cannot advance with zero columns", async ({ page }) => {
    await createJoinedRoom(page, "Setup QA");

    for (const column of ["Mad", "Glad", "Sad"]) {
      await page.getByRole("button", { name: new RegExp(`delete ${column} column`, "i") }).click();
      await expect(page.locator(".column-config__count")).toContainText(/\d\/8/);
    }

    await expect(page.locator(".column-config__count")).toContainText("0/8");
    await page.getByRole("button", { name: /advance to write/i }).click();
    await expectPhase(page, "Setup");
    await expect(page.getByText(/Add at least one column before starting write phase/i)).toBeVisible();
  });

  test("score voting locks vote budget after setup and completes export flow", async ({ page }) => {
    const roomId = await createJoinedRoom(page, "Score QA");
    await page.getByLabel(/vote budget/i).fill("3");
    await page.getByRole("button", { name: /^set$/i }).click();
    await expect(page.getByText(/Vote budget updated/i)).toBeVisible();

    await advanceTo(page, "Write");
    await expect(page.getByLabel(/vote budget/i)).toHaveCount(0);
    await addItem(page, "Score target");

    const lockedBudget = await page.evaluate(async (id) => {
      const participantId = localStorage.getItem(`retro-participant-${id}`);
      const response = await fetch(`/api/rooms/${id}/vote-budget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId, budget: 1 }),
      });
      return response.json();
    }, roomId) as { success: boolean; error?: string };
    expect(lockedBudget).toMatchObject({ success: false, error: "Vote budget can only be changed during setup" });

    await advanceTo(page, "Organise");
    await advanceTo(page, "Vote");
    await page.getByRole("button", { name: /add a vote to Score target/i }).click();
    await expect(page.getByText(/1 used \/ 3 total/i)).toBeVisible();
    await advanceTo(page, "Review");
    await expect(page.getByText(/Score target/i)).toBeVisible();
    await advanceTo(page, "Finalize");
    await expect(page.getByText(/Export this retro/i)).toBeVisible();
    await expect(page.getByText(/Actions preview/i)).toBeVisible();
  });

  test("pairwise ranking compares decision targets across the whole board", async ({ page }) => {
    await createJoinedRoom(page, "Pairwise QA");
    await page.getByRole("radio", { name: /Pairwise ranking/i }).click();
    await expect(page.getByRole("radio", { name: /Pairwise ranking/i })).toHaveAttribute("aria-checked", "true");

    await advanceTo(page, "Write");
    await addItem(page, "Mad target one", "Mad");
    await addItem(page, "Mad target two", "Mad");
    await addItem(page, "Glad target", "Glad");
    await addItem(page, "Sad target", "Sad");
    await advanceTo(page, "Organise");
    await advanceTo(page, "Vote");

    await expect(page.getByText(/0 of 6 comparisons complete/i)).toBeVisible();
    await expect(page.getByText(/0\/6 global pairs/i)).toBeVisible();
    await expect(page.locator(".pairwise-breakdown__item", { hasText: "Mad" })).toContainText("2 targets");
    await expect(page.locator(".pairwise-breakdown__item", { hasText: "Glad" })).toContainText("1 target");
    await chooseVisiblePairwiseOption(page);
    await expect(page.getByText(/1 of 6 comparisons complete/i)).toBeVisible();
    await chooseVisiblePairwiseOption(page);
    await expect(page.getByText(/2 of 6 comparisons complete/i)).toBeVisible();
    await chooseVisiblePairwiseOption(page);
    await chooseVisiblePairwiseOption(page);
    await chooseVisiblePairwiseOption(page);
    await chooseVisiblePairwiseOption(page);
    await expect(page.getByText(/6 of 6 comparisons complete/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /All comparisons are complete/i })).toBeVisible();
    await expect(page.getByText(/ranked over/i).first()).toBeVisible();
  });

  test("pairwise progress is visible live for each participant", async ({ browser }) => {
    const alice = await browser.newPage();
    await createJoinedRoom(alice, "Alice");
    await alice.getByRole("radio", { name: /Pairwise ranking/i }).click();
    const roomUrl = alice.url();

    const bob = await browser.newPage();
    await bob.goto(roomUrl);
    await bob.getByLabel(/display name/i).fill("Bob");
    await bob.getByRole("button", { name: /^join room$/i }).click();
    await expectPhase(bob, "Setup");

    await advanceTo(alice, "Write");
    await addItem(alice, "First target", "Mad");
    await addItem(alice, "Second target", "Mad");
    await addItem(alice, "Third target", "Mad");
    await advanceTo(alice, "Organise");
    await advanceTo(alice, "Vote");
    await expectPhase(bob, "Vote");

    await expect(alice.getByLabel(/participant ranking progress/i)).toContainText("Alice");
    await expect(alice.getByLabel(/participant ranking progress/i)).toContainText("You");
    await expect(alice.getByLabel(/participant ranking progress/i)).toContainText("Bob");
    await chooseVisiblePairwiseOption(alice);
    await expect(bob.getByLabel(/participant ranking progress/i)).toContainText("Alice");
    await expect(bob.getByLabel(/participant ranking progress/i)).toContainText("1/3", { timeout: 5_000 });

    await chooseVisiblePairwiseOption(bob);
    await expect(alice.getByLabel(/participant ranking progress/i)).toContainText("Bob");
    await expect(alice.getByLabel(/participant ranking progress/i)).toContainText("1/3", { timeout: 5_000 });

    await alice.close();
    await bob.close();
  });

  test("two participants see live phase and item updates", async ({ browser }) => {
    const alice = await browser.newPage();
    await createJoinedRoom(alice, "Alice");
    const roomUrl = alice.url();

    const bob = await browser.newPage();
    await bob.goto(roomUrl);
    await bob.getByLabel(/display name/i).fill("Bob");
    await bob.getByRole("button", { name: /^join room$/i }).click();
    await expectPhase(bob, "Setup");

    await advanceTo(alice, "Write");
    await expectPhase(bob, "Write");
    await addItem(bob, "Bob feedback");
    await expect(alice.getByText(/Bob feedback/i)).toBeVisible({ timeout: 5_000 });

    await alice.close();
    await bob.close();
  });

  test("keyboard submits keep focus in card and group inputs", async ({ page }) => {
    await createJoinedRoom(page, "Focus QA");
    await advanceTo(page, "Write");

    const madComposer = page.getByRole("form", { name: /add card to Mad/i });
    const madInput = madComposer.getByLabel(/add a card to Mad/i);
    await madInput.fill("Focused card");
    await madInput.press("ControlOrMeta+Enter");
    await expect(page.getByLabel(/Mad items/i).getByText("Focused card")).toBeVisible({ timeout: 5_000 });
    await expect(madInput).toHaveValue("");
    await expectFocused(madInput);

    await advanceTo(page, "Organise");
    const groupInput = page.getByLabel(/new group name for Mad/i);
    await groupInput.fill("Focused group");
    await groupInput.press("ControlOrMeta+Enter");
    await expect(page.getByText("Focused group")).toBeVisible({ timeout: 5_000 });
    await expect(groupInput).toHaveValue("");
    await expectFocused(groupInput);
  });

  test("card reactions sync live between participants", async ({ browser }) => {
    const alice = await browser.newPage();
    await createJoinedRoom(alice, "Alice");
    const roomUrl = alice.url();
    await advanceTo(alice, "Write");
    await addItem(alice, "Reactable card");

    const bob = await browser.newPage();
    await bob.goto(roomUrl);
    await bob.getByLabel(/display name/i).fill("Bob");
    await bob.getByRole("button", { name: /^join room$/i }).click();
    await expectPhase(bob, "Write");
    await expect(bob.getByText("Reactable card")).toBeVisible({ timeout: 5_000 });

    const aliceReactions = alice.getByLabel(/Reactions for Reactable card/i).first();
    const bobReactions = bob.getByLabel(/Reactions for Reactable card/i).first();

    await aliceReactions.getByRole("button", { name: /add reaction for Reactable card/i }).click();
    await alice.locator("emoji-picker").locator('button[aria-label*="thumbs up"]').first().click();
    await expect(bobReactions).toContainText("1", { timeout: 5_000 });

    await bobReactions.getByRole("button", { name: /add reaction for Reactable card/i }).click();
    await bob.locator("emoji-picker").locator('button[aria-label*="thumbs up"]').first().click();
    await expect(aliceReactions).toContainText("2", { timeout: 5_000 });

    await aliceReactions.locator(".reaction-pill").first().click();
    await expect(bobReactions).toContainText("1", { timeout: 5_000 });

    await alice.close();
    await bob.close();
  });

  test("write cards can be edited and deleted only by their author", async ({ browser }) => {
    const alice = await browser.newPage();
    await createJoinedRoom(alice, "Alice");
    const roomUrl = alice.url();
    await advanceTo(alice, "Write");
    await addItem(alice, "Alice owned card");

    const bob = await browser.newPage();
    await bob.goto(roomUrl);
    await bob.getByLabel(/display name/i).fill("Bob");
    await bob.getByRole("button", { name: /^join room$/i }).click();
    await expectPhase(bob, "Write");
    await addItem(bob, "Bob owned card");
    await expect(alice.getByLabel(/Mad items/i).getByText("Bob owned card")).toBeVisible();

    const bobCardForAlice = alice.locator(".item-card", { hasText: "Bob owned card" });
    await expect(bobCardForAlice.getByRole("button", { name: /edit/i })).toHaveCount(0);
    await expect(bobCardForAlice.getByRole("button", { name: /delete/i })).toHaveCount(0);

    const aliceCard = alice.locator(".item-card", { hasText: "Alice owned card" });
    await aliceCard.getByRole("button", { name: /edit/i }).click();
    await alice.getByLabel(/edit card/i).fill("Alice edited card");
    await alice.getByRole("button", { name: /^save$/i }).click();
    await expect(alice.getByLabel(/Mad items/i).getByText("Alice edited card")).toBeVisible();

    const editedCard = alice.locator(".item-card", { hasText: "Alice edited card" });
    await editedCard.getByRole("button", { name: /delete/i }).click();
    await expect(alice.getByLabel(/Mad items/i).getByText("Alice edited card")).toHaveCount(0);
    await expect(bob.getByLabel(/Mad items/i).getByText("Alice edited card")).toHaveCount(0);

    await alice.close();
    await bob.close();
  });

  test("invite copy fallback does not expose credentials", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error("denied")) },
      });
    });
    await createJoinedRoom(page, "Invite QA");
    await page.getByRole("button", { name: /copy room invite link/i }).click();
    const manualUrl = page.getByLabel(/room invite url/i);
    await expect(manualUrl).toBeVisible();
    await expect(manualUrl).toHaveValue(/\/room\/[A-Z0-9_-]+$/i);
    await expect(page.locator("body")).not.toContainText(/token=|pid=|auth-[a-f0-9]{64}/i);
  });
});
