# Gói 02 — Runtime từ web: N01–N05

Đọc [README](README.md) và [spec](../../specs/2026-11-12-realistic-arm-web-ui-design.md) §4.2 trước. N01–N03 không cần MuJoCo: test chạy trên set mock. N03 làm trong repo `lab/`.

---

### Task N01: Gateway — phiên bearer, allowlist, bind, khóa truy cập

**Files:**
- Modify: `packages/lab-runtime/src/gateway.ts`, `packages/lab-runtime/src/cli.ts`, `packages/lab-runtime/src/v2/gateway.ts`
- Test: `tests/integration/lab-runtime-remote.test.ts`; `tests/integration/lab-runtime-gateway.test.ts` và `tests/integration/lab-v2-stream.test.ts` không sửa và phải xanh

**Interfaces:**
- Consumes: `startLabGateway(options:GatewayOptions)`, `V2Deps` (`pairingValid`, `spendPairing`, `same`).
- Produces:
  ```ts
  // GatewayOptions thêm
  bind?:string                       // mặc định '127.0.0.1'
  publicHosts?:readonly string[]     // giá trị Host được nhận thêm (khớp chính xác, chữ thường)
  allowOrigins?:readonly string[]    // giá trị Origin được nhận thêm (khớp chính xác)
  accessKey?:string                  // >= 32 ký tự; vắng = chỉ mã ghép nối một lần
  // CLI: --bind <addr>, --public-host <host> (lặp được), --allow-origin <origin> (lặp được); env MEKONIQ_LAB_ACCESS_KEY; --port vắng thì đọc env PORT, vắng nữa thì 4176
  // Từ chối khởi động: bind không phải loopback mà không có accessKey → 'ACCESS_KEY_REQUIRED'; accessKey < 32 ký tự → 'ACCESS_KEY_TOO_SHORT';
  //   allow-origin là '*' hoặc không có dạng scheme://host[:port] → 'INVALID_ALLOW_ORIGIN'
  // POST /lab/v2/sessions → 201 {csrfToken,sessionToken,principal}; sessionToken là id phiên (cùng giá trị cookie mang)
  // Xác thực v2: `Authorization: Bearer <sessionToken>` được ưu tiên hơn cookie; phiên đến bằng bearer không bị kiểm X-CSRF-Token
  // Preflight: Access-Control-Allow-Headers: Content-Type, X-CSRF-Token, Authorization, Last-Event-ID; Access-Control-Max-Age: 600
  // Access-Control-Allow-Credentials chỉ gửi cho hai origin loopback hiện có, không gửi cho origin trong allowOrigins
  // /sessions sai 5 lần trong 60 s (đếm chung cả runtime) → 429 'PAIRING_RATE_LIMITED' tới hết cửa sổ
  // Health v2 thêm: features.bearer:true, deployment:{bind:'loopback'|'public'}
  ```
  `accessKey` được `/sessions` nhận như mã ghép nối nhưng không bị tiêu hủy; khi có `accessKey`, pairing token không được in ra log.

