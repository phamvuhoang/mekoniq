# Plan: sửa các phát hiện của buổi smoke 2026-11-14

- **Spec:** [../../specs/2026-11-14-smoke-findings-design.md](../../specs/2026-11-14-smoke-findings-design.md)
- **Báo cáo:** [../../../implementation/smoke-local-cloud-2026-11-14.md](../../../implementation/smoke-local-cloud-2026-11-14.md)

Trạng thái ban đầu: chưa có task nào bắt đầu; không có thay đổi mã.

## Quy ước chung

- Mọi lệnh trong `lab/` hoặc `source/`: `export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"`; lệnh dài bọc `perl -e 'alarm N; exec @ARGV' …`.
- Lab và source là hai repo độc lập; commit trong đúng repo (`git -C lab …`). Tiền tố `fix:`, `test:`, `docs:`; chủ đề mệnh lệnh.
- TDD: viết test thất bại trước, thấy nó thất bại vì đúng lý do, rồi sửa.
- Chuỗi giao diện `tr(vi, ja, en)` đủ ba ngôn ngữ.
- Chạy e2e: mỗi launcher một spec (mã ghép nối dùng một lần); không chạm cổng 1880/1884; dừng launcher cũ trước khi chạy cái mới (`lsof -ti tcp:4175`).
- **Không** đẩy `main`, **không** deploy production, **không** ghi lên Cloud Run nếu chưa có lệnh riêng. Đẩy `lab/main` là deploy production của Lab.
- Task đổi runtime/schema/công cụ mô phỏng: **không có** trong plan này. Nếu T07 hay T08 dẫn tới đổi source, dừng và lập kế hoạch ghim lại + ghi lại bằng chứng riêng.

## Thứ tự và phụ thuộc

```
T01 F1 ─┐
T02 F2 ─┤
T03 F5 ─┼─► T09 hồi quy + tay ─► T10 tài liệu/đóng
T04 F8 ─┤        ▲
T05 F9 ─┤        │
T06 F6 ─┘        │
T07 F3 (đo) ─────┤  (có thể song song, chỉ đọc)
T08 F4 (đo) ─────┘  (cần lệnh riêng; ghi cloud)
T11 F7 docs (sau T03 và kết quả T08)
```

T01–T06 nằm trong Lab và độc lập về tệp, trừ T03/T05 cùng chạm `ui/workspace.ts` (làm tuần tự T05 rồi T03).

---

## T01 — F1: cốc giữ pose cuối đến khi đổi chủ (P1)

**Tệp:** `lab/src/twin/scene.ts` (`plantCup`, vòng cốc ở dòng ~63), `lab/tests/unit/arm-mesh.test.ts` (test dòng 83), `lab/tests/e2e/mujoco-coffee.spec.ts`.

1. **Test thất bại (đơn vị).** Sửa test "a cup whose samples stopped…" thành hai ca: (a) mẫu cốc dừng, chủ `arm` → `cups(f)[0].plant` còn và đúng pose cuối; (b) mẫu cốc dừng, chủ `robot` → `plant` bỏ, vẽ theo người giữ như cũ. Thêm ca chủ `cell`. Chạy: `pnpm exec vitest run tests/unit/arm-mesh.test.ts` → ca (a) thất bại.
2. **Sửa.** `plantCup(f,cupId,ownerKind)` trả `p` khi mẫu đã dừng nhưng `ownerKind` là `arm` hoặc `cell`; chỉ trả `null` khi mẫu dừng và chủ khác. Truyền `c.ownerKind` ở chỗ gọi (`scene.ts` ~63). `droppedPlantCups` không đổi nghĩa.
3. **Test e2e.** Trong `mujoco-coffee.spec.ts`, sau bước "cup-on-tray-robot-docked", thêm kiểm: lấy mẫu `ds('cups')` mỗi 200 ms trong khoảng từ lúc cốc nằm trên khay đến lúc chủ đổi sang robot; mọi mẫu có z ≥ 0,76 và ≤ 0,85 và cách tâm khay ≤ 0,05 m; `plantCupsDropped='0'`.
4. **Chạy.** `pnpm typecheck && pnpm exec vitest run` rồi `pnpm test:mujoco-e2e -- tests/e2e/mujoco-coffee.spec.ts` (≈ 4–5 phút, cần `.venv-mujoco`).
5. **Tay.** Chạy `MJ-BV01` 1× và pause trong khoảng tick 1825–1926 (≈ 36,5–38,5 s sim): cốc nằm trên khay, không lơ lửng.

**Xong khi:** test (a),(b) đạt; e2e đạt; xác nhận bằng mắt; commit `fix: keep a stopped plant cup at its last pose while the arm still owns it` trong `lab/`.

