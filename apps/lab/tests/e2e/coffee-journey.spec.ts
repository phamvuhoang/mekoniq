import { test, expect } from "@playwright/test";
import runtimeLock from "../../config/source-runtime.lock.json" with { type: "json" };
import { openDisplayMenu, openInspector, openProblems, openScenarioPicker } from "../support/twin";
// Against the real pinned source runtime (scripts/test-mock-e2e.mjs). The runtime latches attention for the life of a run, so the
// correction after a missing cup is: reconcile the affected job (human confirmation), then a new run with the same locked inputs.
const token = process.env.LAB_TEST_PAIRING_TOKEN;
const shots = process.env.LAB_EVIDENCE_DIR;
test("missing cup: visible reason and entity, confirmed reconcile, corrected run completes", async ({ page }) => {
  test.skip(!token, "Run scripts/test-mock-e2e.mjs: it starts the pinned source runtime via the launcher and supplies its one-time token.");
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#twin");
  await page.locator("#twin-pair-token").fill(token!);
  await page.getByRole("button", { name: "Ghép nối runtime" }).click();
  await openScenarioPicker(page);
  await page.getByRole("button", { name: "Cà phê sữa đá" }).click();
  await page.getByRole("button", { name: "Chạy mock" }).click();
  await expect(page.getByTestId("mode-badge")).toContainText("MOCK");
  await expect(page.getByTestId("run-identity")).toContainText(`source ${runtimeLock.sourceCommit.slice(0,7)}`);
  await expect(page.getByTestId("cup-owner")).toHaveText("Trạm cà phê");
  const firstRun = await page.getByTestId("run-id").textContent();
  // the cup is under the nozzle while brewing: remove it
  await openInspector(page, "engineering");
  await page.locator("#twin-fault").selectOption("cup-removed");
  await page.getByRole("button", { name: "Chèn lỗi" }).click();
  await expect(page.getByTestId("run-status")).toContainText("Cần kiểm tra");
  await openProblems(page);
  const reason = page.getByTestId("attention-reason");
  await expect(reason).toContainText("CUP_REMOVED");
  await expect(reason).toContainText("cốc");
  await expect(page.getByTestId("next-action")).toContainText("đối soát");
  await expect(page.getByTestId("primary-action")).toHaveText("Đối soát");
  await openProblems(page); // the attention chain and its entity links live in the problems box (U02)
  await page.getByTestId("attention-entity").first().click();
  await expect(page.getByTestId("inspector-title")).toContainText("coffee-job-1");
  await openDisplayMenu(page);
  await page.getByRole("button", { name: "2D", exact: true }).click(); // the plan is DOM; the 3D canvas is not inspectable
  await expect(page.getByTestId("twin-scene").locator('[data-entity="coffee-job-1"][data-selected="true"]')).toHaveCount(1);
  await openInspector(page, "objects"); // the cycle queue lives in the Objects tab
  await expect(page.getByTestId("cycle-queue")).toContainText("CUP_REMOVED");
  if (shots) await page.screenshot({ path: `${shots}/F05-missing-cup-desktop-vi.png`, fullPage: true });
  // reconcile needs an explicit human confirmation; cancelling the dialog changes nothing
  await page.getByTestId("primary-action").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("coffee-job-1");
  await dialog.getByRole("button", { name: "Hủy" }).click();
  await expect(page.getByTestId("cycle-queue")).not.toContainText("Đã cách ly");
  await page.getByTestId("primary-action").click();
  await dialog.getByRole("button", { name: "Xác nhận đã kiểm tra" }).click();
  await expect(page.getByTestId("cycle-queue")).toContainText("Đã cách ly");
  // the run itself stays in attention: it is not relabelled completed
  await expect(page.getByTestId("run-status")).toContainText("Cần kiểm tra");
  await page.getByRole("button", { name: "Chạy lại cùng đầu vào" }).click();
  await expect(page.getByTestId("run-id")).not.toHaveText(firstRun!);
  await expect(page.getByTestId("run-identity")).toContainText("seed 42");
  await page.getByRole("button", { name: "Tự chạy" }).click();
  await expect(page.getByTestId("run-status")).toContainText("Hoàn thành", { timeout: 150000 });
  await expect(page.getByTestId("run-served")).toContainText("2");
  await expect(page.getByTestId("cup-owner")).toHaveText("T01");
  if (shots) await page.screenshot({ path: `${shots}/F05-coffee-completed-desktop-vi.png`, fullPage: true });
});
