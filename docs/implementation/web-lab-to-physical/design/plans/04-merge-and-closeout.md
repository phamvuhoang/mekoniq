# Plan 04 — Đưa nhánh về main và đóng phần còn lại của R2b/R3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa các lỗi review ngày 16/11, fast-forward `codex/web-lab-to-physical` về `main` ở cả hai repo, đưa live cell đạt tiêu chí hiệu năng/liên tục, mở lại chuỗi recording R1 → R2b và chuẩn bị R3 cho host Linux.

**Architecture:** Năm bước tuần tự. Bước 1 sửa nhỏ ngay trên nhánh; bước 2 fast-forward (không rewrite, giữ mọi SHA đã ghi trong bằng chứng); bước 3–5 làm trực tiếp trên `main` theo quy ước repo. Không push cho tới khi capture 185 giây đạt ở cuối bước 3.

**Tech Stack:** TypeScript (pnpm, vitest, Playwright), Python 3.11 + MuJoCo 3.17.0, Node 24.22.2, Git.

**Spec:** `docs/2026-11-13-web-lab-to-physical/` (02, 03, 04) và trạng thái tại `source/docs/implementation/web-lab-to-physical/post-n1-final-recording/status.md`.

Đường dẫn: `S` = `.worktrees/web-lab-to-physical/source`, `L` = `.worktrees/web-lab-to-physical/lab` ở bước 1; từ bước 2 trở đi là `source/` và `lab/`.

## Global Constraints