## T02 — F2: độ cũ khi pause và khi kết thúc (P2)

**Tệp:** `lab/src/twin/arm/arm-telemetry.ts` (`armJointsView`), `lab/src/twin/inspector.ts:31`, `lab/tests/unit/twin-telemetry.test.ts` (quanh dòng 63).

1. **Test thất bại.** Ca mới: mẫu hợp lệ 5 s cũ, `frozen:'paused'` → `stale=false`, `reasonCodes` gồm `FROZEN_SIM`, `ageMs` bằng tuổi lúc đóng băng; `frozen:'ended'` → `RUN_ENDED`; mẫu `quality:'stale'` từ runtime vẫn `stale`; nguồn không rơi về `unknown`.
2. **Sửa.** Thêm tham số tùy chọn `opts:{frozen?:'paused'|'ended'|null,frozenAtMs?:number}`; khi `frozen`, `ageMs=min(nowMs,frozenAtMs)-receivedAtMs`. Ở `inspector.ts` tính `frozen` từ `f.link?.paused` (và `origin!=='hardware'`) hoặc trạng thái run cuối; truyền `frozenAtMs` là thời điểm đóng băng đầu tiên Lab thấy (lưu trong biến cục bộ của inspector, không thêm state lan rộng).
3. **Chạy.** `pnpm exec vitest run tests/unit/twin-telemetry.test.ts tests/unit/arm-mesh.test.ts`; `pnpm test:mujoco-e2e -- tests/e2e/mujoco-coffee.spec.ts`.
4. **Tay.** Pause giữa run → mở Kỹ thuật → dòng q1…q6 hiện `FROZEN_SIM`, tuổi không đổi sau 10 s, nguồn "thực (MuJoCo)". Run xong → `RUN_ENDED`.

**Xong khi:** test đạt, e2e đạt; commit `fix: show paused or ended arm rows as frozen, not stale`.

## T03 — F5: chọn kịch bản khi run đã xong, "Đóng lần chạy" (P1)

**Làm sau T05.** **Tệp:** `lab/src/ui/workspace.ts` (`twin-preset` ~559, `retire` 477, đường tạo run ~471–491), `lab/src/ui/run-bar.ts` (`scenarioPicker`, `runBar`), `lab/tests/unit/` (run-bar), `lab/tests/e2e/twin-workspace.spec.ts`.

0. **Tái hiện trước.** Viết một e2e/đơn vị tối thiểu: hoàn thành một run mock, chọn kịch bản khác, khẳng định tiêu đề **vẫn** là kịch bản cũ (thất bại với kỳ vọng "đổi"). Ghi lại vì sao `this.preset` đổi mà khung nhìn lấy từ `this.view`/`runPreset`.
1. **Test thất bại.** (a) Run `completed`: chọn kịch bản khác → tiêu đề đổi, `archive` được gọi đúng một lần với id run cũ, không tạo run mới, vẫn ghép nối. (b) Run `running`/`paused`: mục bộ chọn có `disabled` và có chuỗi lý do. (c) "Đóng lần chạy" hiện khi run ở trạng thái cuối, gọi `retire()`, màn hình về "chưa chạy". (d) `retire()` trả `RUN_NOT_FOUND`: thông báo "lần chạy trước không còn trên runtime", vẫn chuyển kịch bản.
2. **Sửa.** Trong `twin-preset`: nếu có `this.view` ở trạng thái cuối → `await this.retire()` (đường đã có), bỏ `view/report/seen` như đường tạo run (dòng 491, không tạo run), rồi áp `this.preset`. Nếu run đang chạy → trả về sớm kèm `notice`. Thêm nút/action `twin-run-close` vào `runBar`. Dùng lại chuỗi thông báo lỗi `notFound` hiện có.
3. **Chạy.** `pnpm exec vitest run`; `pnpm test:mock-e2e` (cả hai spec mặc định) và `pnpm test:mock-e2e tests/e2e/twin-workspace.spec.ts`.
4. **Tay.** Mock: chạy "Một đơn giao món" đến "Hoàn thành", chọn "Cà phê sữa đá" → đổi ngay, không tải lại; nút "Đóng lần chạy" đưa về trạng thái chưa chạy.
5. **Quyết định Q1** phải được người dùng duyệt trước khi hợp nhất (tự `retire()` khi chọn).

**Xong khi:** test (a)–(d) đạt; commit `fix: switching scenario after a finished run retires it; add Close run`.

## T04 — F8: "Kiểm tra mô hình" không áp dụng (P3)

**Tệp:** `lab/src/ui/assembly-page.ts`, `lab/src/ui/model-validation*.ts` (tên chính xác tìm bằng `grep -rn "Kiểm tra mô hình" lab/src`), test đơn vị của trang.

