import { test, expect, type Page } from "@playwright/test";
import runtimeLock from "../../config/source-runtime.lock.json" with { type: "json" };
import { openDisplayMenu, openInspector, openScenarioPicker } from "../support/twin";
// Runtime tests drive the real pinned source runtime (scripts/test-mock-e2e.mjs supplies the one-use token); they share one paired page.
const token = process.env.LAB_TEST_PAIRING_TOKEN;
const shots = process.env.LAB_EVIDENCE_DIR;
const shot = async (page: Page, name: string) => { if (shots) await page.screenshot({ path: `${shots}/F05-${name}.png`, fullPage: true }); };
const noWebgl = () => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) { return /webgl/i.test(type) ? null : (get as (...a: unknown[]) => unknown).call(this, type, ...rest); } as typeof get; };

test("WebGL disabled and reduced motion fall back to a 2D twin with the same controls", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.addInitScript(noWebgl);
  await page.goto("/#twin");
  await openScenarioPicker(page);
  await page.getByRole("button", { name: "Cà phê sữa đá" }).click();
  await expect(page.getByTestId("twin-scene").locator("svg")).toHaveCount(1);
  await expect(page.getByTestId("twin-scene").locator("canvas")).toHaveCount(0);
  await expect(page.getByTestId("twin-fallback-note")).toContainText("2D");
  await openDisplayMenu(page);
  await expect(page.getByRole("button", { name: "2D", exact: true })).toHaveAttribute("aria-pressed", "true");
  // no run yet: the badge never claims a mode it is not running
  await expect(page.getByTestId("mode-badge")).not.toContainText("MOCK");
  const legend = page.getByTestId("twin-legend");
  for (const label of ["Mô hình", "Quan sát", "Chưa rõ"]) await expect(legend).toContainText(label);
  const path = page.getByRole("button", { name: "Đường đi" });
  await expect(path).toHaveAttribute("aria-pressed", "true");
  await path.click();
  await expect(path).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  await expect(page.getByRole("button", { name: /e-?stop|dừng khẩn/i })).toHaveCount(0);
  await shot(page, "webgl-disabled-reduced-motion-desktop-vi");
  await context.close();
});

