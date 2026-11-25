import { test, expect } from "@playwright/test";
import { openDisplayMenu, openInspector, openScenarioPicker } from "../support/twin";
// Plan 03 A05: against the pinned source runtime through the launcher (scripts/test-mock-e2e.mjs arm-simulation.spec.ts). The mock run shows the
// arm as a commanded-only trace with provenance; the simulation preset is refused by preflight with the runtime's reason. Nothing here moves a
// real arm and the mock joint animation never completes a pickup by itself (custody rows come from the source journal).
const token = process.env.LAB_TEST_PAIRING_TOKEN;
test("arm telemetry and ARM03 rows are honest in the mock run; the simulation set is unavailable with a reason", async ({ page }) => {
  test.skip(!token, "Run scripts/test-mock-e2e.mjs arm-simulation.spec.ts: it starts the pinned source runtime and supplies its one-time token.");
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#twin");
  await page.locator("#twin-pair-token").fill(token!);
  await page.getByRole("button", { name: "Ghép nối runtime" }).click();
  await openScenarioPicker(page);
  await page.getByRole("button", { name: "Cà phê sữa đá" }).click();
  await page.getByRole("button", { name: "Chạy mock" }).click();
  await expect(page.getByTestId("mode-badge")).toContainText("MOCK");
  await expect(page.getByTestId("run-status")).not.toContainText("Sẵn sàng", { timeout: 60000 });
  await openDisplayMenu(page);
  await page.getByRole("button", { name: "2D", exact: true }).click();
  await openInspector(page, "objects");
  await page.getByTestId("entity-list").getByText("Cánh tay 1").click();
  await expect(page.getByTestId("inspector-title")).toContainText("arm-1");
  const inspector = page.locator("#twin-inspector");
  await expect(inspector).toContainText("q1");
  await expect(inspector).toContainText("mock");                 // commanded-only provenance, never an encoder claim
  await expect(inspector).toContainText("ARM03");
  const arm03 = await inspector.locator('[data-testid^="eng-"]', { hasText: "ARM03" }) /* one block per quantity (U07) */.first().textContent();
  expect(arm03).toMatch(/đạt|không đạt|chưa chạy/);             // a result or an explicit not-run, never blank
  const cupOwner = page.getByTestId("cup-owner");
  await expect(cupOwner).toHaveText(/Trạm cà phê|Cánh tay 1|AMR-1|Khách/);
  await expect(page.locator("#twin-inspector")).toContainText("capsule-sweep-v1"); // the checker named in the row, never a picture
});
