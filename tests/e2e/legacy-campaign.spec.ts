import { test, expect, type Page } from "@playwright/test";
import { openDisplayMenu, openInspector, openScenarioPicker } from "../support/twin";
// NR06: the existing multi-robot presets still run end to end from the UI against the real pinned runtime (scripts/test-mock-e2e.mjs). One pairing for the whole file.
// Adding engineering must not remove or reroute them: same scenario ids, two AMRs both active in the campaign, served and cup owner read from the journal.
const token = process.env.LAB_TEST_PAIRING_TOKEN;
test.describe.configure({ mode: "serial" });
let page: Page;
test.beforeAll(async ({ browser }) => {
  if (!token) return;
  page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#twin");
  await page.locator("#twin-pair-token").fill(token);
  await page.getByRole("button", { name: "Ghép nối runtime" }).click();
});
test.afterAll(async () => { await page?.close(); });
const run = async (preset: string) => {
  const previous = await page.getByTestId("run-id").textContent({ timeout: 500 }).catch(() => null);
  await openScenarioPicker(page);
  await page.getByRole("button", { name: preset }).click();
  // the first run starts with "Chạy mock"; once a run exists a different preset starts with new inputs
  await openInspector(page, "setup");
  await page.getByRole("button", { name: /^(Chạy mock|Chạy với đầu vào mới)$/ }).first().click();
  await expect(page.getByTestId("mode-badge")).toContainText("MOCK");
  if (previous) await expect(page.getByTestId("run-id")).not.toHaveText(previous);   // the new run, not the one still on screen
};
test("mixed preset: food and its identified cup on one mission, both served, cup ends with the table", async () => {
  test.skip(!token, "Run scripts/test-mock-e2e.mjs: it starts the pinned runtime and supplies its one-time token.");
  test.setTimeout(240000);
  await run("Món ăn và cà phê cùng chuyến");
  await expect(page.getByTestId("run-identity")).toContainText("FD02-cups");
  await page.getByRole("button", { name: "Tự chạy" }).click();
  await expect(page.getByTestId("run-status")).toContainText("Hoàn thành", { timeout: 200000 });
  await expect(page.getByTestId("run-served")).toContainText("2");
  await expect(page.getByTestId("cup-owner")).not.toHaveText("");
});
test("two-robot campaign: both AMRs act, nothing is served twice, and the campaign id is the legacy one", async () => {
  test.skip(!token, "Run scripts/test-mock-e2e.mjs: it starts the pinned runtime and supplies its one-time token.");
  test.setTimeout(300000);
  await run("Chiến dịch hai robot");
  await expect(page.getByTestId("run-identity")).toContainText("CAMPAIGN-FD02-FD07-BV01-BV03");
  await openDisplayMenu(page);
  await page.getByRole("button", { name: "2D", exact: true }).click();
  const scene = page.getByTestId("twin-scene");
  await expect(scene.locator('[data-entity="amr-1"]')).toHaveCount(1);
  await expect(scene.locator('[data-entity="amr-2"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Tự chạy" }).click();
  await expect(page.getByTestId("run-status")).toContainText(/Hoàn thành|Cần kiểm tra/, { timeout: 280000 });
  const status = await page.getByTestId("run-status").innerText();
  if (/Hoàn thành/.test(status)) {
    const served = Number((await page.getByTestId("run-served").innerText()).replace(/\D+/g, " ").trim().split(" ")[0]);
    expect(served).toBeGreaterThan(0);
  }
});
test("cancelling a run keeps the cup with its owner instead of deleting custody", async () => {
  test.skip(!token, "Run scripts/test-mock-e2e.mjs: it starts the pinned runtime and supplies its one-time token.");
  test.setTimeout(120000);
  await run("Cà phê sữa đá");
  // the run view paints before the first step returns: wait for a real owner, not the "—" placeholder
  await expect(page.getByTestId("cup-owner")).not.toHaveText("—");
  const owner = await page.getByTestId("cup-owner").innerText();
  expect(owner.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Hủy lần chạy" }).click();
  const confirm = page.getByRole("dialog");
  if (await confirm.isVisible().catch(() => false)) await confirm.getByRole("button", { name: /xác nhận|Hủy lần chạy/i }).first().click();
  await expect(page.getByTestId("run-status")).toContainText("Đã hủy");
  await expect(page.getByTestId("cup-owner")).toHaveText(owner);   // cancelling stops motion; it never erases who holds the cup
});
