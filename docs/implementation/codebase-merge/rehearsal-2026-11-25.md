# Diễn tập M0–M6 · 2026-11-25

Clone: `robot/.worktrees/merge-monorepo`, nhánh `merge/monorepo` (tag `merge-import` = commit nhập). Không ghi gì vào `robot/source` và `robot/lab`. Chưa push, chưa đổi Vercel/Cloud Run/GitHub. **Dừng trước M7, chờ lệnh.**

## Đầu vào

| Mục | Giá trị |
|---|---|
| source `main` | `6285c490` (R4 đã về `main`, cây sạch, không `ahead`) |
| Lab `main` | `77dcce3`, pin `P` = `0650ecbd` |
| Nhánh còn chưa merge | `feat/lab-digital-twin-v2` trong source (không liên quan R4) |

## Nhánh `merge/monorepo` = `origin/main` + 1 merge nhập + 5 commit

1. `chore: import the Robot Lab repository under apps/lab` (`git subtree add`, không squash)
2. `build: make the Robot Lab a workspace member` (xóa lockfile Lab, `tsconfig` exclude, `typecheck`/CI nối Lab, `vercel.json`, eslint bỏ `apps/lab/**`: 84 lỗi lần đầu)
3. `fix: resolve source and Lab paths inside one repository` (28 file)
4. `feat: derive source and Lab identity from paths in one repository` (`scripts/repo-identity.mjs` + `.d.mts`)
5. `fix: build the offline Lab bundle from the workspace lockfile` (**ngoài plan**, xem Ruling 4)
6. `docs: describe the single-repository layout`

## Kết quả theo yêu cầu

| ID | Kết quả |
|---|---|
| MG-01 | `HEAD:apps/lab` = `lab/main^{tree}` → SAME. Ở tag `merge-import`, `LAB_SAME` và `SOURCE_SAME` (hash liệt kê cây) |
| MG-02 | `4b57a9a`, `a35a4a3`, `de4d0c3`, `f68555b` và mọi `labCommit` trong record tra được (`git cat-file -t` = commit); `labFileAt(…,'4b57a9a',…)` đọc được pin `3d8c2a8` |
| MG-03 | `tests/unit/repo-identity.test.ts` (6 test): commit ngoài/trong/cả hai, dirty mỗi phía, merge `--no-ff`, `labIdentity`, `labFileAt` |
| MG-04 | Export từ cây gộp: `portableToolsDigest` và `schemaHash` bằng pin `P`; `runtime.mjs` giống hệt export của `origin/main` sau khi thay SHA nhúng (cùng 2.965.950 byte, cùng sha256) → pin trên `main` không cần đổi. `artifactSha256` khác chỉ vì SHA nhúng |
| MG-05 | Guard IR-SIM: 110/110 (baseline 109/110: thiếu `../lab`). `cloud-run`: pass (timeout 300 s cứng của test được nâng tạm lên 1.200 s rồi hoàn nguyên, như runbook R4). `sim-extension`: 11/12, test còn lại là timeout 300 s cứng (baseline cũng vậy, 10/12). Chưa chạy riêng: các guard khác ngoài ba guard trên (`linkforge-irsim`, `sim-extension` và `cloud-run` đã bao phủ record R4 và chuỗi trước nó) |
| MG-06 | `pnpm install --frozen-lockfile && contracts:check && typecheck && lint && build` exit 0; `apps/lab/dist/source-runtime.lock.json` có `sourceCommit` = `P` |
| MG-07 | `git diff pnpm-lock.yaml`: 131 dòng thêm, 0 dòng bị xóa |
| MG-08 | Unit source: 176/178 file, 2006/2008 test (baseline 174/177, 1996/1998). 2 fail cuối: `lab-sil-cli` (đã sửa, 5/5), `r4-native-import` (flake khi chạy cả bộ: 24/24 khi chạy riêng). Unit Lab: 92 file, 761 test = baseline. Integration Lab: 109 pass, 1 skip |
| MG-09 | Nhánh vứt đi: export → import → `sync-engineering-contracts` → `check:source` ("Verified source e8aeddd9"); commit pin chỉ đụng 3 file dưới `apps/lab`; `pin.sourceCommit === sourceCommit()`, `sourceDirty` rỗng, `labDirty` rỗng → `true true true`. Nhánh đã xóa |
| MG-10 | Test grep trong `repo-identity.test.ts`: `apps/lab` không xuất hiện trong `packages`, `robotics`; `apps/lab/src` không import ra ngoài |
| MG-12 | `git diff --stat merge-import HEAD -- docs/implementation/evidence apps/lab/docs` rỗng; không file nào trong tool closure bị đụng |
| e2e | `pnpm test:mock-e2e` trong `apps/lab`: pass (cổng 4175/4176 rảnh) |

## Baseline (M0), để so

