import { test, expect, type Page, type Request } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { openDisplayMenu, openInspector, openScenarioPicker } from "../support/twin";
// Against the real pinned source runtime (scripts/test-mock-e2e.mjs): live SSE telemetry and business events, stale vs heartbeat,
// acknowledged pause, dropped stream and reconnect, read-only replay with trace, A/B compare, exports, and a lost session.
const token = process.env.LAB_TEST_PAIRING_TOKEN;
const shots = process.env.LAB_EVIDENCE_DIR;
const shot = async (page: Page, name: string) => { if (shots) await page.screenshot({ path: `${shots}/F06-${name}.png`, fullPage: true }); };
const chip = (page: Page) => page.getByTestId("twin-telemetry");
interface Report { effects: { attempts: number }[]; businessEvents: unknown[]; telemetry: { samples: unknown[] } }
async function report(page: Page): Promise<Report> {
  const id = (await page.getByTestId("run-id").textContent())!.trim();
  return page.evaluate(async (runId) => (await fetch(`/lab/v2/runs/${runId}/report`, { credentials: "same-origin" })).json(), id);
}
const commands = (r: Report) => [r.effects.reduce((n, e) => n + e.attempts, 0), r.businessEvents.length];

test("telemetry stream, stale/frozen states, reconnect, read-only replay, compare, export and a lost session", async ({ browser }) => {
  test.skip(!token, "Run scripts/test-mock-e2e.mjs: it starts the pinned source runtime via the launcher and supplies its one-time token.");
  test.setTimeout(240000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const actions: Request[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && /\/runs\/[0-9a-f-]+\/actions$/.test(r.url())) actions.push(r); });
  await page.goto("/#twin");
  await page.locator("#twin-pair-token").fill(token!);
  await page.getByRole("button", { name: "Ghép nối runtime" }).click();
  await openScenarioPicker(page);
  await page.getByRole("button", { name: "Một đơn giao món" }).click();
  await openDisplayMenu(page);
  await page.getByRole("button", { name: "2D", exact: true }).click();
  await page.getByRole("button", { name: "Chạy mock" }).click();
  await expect(page.getByTestId("mode-badge")).toContainText("MOCK");
  await openInspector(page, "engineering"); // the link detail lives in the Engineering tab (the run bar shows one word)

  // live SSE: samples arrive over the telemetry stream; with no step the pose stops refreshing while heartbeats continue -> stale, not live
  await expect(chip(page)).toContainText("SSE");
  await expect(chip(page)).toContainText("amr-1");
  await expect(chip(page)).toContainText("cũ", { timeout: 5000 });
  await expect(chip(page)).toHaveAttribute("data-state", "stale");
  await page.waitForTimeout(2600); // > 2 s heartbeat deadline: still SSE (heartbeats arrive), still stale (no new measurement)
  await expect(chip(page)).toContainText("SSE");
  await expect(chip(page)).toHaveAttribute("data-state", "stale");
  await shot(page, "telemetry-stale-heartbeat-desktop-vi");

  // acknowledged pause of the mock clock: FROZEN_SIM with the real age, no stale alarm
  await page.getByRole("button", { name: "Tạm dừng mô phỏng" }).click();
  await expect(page.getByTestId("run-status")).toContainText("Tạm dừng");
  await expect(chip(page)).toHaveAttribute("data-state", "frozen_sim", { timeout: 5000 });
  await expect(chip(page)).toContainText("FROZEN_SIM");
  await shot(page, "telemetry-frozen-sim-desktop-vi");
  await page.getByTestId("twin-transport").getByRole("button", { name: "Tiếp tục mô phỏng" }).click();// item 2: the primary action resumes too
  await expect(page.getByTestId("run-status")).not.toContainText("Tạm dừng");

  // dropped stream: the browser goes offline; the link is no longer live; back online it reconnects and the twin updates again
  await context.setOffline(true);
  await expect(chip(page)).not.toContainText("SSE", { timeout: 10000 });
  await expect(chip(page)).toHaveAttribute("data-state", "disconnected");
  await shot(page, "telemetry-disconnected-desktop-vi");
  await context.setOffline(false);
  await expect(chip(page)).toContainText("SSE", { timeout: 15000 });
  const before = Number((await page.getByTestId("run-revision").textContent())!.trim());
  // a step produces new samples: the chip is live for the pose deadline (500 ms) after they arrive, then stale again
  const live = page.waitForFunction(() => document.getElementById("twin-telemetry")?.dataset.state === "live", undefined, { polling: "raf", timeout: 5000 });
  await page.getByRole("button", { name: "+5 s" }).click();
  await live;
  await expect(page.getByTestId("run-revision")).not.toHaveText(String(before));
  await expect(chip(page)).toHaveAttribute("data-state", "stale", { timeout: 3000 });

  // finish the run, then replay it: no action request is sent and the command count stays the same
  await page.getByRole("button", { name: "Tự chạy" }).click();
  await expect(page.getByTestId("run-status")).toContainText("Hoàn thành", { timeout: 120000 });
  await expect(page.getByTestId("report-streams")).toContainText("Sự kiện nghiệp vụ (bền");
  await expect(page.getByTestId("report-streams")).toContainText("Telemetry (có thể mất");
  const counted = commands(await report(page)), sent = actions.length;
  await openInspector(page, "report");
  await page.getByRole("button", { name: "Xem lại (chỉ đọc)" }).click();
  const cursor = page.locator("#twin-replay-cursor");
  await cursor.fill("400");
  await expect(page.getByTestId("replay-time")).toContainText("tick 400");
  await expect(page.getByTestId("replay-events")).not.toBeEmpty();
  await expect(page.getByTestId("replay-entities")).toContainText("amr-1");
  await openInspector(page, "objects");
  await page.getByTestId("entity-list").getByRole("button", { name: /amr-1|AMR/ }).first().click();
  await expect(page.getByTestId("trace-rows")).toContainText("command");
  await expect(page.getByTestId("trace-rows")).toContainText("observation");
  await openInspector(page, "report");
  await page.getByRole("button", { name: "Phát", exact: true }).click();
  await expect(page.getByRole("button", { name: "Phát", exact: true })).toBeVisible({ timeout: 30000 }); // playback reached the end
  await shot(page, "replay-trace-desktop-vi");
  expect(actions.length).toBe(sent);
  expect(commands(await report(page))).toEqual(counted);
  await page.getByRole("button", { name: "Thoát xem lại" }).click();

  // exports: self-contained HTML with manifest/seeds/sample counts/missing evidence; CSV with both streams; nothing executable
  const [html] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "HTML" }).click()]);
  const text = await readFile((await html.path())!, "utf8");
  expect(text.startsWith("<!doctype html>")).toBe(true);
  expect(text).not.toMatch(/<script|<link|<iframe|csrf|mekoniq_lab_session/i);
  for (const s of ["Source manifest", "Seeds", "Sample counts", "Missing evidence", "Business events (durable)", "Telemetry (lossy, coalesced)"]) expect(text).toContain(s);
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV" }).click()]);
  const rows = (await readFile((await csv.path())!, "utf8")).split("\n");
  expect(rows[0]).toBe("stream,sequence_or_seq,time,tick,entity_or_kind,id,type,quality,detail,raw_sim_time_ns");
  expect(rows.some((r) => r.startsWith("business,"))).toBe(true);
  expect(rows.some((r) => r.startsWith("telemetry,"))).toBe(true);

  // A/B: the same locked inputs again; compare shows comparable runs with KPI units, one run per side (no percentiles)
  await page.getByRole("button", { name: "Chạy lại cùng đầu vào" }).click();
  await expect(page.getByTestId("compare-panel")).toContainText("So sánh được");
  await expect(page.getByTestId("compare-panel")).toContainText("missionTimeS");
  await shot(page, "compare-desktop-vi");
  // the second run's first step (and its report) must have landed before the session is cut below: otherwise that report fetch races the cookie clear
  await expect(page.getByRole("button", { name: "+5 s" })).toBeEnabled();

  if (shots) {
    // browser memory with the stream open (Chrome only, approximate): recorded, not asserted
    // MemoryInfo exposes getters on its prototype: copy the fields explicitly (JSON.stringify of the object is {})
    const heap = await page.evaluate(() => { const m = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory; return m ? { usedJSHeapSizeMiB: +(m.usedJSHeapSize / 2 ** 20).toFixed(1), totalJSHeapSizeMiB: +(m.totalJSHeapSize / 2 ** 20).toFixed(1), jsHeapSizeLimitMiB: +(m.jsHeapSizeLimit / 2 ** 20).toFixed(0), note: "Chrome performance.memory is coarse (bucketed) without --enable-precise-memory-info" } : null; });
    await writeFile(`${shots}/F06-browser-memory.json`, JSON.stringify({ capturedAt: new Date().toISOString(), browser: browser.version(), command: "node scripts/test-mock-e2e.mjs --evidence twin-recovery.spec.ts", scenario: "FD01 completed, replayed, second run started; 2D view, both SSE streams open", heap }, null, 2) + "\n");
  }

  // lost session (as after a runtime restart): the stream reconnect is refused with 401 -> re-pair prompt; the last report stays viewable
  await context.clearCookies();
  await openInspector(page, "engineering");
  await context.setOffline(true);
  await expect(chip(page)).not.toContainText("SSE", { timeout: 10000 });
  await context.setOffline(false);
  await expect(page.locator("#twin-pair-token")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".notice")).toContainText("Ghép nối lại");
  await expect(chip(page)).toContainText("cần ghép nối lại");
  await openInspector(page, "report");
  await page.getByRole("button", { name: "Xem lại (chỉ đọc)" }).click();
  await expect(page.getByTestId("replay-panel")).toBeVisible();
  await shot(page, "session-lost-desktop-vi");
  await context.close();
});
