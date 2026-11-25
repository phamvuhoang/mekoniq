# Gộp `lab` vào `source` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Đây là plan đề xuất; chưa được bắt đầu khi [spec](01-spec.md) chưa duyệt. M7–M10 cần lệnh riêng của người dùng cho từng bước ghi `Lệnh người dùng`. Người dùng đã chốt ngày 20/11: cutover sau khi R4 về `main`; Lab ở `lab.mekoniq.app`; marketing về `mekoniq.app`.

**Goal:** Một repo `phamvuhoang/mekoniq` chứa Lab tại `apps/lab`, lịch sử và SHA của cả hai còn nguyên, pin và evidence giữ ngữ nghĩa cũ; Lab phục vụ tại `lab.mekoniq.app`, trang marketing tại `mekoniq.app`.

**Architecture:** Nhập Lab bằng `git subtree add` vào một clone riêng, thêm bốn commit sửa (workspace, đường dẫn, định danh, tài liệu), kiểm trong clone. Cutover là fast-forward `main` của `source` tới nhánh đã kiểm, chuyển trạng thái local của Lab, rồi nối lại project Vercel.

**Tech Stack:** Git (subtree), Node 24.22.2, pnpm 10.32.1, TypeScript/Vitest/Playwright hiện có, Vercel CLI, gcloud. Không thêm thư viện.

**Spec:** [01-spec.md](01-spec.md). Các bước domain viết gọn ở [03-domain-guide.md](03-domain-guide.md).

**Thời điểm:** M7 chỉ chạy sau khi R4 đã fast-forward về `main` ở cả hai repo. M0–M6 có thể chạy thử sớm, nhưng R4 còn sửa script và recorder, nên bốn commit sửa phải làm lại hoặc cherry-pick trên `main` sau R4. Kinh tế nhất: chạy M0–M6 ngay sau khi R4 về `main`. Trong plan này `P` là pin trên `lab/main` tại lúc bắt đầu M0 (hôm nay `3d8c2a8`).

Ký hiệu: `R=/Users/hoangpham/source/prv/robot`, `C=$R/.worktrees/merge-monorepo` (clone diễn tập). Lệnh `pnpm`/`node` chạy tại root của `C` trừ khi ghi khác.

## Global Constraints

- Node 24.22.2 (`export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"`), pnpm 10.32.1. Lệnh dài chạy dưới `perl -e 'alarm N; exec @ARGV' …`.
- **M0–M6 không ghi gì vào `$R/source` và `$R/lab`.** Chỉ `git clone`/`git fetch` từ chúng (chỉ đọc). Không `git gc`, không đổi nhánh, không cài gì trong hai cây đó.
- Không dùng cổng 4175/4176/4185/4186 khi `lsof -nP -iTCP:<cổng> -sTCP:LISTEN` cho thấy đang có tiến trình. Không chạy việc nặng CPU khi phiên khác đang ghi evidence.
- Không rewrite lịch sử, không `--squash`, không force push. Không sửa byte nào dưới `docs/implementation/evidence/` và `apps/lab/docs/`.
- Không sửa file trong tool closure: `robotics/**`, `packages/contracts/schemas/**`, `integrations/arm-controller/**`, `tests/fixtures/digital-twin/**`.
- Không commit pin trên `main`. Pin trên `main` phải còn là `P` khi kết thúc M7.
- Không ghi `accepted:true`. Lần gộp không đóng gate nào.
- Không push `main`, không đổi Vercel, Cloud Run hay GitHub khi chưa có lệnh riêng. Push `main` là deploy production.
- Không đụng `trial/`, cổng 1880/1884. Không sửa nội dung `web/`; M9 chỉ đổi cấu hình domain của project.
- Commit: tiền tố `build:`/`fix:`/`feat:`/`test:`/`docs:`/`chore:`, kết thúc bằng `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. Sau commit pin diễn tập, `sourceCommit()` có đúng bằng `pin.sourceCommit` không, kể cả khi lịch sử có merge (Task M5, M6).
2. Digest portable tools của bản export ở đầu nhánh gộp có bằng `portableToolsDigest` của pin `P` không (Task M6).
3. `git diff pnpm-lock.yaml` có dòng bị xóa nào không (Task M3).
4. `prepare-mujoco-r2a-core.mjs` đọc được file Lab ở cả commit trước và sau khi gộp (Task M5).
5. Sau khi nối lại Vercel, một push chỉ đổi `packages/` có build lại `cloud-web` không (Task M7).

## Thứ tự và điểm dừng

```mermaid
flowchart LR
  M0[M0 Baseline] --> M2[M2 Nhập] --> M3[M3 Workspace] --> M4[M4 Đường dẫn] --> M5[M5 Định danh] --> M6[M6 Kiểm trong clone]
  M6 -. "lệnh người dùng, hai cây sạch" .-> M7[M7 Cutover]
  M7 -. "lệnh người dùng" .-> M8[M8 lab.mekoniq.app] -. "lệnh người dùng" .-> M9[M9 Marketing về mekoniq.app] --> M10[M10 Đóng]