- Mọi lệnh `pnpm`/`node`: `export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"`. Lệnh dài chạy dưới `perl -e 'alarm N; exec @ARGV' …`.
- Pytest: `PYTHONDONTWRITEBYTECODE=1 … -p no:cacheprovider`; không để `__pycache__`/`.pytest_cache` dưới portable tool roots.
- Không bao giờ ghi `accepted:true`; không nới ngưỡng reader/guard để cho qua; physics giữ `not_calibrated`.
- "Durable trước logical commit" giữ nguyên: WAL của tick phải fsync trước khi tick được commit, trả HTTP hoặc vào report.
- Bằng chứng lịch sử không sửa byte; không rewrite lịch sử Git.
- Mỗi commit source đổi runtime/schema/portable tools → một commit Lab `chore: pin source runtime <sha>`.
- Không đụng cổng 1880/1884, không chạy `trial/scripts/deploy.sh`.
- Push `main` = deploy production: chỉ push ở Task 3.8, không deploy Cloud Run nếu chưa có lệnh riêng.
- Commit: tiền tố `fix:`/`test:`/`docs:`/`chore:`, kết thúc bằng `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. Mất điện giữa hai fsync sau khi giảm sync: mở lại run phải ra `WORLD_RESTART_UNKNOWN` hoặc trạng thái đã commit, không bao giờ là tick chưa durable (Task 3.1).
2. Tab ẩn rồi hiện lại khi run đang chạy: cảnh giữ snapshot cuối có nhãn stale, không trống (Task 3.5).
3. Retry một action đã có receipt trong lúc step khác đang chạy: step chạy đủ số tick (Task 1.6).
4. SIGKILL gateway giữa lúc export replay: lần khởi động sau export lại được (Task 1.5).
5. Máy bận CPU khi chạy regression: bốn test thời gian vẫn xanh 20/20 lần lặp (Task 1.2).

---

# Bước 1 — Sửa nhỏ trên nhánh trước khi merge

### Task 1.1: Lint xanh trên checkout sạch

**Files:** Modify `S/eslint.config.mjs` (cạnh dòng 15, mục globals cho evidence Cloud Run).

- [ ] Thêm một entry `files:['docs/implementation/web-lab-to-physical/**/*.mjs']` với `globals:{AbortController:'readonly',performance:'readonly'}`.
- [ ] Run: `pnpm -s exec eslint . --ignore-pattern '.superpowers/**'` → 0 error. (`.superpowers/` là gitignored; CI không thấy nó.)
- [ ] Commit `fix: lint retained web-lab evidence scripts with node globals`.

### Task 1.2: Bốn test phụ thuộc thời gian

**Files:** Modify `S/tests/unit/r2b-process.test.ts:10-16`, `S/tests/integration/lab-v2-bv01-sil.test.ts:47-50,80-83`. Không sửa code sản phẩm.

- [ ] `r2b-process`: ca "retained" dùng deadline 2000 ms; ca "started" chỉ abort sau khi poll thấy `stdout.log` khác rỗng (poll 20 ms, trần 5 s). Assertion giữ nguyên chuỗi `retained`/`started`.
- [ ] `bv01-sil` operator-restart: thay hai `sleep(80)`/`sleep(350)` bằng poll đọc `native-faults.json` tới khi dòng cuối là `awaiting_operator` rồi `observed_transition` (poll 25 ms, trần 5 s).
- [ ] `bv01-sil` amr-delay và missing-cup: timeout test 8000 → 15000 ms. Ghi một dòng comment: hold bound 5000 ms ở `native-lifecycle.ts:91,176` + 1400 ms sleep vượt 8000 khi hold không settle.
- [ ] Run mỗi file 20 lần trong khi tải CPU (`yes > /dev/null &` × số core, nhớ kill): `for i in {1..20}; do pnpm -s test:unit -- tests/unit/r2b-process.test.ts || break; done` và tương tự `test:integration -- tests/integration/lab-v2-bv01-sil.test.ts`. Expected: 20/20.
- [ ] Commit `test: wait on observed state instead of fixed sleeps in process and SIL tests`.

Việc tách riêng, không chặn: tìm vì sao `holdForReconcile` chạm bound 5 s (ghi vào dispositions, không sửa ở plan này).

### Task 1.3: Producer browser ghi argv chuẩn

**Files:** Modify `L/playwright.b07b.config.ts`, `L/scripts/measure-cell-production.ts:49-54`; Test `S/tests/unit/r2b-browser-readback.test.ts`.

- [ ] Config: `outputDir: process.env.LAB_PW_OUTPUT` (undefined → mặc định Playwright).
- [ ] Producer: `args` = `['exec','playwright','test','--config','playwright.b07b.config.ts','mujoco-cell.spec.ts']`; truyền `LAB_PW_OUTPUT: join(output,'browser-artifacts')` qua env của spawn. Không còn đường dẫn tuyệt đối trong `browser-runtime-identity.json`.
- [ ] Thêm vào test reader một ca dùng đúng mảng `args` export từ producer (export hằng `BROWSER_ARGS` từ `measure-cell-production.ts`, hoặc nếu không import chéo repo được thì thêm test Lab `tests/unit/measure-args.test.ts` khẳng định `BROWSER_ARGS` bằng mảng mà `S/scripts/browser-evidence-readback.mjs:11-12` yêu cầu, chép nguyên văn).
- [ ] Run: `pnpm typecheck && pnpm exec vitest run tests/unit/measure-args.test.ts` (Lab). Expected: PASS.
- [ ] Commit Lab `fix: record canonical browser argv and pass the output directory by environment`.

### Task 1.4: Webots journey — badge "not run"

**Files:** Modify `L/src/ui/workspace.ts:552` (`create`); Test `L/tests/unit/` (file workspace hiện có) và spec Webots journey.

- [ ] Test trước: với preset có `backendSetId` khác `MUJOCO_MOBILE_SET`, `create()` không gọi `loadPayloadBundle` (spy = 0 lần); với preset mobile mà bundle reject, `create()` vẫn đi tiếp tới `rt.create`.
- [ ] Sửa: chỉ gọi khi `p.backendSetId===MUJOCO_MOBILE_SET`, kèm `.catch(()=>null)`; gọi `this.rerender()` ngay sau `await this.apply(v)` để badge không chờ start + step đầu.
- [ ] Run unit → PASS. Sau đó chạy đúng một spec: `pnpm test:irsim-e2e -- <spec Webots journey của R1>` (launcher `pnpm lab:webots`, một spec mỗi launcher). Expected: badge `Simulation · not calibrated` trong 5 s.
- [ ] Nếu spec vẫn fail: dừng, áp dụng superpowers:systematic-debugging; lần này giữ screenshot (Task 1.4b).
- [ ] **1.4b:** `L/playwright.irsim.config.ts` và `playwright.b07b.config.ts` nhận `outputDir` từ env như `playwright.config.ts`; `scripts/test-irsim-e2e.mjs` đặt một thư mục cho mỗi spec, ngoài `test-results/`.
- [ ] Commit Lab `fix: load the payload bundle only for mobile presets and paint the run view after create`.

### Task 1.5: Gateway không tự khoá sau lỗi close/crash

**Files:** Modify `S/packages/lab-runtime/src/v2/gateway.ts:63,88-89,214,407`, `S/packages/lab-runtime/src/gateway.ts` (đoạn `ownership.close()`), `S/packages/lab-runtime/src/v2/scenario-runner.ts:501`, `gateway.ts:52` (bảng mã lỗi); Test `S/tests/security/lab-run-writer.test.ts` hoặc file gateway unit gần nhất.

- [ ] Test A: một run có `close()` reject → `POST /runs` kế tiếp vẫn 201; `v2.close()` resolve và ownership được nhả.
- [ ] Test B: tạo sẵn thư mục rác trong `<dataRoot>/replay-exports/` trước khi mở gateway → POST replay export trả 2xx, không 429 `REPLAY_RECOVERY_REQUIRED`.
- [ ] Test C: run world đã terminal, gửi lại action có receipt → trả đúng receipt; action mới → HTTP 409 mã `WORLD_TERMINAL`.
- [ ] Sửa: catch từng run trong vòng `expiryCleanup` (chuỗi luôn resolve), `Promise.allSettled` trong close, `ownership.close()` trong `finally`; khi khởi động, sau khi giữ khoá data root, xoá `replay-exports/*`; ở `scenario-runner.ts:501` replay receipt trước khi ném, và map `WORLD_TERMINAL` → 409.
- [ ] Run: `pnpm test:security -- <file>` và `pnpm test:unit -- tests/unit/world-runner.test.ts` → PASS.
- [ ] Commit `fix: keep the gateway usable after a failed close, crash residue or terminal world`.

### Task 1.6: Control cũ gửi lại không cắt batch step

**Files:** Modify `S/packages/lab-runtime/src/v2/navigation2d/runner.ts:541,626`; Test `S/tests/security/lab-run-controls.test.ts:142`.

- [ ] Đổi kỳ vọng ở dòng 142: sau khi replay `pause` cũ trong lúc `step{ticks:2}`, `stepped.tick` là **2** (hiện đang khẳng định 0). Chạy → FAIL.
- [ ] Sửa: chỉ đặt `admitted=true` ở nhánh không-cache, sau `beforeExecute` (cùng hướng với `onControlBegin` của world runner ở `0d46403`).
- [ ] Run: `pnpm test:security -- tests/security/lab-run-controls.test.ts` (cần `.venv-irsim`; nếu test bị skip thì coi như chưa kiểm). Expected: PASS, 0 skipped.
- [ ] Cập nhật dòng "Unchanged navigation admission" trong `post-n1-final-recording/dispositions.md` bằng một ghi chú mới phía dưới (không sửa dòng cũ).
- [ ] Commit `fix: stop a replayed control receipt from truncating a later step batch`.

### Task 1.7: Cổng kiểm của bước 1

- [ ] Source: `pnpm contracts:check && pnpm typecheck && pnpm lint && pnpm build && pnpm test:unit && pnpm test:contracts && pnpm test:adapters` → exit 0. `test:integration` chạy nếu Supabase/Docker lên; nếu không, ghi rõ chưa chạy.
- [ ] Lab: `node scripts/import-runtime.mjs <export>` sau `node scripts/export-lab-runtime.mjs <dir>` ở source, `node scripts/sync-engineering-contracts.mjs && pnpm check:source && pnpm typecheck && pnpm exec vitest run` → exit 0. Commit `chore: pin source runtime <sha>`.
- [ ] Hai worktree sạch (`git status --short` rỗng).

---

# Bước 2 — Fast-forward về main (chưa push)

### Task 2.1: Merge

- [ ] `git -C source status --short` chỉ còn ba đường dẫn smoke-findings chưa theo dõi; `git -C lab status --short` chỉ còn `docs/simulation-compatibility.md`. Nhánh không đụng các file này (đã kiểm 16/11) — giữ nguyên, không stash.
- [ ] `git -C source merge --ff-only codex/web-lab-to-physical` và tương tự cho `lab`. Expected: "Fast-forward". Nếu không ff được: dừng và báo.
- [ ] `git -C source worktree remove ../.worktrees/web-lab-to-physical/source` (và lab), `git worktree prune`, `git branch -d codex/web-lab-to-physical` ở cả hai. Các `.venv*`/`node_modules` của worktree mất theo: chạy `pnpm install --frozen-lockfile` và kiểm `.venv-mujoco`, `.venv-irsim`, `.venv-webots`, `.venv-linkforge` ở `source/` còn dùng được (`node scripts/lab-irsim.mjs doctor`).

### Task 2.2: Gỡ byte thô của thế hệ `final-recording` khỏi cây

Quyết định: xoá **chỉ** `docs/implementation/evidence/web-lab-to-physical/final-recording/raw/` (1,0 GB). Giữ `index.json`, `archive-receipts/`, `public-readbacks/`, `images/`, `privacy-*` — index post-N1 tham chiếu `final-recording/index.json` và `privacy-exclusions.json`; không code/test nào đọc `raw/`.

- [ ] `git grep -n 'final-recording/raw/' -- docs ':!docs/implementation/evidence'` → liệt kê link Markdown trỏ vào `raw/`. Các file audit JSON trong `retention/` là bản ghi lịch sử: không sửa.
- [ ] Tạo `final-recording/raw.REMOVED.md`: nêu commit cuối còn chứa `raw/` (SHA `main` ngay trước commit này), lệnh lấy lại (`git show <sha>:<path> > file`), và rằng sha256 từng archive vẫn nằm trong `index.json`.
- [ ] Sửa các link Markdown sống (README, `final-recording-status.md`, `reproduce-final-recording.md`) trỏ sang `raw.REMOVED.md`.
- [ ] `git rm -r …/final-recording/raw` → commit `docs: drop superseded final-recording raw archives from the tree`.
- [ ] Verify: `du -sh docs/implementation/evidence/web-lab-to-physical` ≈ 0,7 GB; `pnpm lint` exit 0.

### Task 2.3: Quy ước bằng chứng thô từ nay

- [ ] Thêm vào `source/docs/implementation/README.md` một đoạn: archive thô > 5 MB không commit; lưu ngoài Git (thư mục `robot/evidence-archive/<candidate>/` trên máy ghi, sao lưu do người dùng chỉ định), trong Git chỉ có index với đường dẫn tương đối, kích thước và sha256.
- [ ] Thêm `docs/implementation/evidence/**/raw/*.tar.gz` vào `source/.gitignore`. Kiểm `git status` không coi `post-n1-final-recording/raw` hiện có là bị xoá (file đã tracked không bị ảnh hưởng).
- [ ] Commit `docs: keep future raw evidence archives outside Git`.

### Task 2.4: Tài liệu thiết kế

- [ ] `diff -r robot/docs/2026-11-13-web-lab-to-physical source/docs/implementation/web-lab-to-physical/design` → nếu bản workspace mới hơn, chép sang `design/` (kể cả plan này), sửa link tương đối, commit `docs: sync the web-lab-to-physical design set`. Giữ bản workspace làm nơi soạn.
- [ ] Re-pin Lab theo commit source cuối của bước 2 (lệnh như Task 1.7).

---

# Bước 3 — Hiệu năng và tính liên tục của live cell

Mục tiêu đo (reader hiện có, không đổi ngưỡng): tốc độ ≥ mục tiêu 1× của reader, draw p95 ≤ 33 ms, worker IPC p95 ≤ 15 ms, receipt cuối ≤ 500 ms, không còn `CAPTURE_PAUSE_CORRELATION`/`CAPTURE_STREAM_GAP`/`CAPTURE_RENDER_PROGRESSION`.

### Task 3.0: Đo trước khi sửa

- [ ] Viết `source/scripts/native-sim/tick-cost-probe.mjs`: chạy 500 tick world `coffee-delivery-cell-v1` qua runner thật, in JSON `{ticks, wallMs, fsyncCount, fsyncMsP50, fsyncMsP95, flushMs:[…]}` (đếm bằng cách bọc `FileHandle.prototype.sync`). Ghi số baseline vào commit message. Kỳ vọng baseline ≈ 8 fsync/tick, ≈ 54 ms/tick.

### Task 3.1: Một ghi durable mỗi tick

**Files:** `source/packages/lab-runtime/src/v2/scenario-runner.ts:258,387-392`, `v2/checkpoint.ts:9-10`, `v2/simulation3d/world-evidence.ts:60-78`, `v2/simulation3d/physics-evidence.ts:61,83`; Test `tests/unit/world-runner.test.ts` + file durability hiện có của B05.

- [ ] Test trước (bọc `sync`): một tick world gọi fsync **≤ 2** lần; sau tick, `pending.ndjson` chứa record của tick và đã được sync trước khi `run.json` mang tick mới.
- [ ] Test crash: giết runner sau WAL-append nhưng trước `persist()` → mở lại ra `WORLD_RESTART_UNKNOWN`; giết sau `persist()` → mở lại đọc được `run.json` (không rỗng/hỏng).
- [ ] Sửa: checkpoint `prepared` và `sent` bỏ `{sync:true}` (recovery không đọc `stage`); giữ fd `pending.ndjson` mở suốt chunk và chỉ `sync()` file; fsync thư mục chỉ khi tạo/rename file; `persist()` (commit logic) thêm fsync file trước khi trả; `quota()` dùng bộ đếm byte chạy thay cho readdir+lstat mỗi tick.
- [ ] Run 51 regression durability của B05 + test mới → PASS. Chạy lại probe 3.0: fsync/tick ≤ 2.
- [ ] Commit `fix: commit one durable write per world tick`.

### Task 3.2: Flush chunk không chặn event loop

**Files:** `world-evidence.ts:65-71`, `physics-evidence.ts` (flush tương ứng).

- [ ] Test: phát lại 2.503 observation của B05 qua recorder → 11 chunk nén **giống từng byte** bản đã lưu (test này đã có ở B05; phải giữ xanh).
- [ ] Sửa: `gzipSync` → `promisify(gzip)` cùng tham số; gộp `write.intent` + manifest thành một lần `writeDurable` nếu reader không phụ thuộc thứ tự hai file (đọc reader trước; nếu phụ thuộc thì chỉ đổi gzip).
- [ ] Probe 3.0: `flushMs` max < 100 ms. Commit `fix: compress evidence chunks off the tick path`.

### Task 3.3: Scan LiDAR chỉ ở tick publish

**Files:** `source/robotics/simulation-mujoco/mujoco_worker/mobile_engine.py:179-180,253`, `world_engine.py:154`; schema ACK trong `packages/contracts/schemas`; consumer `mujoco-world-ports.ts:147`, `world-scene.ts:36`, `navigation2d/runner.ts`.

- [ ] Trước tiên grep mọi consumer đọc `robots[].scan`; nếu có consumer cần scan mỗi tick thì giữ bản cuối ở phía TS (cache), không ở wire.
- [ ] Test Python (`robotics/simulation-mujoco/tests/test_world.py`): tick không chia hết `publishEveryTicks` → ACK không có `scans`; tick chia hết → có 360 beam.
- [ ] Sửa worker + schema (trường optional) → `pnpm contracts:generate`. Đây là đổi portable tools: cập nhật physics lock/probe nếu digest đổi, re-pin Lab.
- [ ] Run: pytest file trên, `pnpm test:integration -- tests/integration/mujoco-mobile-worker.test.ts tests/integration/mujoco-mobile-lifecycle.test.ts`, campaign payload 19 ca và cell 8 ca (verifier exit 0). Commit `fix: send lidar scans only on publish ticks`.

### Task 3.4: Display không đọc lại journal mỗi tick

**Files:** `scenario-runner.ts:405,455` (`publishWorldDisplay`), `world-control.ts:14-22`.

- [ ] Test: 100 tick không có `drain()` commit → số lần đọc journal = 0 (spy store).
- [ ] Sửa: dựng display từ checkpoint; làm mới cursor journal chỉ khi `drain()` commit; parse load profile/`programs.json` một lần lúc admission.
- [ ] Commit `fix: build the world display from the committed checkpoint`.

### Task 3.5: Vòng hiển thị Lab

**Files:** `lab/src/ui/workspace.ts:166-168,193-202,227-232,288,479`, `lab/src/twin/scene.ts:53`; Test `lab/tests/unit/` (workspace/playback).

- [ ] Test 1: `refreshWorld` với cùng tick/revision/reason → `rerender` 0 lần; run terminal → ticker dừng.
- [ ] Test 2: 600 ms không có tick mới, status `running` → `sceneEntities('mujoco-cell')` vẫn trả entity của snapshot cuối, kèm cờ `stale:true`; nội suy tắt.
- [ ] Test 3: đổi `runRevision` với cùng run/boot/scene digest → `WorldPlayback` và `LivePlayback` **không** bị clear; clear khi đổi boot, gap sim-time > 1 s hoặc sim-time lùi.
- [ ] Test 4: scene fetch lỗi một lần → lần poll sau thử lại, không báo `WORLD_SCENE_IDENTITY_MISMATCH`.
- [ ] Sửa theo bốn test; `priorityPause` await/clear trong `finally`. Thêm nhãn stale ba ngôn ngữ qua `tr(vi,ja,en)`.
- [ ] Run `pnpm typecheck && pnpm exec vitest run`; rồi `pnpm test:mujoco-e2e -- mujoco-cell.spec.ts`. Commit `fix: hold the last committed cell frame and keep interpolation across revisions`.

### Task 3.6: Đo pause trên một đồng hồ

**Files:** `lab/scripts/measure-cell-production.ts:83,87-90`, `lab/scripts/production-http-observer.ts:41`.

- [ ] Ghi thời điểm bắt đầu request `/actions` **trong trang** bằng `PerformanceObserver` (`resource`), cùng `performance.now()` với click, ghép theo `actionId`. Timing Playwright chỉ dùng cho khoảng thời gian, không cho thứ tự liên tiến trình.
- [ ] Reader `source/scripts/r2b-readback.mjs` giữ nguyên predicate `requestStart >= click`; chỉ đổi nguồn trường nếu tên trường đổi — nếu phải đổi reader thì thêm ca test với capture cũ vẫn bị từ chối.
- [ ] Commit Lab `fix: correlate pause click and request on the page clock`.

### Task 3.7: Capture 185 giây

- [ ] Re-pin Lab, hai cây sạch, `caffeinate -dims`, màn hình mở khoá. Chạy producer theo `post-n1-final-recording/reproduce.md`, output ngoài hai repo.
- [ ] Chạy reader công khai không đổi → exit 0. Nếu còn predicate fail: dừng, systematic-debugging với probe 3.0; **không** chạy lại nguyên trạng để lấy lượt may mắn.
- [ ] Ghi kết quả (cả lượt fail nếu có) vào một thư mục candidate mới; index + sha256 vào Git, archive thô để ngoài theo Task 2.3.

### Task 3.8: Push (lần đầu)

- [ ] Cổng: Task 1.7 chạy lại trên `main` → exit 0.
- [ ] Source, tránh trần 2 GB/push: đẩy object lên nhánh tạm theo đoạn rồi mới đẩy `main` —
  `git push origin 981e234:refs/heads/tmp/wl2p`, rồi lần lượt `838ac2c`, `907087c`, `5194c99`, `HEAD` vào cùng ref; sau đó `git push origin main` và `git push origin :tmp/wl2p`.
- [ ] Không có migration mới trên nhánh (kiểm `git diff 11d25b4..main --stat -- supabase`); nếu có thì `pnpm exec supabase db push` trước.
- [ ] Smoke `https://www.mekoniq.app/health/live` và `/health/ready` → `{"ready":true}`.
- [ ] Lab: `git push origin main`; mở `https://mekoniq-lab.vercel.app/#replay`, mở replay `coffee-delivery` từ catalogue, kiểm VI/JA/EN. Kiểm UI mới có ghép được với runtime Cloud Run `4f893ac` không; nếu Lab từ chối vì lệch pin thì ghi rõ: live trên web cần deploy runtime mới (lệnh riêng của người dùng, D60).

---

# Bước 4 — Chuỗi recording

Điều kiện: Docker (OrbStack) chạy, Webots R2025a, hai cây sạch, Lab pin = commit source, không bytecode dưới portable roots, `caffeinate -dims`, output ngoài hai repo, không commit Lab giữa chừng.

### Task 4.1: Image container cho WEB05

- [ ] `deploy/lab-runtime/build.sh … --platform linux/arm64` → image; chạy `deploy/lab-runtime/single-host/compose.yaml`; thu WEB05 (hai container cùng volume, crash/committed chunks, replay) vào `--container-record`.

### Task 4.2: Ghi theo thứ tự, mỗi bước exit 0 mới sang bước sau

- [ ] Lab regression: `node scripts/record-regression.mjs --suite physical-robot-lab --out <dir>` → 0 failed.
- [ ] IR-SIM: `node scripts/record-irsim.mjs --out … --candidate-id candidate-10`.
- [ ] `node scripts/record-sim-extension.mjs --release r1 …` (INT11, REG01 phải `tested`).
- [ ] `--release r1.1 --r1-record … --mock-regression …`
- [ ] `--release r2a --r11-record … --mock-regression …`
- [ ] `node scripts/record-sim-extension-r2b.mjs --r2a-record … --physics-campaign … --cell-campaign … --semantic-study … --web-record <Task 3.7> --container-record <Task 4.1> --out …`
- [ ] Guards: `pnpm test:acceptance -- sim-extension` (với `LAB_SIMEXT_EVIDENCE_DIR`) và `linkforge-irsim` → PASS.
- [ ] Hai điểm cần biết trước: (a) reader R2b đòi record R2a ghi G-CLOUD1 đúng `blocked_external`; (b) WEB06/G-HOST1 hardcode `blocked_external` — khi có host HTTPS cần một supplement riêng kiểu `cloud-run`, không sửa JSON qualification.
- [ ] Commit `docs: record …` cho từng candidate (index + sha256; archive thô ngoài Git), xoá candidate bị thay thế khỏi cây, cập nhật `status.md` mới (file mới, không sửa bản post-N1). Mọi record `accepted:false`; sidecar `acceptance.json` chỉ do người ký viết.

---

# Bước 5 — R3

### Task 5.1: Sửa trước khi có host (làm được ngay)

**Files:** `source/robotics/manipulation/native_xarm/worker.py:61,63`, `packages/lab-runtime/src/v2/backends/gazebo-nav2.ts:64`, `packages/lab-runtime/src/v2/sil/xarm-cli.ts:18,23`, `scripts/r3-native-readback.mjs` (`readXarmObservation`).

- [ ] Test: domain ID của xArm ∈ [1,50], của Gazebo/Nav2 ∈ [51,101], với mọi seed 0…999; hai dải rời nhau.
- [ ] Test: preflight trả `VENDOR_SOURCE_MISMATCH` (hoặc `SOURCE_DIRTY`, `XARM_MODEL_SELECTOR_MISMATCH`, `XARM_VENDOR_CHECKOUT_MISMATCH`) → `result:'failed'`, category `tooling`; chỉ khi **mọi** lý do thuộc nhóm host/profile mới là `blocked_external`. `G2_MIMIC_CONTACT_NOT_OBSERVED` → `not_run`, category `tooling`.
- [ ] Test: `run-manifest.motion.result !== 'pass'` → `modelMapping`/`sampleCoverage` không phải `tested`.
- [ ] Sửa, chạy `pnpm test:unit -- tests/unit/r3-native-readback.test.ts`, `pnpm test:integration -- tests/integration/xarm-native-contract.test.ts`, pytest `robotics/manipulation/tests`. Re-pin Lab. Ghi lại 6 profile R3 (36 invocation exit 0, `nativeReady:false`).

### Task 5.2: Native trên Linux (cần host)

- [ ] Nhánh xArm: Ubuntu 24.04 / ROS 2 Jazzy / Gazebo Harmonic — chạy 16 ca native của L01, FD01 Nav2 (3 seed + 4 fault), restart recovery, planning, G2 contact; DEP-SEC-01 cần reader security thật trước khi bất kỳ gate native nào thành `tested`.
- [ ] Nhánh custom/PUMA: Debian 12 / LinuxCNC — controller-clock, joint/cartesian, terminal trust, ALG04.
- [ ] MuJoCo probe trên linux/x64 thật (probe tự từ chối container/qemu/rosetta).

### Task 5.3: Physical (cần phần cứng + người ký)

- [ ] Chọn nhánh phần cứng → hồ sơ robot/geometry/limits/calibration/E-stop → shadow → HIL → live có giám sát. Không có bước nào trong plan này tự đóng gate hardware.

---

## Thứ tự và điểm dừng

| Sau | Dừng nếu |
|---|---|
| 1.4 | Webots journey vẫn fail sau sửa → debug trước khi merge |
| 2.1 | Không fast-forward được |
| 3.7 | Reader còn từ chối capture → không push, không sang bước 4 |
| 4.2 | Bất kỳ recorder nào exit ≠ 0 → không ghi bước sau |
| 5.2 | Chưa có host Linux |