- [ ] **Step 1: Test fail trước** (`lab-runtime-remote.test.ts`, gateway trên cổng ngẫu nhiên, request bằng `fetch` của Node với header Host/Origin đặt tay):
  - mặc định: Origin `https://lab.example` → 403 `ORIGIN_FORBIDDEN`; Host `evil.example:4176` → 403 `HOST_FORBIDDEN` (không đổi so với hôm nay);
  - `allowOrigins:['https://lab.example']`: preflight `OPTIONS` trả `Access-Control-Allow-Origin: https://lab.example`, có `Authorization` trong `Allow-Headers`, không có `Access-Control-Allow-Credentials`, không có `Access-Control-Allow-Private-Network`; Origin `https://lab.example.evil.test` → 403;
  - ghép nối → nhận `sessionToken`; `GET /lab/v2/readiness?...` với `Authorization: Bearer` và không cookie → 200; `POST /lab/v2/runs` với bearer và không `X-CSRF-Token` → không phải 403 `CSRF_INVALID`; cùng request bằng cookie mà thiếu CSRF → 403 `CSRF_INVALID`;
  - bearer sai hoặc hết hạn → 401 `SESSION_REQUIRED`;
  - `accessKey` 40 ký tự: `/sessions` với khóa đúng hai lần → hai phiên; sáu lần sai liên tiếp → lần thứ sáu 429 `PAIRING_RATE_LIMITED`, và khóa đúng trong cùng cửa sổ cũng 429;
  - `startLabGateway({bind:'0.0.0.0'})` không `accessKey` → ném `ACCESS_KEY_REQUIRED`; `accessKey:'short'` → `ACCESS_KEY_TOO_SHORT`; `allowOrigins:['*']` → `INVALID_ALLOW_ORIGIN`;
  - `publicHosts:['lab-runtime.example']`: Host đó được nhận, Host khác vẫn 403;
  - stream `GET /runs/<id>/events` với bearer trả `text/event-stream`.
- [ ] **Step 2:** Sửa gateway và CLI theo Interfaces. Hằng `origins` và danh sách Host hiện có thành giá trị mặc định cộng với tham số.
- [ ] **Step 3:** `pnpm test:integration -- tests/integration/lab-runtime-remote.test.ts tests/integration/lab-runtime-gateway.test.ts tests/integration/lab-v2-stream.test.ts && pnpm typecheck && pnpm lint` xanh. Commit `feat: lab gateway accepts bearer sessions, configured origins and an access key`. Lab re-pin.

---

### Task N02: `step` có nhịp và chu kỳ đẩy telemetry

**Files:**
- Create: `packages/lab-runtime/src/v2/pace.ts`
- Modify: `packages/contracts/schemas/lab-action-v2.schema.json`, `packages/lab-runtime/src/v2/scenario-runner.ts`, `packages/lab-runtime/src/v2/navigation2d/runner.ts`, `packages/lab-runtime/src/v2/event-stream.ts`, `packages/lab-runtime/src/v2/gateway.ts`
- Test: `tests/unit/paced-step.test.ts`, `tests/integration/lab-v2-paced-step.test.ts`, và một case thêm vào test fixed-step runner hiện có chạy bằng worker double

**Interfaces:**
- Consumes: nhánh `step` của hai runner (`scenario-runner.ts:404`, `navigation2d/runner.ts:501`), `STREAM_DEFAULTS`, giới hạn 10 000 receipt (`scenario-runner.ts:380`).
- Produces:
  ```ts
  // lab-action-v2: step.payload = {ticks:1..3000, pace?:{factor:1|4|16|64}}; có pace mà ticks > 50 → INVALID_ACTION
  // pace.ts (dùng chung cho hai runner)
  export interface PaceAnchor {wallMs:number;tick:number;factor:number}
  /** Tick `tick` được bắt đầu sớm nhất tại anchor.wallMs+(tick−anchor.tick)·tickMs/factor. Mốc mới khi chưa có mốc, factor đổi, hoặc now đã trễ hơn thời điểm đó quá 250 ms. Thuần. */
  export function paceDelay(anchor:PaceAnchor|null,tick:number,factor:number,nowMs:number,tickMs?:number):{anchor:PaceAnchor;delayMs:number}
  export interface WallClock {now():number;sleep(ms:number):Promise<void>}
  export const realWall:WallClock                                             // performance.now và setTimeout
  // RunProviders thêm (tùy chọn, cho test): wall?:WallClock
  // STREAM_DEFAULTS.telemetryMs = 40
  // Health v2: features.pacedStep:true
  ```
  Mốc nhịp nằm trong bộ nhớ của run, không vào checkpoint. `pause`, `resume`, `cancel` xóa mốc. Không `pace` thì cả hai runner không gọi `wall` lần nào. Lab gửi `ticks:20` mỗi `step` có nhịp (N03): `maxTicks` lớn nhất 180 000 cần 9 000 receipt, dưới giới hạn 10 000. Trần đã biết, không sửa ở đây: checkpoint ghi hai lần mỗi action và mang mọi receipt.