1. **Test thất bại.** Bundle Webots (không có `robots/*.urdf`): nút `disabled`, có dòng "Không áp dụng cho engine này"; bundle IR-SIM: nút bật như cũ.
2. **Sửa.** Quyết định theo hồ sơ engine của bundle (đã có trên biên nhận compile), không so chuỗi lỗi. Chuỗi ba ngôn ngữ.
3. **Chạy.** `pnpm exec vitest run`; `pnpm test:irsim-e2e -- tests/e2e/irsim-journey.spec.ts` (xác nhận IR-SIM không đổi), rồi `pnpm test:webots-e2e -- tests/e2e/webots-journey.spec.ts`.

**Xong khi:** đạt hai e2e; commit `fix: disable model validation where the bundle has no URDF`.

## T05 — F9: ghép nối đặt lại kịch bản (P3)

**Tệp:** `lab/src/ui/workspace.ts` (đường sau `pair`/`checkReadiness`), test đơn vị/e2e.

1. **Tái hiện.** Test: chọn kịch bản khác mặc định trước ghép nối, ghép nối, khẳng định kịch bản giữ nguyên (đang thất bại). Tìm điểm đặt lại bằng `git -C lab log -S'this.preset=' -- src/ui/workspace.ts` và đọc quanh `pair`.
2. **Sửa** tại điểm tìm được; không đổi hành vi khác.
3. **Chạy.** `pnpm exec vitest run`; `pnpm test:mock-e2e`.

**Xong khi:** test đạt; commit `fix: keep the chosen scenario when the runtime is paired`.

## T06 — F6: nhãn engine và tài liệu so sánh (P1)

**Tệp:** `lab/src/ui/run-bar.ts` hoặc `lab/src/twin/` (nơi tạo nhãn "Mô phỏng · chưa hiệu chuẩn"), `lab/src/ui/keys.ts` (help), `lab/docs/simulation-compatibility.md`, test đơn vị.

1. **Test thất bại.** Cho run có `armPlant.engine==='mujoco_3d'`, `navigation engine==='webots_3d'`, `irsim_2d`, mock: nhãn engine đúng chuỗi và có tooltip "hình do Lab vẽ"; không có nhãn khi chưa có run.
2. **Sửa.** Lấy engine từ báo cáo/`run-identity` đã có (`data-testid='run-identity'` hiện dùng trong e2e IR-SIM); không gọi API mới. Thêm đoạn giải thích Webots đen vào help và thông báo lần chạy Webots đầu.
3. **Tài liệu.** Viết bảng engine (mục 3.6 báo cáo) vào `simulation-compatibility.md`, ghi đúng những gì quan sát được; không nêu số liệu chưa đo. Ghi số FD01: IR-SIM 61,9 s, Webots 103,0 s kèm cảnh báo nguyên nhân chưa tách.
4. **Thử chế độ xem Webots.** Một lần: dừng launcher, chạy `MEKONIQ_WEBOTS_WATCH=1 pnpm lab:webots`, chạy `Webots 3D · giao món FD01` ở 1×, quan sát cửa sổ Webots; ghi nguyên văn kết quả (chạy tốt / treo nạp world / lỗi) vào `simulation-compatibility.md` và báo cáo. Không đổi mặc định.
5. **Chạy.** `pnpm exec vitest run`; `pnpm test:webots-e2e -- tests/e2e/webots-journey.spec.ts`; `pnpm test:irsim-e2e`.

**Xong khi:** hai backend cho nhãn khác nhau trên cùng giao diện; tài liệu có bảng; kết quả thử watch đã ghi; commit `feat: label the physics engine on the twin and document engine differences` (Lab) và `docs:` (tài liệu).

## T07 — F3: đo tất định (P2, chỉ đọc cho tới khi có kết quả)

**Công cụ:** `scripts/lab-irsim.mjs`/CL01 producer hoặc script gọi HTTP có lịch bước cố định (xem `docs/implementation/evidence/cloud-run/mekoniq-2026-11-14/` để lấy cách CL01 gọi `step`). Bản local dùng `pnpm lab:mujoco` + runtime cục bộ; bản cloud cần lệnh riêng (T08 cũng dùng).

1. Local ×2, cùng seed 42, mọi bước 50 tick → ghi `arm-trace` sha và số mẫu mỗi stream.
2. Local, lịch bước khác (1× so với 16×).
3. Cloud, lịch cố định của bước 1 (cần lệnh).
4. Điền bảng kết quả vào `docs/implementation/` (một trang ngắn: ba điều kiện × hai số). Áp dụng nhánh quyết định (a)/(b)/(c) trong spec. Nếu (a): thêm một test `tests/contracts` hoặc đơn vị khẳng định sha bằng nhau trên cùng lịch bước.