- Source unit: 3 file fail do môi trường: hai cần `MEKONIQ_RETAINED_INPUTS`, một (`r2b-suite-coverage`) cần `../lab`. Với biến retained inputs (`evidence-archive/retained-corpus-copy/inputs.json`) chỉ còn `r2b-suite-coverage`; sau khi gộp nó pass.
- Lab: 92 file / 761 test, typecheck ổn (chỉ khi có `../source` cạnh bên; clone đơn lẻ không chạy được, đúng như spec §1).

## Ruling

1. **`sourceCommit()` sau khi nhập là `18c906e8`, không phải `origin/main` (`6285c490`).** `6285c490` là merge commit; `git log -- . ':(exclude)apps/lab'` bỏ qua nó. Giống hôm nay: một commit docs ở phía source đã đòi pin lại trước khi ghi evidence. Pin `P` = `0650ecbd` không bằng `sourceCommit()` ngay cả trước khi gộp, nên recorder tiếp theo vẫn cần một vòng pin (không phải do lần gộp).
2. **Giữ `HEAD` ở `packages/lab-runtime/src/v2/sil/native-providers.ts` và `xarm-cli.ts`.** Đó là mã runtime nằm trong artifact đã pin; sửa sẽ đổi `artifactSha256` và buộc re-pin + deploy Cloud Run, trái với spec §5.4. Hệ quả: native X1/X2 ghi `HEAD` của repo và từ chối cây bẩn ở cả `apps/lab`. Fail closed. Dọn khi lần đổi runtime tới đã cần re-pin.
3. **Giữ `HEAD` cho** `release.mjs`, `restore-rehearsal.mjs`, `continuity-suite.ts`, `load-report.ts` (commit nền tảng, không liên quan pin), `r4-cld02.sh` và `native-checker-bootstrap.mjs`, `lab-algorithm.mjs` (định danh của một checkout sạch cho native/CI). CLD02 phải chạy trên commit source trước commit pin, như hôm nay.
4. **Thêm commit `fix: build the offline Lab bundle…`** ngoài plan: `build-offline.mjs` copy `apps/lab/pnpm-lock.yaml` vừa bị xóa; giờ copy lockfile root. Test `offline-bundle` dựng fixture `apps/lab` trong thư mục tạm.
5. **`regression-identity.ts`** nhận biết "gộp" khi `labDirectory === <source>/apps/lab`; ngược lại giữ hành vi hai repo (các test cũ vẫn chạy). Một commit Lab cũ (trước gộp) được băm theo bố cục gốc của nó.
6. **`labIdentity(root, labDir)`** thay cho `git -C lab`: `--lab` ngoài `apps/lab` vẫn dùng `HEAD`/`status` của checkout đó (test recorder dùng thư mục tạm).
7. **`artifacts/src/…` (capture.cjs, digital-twin-status.py, build.py) vẫn đọc `../lab`.** Đó là trình dựng trình chiếu lịch sử; chưa sửa, không chặn gì. Có thể làm sau.
8. **Test `recovery-recorder-entrypoints` mock `repo-identity.mjs`** thay cho mock `execFileSync` (đường đi git đã đổi).

## Còn mở trước M7

- Chưa chạy trong clone: `pnpm test:irsim-e2e`, `test:mujoco-e2e`, `pnpm lab:mujoco` (MJ-BV01) — thuộc M7 theo plan.
- Việc review toàn nhánh bởi một ngữ cảnh mới chưa làm; đây là tự rà soát của người thực hiện (Review Focus 1–4 đã kiểm bằng lệnh ở trên, mục 5 thuộc M7).
- Cutover M7 cần: hai cây `robot/source`, `robot/lab` sạch và không phiên nào đang làm việc; mỗi lệnh ghi (push `main`, đổi Vercel) cần lệnh riêng. `source/main` hiện sạch và bằng `origin/main`.

## Review sau M7 (2026-11-25)

Review bằng ngữ cảnh mới tìm ra năm lỗi, sửa trong một commit `fix:` trên `main` trước khi push. Không đụng tool closure hay mã runtime, nên pin `0650ecbd` giữ nguyên và không cần deploy lại Cloud Run.

1. `native-checker-bootstrap.mjs` ghi `HEAD`, còn `sim-extension-r3.mjs` so với commit source theo đường dẫn: recorder R3 luôn fail `R3_CHECKER_TUPLE`, vì commit pin luôn nằm trên S. Giờ checker lấy commit source theo đường dẫn, viết thẳng lệnh git vì file này chỉ được dùng builtins.
2. Campaign của `lab-mujoco.mjs` ghi `HEAD`, còn `r4-readback.mjs:44` so với commit source: R4/R5 báo `*_TUPLE_MISMATCH` nếu campaign chạy sau commit pin. Giờ dùng `sourceCommit()`.
3. `lab-sil.mjs` truyền commit source theo đường dẫn, còn `native-providers.ts` (runtime đã pin) so với `HEAD`: báo `NATIVE_SOURCE_COMMIT_MISMATCH`. `lab-sil.mjs` trở về `HEAD`; host native phải checkout đúng commit source.
4. `labIdentity` và `isEmbedded` so đường dẫn bằng chuỗi: symlink `robot/lab` hoặc dấu `/` cuối rơi về chế độ hai repo. Giờ so theo `realpath`.
5. `labFileAt` nuốt mọi lỗi Git. Giờ chỉ thử lại ở root khi Git báo không có đường dẫn (`LC_ALL=C`).