- [ ] **Step 1: Unit fail trước** (`paced-step.test.ts`): `paceDelay(null,100,1,5000)` trả mốc `{wallMs:5000,tick:100,factor:1}` và `delayMs:0`; với mốc đó, tick 110 tại `now=5100` → `delayMs:100`; tại `now=5190` → `10`; tại `now=5460` (trễ 260 ms) → mốc mới, `delayMs:0`; đổi `factor` sang 4 → mốc mới; `factor:4`, tick +10 → 50 ms.
- [ ] **Step 2: Integration fail trước** (`lab-v2-paced-step.test.ts`, set `mock-default`, `wall` thật):
  - 75 request `step{ticks:20,pace:{factor:1}}` liên tiếp (30 s mô phỏng): tổng thời gian thực trong `30 000 ms ± 3 %`; lặp với `factor:4`: `7 500 ms ± 3 %`;
  - `step{ticks:51,pace:{factor:1}}` → 422 `INVALID_ACTION`; `step{ticks:3000}` không `pace` vẫn chạy như cũ và `wall.sleep` không được gọi (wall giả đếm lần gọi);
  - Review Focus 1: gửi `step{ticks:50,pace:{factor:1}}` rồi hủy request phía client sau 200 ms; sau 2 s, `GET /runs/<id>` cho `tick` đúng bằng tick trước + 50 và không đổi trong 1 s tiếp theo; gửi lại cùng `actionId` trả receipt cũ;
  - `pause` gửi trong lúc một `step{ticks:20,pace:{factor:1}}` đang chạy được trả lời trong ≤ 500 ms kể từ lúc gửi;
  - `STREAM_DEFAULTS.telemetryMs===40`; health có `features.pacedStep`.
- [ ] **Step 3: Runner fixed-step.** Thêm một case vào test fixed-step runner dùng worker double: 10 request `step{ticks:20,pace:{factor:4}}` với wall giả → `sleep` được gọi với tổng `1000 ms ± 1 tick`; cùng chuỗi không `pace` → `sleep` không được gọi và sha256 các chunk evidence bằng golden hiện có.
- [ ] **Step 4:** Sửa schema, `pnpm contracts:generate`; viết `pace.ts`; trong nhánh `step` của hai runner gọi `paceDelay` trước mỗi tick và `await wall.sleep(delayMs)` khi `delayMs>0`.
- [ ] **Step 5:** `pnpm test:unit -- tests/unit/paced-step.test.ts tests/unit/bv01-mock-golden.test.ts && pnpm test:contracts && pnpm test:integration -- tests/integration/lab-v2-paced-step.test.ts tests/integration/lab-v2-stream.test.ts` và test fixed-step ở Step 3 xanh. Commit `feat: paced step holds a run at wall-clock rate; telemetry is pushed every 40 ms`. Lab re-pin.

---

### Task N03: Lab — địa chỉ runtime, bearer, SSE qua `fetch`, vòng chạy có nhịp

**Files (repo `lab/`):**
- Create: `src/runtime/target.ts`, `src/runtime/fetch-event-source.ts`
- Modify: `src/scenarios/controls.ts`, `src/runtime/stream.ts`, `src/ui/workspace.ts`
- Test: `tests/unit/runtime-target.test.ts`, `tests/unit/fetch-event-source.test.ts`, `tests/unit/twin-runtime-remote.test.ts`, `tests/e2e/remote-origin.spec.ts`