**Xong khi:** có bảng số thật và một câu hợp đồng kiểm được; F3 hoặc đóng, hoặc thành lỗi tất định riêng.

## T08 — F4: tái hiện instance active (P2, ghi cloud, cần lệnh)

**Điều kiện:** người dùng ra lệnh rõ cho thí nghiệm này (ghi cloud thật, ~0,15 USD).

1. Chuẩn bị: tài khoản gcloud, khóa từ Secret Manager vào biến (không in). Script tạo phiên (có `Origin` được phép), tạo run `MJ-BV01`, mở luồng `GET /lab/v2/runs/<id>/events` bằng `curl -N`, rồi `kill -9` curl.
2. Theo dõi 10 phút bằng Monitoring REST (`instance_count{state}`, `max_request_concurrencies`), cách đo như trong báo cáo (alignmentPeriod 60 s).
3. Dọn: archive run bằng chính phiên đã tạo (đúng chủ), kiểm tra instance về 0.
4. Ghi kết quả: nếu active kéo dài đến timeout → áp giảm thiểu (a) trong spec: `cloud-run.sh` `--timeout` 900, cập nhật runbook; **không deploy** trừ khi có lệnh. Nếu active tắt ngay → ghi "nguyên nhân là client sống" và hướng tìm.

**Xong khi:** có kết luận bằng số liệu; commit `docs:`/`chore:` cho thay đổi script nếu có.

## T09 — Hồi quy và kiểm tay

1. Trong `lab/`: `pnpm typecheck && pnpm exec vitest run`.
2. e2e theo thứ tự, mỗi lần một launcher: `pnpm test:mock-e2e`; `pnpm test:irsim-e2e -- tests/e2e/irsim-journey.spec.ts`; `pnpm test:irsim-e2e -- tests/e2e/irsim-fleet.spec.ts`; `pnpm test:webots-e2e -- tests/e2e/webots-journey.spec.ts`; `pnpm test:mujoco-e2e -- tests/e2e/mujoco-coffee.spec.ts`.
3. Hồi quy R-MOCK: `node scripts/record-regression.mjs --suite physical-robot-lab --out <ngoài cây>/regression` (outside both trees); không commit bản ghi này trừ khi có kế hoạch ghi nhận riêng.
4. Tay trên Chrome theo các bước của báo cáo (mock ×4, IR-SIM ×2, Webots ×3, MuJoCo); mỗi F có hình xác nhận.
5. Dọn: dừng launcher, không còn tiến trình Webots/worker, `git -C lab status` chỉ có thay đổi dự định.

## T10 — Tài liệu và đóng

- Cập nhật báo cáo `smoke-local-cloud-2026-11-14.md`: cột "trạng thái" của từng F (đã sửa/đã đo/mở), số đo T07 và T08, kết quả thử watch.
- Cập nhật `docs/implementation/verification.md` bằng một dòng trỏ tới báo cáo (nếu file có mục tương ứng).
- Không sửa `CLAUDE.md` trừ khi người dùng yêu cầu; không ghi `acceptance.json`; không viết `accepted:true`.

## T11 — F7: runbook (sau T03 và kết quả T08)

**Tệp:** `docs/operations/lab-runtime-cloud-run.md` (mục dọn run và mục 8 chi phí).

1. Thêm: quyền sở hữu run theo phiên; khóa không archive run phiên khác; cách giải phóng slot (Đóng lần chạy; chờ phiên hết hạn ≤ 1 giờ; tạo revision mới); `ORIGIN_REQUIRED` cho client ngoài trình duyệt; ghi chú instance active tính tiền sau khi đóng tab (theo kết quả T08).
2. Đối chiếu giá Cloud Run với bảng giá chính thức; sửa hoặc xác nhận con số 0,14616 USD/giờ và hạn mức free tier (Singapore Tier 2 có được hưởng hay không: ghi nguồn).

**Xong khi:** runbook khớp với hành vi đã đo; commit `docs:`.

---

## Tiêu chí hoàn thành toàn plan

- T01, T02, T03, T04, T05, T06 hợp nhất trong `lab/main` (chưa đẩy), mỗi cái có test thất bại trước và đạt sau.
- T09 đạt toàn bộ; T07 và T08 có kết luận bằng số liệu hoặc ghi rõ "không tái hiện".
- T10, T11 hoàn tất.
- Không bản ghi bằng chứng cũ bị sửa; không gate nào đổi trạng thái; không deploy production.
- Việc chưa làm được nêu rõ trong báo cáo: kiểm tay Chrome/Firefox/Safari, `acceptance.json`, đối chiếu giá nếu không truy cập được nguồn chính thức.