```

Không có M1 (việc dựng clone nằm trong M0). M8 và M9 về kỹ thuật không phụ thuộc M2–M7; xếp sau M7 theo ý người dùng ("sau khi xong").

| Task | Ước lượng | Đụng hai cây đang dùng |
|---|---|---|
| M0–M6 | 1–2 ngày | Không |
| M7 | 1–2 giờ | Có, cần tạm dừng |
| M8 | 30 phút | Không |
| M9 | 15 phút | Không |
| M10 | 1 giờ, cộng một việc sau 14 ngày | Không |

---

### Task M0: Clone diễn tập và baseline

**Files:** Create `$C` (clone, ngoài mọi repo đang dùng).

- [ ] Ghi lại SHA của `main` ở hai repo và pin `P`: `git -C $R/source rev-parse main`, `git -C $R/lab rev-parse main`, `git -C $R/lab show main:config/source-runtime.lock.json | grep sourceCommit`. Tại thời điểm viết (trước khi R4 về `main`): `33847b9`, `65a4593`, `P` = `3d8c2a8`.
- [ ] `git clone "$R/source" "$C" && cd "$C" && git remote add lab "$R/lab" && git fetch lab`. Clone local dùng hardlink, không chép 1,8 GB.
- [ ] `printf '.venv*\n' >> .git/info/exclude`, rồi `for v in "$R"/source/.venv*; do ln -s "$v" .; done` (dùng lại venv đã cấp; symlink không được để lọt vào `git status`).
- [ ] `git checkout --detach origin/main && pnpm install --frozen-lockfile`.
- [ ] Baseline source: `perl -e 'alarm 1800; exec @ARGV' pnpm test:unit 2>&1 | tail -6`. Ghi số file test và số test.
- [ ] Baseline guard: chạy guard của mọi record đang nằm trong cây, theo đúng lệnh trong tài liệu trạng thái mới nhất dưới `source/docs/implementation/` (hôm nay là `web-lab-to-physical/status-2026-11-19.md`, năm guard, archive đã giải nén ở `$R/evidence-archive/raw-3d8c2a8-lab-4b57a9a/`; sau R4 sẽ có thêm record của R4). Lưu đầu ra vào `$C/../merge-baseline-guards.txt`.
- [ ] Baseline Lab: `git clone "$R/lab" "$R/.worktrees/merge-lab-baseline" && cd "$R/.worktrees/merge-lab-baseline" && git checkout --detach origin/main && pnpm install --frozen-lockfile && pnpm typecheck && pnpm exec vitest run tests/unit 2>&1 | tail -6`. Ghi số liệu, rồi xóa clone này.

Không commit.

### Task M2: Nhập Lab, giữ lịch sử

**Files:** Create `apps/lab/**` (2.195 file, từ `lab/main`).

- [ ] `cd "$C" && git checkout -b merge/monorepo origin/main`. Lưu ý: clone đã có sẵn một nhánh local tên `r4/virtual-commissioning`; đừng tạo nhánh tên `r4`.
- [ ] `git subtree add --prefix=apps/lab lab main -m "chore: import the Robot Lab repository under apps/lab"`.
- [ ] Verify MG-01: `test "$(git rev-parse HEAD:apps/lab)" = "$(git rev-parse 'lab/main^{tree}')" && echo SAME`. Expected: `SAME`.
- [ ] Verify MG-02: `git cat-file -t 4b57a9a` → `commit`; `git show 4b57a9a:config/source-runtime.lock.json | grep sourceCommit` → `3d8c2a8…`. Lặp cho mọi SHA Lab trong các tài liệu trạng thái và record đang nằm trong cây.
- [ ] Verify định danh trước khi sửa gì: `git log -1 --format=%h -- . ':(exclude)apps/lab'` → SHA của `origin/main`; `git log -1 --format=%h -- apps/lab` → SHA của merge commit vừa tạo.
- [ ] `git tag merge-import` (tag local, để M5 và M6 so sánh).

Commit đã do `git subtree add` tạo.

### Task M3: Lab thành thành viên workspace

**Files:** Delete `apps/lab/pnpm-lock.yaml`. Modify `pnpm-lock.yaml`, `tsconfig.json`, `package.json`, `apps/lab/vercel.json`, `.github/workflows/ci.yml`; có thể `eslint.config.mjs`.

- [ ] `git rm apps/lab/pnpm-lock.yaml && pnpm install`.
- [ ] Verify MG-07: `git diff pnpm-lock.yaml | grep -E '^-[^-]'` → không có dòng nào. Nếu có, dừng và xem phụ thuộc nào của package cũ bị đổi phiên bản.
- [ ] `tsconfig.json`: thêm `"apps/lab"` vào `exclude`.
- [ ] `package.json`, script `typecheck`: nối `&& pnpm --filter mekoniq-robot-lab typecheck`.
- [ ] `apps/lab/vercel.json`: `"installCommand": "cd ../.. && pnpm install --frozen-lockfile"`. Các trường khác giữ nguyên.
- [ ] `.github/workflows/ci.yml`, dòng test của job `verify`: nối `&& pnpm --filter mekoniq-robot-lab test:unit`.
- [ ] Run: `pnpm exec eslint apps/lab`. Nếu 0 lỗi: không sửa gì. Nếu có lỗi: thêm `'apps/lab/**'` vào `ignores` của `eslint.config.mjs` kèm một dòng comment ghi số lỗi và rằng việc bật lint cho Lab là việc riêng.
- [ ] Run: `pnpm contracts:check && pnpm typecheck && pnpm lint && pnpm build`. Expected: exit 0; `apps/lab/dist/source-runtime.lock.json` tồn tại và có `sourceCommit` bằng `P`.
- [ ] Run: `pnpm --filter mekoniq-robot-lab test:unit`. Expected: số file và số test bằng baseline Lab của M0.
- [ ] Commit `build: make the Robot Lab a workspace member`.

### Task M4: Đường dẫn chéo

**Files:** Modify trong `apps/lab/scripts/`: `measure-cell-production.ts`, `record-regression.mjs`, `start-irsim.mjs`, `sync-engineering-contracts.mjs`, `production-build-identity.ts`. Modify trong `apps/lab/tests/integration/`: `arm-evidence.test.ts`, `irsim-launcher.test.ts`, `mujoco-launcher.test.ts`, `simulation-capability.test.ts`, `source-report-import.test.ts`. Modify `scripts/record-sim-extension-r3.mjs`, `tests/unit/sim-extension-qualification.test.ts`.

- [ ] Lab → source: root source từ `apps/lab` là `../..` (từ `apps/lab/scripts` và `apps/lab/tests/integration` là `../../..`). Mặc định `--source` của `start-irsim.mjs:68` thành `resolve(lab,'../..')`.
- [ ] Source → Lab: `record-sim-extension-r3.mjs:17` mặc định `join(root,'apps/lab')`; `sim-extension-qualification.test.ts:224` `LAB_ROOT='apps/lab'`.
- [ ] Giữ nguyên các test tự dựng thư mục tạm có `lab/` và `source/` cạnh nhau rồi truyền `--source` (ví dụ `irsim-launcher.test.ts:70-86`); chỉ sửa chỗ chúng chép file từ checkout thật.
- [ ] Verify: `git grep -nE "\.\./source\b|'\.\./lab'" -- apps/lab/scripts apps/lab/tests apps/lab/src scripts tests packages`. Expected: chỉ còn các dòng dựng bố cục tạm đã nêu; đọc từng dòng còn lại và ghi lý do giữ vào message commit.
- [ ] Run: `pnpm typecheck && pnpm --filter mekoniq-robot-lab test:unit && pnpm test:unit -- tests/unit/sim-extension-qualification.test.ts`. Expected: PASS. Test thứ ba giờ kiểm cả các suite có `repo:'lab'` vì `LAB_ROOT` luôn tồn tại.
- [ ] Commit `fix: resolve source and Lab paths inside one repository`.

Integration của Lab cần runtime đã cài; chúng chạy ở M6 (mock) và M7 (đầy đủ).

### Task M5: Định danh source và Lab theo đường dẫn

**Files:** Create `scripts/repo-identity.mjs`, `tests/unit/repo-identity.test.ts`. Modify `scripts/export-lab-runtime.mjs:16,27`, `deploy/lab-runtime/build.sh:16-17`, `scripts/record-irsim.mjs:39`, `scripts/record-sim-extension.mjs:104`, `scripts/record-sim-extension-r2b.mjs:19-20,35`, `scripts/record-sim-extension-r3.mjs`, `tests/support/regression-identity.ts:17-23`, `scripts/native-sim/prepare-mujoco-r2a-core.mjs:14`, `apps/lab/scripts/sync-engineering-contracts.mjs:14`, `apps/lab/scripts/production-build-identity.ts:9`.

- [ ] Dò lại danh sách chỗ gọi trên `main` hiện tại, vì R4 có thể đã thêm recorder: `git grep -nE "rev-parse','HEAD'|'status','--porcelain'|rev-parse HEAD|status --porcelain" -- scripts tests/support deploy apps/lab/scripts`. Mọi dòng liên quan tới cặp (source, Lab) đều phải đổi; ghi các dòng cố ý giữ `HEAD` vào message commit.
- [ ] Viết test trước (`tests/unit/repo-identity.test.ts`), dựng repo tạm bằng `git init` trong `mkdtemp`:
  - commit A đụng `README.md`, commit B chỉ đụng `apps/lab/x` → `sourceCommit` = A, `labCommit` = B;
  - commit C đụng cả hai → cả hai = C;
  - sửa `README.md` chưa commit → `sourceDirty` khác rỗng, `labDirty` rỗng; thêm file mới dưới `apps/lab/` → ngược lại;
  - nhánh phụ đụng `apps/lab/y`, merge về bằng `--no-ff` → `sourceCommit` vẫn là commit cuối đụng phía ngoài.
- [ ] Run test. Expected: FAIL vì chưa có module.
- [ ] Viết `scripts/repo-identity.mjs`:

```js
// One repository holds source and the Lab. "source" is every path outside apps/lab; the Lab is apps/lab.
// Recorders, the runtime export and the image build still bind a (source, Lab) pair through these four reads.
import {execFileSync} from 'node:child_process';
export const LAB_PREFIX='apps/lab';
const git=(root,...a)=>execFileSync('git',['-C',root,...a],{encoding:'utf8',maxBuffer:64*1024*1024}).trim();
const SOURCE=['--','.',`:(exclude)${LAB_PREFIX}`],LAB=['--',LAB_PREFIX];
export const sourceCommit=(root)=>git(root,'log','-1','--format=%H',...SOURCE);
export const labCommit=(root)=>git(root,'log','-1','--format=%H',...LAB);
export const sourceDirty=(root)=>git(root,'status','--porcelain','--untracked-files=all',...SOURCE);
export const labDirty=(root)=>git(root,'status','--porcelain','--untracked-files=all',...LAB);
```

- [ ] Run test. Expected: PASS.
- [ ] Thay các lệnh `rev-parse HEAD` và `status --porcelain` ở những file đã liệt kê bằng bốn hàm trên. `build.sh` là shell: dùng trực tiếp hai lệnh git có pathspec như trong [spec §5.3](01-spec.md#53-định-danh-source-và-lab-trong-một-repo-mg-d02).
- [ ] `regression-identity.ts`: phía source bỏ các entry dưới `apps/lab/`; phía Lab chỉ lấy entry dưới `apps/lab/` và cắt tiền tố trước khi áp `LAB_EVIDENCE_MUTABLE_PATHS`; commit và danh sách đường dẫn bẩn theo phía. Cập nhật `tests/unit/lab-regression-identity.test.ts` cho bố cục mới.
- [ ] Verify `codeHash` so được qua điểm gộp: tại tag `merge-import`, hash liệt kê Lab đã cắt tiền tố phải bằng hash liệt kê `lab/main`, và hash liệt kê source đã bỏ `apps/lab/` phải bằng hash liệt kê `origin/main`:

```sh
t=$(printf '\t')
[ "$(git ls-tree -r merge-import -- apps/lab | sed "s|${t}apps/lab/|${t}|" | shasum -a 256)" = "$(git ls-tree -r lab/main | shasum -a 256)" ] && echo LAB_SAME
[ "$(git ls-tree -r merge-import | grep -v "${t}apps/lab/" | shasum -a 256)" = "$(git ls-tree -r origin/main | shasum -a 256)" ] && echo SOURCE_SAME
```

  Expected: `LAB_SAME`, `SOURCE_SAME`.
- [ ] `prepare-mujoco-r2a-core.mjs:14`: đọc `<labCommit>:apps/lab/config/source-runtime.lock.json`, nếu Git báo không có đường dẫn thì đọc `<labCommit>:config/source-runtime.lock.json`. Thêm một ca test cho mỗi nhánh (commit `4b57a9a` cho nhánh cũ).
- [ ] Thêm test grep cho MG-10 vào `tests/unit/repo-identity.test.ts`: `git grep -nE "apps/lab" -- packages robotics` rỗng, và `git grep -nE "from ['\"](\.\./){2,}(packages|scripts|tests|robotics)" -- apps/lab/src` rỗng.
- [ ] Run: `pnpm typecheck && pnpm lint && pnpm test:unit -- tests/unit/repo-identity.test.ts tests/unit/lab-regression-identity.test.ts tests/unit/irsim-qualification.test.ts tests/unit/sim-extension-qualification.test.ts tests/unit/mujoco-native-probe.test.ts`. Expected: PASS.
- [ ] Commit `feat: derive source and Lab identity from paths in one repository`.

### Task M6: Kiểm trong clone

Không tạo commit trên `merge/monorepo` ngoài commit tài liệu ở bước cuối.

- [ ] Run đủ bộ tĩnh: `pnpm install --frozen-lockfile && pnpm contracts:check && pnpm typecheck && pnpm lint && pnpm build`. Expected: exit 0 (MG-06).
- [ ] Run: `perl -e 'alarm 1800; exec @ARGV' pnpm test:unit`. Expected: số file và số test không ít hơn baseline M0, không test nào fail (MG-08).
- [ ] Run lại các guard như M0, so với `merge-baseline-guards.txt`. Expected: cùng kết quả (MG-05).
- [ ] MG-12: `git diff --stat merge-import HEAD -- docs/implementation/evidence apps/lab/docs` → rỗng.
- [ ] MG-04: `node scripts/export-lab-runtime.mjs "$TMPDIR/merge-export"`; so digest portable tools trong `manifest.json` của bản export với `portableToolsDigest` trong `apps/lab/config/source-runtime.lock.json`. Expected: bằng nhau. `sourceCommit` của manifest phải bằng `git log -1 --format=%H -- . ':(exclude)apps/lab'`.
- [ ] MG-09, diễn tập vòng pin trên nhánh vứt đi:

```sh
git checkout -b rehearsal/pin
cd apps/lab && node scripts/import-runtime.mjs "$TMPDIR/merge-export" && node scripts/sync-engineering-contracts.mjs && pnpm check:source && cd ../..
git add apps/lab && git commit -m "chore: pin source runtime $(git log -1 --format=%h -- . ':(exclude)apps/lab')"
node -e "import('./scripts/repo-identity.mjs').then(async i=>{const p=JSON.parse((await import('node:fs')).readFileSync('apps/lab/config/source-runtime.lock.json','utf8'));console.log(p.sourceCommit===i.sourceCommit('.'),i.sourceDirty('.')==='',i.labDirty('.')==='')})"
```

  Expected: `true true true`, và `git show --stat HEAD` chỉ liệt kê file dưới `apps/lab/`.
- [ ] Nếu cổng 4175/4176 rảnh: `cd apps/lab && pnpm test:mock-e2e`. Expected: PASS. Nếu cổng bận, ghi `not_run` và để lại cho M7.
- [ ] `git checkout merge/monorepo && git branch -D rehearsal/pin`. Nhánh diễn tập không được đi tiếp.
- [ ] Sửa tài liệu trong repo: `README.md` (root), `apps/lab/README.md`, `deploy/lab-runtime/README.md`, `packages/lab-runtime/README.md`: đường dẫn Lab, lệnh `cd apps/lab`, quy tắc commit pin trong một repo. Commit `docs: describe the single-repository layout`.
- [ ] Ghi kết quả M0–M6 (SHA, số test, đầu ra guard, các mục `not_run`) vào `$R/docs/2026-11-20-codebase-merge/rehearsal-<ngày>.md`.

Kết thúc M6: `merge/monorepo` = `origin/main` + 1 merge commit + 4 commit sửa. **Dừng, chờ lệnh.**

---

### Task M7: Cutover

**Lệnh người dùng:** bắt đầu cutover; push `main`; đổi cấu hình Vercel. Ba lệnh riêng.

**Điều kiện đầu** (thiếu một điều là không bắt đầu):

- [ ] R4 đã fast-forward về `main` ở cả hai repo và đã push: `git -C $R/source branch --merged main` và `git -C $R/lab branch --merged main` đều có `r4/virtual-commissioning`; `git -C $R/source status -sb` và `git -C $R/lab status -sb` trên `main` không báo `ahead`.
- [ ] Người dùng xác nhận không phiên nào đang làm việc trong `source/` hay `lab/`.
- [ ] `git -C $R/source status --porcelain` và `git -C $R/lab status --porcelain` đều rỗng.
- [ ] `lsof -nP -iTCP:4175 -iTCP:4176 -iTCP:4185 -iTCP:4186 -sTCP:LISTEN` rỗng.
- [ ] `git -C $R/source rev-parse main` bằng `git -C $C merge-base merge/monorepo origin/main`, và `git -C $R/lab rev-parse main` bằng commit đã nhập. Nếu một bên đã đi tiếp: trong `$C`, tạo lại nhánh từ `main` mới, chạy lại M2, `git cherry-pick` bốn commit sửa, chạy lại bộ tĩnh và unit của M6.

**Bước**

- [ ] Sao lưu: `git -C $R/source tag pre-merge/source-main main && git -C $R/lab tag pre-merge/lab-main main` (tag local).
- [ ] `git -C $R/source fetch "$C" merge/monorepo:merge/monorepo && git -C $R/source checkout main && git -C $R/source merge --ff-only merge/monorepo`. Expected: fast-forward.
- [ ] Chuyển trạng thái local của Lab:

```sh
cd $R && mv lab lab.pre-merge-$(date +%F)
for d in .runtime runs releases .superpowers; do [ -e lab.pre-merge-*/$d ] && mv lab.pre-merge-*/$d source/apps/lab/; done
ln -s source/apps/lab lab
cd source && pnpm install --frozen-lockfile && git status --porcelain
```

  Expected: `git status --porcelain` rỗng (bốn thư mục vừa chuyển đều bị `apps/lab/.gitignore` bỏ qua).
- [ ] Trên `main`: `cd $R/source/apps/lab && pnpm check:source`. Expected: `Verified source <P>…`.
- [ ] Kiểm local đầy đủ trên `main`: `pnpm test:unit` (root); tại `apps/lab`: `pnpm exec vitest run`, `pnpm test:mock-e2e`, một spec `pnpm test:irsim-e2e -- <spec>`, một spec `pnpm test:mujoco-e2e -- <spec>`; mở `pnpm lab:mujoco` và chạy MJ-BV01 một lần. Expected: PASS, cùng hành vi như trước khi gộp.
- [ ] Kiểm symlink: `cd $R/lab && pnpm typecheck`. Expected: PASS.
- [ ] **Lệnh người dùng (push):** `git -C $R/source push origin main`. Project `mekoniq` build `cloud-web`. Smoke: `GET https://www.mekoniq.app/health/live`, `GET /health/ready` → `{"ready":true}`. Lần gộp không thêm migration nên không cần `supabase db push`.
- [ ] **Lệnh người dùng (Vercel):** với project `mekoniq-lab` (team `henry-projects`): nối Git sang `phamvuhoang/mekoniq` (`vercel git connect https://github.com/phamvuhoang/mekoniq.git --project mekoniq-lab`), đặt Root Directory `apps/lab` (Settings → Build and Deployment, hoặc `PATCH /v9/projects/mekoniq-lab` với `{"rootDirectory":"apps/lab"}` qua `vercel api`). Ở cả hai project `mekoniq` và `mekoniq-lab`, tắt tùy chọn tự bỏ qua deployment khi root directory và phụ thuộc không đổi. Deploy lại `mekoniq-lab` từ `main`.
- [ ] MG-11: `curl -s https://mekoniq-lab.vercel.app/source-runtime.lock.json` và `curl -s https://mekoniq-lab-runtime-ojykcqdkja-as.a.run.app/lab/v2/health`. Expected: cùng `sourceCommit`, bằng `P`. Mở trang, phát một bản ghi mẫu.
- [ ] Review Focus 5: ở lần push kế tiếp chỉ đổi `packages/`, xác nhận project `mekoniq` có build.