**Interfaces:**
- Consumes: health `features.bearer`, `features.pacedStep`, `sessionToken` (N01, N02); `openRunStreams` và `StreamDeps` (`stream.ts`); `httpTwinRuntime` (`controls.ts:112`).
- Produces:
  ```ts
  // target.ts
  export interface RuntimeTarget {base:string;kind:'same_origin'|'loopback'|'remote'}   // base: '/lab/v2' | 'http://127.0.0.1:4176/lab/v2' | 'https://host/lab/v2'
  export function parseTarget(input:string|null,pageOrigin:string):RuntimeTarget         // ném INVALID_RUNTIME_URL; http chỉ cho 127.0.0.1, localhost, [::1]; còn lại phải https; null hoặc rỗng → same_origin
  export function loadTarget(pageOrigin:string):RuntimeTarget; export function saveTarget(input:string|null):void   // localStorage 'mekoniq-lab-runtime'
  export function requestInit(t:RuntimeTarget,token:string):RequestInit                   // same_origin: {credentials:'same-origin'}; khác: {credentials:'omit',headers:{Authorization},…} và targetAddressSpace:'loopback' khi kind là loopback
  /** Trang không phải loopback chỉ được gửi request tới runtime sau một thao tác của người dùng. */
  export const mayAutoProbe=(t:RuntimeTarget,pageHost:string):boolean
  // fetch-event-source.ts: đúng phần giao diện EventSource mà stream.ts dùng
  export class FetchEventSource {constructor(url:string,init?:{headers?:Record<string,string>;fetch?:typeof fetch;extra?:RequestInit});
   readyState:0|1|2;onopen:(()=>void)|null;onerror:(()=>void)|null;addEventListener(type:string,listener:(e:{data:string;lastEventId:string})=>void):void;close():void}
  // controls.ts: httpTwinRuntime(target:RuntimeTarget={base:'/lab/v2',kind:'same_origin'}); TwinRuntime thêm `readonly target:RuntimeTarget` và `streamDeps():Pick<StreamDeps,'base'|'EventSource'>`
  // TwinRuntimeError mới: 'RUNTIME_PIN_MISMATCH' (commit của health khác source-runtime.lock.json; chỉ kiểm khi kind khác same_origin), 'LOOPBACK_BLOCKED' (fetch tới loopback ném TypeError)
  ```
  `FetchEventSource` không tự nối lại: stream kết thúc hoặc lỗi mạng → `readyState=2` rồi `onerror`; `stream.ts` đã xử lý trường hợp này bằng `probe()`. Vòng chạy trong `workspace.ts`: khi health có `features.pacedStep`, gửi liên tiếp `step{ticks:20,pace:{factor:runSpeed}}` không tự chờ, và đo tốc độ thực (tick đã chạy trên thời gian thực của 2 s gần nhất) vào `measuredSpeed`; không có thì giữ vòng cũ.

- [ ] **Step 1: Unit fail trước.**
  - `runtime-target.test.ts`: `parseTarget(null,'https://lab.example')` → `same_origin`; `'http://127.0.0.1:4176'` → `loopback` với base `http://127.0.0.1:4176/lab/v2`; `'https://rt.example'` → `remote`; `'http://rt.example'`, `'ftp://x'`, `'javascript:1'` → `INVALID_RUNTIME_URL`; `requestInit` của `loopback` có `Authorization`, `credentials:'omit'`, `targetAddressSpace:'loopback'`; `mayAutoProbe` đúng cho trang `127.0.0.1` với đích cùng origin, sai cho trang `lab.example` với mọi đích.
  - `fetch-event-source.test.ts` (fetch giả trả `ReadableStream`): phân tích `id:`/`event:`/`data:` kể cả một bản ghi bị cắt giữa hai chunk và dòng `retry:`; `lastEventId` giữ qua bản ghi không có id; `onopen` khi có phản hồi 200; phản hồi 401 → `readyState===2` và `onerror`; stream đóng → `onerror` đúng một lần; `close()` hủy fetch và không gọi `onerror`; header `Authorization` có trong request.
  - `twin-runtime-remote.test.ts`: `httpTwinRuntime` với đích `loopback` gửi bearer sau `pair()` và không gửi `X-CSRF-Token`; `openRunStreams` với `FetchEventSource` qua một server SSE giả cho đúng chuỗi trạng thái `connecting → live → reconnecting/polling → live` khi server cắt stream, nối lại với `?after=<cursor>` và không mất bản ghi `business` nào; health có `sourceCommit` khác lock → `create` ném `RUNTIME_PIN_MISMATCH`; Review Focus: hai `step` cùng `expectedRevision` → cái thứ hai `REVISION_CONFLICT`, workspace đọc lại và dừng vòng chạy.