test.describe.serial("paired source runtime", () => {
  test.skip(!token, "Run scripts/test-mock-e2e.mjs: it starts the pinned source runtime via the launcher and supplies its one-time token.");
  test.describe.configure({ timeout: 120000 });
  let page: Page;
  test.beforeAll(async ({ browser }) => { page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); });
  test.afterAll(async () => { await page.close(); });

  test("coffee preset runs on the mock backend with a locked, visible identity", async () => {
    await page.goto("/#twin");
    await page.locator("#twin-pair-token").fill(token!);
    await page.getByRole("button", { name: "Ghép nối runtime" }).click();
    await expect(page.getByTestId("preflight")).toContainText("mock-default");
    await openScenarioPicker(page);
    await page.getByRole("button", { name: "Cà phê sữa đá" }).click();
    await page.getByRole("button", { name: "Chạy mock" }).click();
    await expect(page.getByTestId("mode-badge")).toContainText("MOCK");
    await expect(page.getByTestId("cup-owner")).toHaveText("Trạm cà phê");
    await expect(page.getByTestId("run-identity")).toContainText("mock-default");
    await expect(page.getByTestId("run-identity")).toContainText("BV01");
    await expect(page.getByTestId("run-identity")).toContainText("seed 42");
    await expect(page.getByTestId("run-identity")).toContainText("mock_kinematic");
    await expect(page.getByTestId("run-identity")).toContainText(`source ${runtimeLock.sourceCommit.slice(0,7)}`);
    // a run that is simply running needs no person: its next step is the run bar's primary action, not a viewport strip
    await expect(page.getByTestId("primary-action")).toBeVisible();
    await expect(page.getByTestId("next-action")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /e-?stop|dừng khẩn/i })).toHaveCount(0);
    await shot(page, "coffee-run-desktop-vi");
  });

  test("layers, legend and one shared selection survive a 3D to 2D switch", async () => {
    // contact markers are drawn on the 2D plan only, so the layer toggles are flipped there; 3D disables that toggle with a visible reason
    await openDisplayMenu(page);
    await page.getByRole("button", { name: "2D", exact: true }).click();
    for (const name of ["Vùng chiếm chỗ", "Đường đi", "Tiếp xúc", "Khung tọa độ"]) {
      const toggle = page.getByRole("button", { name, exact: true });
      const before = await toggle.getAttribute("aria-pressed");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
    }
    const contacts = page.getByRole("button", { name: "Tiếp xúc", exact: true });
    const contactsPressed = await contacts.getAttribute("aria-pressed");
    await page.getByRole("button", { name: "Khung tọa độ", exact: true }).click();
    await page.getByRole("button", { name: "3D", exact: true }).click();
    await expect(contacts).toBeDisabled();
    await expect(page.getByTestId("layers-2d-only")).toContainText("2D");
    await openInspector(page, "objects");
    await page.getByTestId("entity-list").getByRole("button", { name: /cup-1/ }).click();
    await expect(page.getByTestId("inspector-title")).toContainText("cup-1");
    // the selection re-rendered the stage: the 3D buffer must follow the new stage size, not a stale/default 640x420
    await page.getByRole("button", { name: "+5 s" }).click();
    await expect.poll(() => page.evaluate(() => { const s = document.getElementById("twin-stage")!, c = s.querySelector("canvas"), r = Math.min(devicePixelRatio, 2); return c ? Math.abs(c.width - Math.round(s.clientWidth * r)) <= 2 && Math.abs(c.height - Math.round(s.clientHeight * r)) <= 2 && s.clientWidth !== 640 : false; })).toBe(true);
    const status = await page.getByTestId("run-status").textContent();
    const tick = await page.getByTestId("run-tick").textContent();
    await openDisplayMenu(page);
    await page.getByRole("button", { name: "2D", exact: true }).click();
    await expect(page.getByTestId("twin-scene").locator('svg [data-entity="cup-1"][data-selected="true"]')).toHaveCount(1);
    await expect(contacts).toBeEnabled();
    await expect(contacts).toHaveAttribute("aria-pressed", contactsPressed!);
    await expect(page.getByTestId("inspector-title")).toContainText("cup-1");
    await expect(page.getByTestId("run-status")).toHaveText(status!);
    await expect(page.getByTestId("run-tick")).toHaveText(tick!);
    // selecting from the scene updates the same inspector and list
    await page.getByTestId("twin-scene").locator('svg [data-entity="amr-1"]').click();
    await expect(page.getByTestId("inspector-title")).toContainText("AMR-1");
    await openInspector(page, "objects");
    await expect(page.getByTestId("entity-list").getByRole("button", { name: /AMR-1/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("engineering panel shows units, observed versus commanded and data age", async () => {
    await page.getByRole("button", { name: "+5 s" }).click();
    await expect(page.getByTestId("run-tick")).toContainText("15.0 s");
    const eng = page.getByTestId("engineering-panel");
    await openInspector(page, "objects");
    await page.getByTestId("entity-list").getByRole("button", { name: /AMR-1/ }).click();
    await openInspector(page, "engineering");
    for (const h of ["Quan sát", "Lệnh", "Tuổi dữ liệu"]) await expect(eng).toContainText(h);
    await expect(eng.getByTestId("eng-pose-x")).toContainText(" m");
    await expect(eng.getByTestId("eng-yaw")).toContainText("rad");
    await openInspector(page, "objects");
    await page.getByTestId("entity-list").getByRole("button", { name: /Cánh tay 1/ }).click();
    await openInspector(page, "engineering");
    // Mock has no observed encoder samples; the commanded angle is a separate value (observed, then commanded: one block per quantity, U07).
    await expect(eng.getByTestId("eng-joint-1").locator("dd").nth(0)).toHaveText("không có");
    await expect(eng.getByTestId("eng-joint-1").locator("dd").nth(1)).toContainText("0.0000");
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "+5 s" }).click();
    await expect(page.getByTestId("run-tick")).toContainText("35.0 s");
    await expect(eng.getByTestId("eng-joint-1")).toContainText("rad");
    await expect(eng.getByTestId("eng-joint-1")).toContainText("ms");
    await openInspector(page, "objects");
    await page.getByTestId("entity-list").getByRole("button", { name: /Trạm cà phê/ }).click();
    await openInspector(page, "engineering");
    await expect(eng.getByTestId("eng-step-brew")).toContainText("mL");
    await expect(eng.getByTestId("eng-cup-sensor")).toBeVisible();
    await shot(page, "engineering-desktop-vi");
    for (const [code, label] of [["JA", "ja"], ["EN", "en"]]) {
      await page.getByRole("button", { name: code, exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", label);
      await expect(page.getByTestId("mode-badge")).toContainText("MOCK");
      await shot(page, `engineering-desktop-${label}`);
    }
    await page.getByRole("button", { name: "VI", exact: true }).click();
  });

  test("mobile layout is operable with the keyboard only", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const step = page.getByRole("button", { name: "+5 s" });
    await step.focus();
    const before = await page.getByTestId("run-tick").textContent();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("run-tick")).not.toHaveText(before!);
    await openDisplayMenu(page);
    const footprint = page.getByRole("button", { name: "Vùng chiếm chỗ", exact: true });
    const pressed = await footprint.getAttribute("aria-pressed");
    await footprint.focus();
    await page.keyboard.press("Space");
    await expect(footprint).toHaveAttribute("aria-pressed", pressed === "true" ? "false" : "true");
    await openInspector(page, "objects");
    const cup = page.getByTestId("entity-list").getByRole("button", { name: /cup-1/ });
    await cup.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("inspector-title")).toContainText("cup-1");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await shot(page, "coffee-run-mobile-vi");
    for (const [code, label] of [["JA", "ja"], ["EN", "en"]]) {
      await page.getByRole("button", { name: code, exact: true }).click();
      await shot(page, `coffee-run-mobile-${label}`);
    }
    await page.getByRole("button", { name: "VI", exact: true }).click();
  });
});