`tests/unit/repo-identity.test.ts` có thêm ca symlink, ca lỗi khác và một test liệt kê mọi chỗ còn đọc `rev-parse HEAD` kèm lý do; một chỗ đọc mới phải được duyệt.

## M7 hoàn tất và M8 (2026-11-25)

- Vercel (người dùng làm): `mekoniq-lab` nối `phamvuhoang/mekoniq`, Root Directory `apps/lab`, `enableAffectedProjectsDeployments=false` ở cả `mekoniq` và `mekoniq-lab`; cả hai production build từ `c7df3381`. MG-11: `mekoniq-lab.vercel.app/source-runtime.lock.json` và Cloud Run `/lab/v2/health` cùng `0650ecbd`. Review Focus 5 chờ lần push kế tiếp chỉ đổi `packages/`.
- M8.1: `lab.mekoniq.app` gắn vào `mekoniq-lab`; `200`, pin `0650ecbd`.
- M8.2 (lệnh người dùng): Cloud Run `LAB_ALLOW_ORIGIN=https://lab.mekoniq.app`, revision `mekoniq-lab-runtime-00005-s68` (image `sha256:1333d28d…` không đổi). Preflight `OPTIONS /lab/v2/sessions`: origin mới `204` + allow-origin, origin cũ `403`. Lùi: chạy lại với `https://mekoniq-lab.vercel.app` hoặc chuyển traffic về `00004-92t`.
- M8.3: người dùng ghép bằng khóa ở `https://lab.mekoniq.app` (Bản sao số → Địa chỉ khác); panel báo Lab ghim `0650ecb` = Runtime chạy `0650ecb`. Chạy MJ-BV01 (MuJoCo xArm 6) tới tick 250 (5.0 s), rồi Hủy lần chạy → `Đã hủy`, Ngắt kết nối, đóng tab. Kiểm tay, không ghi evidence.
- M8.4: `mekoniq-lab.vercel.app` → `308` `lab.mekoniq.app` (PATCH `/v9/projects/mekoniq-lab/domains/mekoniq-lab.vercel.app`).
- M8.5: commit `4c8dbef3` `docs: point the cloud runtime origin at lab.mekoniq.app` (hai file ví dụ + runbook `docs/operations/lab-runtime-cloud-run.md`; `mekoniq.env.example` sửa luôn image về `sha256:1333d28d…` của R4). Chưa push.
- Cloud Run không đặt min-instances và tính CPU theo request: không còn kết nối thì về 0 instance.

## M9 (2026-11-25)

- Trước: `mekoniq.app` thuộc project `mekoniq`, `308` → `https://www.mekoniq.app/`; `www/health/ready` `{"ready":true}`.
- Người dùng gỡ `mekoniq.app` khỏi project `mekoniq` (`DELETE /v9/projects/mekoniq/domains/mekoniq.app`; domain vẫn trong tài khoản). Gắn vào `mekoniq-serve` (`POST /v10/projects/mekoniq-serve/domains`, verified).
- MG-13: `https://mekoniq.app/` `200`, sha256 thân trang = `web/index.html` (`90841c4b…`); `www.mekoniq.app/health/ready` `{"ready":true}`, `/health/live` `{"live":true}`, `www` trả `200`. Project `mekoniq` còn `www.mekoniq.app`, `mekoniq.vercel.app`.
- Người dùng xác nhận không có link `mekoniq.app/<đường dẫn app>` nào đang lưu hành: không thêm redirect vào `web/vercel.json`.
- Lùi: gỡ `mekoniq.app` khỏi `mekoniq-serve`, thêm lại vào `mekoniq` với redirect `www.mekoniq.app` (308).

## M10 (2026-11-25)

- `CLAUDE.md` và `AGENTS.md` ở workspace: ba repo; `lab` → `source/apps/lab`; một lockfile; commit pin chỉ đụng `apps/lab`; định danh theo đường dẫn (ngoại lệ runtime đã ghim còn dùng HEAD); ba hostname; origin Cloud Run; bỏ ghi chú nhánh R4.
- Bộ nhớ Claude: `codebase-merge-design`, `r4-virtual-commissioning-design`, `host-toolchain-quirks` cập nhật; thêm `workspace-layout-after-merge`.
- `docs/2026-11-19-virtual-commissioning/README.md` §2: thêm dòng cutover.
- Bộ tài liệu chép vào `source/docs/implementation/codebase-merge/` (`design/` + bản ghi này), mục mới trong `docs/implementation/README.md`; commit `docs: record the repository merge`.
- Còn lại: archive `phamvuhoang/mekoniq-lab` (lệnh người dùng); sau 2026-12-09 xóa `lab.pre-merge-2026-11-25`, `.worktrees/merge-monorepo`, tag `pre-merge/*` (xem và hỏi trước); Review Focus 5 ở lần push chỉ đổi `packages/`.