- [ ] **Step 2:** Viết `target.ts`, `fetch-event-source.ts`; sửa `controls.ts`, `stream.ts` (nhận `EventSource` và `base` từ `rt.streamDeps()`), vòng chạy và điều kiện tự dò trong `workspace.ts` (`mayAutoProbe` thay cho kiểm `location.hostname` ở dòng 201).
- [ ] **Step 3: e2e** `remote-origin.spec.ts` (RT04; một spec mỗi launcher): launcher mock khởi động runtime với `--allow-origin http://localhost:4177`; Lab được phục vụ thêm ở `http://localhost:4177` (origin khác `127.0.0.1:4176`); mở trang đó, khẳng định không có request nào tới `127.0.0.1:4176` trước khi bấm Kết nối; nhập địa chỉ và mã, chạy `BV01` mock tới `completed`; chip runtime báo trực tiếp. `lab/scripts/start-mock.mjs` nhận `--allow-origin` và `--extra-ui-port` để phục vụ việc này.
- [ ] **Step 4:** `pnpm typecheck && pnpm exec vitest run` + `node scripts/test-mock-e2e.mjs remote-origin.spec.ts twin-workspace.spec.ts coffee-journey.spec.ts` xanh. Commit `feat: the Lab connects to a chosen runtime with a bearer session and fetch-based streams`.

---

### Task N04: Image container

**Files:**
- Create: `deploy/lab-runtime/Dockerfile`, `deploy/lab-runtime/build.sh`, `deploy/lab-runtime/README.md`
- Test: `tests/integration/lab-runtime-container.test.ts`

**Interfaces:**
- Consumes: `scripts/export-lab-runtime.mjs <dir> --clean-checkout` (`runtime.mjs`, `schemas/`), tool root `robotics/simulation-mujoco`, `requirements.lock`, tham số CLI của N01 và M06.
- Produces: `deploy/lab-runtime/build.sh <tag> [--platform linux/amd64|linux/arm64]` dựng image từ một export sạch của HEAD. Image: Node 24.22.2 và Python 3.11; `/app/runtime.mjs`, `/app/schemas`, `/app/robotics/simulation-mujoco`, `/opt/venv-mujoco` cài từ lock với `--require-hashes` lúc build; người dùng không phải root; `ENV MEKONIQ_LAB_MUJOCO=1 PYTHONDONTWRITEBYTECODE=1`; `ENTRYPOINT ["node","/app/runtime.mjs","--bind","0.0.0.0","--data-dir","/tmp/runs","--mujoco-python","/opt/venv-mujoco/bin/python","--mujoco-worker","/app/robotics/simulation-mujoco","--mujoco-lock","/app/robotics/simulation-mujoco/requirements.lock"]`; `--public-host` và `--allow-origin` lấy từ env `LAB_PUBLIC_HOST`, `LAB_ALLOW_ORIGIN` qua một dòng shell trong entrypoint; cổng từ `PORT`.

