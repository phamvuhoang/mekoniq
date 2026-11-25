# Spec — Gộp `lab` vào `source`

**Trạng thái:** đề xuất; ba hướng đã chốt với người dùng ngày 20/11 ([README §0](README.md#0-hướng-đã-chốt-với-người-dùng-2011)) · **Ngày:** 2026-11-20 · [Tổng quan](README.md) · [Plan](02-plan.md)

ID: quyết định `MG-DNN`, yêu cầu `MG-NN`, task `M0`–`M10`.

## 1. Mục đích và lý do

Người dùng nêu hai điều: code đang chia hai repo, và chỉ có một domain `mekoniq.app`. Phần còn lại của mục này là cách tôi hiểu lý do, rút từ những gì đọc được trong code:

- **Mỗi thay đổi runtime tốn hai commit ở hai repo.** Một commit source đổi runtime/schema/portable tools phải theo sau bằng export, import và một commit Lab `chore: pin source runtime <sha>`; rồi hai lần push tới hai remote.
- **Hai repo chỉ chạy được khi nằm cạnh nhau.** Lab import thẳng `../../source/...` trong 5 script và 5 test; recorder của source mặc định tìm `../lab`. Một clone riêng lẻ của `mekoniq-lab` không chạy nổi bộ integration của chính nó.
- **Lab không có CI.** `source/.github/workflows/ci.yml` không chạy gì của Lab, và repo Lab không có workflow.
- **Hai địa chỉ cho một sản phẩm.** App cloud ở `www.mekoniq.app`, Lab ở `mekoniq-lab.vercel.app`.

Việc gộp **không** nhằm đổi kiến trúc runtime, đổi cách Lab nói chuyện với runtime, hay đổi ý nghĩa của evidence.

## 2. Mục tiêu, không làm, thất bại dù chạy được

**Mục tiêu**

- Một repo Git (`phamvuhoang/mekoniq`), một lockfile, một lệnh cài, một CI có chạy typecheck, unit và build của Lab.
- Lab phục vụ tại `https://lab.mekoniq.app`; trang marketing tại `https://mekoniq.app`; app cloud giữ `https://www.mekoniq.app`.
- Lịch sử hai repo còn nguyên; mọi SHA đã ghi trong evidence tra được trong repo gộp.
- Hành vi runtime, UI Lab, launcher, recorder và guard không đổi ngoài đường dẫn và cách lấy định danh.

**Không làm**

- Không bỏ pin, không bỏ export/import runtime, không để Lab import mã runtime trực tiếp.
- Không gộp các script trùng (`check-brand`), không đổi tên package, không chuyển `lab/docs` vào `docs/` của source.
- Không gộp repo `web/` và `trial/` vào monorepo (`web/` chỉ đổi domain). Không gộp các project Vercel. Không dời app cloud khỏi `www.mekoniq.app`.
- Không ghi lại evidence nào chỉ vì gộp. Không deploy lại Cloud Run vì gộp.

**Thất bại dù chạy được**

- Pin trên `main` bị lần gộp làm đổi: bản web sẽ lệch runtime Cloud Run và demo cho nhà đầu tư hỏng. Hôm nay pin đó là `3d8c2a8`; sau khi R4 về `main` nó sẽ là pin R4 để lại, gọi là `P` trong tài liệu này.
- Một SHA của Lab đã ghi trong evidence không còn tra được.
- Một byte của evidence lịch sử bị sửa, hoặc một record có `accepted:true`.
- Phiên R4 đang chạy thấy cây của mình bị dời giữa một task.
- Push `main` hoặc đổi cấu hình Vercel/Cloud Run khi chưa có lệnh của người dùng.

## 3. Hiện trạng

Bảng số liệu ở [README §2](README.md#2-hiện-trạng-đã-kiểm-ngày-2011). Các điểm quyết định thiết kế:

- **Pin.** `lab/config/source-runtime.lock.json` giữ `sourceCommit`, `artifactSha256`, `schemaHash`, `portableToolsDigest`. Bản web phục vụ file này tại `/source-runtime.lock.json` và so `sourceCommit` với `GET /lab/v2/health` của runtime ở origin khác (`lab/src/scenarios/controls.ts:138-140`). Launcher local so digest của tool closure, không so commit.
- **Tool closure** chỉ gồm `robotics/…`, `packages/contracts/schemas`, `integrations/arm-controller/…`, `tests/fixtures/digital-twin` (`source/scripts/native-sim/tool-identity.mjs`). Lockfile, script, config của root không nằm trong đó.
- **Định danh lúc ghi evidence.** Recorder lấy `git rev-parse HEAD` và `git status --porcelain` của từng repo, rồi đòi `pin.sourceCommit` bằng commit source (`record-irsim.mjs:39-43`, `record-sim-extension.mjs:104-108`, `record-sim-extension-r2b.mjs:19-20`, `record-sim-extension-r3.mjs:17`). `tests/support/regression-identity.ts` băm `git ls-tree -r` của từng repo, bỏ các đường dẫn evidence của Lab.
- **Guard của record cũ không đọc Git.** Chúng kiểm byte của record và archive. Chỗ duy nhất đọc file Lab tại một commit cũ là `scripts/native-sim/prepare-mujoco-r2a-core.mjs:14` (`git show <labCommit>:config/source-runtime.lock.json`).
- **Export** (`scripts/export-lab-runtime.mjs:16,27`) từ chối cây bẩn và ghi `sourceCommit = HEAD`; `deploy/lab-runtime/build.sh:16-17` làm giống vậy cho image.
- **Nhánh đang sống.** Cả hai repo có `r4/virtual-commissioning`; plan R4 fast-forward chúng về `main` ở V16.

## 4. Các hướng đã cân nhắc

| Hướng | Nội dung | Đánh đổi | Kết luận |
|---|---|---|---|
| A. Chỉ đổi domain | Thêm `lab.mekoniq.app` vào project `mekoniq-lab`, đổi origin của Cloud Run. Không đụng code | Nửa giờ, không rủi ro. Không giải quyết hai commit, hai remote, thiếu CI | Không đủ cho yêu cầu "gộp codebase". Giữ lại làm **M8**, làm được độc lập, trước hoặc sau |
| **B. Một repo, chỉ chuyển chỗ** | Nhập Lab vào `apps/lab` giữ lịch sử; giữ pin và evidence; định danh theo đường dẫn | Sửa đường dẫn ở khoảng 20 file và định danh ở khoảng 10 chỗ. Vẫn còn commit pin, nhưng cùng repo, một lần push | **Chọn** |
| C. Gộp sâu | Như B, rồi bỏ pin: Lab build thẳng từ `packages/lab-runtime`, bỏ `src/shared` sinh ra, gộp script trùng | Phá ngữ nghĩa cặp (source, Lab) mà mọi recorder, guard và record hiện có dựa vào; phải thiết kế lại qualification. Không ai yêu cầu | Không làm. Có thể mở sau, khi B đã ổn |
| D. Nhập bằng `git filter-repo` | Viết lại lịch sử Lab vào thư mục con để `git log` liền mạch | Đổi mọi SHA của Lab; evidence trỏ tới SHA không còn tồn tại | Loại |
| E. Lab dưới `www.mekoniq.app/lab` | Một origin cho cả app cloud và Lab | Lab và app cloud chung localStorage/IndexedDB và phiên Supabase; Cloud Run phải cho phép origin của app production; Vite cần `base`, Next cần rewrite sang project khác | Loại; subdomain vẫn là "một domain" |
| F. Thư mục `lab/` ở root repo, ngoài workspace | Giữ lockfile riêng của Lab | Vẫn hai lockfile, hai lần cài; hành vi pnpm với thư mục con nằm ngoài workspace phải kiểm thêm | Loại; `apps/*` đã là glob của workspace |

## 5. Thiết kế

### 5.1 Bố cục đích

```text
mekoniq/                      (GitHub phamvuhoang/mekoniq; local: robot/source)
├── apps/
│   ├── cloud-web/            Vercel project mekoniq      → www.mekoniq.app
│   ├── tablet-web/  tablet-android/
│   └── lab/                  Vercel project mekoniq-lab  → lab.mekoniq.app
│       ├── config/source-runtime.lock.json    (pin, như cũ)
│       ├── src/ scripts/ tests/ fixtures/ public/ docs/
│       └── .runtime/ runs/ releases/          (gitignore, như cũ)
├── packages/  robotics/  scripts/  tests/  deploy/  docs/
└── pnpm-workspace.yaml  pnpm-lock.yaml        (một lockfile)
```

### 5.2 Nhập lịch sử (MG-D01)

`git subtree add --prefix=apps/lab <lab> main`, không `--squash`. Kết quả là một merge commit có lịch sử Lab làm cha thứ hai. Commit cũ của Lab giữ nguyên SHA và giữ file ở đường dẫn gốc của chúng.

Đã thử ngày 20/11 trong một clone tạm (chỉ đọc hai repo, đã xóa):

| Kiểm | Kết quả |
|---|---|
| `git rev-parse HEAD:apps/lab` so với `lab/main^{tree}` | Trùng (`c59b14f`) |
| `git cat-file -t 4b57a9a`; `git show 4b57a9a:config/source-runtime.lock.json` | `commit`; đọc được, pin `3d8c2a8` |
| Nhánh R4: `git merge main`, rồi `git merge -X subtree=apps/lab lab/r4/virtual-commissioning` | Cả hai merge sạch; `HEAD:apps/lab` trùng cây của Lab R4 (`700b204`) |
| `main` là tổ tiên của nhánh R4 sau khi mang theo | Đúng; R4 vẫn fast-forward về `main` được |
| File Lab bị `.gitignore` của root che | Không có file nào |

Lịch sử một file Lab qua điểm nhập xem bằng `git log -- apps/lab/<path>` cho phần sau và `git log <sha-nhập>^2 -- <path>` cho phần trước. Đó là cái giá của việc giữ SHA.

### 5.3 Định danh source và Lab trong một repo (MG-D02)

Recorder, export và guard tiếp tục làm việc với một cặp (source, Lab). Định nghĩa mới:

| Khái niệm | Hai repo (cũ) | Một repo (mới) |
|---|---|---|
| Commit source `S` | `git -C source rev-parse HEAD` | `git log -1 --format=%H -- . ':(exclude)apps/lab'` |
| Commit Lab `L` | `git -C lab rev-parse HEAD` | `git log -1 --format=%H -- apps/lab` |
| Source bẩn | `git -C source status --porcelain --untracked-files=all` | thêm `-- . ':(exclude)apps/lab'` |
| Lab bẩn | `git -C lab status --porcelain --untracked-files=all` | thêm `-- apps/lab` |
| Liệt kê cây source | `git ls-tree -r <rev>` | bỏ các entry dưới `apps/lab/` |
| Liệt kê cây Lab | `git ls-tree -r <rev>` | chỉ các entry dưới `apps/lab/`, cắt tiền tố |

Hệ quả, đã kiểm trong clone tạm:

- Ngay sau khi nhập trên nhánh R4: `S` = `9805ec6`, đúng bằng `sourceCommit` của pin. **Bất biến "pin = commit source" giữ nguyên qua điểm nhập mà không cần pin lại.**
- Liệt kê cây Lab sau khi cắt tiền tố trùng với liệt kê của repo Lab cũ, và liệt kê cây source sau khi bỏ `apps/lab/` trùng với repo source cũ. Vì vậy `codeHash` trong `regression-identity` so được giữa trước và sau khi gộp.
- Một commit đụng cả hai phía cho `S = L =` chính nó; pin nằm trong commit không thể trỏ tới chính commit đó, nên recorder từ chối cho tới khi có một commit pin chỉ đụng `apps/lab`. Quy tắc "thay đổi runtime rồi tới commit pin" vẫn như cũ, có điều giờ nằm trong một repo.
- Commit chỉ đụng docs ở phía source vẫn làm đổi `S` và đòi pin lại trước khi ghi evidence, đúng như hôm nay.

Một module `scripts/repo-identity.mjs` cung cấp bốn hàm trên. Các chỗ gọi:

| File | Đổi gì |
|---|---|
| `scripts/export-lab-runtime.mjs:16,27` | `dirty` và `sourceCommit` |
| `deploy/lab-runtime/build.sh:16-17` | hai lệnh git thêm pathspec |
| `scripts/record-irsim.mjs:39`, `record-sim-extension.mjs:104`, `record-sim-extension-r2b.mjs:19-20,35`, `record-sim-extension-r3.mjs:17` | commit và dirty của cả hai phía; mặc định `--lab` là `apps/lab` |
| `tests/support/regression-identity.ts:17-23` | liệt kê cây, commit, đường dẫn bẩn theo phía |
| `scripts/native-sim/prepare-mujoco-r2a-core.mjs:14` | đọc file Lab tại một commit: thử `<sha>:apps/lab/<path>`, nếu không có thì `<sha>:<path>` (commit trước khi gộp) |
| `apps/lab/scripts/sync-engineering-contracts.mjs:14`, `production-build-identity.ts:9` | `sourceCommit`, `labCommit` và dirty theo phía |

`tests/acceptance/continuity-suite.ts:149` là của platform, không liên quan Lab; giữ `HEAD`.

### 5.4 Pin và runtime: không đổi

Export vẫn từ cây sạch của phía source, import vào `apps/lab/.runtime/`, pin vẫn ở `apps/lab/config/source-runtime.lock.json`, commit pin vẫn là `chore: pin source runtime <S>`. Các commit sửa của lần gộp không đụng file nào trong tool closure, nên trên `main` digest giữ nguyên, `pnpm lab:mujoco` vẫn chạy với pin `P`, và **không có commit pin nào trên `main` trong lần gộp**.

Hai ranh giới import, kiểm bằng một test grep:

- `packages/`, `robotics/` không import từ `apps/lab` (runtime không phụ thuộc Lab).
- `apps/lab/src/` không import ra ngoài `apps/lab` (bản web và gói offline tự đủ). Script và test của Lab được import từ phía source, như hôm nay.

### 5.5 Workspace, typecheck, lint, build, CI (MG-D03)

- `apps/lab` khớp glob `apps/*`, tự thành thành viên workspace. Xóa `apps/lab/pnpm-lock.yaml`; `pnpm install` thêm importer `apps/lab` vào lockfile root. Các phiên bản trùng của hai bên đã giống nhau (ajv 8.20.0, Playwright 1.64.1, TypeScript 5.9.3, vitest 4.1.12, vite 7.3.1 như `tablet-web`); cái mới là `three`, `@types/three`, `fake-indexeddb`.
- `tsconfig.json` của root đang include `apps/**/*.ts`, sẽ kéo theo 251 file `.ts` của Lab dưới bộ option khác. Thêm `apps/lab` vào `exclude`, và nối `pnpm --filter mekoniq-robot-lab typecheck` vào script `typecheck` của root.
- `pnpm build` của root (`pnpm -r --if-present build`) sẽ build luôn Lab. Chấp nhận: CI có build Lab.
- `eslint .` của root sẽ quét Lab lần đầu. Chạy thử; nếu sạch thì để nguyên, nếu có lỗi thì thêm `apps/lab/**` vào `ignores` và ghi thành việc riêng.
- CI: thêm `pnpm --filter mekoniq-robot-lab test:unit` vào dòng test. Integration và e2e của Lab cần runtime đã cài và venv, vẫn chạy local như hôm nay.
- Build của `cloud-web` trên Vercel dùng `--filter @mekoniq/cloud-web...`, không đổi.

### 5.6 Đường dẫn chéo

Từ `apps/lab`, root source là `../..`; từ root, Lab là `apps/lab`.

| Phía | File |
|---|---|
| Lab → source | `scripts/measure-cell-production.ts`, `record-regression.mjs`, `start-irsim.mjs` (mặc định `--source`), `sync-engineering-contracts.mjs`, `production-build-identity.ts`; `tests/integration/arm-evidence`, `irsim-launcher`, `mujoco-launcher`, `simulation-capability`, `source-report-import` |
| Source → Lab | `scripts/record-sim-extension-r3.mjs` (mặc định `--lab`), `tests/unit/sim-extension-qualification.test.ts` (`LAB_ROOT`; sau khi gộp nhánh "không có Lab thì bỏ qua" không còn xảy ra), README và tài liệu vận hành |

Một số test của Lab tự dựng thư mục tạm có `lab/` và `source/` cạnh nhau rồi truyền `--source`; chúng mô phỏng bố cục, không phụ thuộc bố cục thật, và được giữ.

### 5.7 Vercel và domain (MG-D04)

- Project `mekoniq-lab`: nối sang repo `phamvuhoang/mekoniq`, Root Directory `apps/lab`. `apps/lab/vercel.json` đổi `installCommand` thành `cd ../.. && pnpm install --frozen-lockfile`, theo đúng mẫu của `apps/cloud-web/vercel.json`. Build và output giữ nguyên.
- Thêm domain `lab.mekoniq.app` vào project `mekoniq-lab`. `mekoniq.app` đã đăng ký qua Vercel và đã có bản ghi wildcard `*`, nên không cần thêm bản ghi DNS.
- **Chi phí: không phát sinh.** Vercel không tính phí theo subdomain hay theo domain gắn vào project, TLS tự cấp; team đang ở gói Pro; domain đã trả tới 31/10/2027. Điều kiện của người dùng ("nếu không có chi phí phát sinh") được thỏa. Các bước ở [hướng dẫn 03](03-domain-guide.md).
- Sau khi gộp, một push `main` kích hoạt build của cả hai project. Vercel có cơ chế tự bỏ qua project "không bị ảnh hưởng" trong monorepo, dựa trên phụ thuộc khai trong `package.json`. Repo này import giữa các package bằng đường dẫn tương đối, không khai phụ thuộc, nên cơ chế đó có thể bỏ sót. **Tắt nó cho cả hai project** và kiểm bằng lần push đầu. Chi tiết của cơ chế này tôi nêu theo tài liệu Vercel, chưa kiểm trên tài khoản; M7 kiểm thật.
- Không thêm "Ignored Build Step". Mỗi push build cả hai là thừa nhưng đúng; thêm sau nếu số phút build thành vấn đề.

### 5.8 Cloud Run

Việc gộp repo không đụng Cloud Run: pin trên `main` không đổi qua lần gộp, nên nó vẫn khớp commit mà runtime đang chạy báo ở `GET /lab/v2/health`.

Việc đổi domain thì có đụng. Runtime chỉ cho một origin, nên thứ tự là: thêm domain (cả hai địa chỉ đều mở được UI, chỉ địa chỉ cũ ghép được với cloud) → cập nhật `LAB_ALLOW_ORIGIN=https://lab.mekoniq.app` (chỉ địa chỉ mới ghép được) → đặt chuyển hướng từ `mekoniq-lab.vercel.app` sang địa chỉ mới. Bước giữa là thay đổi production, cần lệnh của người dùng. Dự án lưu trong IndexedDB của trình duyệt ở origin cũ không tự sang origin mới.

### 5.9 Evidence và lịch sử

- Record trước khi gộp gắn với (SHA source, SHA Lab) của hai repo. Cả hai loại SHA đều nằm trong repo gộp. Không byte nào của record bị sửa; `apps/lab/docs/` là `lab/docs/` chuyển nguyên.
- Guard của năm record hiện tại phải cho cùng kết quả trước và sau khi gộp (MG-05).
- Record đầu tiên sau khi gộp gắn với (`S`, `L`) của cùng một repo. Trường `lab.path` trong record sẽ là `…/apps/lab`.
- Lần gộp không ghi evidence mới và không đóng gate nào. Chuỗi ghi đầy đủ chạy ở lần đóng release kế tiếp, như thường lệ.

### 5.10 Workspace local

- `robot/source` giữ tên. `robot/lab` cũ đổi tên thành `robot/lab.pre-merge-<ngày>` và giữ 14 ngày.
- `.runtime/` (228 MB), `runs/` (361 MB), `releases/` (750 MB), `.superpowers/` không nằm trong Git: chuyển tay sang `source/apps/lab/`. `.gitignore` của Lab đi cùng nên chúng vẫn bị bỏ qua.
- `robot/lab` thành symlink tới `source/apps/lab`. Workspace root không phải repo Git nên symlink không vào commit nào. Nó giữ cho đường dẫn `lab/...` trong các plan R4, trong `CLAUDE.md` và các lệnh `cd lab && pnpm …` tiếp tục đúng. Đường dẫn chuẩn trong tài liệu mới là `source/apps/lab`.
- Cập nhật `robot/CLAUDE.md`, `robot/AGENTS.md` và bộ nhớ của Claude: bốn repo còn ba, quy tắc commit pin, đường dẫn Lab.

### 5.11 Cửa sổ cutover (MG-D05)

**Đã chốt: cutover sau khi R4 fast-forward về `main` ở cả hai repo** (sau V16) và trước khi release kế tiếp bắt đầu. Lúc đó chỉ có cặp `main` cần nhập, không phải mang nhánh nào theo.

Chuẩn bị (M0–M6) không cần cửa sổ và có thể chạy thử sớm để lộ vấn đề, nhưng R4 còn sửa nhiều script và recorder; bốn commit sửa của lần gộp phải làm lại hoặc cherry-pick trên `main` sau R4. Cutover (M7) cần cả hai cây sạch, không tiến trình nào của Lab đang chạy, và lệnh của người dùng.

Đường làm sớm giữa hai task R4 (mang theo nhánh bằng `git merge main` rồi `git merge -X subtree=apps/lab lab/r4/virtual-commissioning`) đã thử chạy sạch trong clone tạm nhưng **không dùng**. Giữ ở đây để biết nó khả thi nếu lịch đổi.

### 5.12 Trang marketing về `mekoniq.app` (MG-D06)

Người dùng chốt đưa trang marketing về domain này. Cách xếp hostname là lựa chọn của tôi:

| Hostname | Hôm nay | Sau M9 |
|---|---|---|
| `www.mekoniq.app` | App cloud (project `mekoniq`) | Không đổi |
| `mekoniq.app` | Chuyển hướng 308 sang `www` | Trang marketing (project `mekoniq-serve`) |
| `lab.mekoniq.app` | Chưa có | Lab (project `mekoniq-lab`) |

- Chỉ đổi cấu hình domain của hai project. Repo `mekoniq-web` không đổi, không gộp vào monorepo: `web/demo/` là bản xuất từ `trial/`, và site không có bước build.
- `web/` không hardcode hostname nào, nên không cần sửa nội dung.
- Không dời app sang `app.mekoniq.app`. Mã của app không phụ thuộc hostname, nhưng cấu hình bên ngoài (Supabase Auth, webhook của kênh bán và thanh toán, địa chỉ cloud trong tablet) có thể đang trỏ vào `www`, và tôi không đọc được các cấu hình đó.
- Hệ quả: `mekoniq.app/<đường dẫn của app>` hôm nay chuyển sang `www`, sau M9 trả 404 của trang marketing. Chuyển hướng hiện tại có `cache-control: max-age=0`, nên trình duyệt không giữ nó lâu.
- Việc này độc lập với lần gộp code; xếp sau M8 để các thay đổi domain đi cùng một đợt.

## 6. Yêu cầu đo được

| ID | Yêu cầu | Kiểm bằng |
|---|---|---|
| MG-01 | Cây Lab sau khi nhập trùng byte với cây Lab trước khi nhập | `git rev-parse <nhập>:apps/lab` = `git rev-parse <lab-main>^{tree}` |
| MG-02 | Mọi SHA Lab trong evidence hiện có tra được | `git cat-file -t` cho từng SHA trong `status-2026-11-19.md` và các record |
| MG-03 | `S`, `L` và hai phép kiểm bẩn đúng theo bảng §5.3 | Test unit dựng repo tạm: commit ngoài, commit trong, commit cả hai, file bẩn mỗi phía |
| MG-04 | Pin trên `main` vẫn là `P` (pin trước khi gộp); digest tool closure không đổi | `pnpm check:source`; so `portableToolsDigest` trước và sau |
| MG-05 | Năm guard của record hiện tại cho cùng kết quả trước và sau | Chạy ở `origin/main` và ở đầu nhánh gộp, so đầu ra |
| MG-06 | Một lệnh cài, CI xanh, có typecheck + unit + build của Lab | `pnpm install --frozen-lockfile && pnpm contracts:check && pnpm typecheck && pnpm lint && pnpm build`; job CI |
| MG-07 | Lockfile root chỉ thêm, không đổi phụ thuộc của package cũ | `git diff pnpm-lock.yaml` không có dòng bị xóa |
| MG-08 | Số file test và kết quả của `pnpm test:unit` (source) và `vitest run` (Lab) không giảm so với trước | So với lần chạy baseline ở M0 |
| MG-09 | Vòng export → import → pin chạy được trong một repo và recorder chấp nhận định danh | Diễn tập trên nhánh vứt đi: sau commit pin, `pin.sourceCommit === sourceCommit()` và cây sạch |
| MG-10 | Ranh giới import §5.4 | Test grep, không có dòng nào |
| MG-11 | Sau cutover, bản web ở `mekoniq-lab.vercel.app` (rồi `lab.mekoniq.app`) phục vụ pin `P` và khớp `GET /lab/v2/health` của Cloud Run | `curl` hai địa chỉ, so `sourceCommit` |
| MG-12 | Không evidence lịch sử nào đổi byte | `git diff --stat <nhập>^1 <đầu nhánh> -- docs/implementation/evidence` rỗng; cây `apps/lab/docs` trùng `lab/docs` |
| MG-13 | `https://mekoniq.app` phục vụ trang marketing; `https://www.mekoniq.app/health/ready` vẫn `{"ready":true}` | `curl` hai địa chỉ sau M9 |

## 7. Rủi ro

| Rủi ro | Chặn bằng |
|---|---|
| Cutover khi phiên khác đang chạy | Điều kiện đầu M7: hai cây sạch, không cổng 4175/4176/4185/4186 nào đang nghe, người dùng ra lệnh |
| Sửa nhầm file trong tool closure làm digest đổi, `lab:mujoco` trên `main` fail closed | MG-04; các commit sửa chỉ đụng `scripts/`, `tests/`, config root, `apps/lab/` |
| Vercel bỏ qua build của `cloud-web` vì không thấy phụ thuộc | Tắt tự bỏ qua; kiểm lần push đầu (§5.7) |
| Build Lab hỏng sau khi đổi Root Directory | Build hỏng không thay bản production đang chạy; đường lùi là nối lại repo cũ |
| `git log` có pathspec chọn sai commit khi lịch sử có merge | MG-03 có ca merge; kết quả ở clone tạm đúng cho cả `main` và R4 |
| R4 thêm recorder hoặc script mới đọc `HEAD` của hai repo | M5 dò lại bằng `git grep` trên `main` sau R4, không tin danh sách ở §5.3 |
| Diễn tập làm trước khi R4 về `main` bị cũ | Bốn commit sửa được làm lại hoặc cherry-pick trên `main` mới; kinh tế nhất là chạy M0–M6 ngay sau khi R4 về `main` |
| Gỡ nhầm `mekoniq.app` khỏi cả tài khoản | Chỉ gỡ khỏi project; không dùng `vercel domains rm` ([hướng dẫn 03](03-domain-guide.md)) |
| Link `mekoniq.app/<đường dẫn app>` đang lưu hành | Sau M9 trả 404; thêm redirect trong `web/vercel.json` nếu có link như vậy |
| Diễn tập làm chậm máy khi phiên khác ghi evidence | Việc nặng của M6 chỉ chạy khi không có recording |
| Guard cần archive đã giải nén | Dùng `robot/evidence-archive/raw-3d8c2a8-lab-4b57a9a/` như `status-2026-11-19.md` mô tả |

## 8. Để lại cho người thực thi

- Cách viết lại từng import trong các script Lab (một hằng `SOURCE_ROOT`, hay sửa từng dòng).
- Có đưa Lab vào eslint ngay hay không, tùy kết quả lần chạy đầu.
- Tên tag sao lưu và tên thư mục `lab.pre-merge-*`.
- Câu chữ của README hai bên.