**Đường lùi**

| Thời điểm | Cách lùi |
|---|---|
| Trước khi push | `git -C $R/source checkout main && git reset --hard pre-merge/source-main` (chỉ khi chưa push và cây sạch; đây là lệnh hủy, hỏi người dùng trước); `rm $R/lab` (symlink); chuyển bốn thư mục về và `mv lab.pre-merge-* lab` |
| Sau khi push, trước khi nối Vercel | Lab trên web chưa đổi gì. `git revert` bốn commit sửa và `git revert -m 1 <merge nhập>`, push; không force push |
| Sau khi nối Vercel | Nối `mekoniq-lab` lại repo `mekoniq-lab`, bỏ Root Directory, deploy lại; repo cũ chưa bị đụng tới trước M10 |

### Task M8: Domain `lab.mekoniq.app`

**Lệnh người dùng:** thêm domain; cập nhật Cloud Run. Hai lệnh riêng. Bản gọn cho người làm tay: [hướng dẫn 03, phần A](03-domain-guide.md#a-lab-về-labmekoniqapp). Không phát sinh chi phí ([spec §5.7](01-spec.md#57-vercel-và-domain-mg-d04)).

**Files:** Modify `deploy/lab-runtime/mekoniq.env.example:6`, `deploy/lab-runtime/README.md:33` (ví dụ origin).

- [ ] **Lệnh người dùng:** `vercel domains add lab.mekoniq.app mekoniq-lab --scope henry-projects`. Verify: `curl -sI https://lab.mekoniq.app | head -1` → `200`; `/source-runtime.lock.json` trả đúng pin. Lúc này cả hai địa chỉ mở được UI; chỉ địa chỉ cũ ghép được với cloud.
- [ ] **Lệnh người dùng (thay đổi production):** `gcloud run services update mekoniq-lab-runtime --project=mekoniq --region=asia-southeast1 --update-env-vars=LAB_ALLOW_ORIGIN=https://lab.mekoniq.app`. Lệnh tạo revision mới; run đang chạy trên runtime cloud sẽ mất. Verify: `GET /lab/v2/health` vẫn báo đúng commit của pin; người dùng (giữ khóa truy cập) ghép từ `https://lab.mekoniq.app` và chạy một bước.
- [ ] Đặt chuyển hướng `mekoniq-lab.vercel.app` → `lab.mekoniq.app` trong cấu hình domain của project.
- [ ] Sửa hai file ví dụ, commit `docs: point the cloud runtime origin at lab.mekoniq.app`. Commit này đụng phía source: nhánh nào sắp ghi evidence phải pin lại như thường lệ.

Không ghi evidence cloud mới ở đây; chỉ kiểm tay. Lần smoke có record kế tiếp thuộc release sau và chạy với origin mới.

### Task M9: Trang marketing về `mekoniq.app`

**Lệnh người dùng:** đổi chủ của `mekoniq.app` giữa hai project. Một lệnh. Bản gọn: [hướng dẫn 03, phần B](03-domain-guide.md#b-trang-marketing-về-mekoniqapp). Lý do xếp hostname: [spec §5.12](01-spec.md#512-trang-marketing-về-mekoniqapp-mg-d06).

**Files:** không có. Không sửa repo `web/`.

- [ ] Trước khi làm: `curl -sI https://mekoniq.app | head -3` (ghi lại 308 và `location`), `curl -s https://www.mekoniq.app/health/ready` → `{"ready":true}`.
- [ ] **Lệnh người dùng:** gỡ `mekoniq.app` khỏi project `mekoniq` (Dashboard → Settings → Domains → Remove; giữ `www.mekoniq.app`). **Không dùng `vercel domains rm`**, lệnh đó gỡ domain khỏi cả tài khoản.
- [ ] `vercel domains add mekoniq.app mekoniq-serve --scope henry-projects`.
- [ ] MG-13: `curl -sI https://mekoniq.app | head -1` → `200`; nội dung là `web/index.html`; `curl -s https://www.mekoniq.app/health/ready` → `{"ready":true}`; đăng nhập app ở `www` như cũ.
- [ ] Hỏi người dùng có link `mekoniq.app/<đường dẫn app>` nào đang lưu hành không. Nếu có: thêm redirect cho các đường dẫn đó vào `web/vercel.json` (việc trong repo `web/`, cần lệnh riêng).

Đường lùi: gỡ `mekoniq.app` khỏi `mekoniq-serve`, thêm lại vào `mekoniq` với Redirect to `www.mekoniq.app`.

### Task M10: Đóng

- [ ] Cập nhật `$R/CLAUDE.md` và `$R/AGENTS.md`: workspace còn ba repo; Lab ở `source/apps/lab` (symlink `lab`); một lockfile; quy tắc "commit pin chỉ đụng `apps/lab`"; định danh theo đường dẫn; ba hostname (`www` app, `lab` Lab, tên gốc marketing); bỏ ghi chú R4 về nhánh và pin.
- [ ] Cập nhật bộ nhớ của Claude (`host-toolchain-quirks`, `r4-virtual-commissioning-design`, thêm một mục cho bố cục mới).
- [ ] Thêm một dòng vào `$R/docs/2026-11-19-virtual-commissioning/README.md` §2: từ ngày cutover, `lab/` là `source/apps/lab`.
- [ ] Chép bộ tài liệu này vào `source/docs/` theo cách các bộ trước đã làm, commit `docs: record the repository merge`.
- [ ] **Lệnh người dùng:** archive repo GitHub `phamvuhoang/mekoniq-lab` (chỉ đọc; không xóa).
- [ ] Sau 14 ngày không cần lùi: xóa `$R/lab.pre-merge-*`, `$C`, và hai tag `pre-merge/*`. Xóa thư mục là lệnh hủy; xem nội dung và hỏi người dùng trước.

## Hoàn tất nghĩa là gì

MG-01 tới MG-13 đều có kết quả ghi trong `rehearsal-<ngày>.md` hoặc trong ghi chép của M7; `main` của `phamvuhoang/mekoniq` chứa `apps/lab`; pin trên `main` vẫn là `P`; hai project Vercel build từ một repo; `lab.mekoniq.app` phục vụ Lab và ghép được với runtime cloud; `mekoniq.app` phục vụ trang marketing và `www.mekoniq.app` vẫn là app cloud. Không gate nào được đóng và không record nào được ghi bởi plan này.