- [ ] **Step 1: Test fail trước** (`lab-runtime-container.test.ts`; `not_run` khi `docker info` lỗi hoặc `LAB_CONTAINER_IMAGE` không đặt): chạy image với `MEKONIQ_LAB_ACCESS_KEY` 40 ký tự, `LAB_PUBLIC_HOST=127.0.0.1:<cổng>`, `LAB_ALLOW_ORIGIN=http://127.0.0.1:4175`; `/lab/v2/health` có `sourceCommit` bằng `git rev-parse HEAD`, backend `mujoco_arm` `installed` và `reachable`, không có `webots_3d`/`irsim_2d` nào `installed`, `deployment.bind==='public'`; ghép nối bằng khóa truy cập; tạo `MJ-BV01` với `coffee-cell-project.json`, gửi `step{ticks:50}` tới khi `completed`, `served===2`; container không ghi gì ngoài `/tmp`; dừng container không để lại tiến trình.
- [ ] **Step 2:** Viết Dockerfile, `build.sh`, README (cách dựng, biến môi trường, câu "run trong container không phải bằng chứng gate").
- [ ] **Step 3:** Dựng cho kiến trúc của máy (`--platform linux/arm64` trên Mac này) rồi `LAB_CONTAINER_IMAGE=mekoniq-lab-runtime:dev perl -e 'alarm 900; exec @ARGV' pnpm test:integration -- tests/integration/lab-runtime-container.test.ts` xanh: đây là RT05 của `G-RT2`. Dựng thêm `--platform linux/amd64` (thứ Cloud Run chạy) và chạy lại test một lần; ghi thời gian mỗi tick của cả hai vào README, lần amd64 qua giả lập chỉ là số đo. Commit `build: headless lab runtime image with the mujoco arm`.

---

### Task N05: Runbook và script Cloud Run

**Files:**
- Create: `deploy/lab-runtime/cloud-run.sh`, `docs/operations/lab-runtime-cloud-run.md`
- Test: `tests/unit/cloud-run-script.test.ts`

**Interfaces:**
- Consumes: image của N04; D60.
- Produces: `deploy/lab-runtime/cloud-run.sh [--execute]`. Không `--execute`: in ra các lệnh sẽ chạy và thoát 0, không gọi `gcloud`. Biến bắt buộc: `GCP_PROJECT`, `GCP_REGION` (mặc định `asia-southeast1`), `LAB_ORIGIN`, `ACCESS_KEY_SECRET` (tên secret trong Secret Manager), `IMAGE`. Lệnh deploy có đúng các cờ: `--execution-environment=gen2 --max-instances=1 --min-instances=0 --concurrency=20 --timeout=3600 --cpu=1 --memory=2Gi --allow-unauthenticated --set-secrets=MEKONIQ_LAB_ACCESS_KEY=<secret>:latest --set-env-vars=LAB_ALLOW_ORIGIN=<origin>,LAB_PUBLIC_HOST=<host>`; sau lần deploy đầu, script đọc URL dịch vụ và cập nhật `LAB_PUBLIC_HOST` bằng host đó.

- [ ] **Step 1: Test fail trước** (`cloud-run-script.test.ts`, chạy script bằng `bash` với `PATH` chỉ có một `gcloud` giả ghi lại tham số): không `--execute` → `gcloud` giả không được gọi, stdout chứa mọi cờ ở Interfaces; thiếu `GCP_PROJECT` hoặc `LAB_ORIGIN` → thoát 2 với tên biến; `LAB_ORIGIN='*'` → thoát 2; `--execute` → `gcloud run deploy` được gọi đúng một lần với các cờ đó và không có khóa truy cập dạng văn bản trong tham số.
- [ ] **Step 2:** Viết script và runbook: điều kiện trước (project, API bật, secret đã tạo bằng tay), dựng và đẩy image bằng Cloud Build từ đúng commit Lab đã ghim, deploy, kiểm `GET /lab/v2/health`, kết nối từ Lab, giới hạn (một instance, run mất khi instance tắt, stream cắt mỗi 60 phút và tự nối lại), chi phí ước tính và nguồn, cách tắt dịch vụ, mục "Không được suy ra".
- [ ] **Step 3:** `pnpm test:unit -- tests/unit/cloud-run-script.test.ts` xanh. Commit `docs: cloud run runbook and dry-run deploy script for the lab runtime`.
- [ ] **Step 4 (chỉ khi người dùng ra lệnh và cho project):** chạy `--execute`, thực hiện CL01 theo runbook, ghi kết quả vào README của bản ghi; không có lệnh thì `G-CLOUD1` giữ `blocked_external`.
