# Gói 03 — UI Lab: U01–U06

Đọc [README](README.md) và [spec](../../specs/2026-11-12-realistic-arm-web-ui-design.md) §4.3, §6.3 trước. Mọi task ở repo `lab/`; lệnh chạy từ `lab/`. Chuỗi hiển thị nào cũng qua `tr(vi, ja, en)` đủ ba ngôn ngữ. U01–U04 chạy trên runtime hiện có (mock, IR-SIM, Webots), không cần MuJoCo.

**Quy ước chung của gói:** `data-testid` và `data-action` đang có giữ nguyên tên và nghĩa; phần tử chỉ đổi chỗ. Test e2e đọc thứ nằm trong bảng chi tiết phải mở thẻ trước bằng helper `openInspector`.

---

### Task U01: Bố cục — thanh run, khung nhìn, thanh điều khiển, bảng chi tiết

**Files:**
- Create: `src/ui/run-bar.ts`, `src/ui/transport.ts`, `src/ui/inspector.ts`, `tests/support/twin.ts`, `tests/unit/twin-shell.test.ts`, `tests/e2e/twin-layout.spec.ts`
- Modify: `src/ui/workspace.ts` (`html()`, `bar()`, `runSettings()`, `click()`), `src/ui/operations-panel.ts`, `src/ui/report-panel.ts`, `src/ui/engineering-panel.ts`, `src/styles/main.css`, các spec trong `tests/e2e/` đọc phần tử đã đổi chỗ

**Interfaces:**
- Consumes: `TwinWorkspace` (`workspace.ts`), `operationsPanel`, `reportPanel`, `engineeringPanel`, `statusText`, `nextAction`.
- Produces:
  ```ts
  // inspector.ts
  export type InspectorTab='objects'|'engineering'|'report'|'setup';
  export interface TwinUiState {inspectorOpen:boolean;tab:InspectorTab;watch:boolean;displayOpen:boolean;problemsOpen:boolean;runtimeOpen:boolean;pickerOpen:boolean}
  export function loadUi():TwinUiState; export function saveUi(s:TwinUiState):void    // localStorage 'mekoniq-lab-twin-ui'; chỉ lưu inspectorOpen và tab; mặc định {inspectorOpen:false,tab:'objects'}
  export function inspector(ui:TwinUiState,panels:Record<InspectorTab,string>):string  // role tablist/tabpanel; data-testid twin-inspector, inspector-tab-<tab>; data-action twin-inspector-tab
  // run-bar.ts
  export interface RunBarState {scenarioTitle:string;runtime:{state:'none'|'connecting'|'live'|'slow'|'lost';label:string;detail:string};mode:string;
   status:string|null;simTimeS:number|null;served:string|null;problems:number;primary:{action:string;label:string;disabled:boolean}|null;inspectorOpen:boolean}
  export function runBar(s:RunBarState):string
  export function runtimePopover(s:{open:boolean;pairFormHtml:string;sourceCommit:string|null}):string   // data-testid runtime-popover; chứa form ghép nối hiện có (#twin-pair-form, #twin-pair-token) nguyên vẹn; U06 mở rộng chữ ký
  // transport.ts
  export interface TransportState {mode:'idle'|'live'|'replay';playing:boolean;canPlay:boolean;canStep:boolean;canPause:boolean;paused:boolean;canCancel:boolean;speeds:number[];speed:number;simTimeS:number;tick:number;
   /** Tốc độ đo được khi đang tự chạy; hiện cạnh tốc độ chọn khi lệch quá 10 % (data-testid measured-speed). */measuredSpeed?:number;
   replay?:{fromTick:number;toTick:number;tick:number;playing:boolean;marks:{tick:number;label:string}[]}}
  export function transportBar(s:TransportState):string
  // tests/support/twin.ts
  export async function openInspector(page:import('@playwright/test').Page,tab:InspectorTab):Promise<void>
  export async function openDisplayMenu(page:import('@playwright/test').Page):Promise<void>
  ```
  `data-testid` mới: `scenario-picker`, `runtime-chip`, `runtime-popover`, `problems-count`, `primary-action`, `twin-transport`, `measured-speed`, `twin-inspector`, `inspector-tab-<tab>`, `display-menu`. `data-action` mới: `twin-inspector-toggle`, `twin-inspector-tab`, `twin-display-toggle`, `twin-runtime-toggle`. Ở U01 bộ chọn kịch bản còn là danh sách preset hiện có đặt trong một hộp mở từ `scenario-picker`; U02 thay nội dung của nó.
  Vị trí `data-testid` đang có (theo bảng spec §6.3):

  | Vị trí | `data-testid` |
  |---|---|
  | Thanh run (luôn hiện) | `mode-badge` (trên nhãn mô phỏng), `run-status`, `run-tick`, `run-served`, `twin-telemetry` (chữ của chip runtime) |
  | Khung nhìn | `twin-scene`, `twin-fallback-note`, `next-action` |
  | Menu Hiển thị | `twin-legend`, `layer-provenance`, `layers-2d-only`, `navigation-scene-unavailable` |
  | Thẻ Đối tượng | `cycle-queue`, `entity-list`, `cup-owner` |
  | Thẻ Kỹ thuật | `run-identity`, `run-id`, `run-revision`, bảng kỹ thuật và chèn lỗi của `engineeringPanel` |
  | Thẻ Báo cáo | `twin-report-summary`, `saved-evidence`, `controller-verification`, nút xuất và nhập |
  | Thẻ Thiết lập | `preflight`, `#twin-backend-set`, `#twin-fault-schedule`, `#twin-speed-limit`, liên kết mở lại run |
  | Hộp runtime (mở từ `runtime-chip`) | `#twin-pair-form`, `#twin-pair-token` |

  Bố cục CSS: vùng làm việc của trang twin là lưới `grid-template-rows:auto 1fr auto` cao `calc(100dvh − chiều cao thanh ứng dụng)`; bảng chi tiết rộng 380 px bên phải khung nhìn ở bề rộng ≥ 1024 px, là tấm trượt từ dưới (tối đa 60 % chiều cao) ở bề rộng < 768 px; dưới 700 px chiều cao trang được cuộn nhưng thanh điều khiển dính đáy.

- [ ] **Step 1: Unit fail trước** (`twin-shell.test.ts`): `runBar` với `problems:0` không có `problems-count`, với `problems:2` có và chứa "2"; `mode-badge` chứa cả biểu tượng lẫn chữ; `transportBar({mode:'idle',…})` vô hiệu mọi nút; `mode:'replay'` có `input[type=range]#twin-replay-cursor`; `speed:4,measuredSpeed:3.9` không có `measured-speed`, `measuredSpeed:2.5` có và chứa "2,5×"; `inspector` với `inspectorOpen:false` có thuộc tính `hidden` và vẫn chứa đủ bốn tabpanel; `loadUi()` khi storage rỗng hoặc hỏng trả mặc định; `saveUi` rồi `loadUi` giữ `inspectorOpen` và `tab`, không giữ `watch`.
- [ ] **Step 2: e2e fail trước** (`twin-layout.spec.ts`, launcher mock, preset `coffee`):
  - 1440 × 900, bảng chi tiết đóng: `document.documentElement.scrollHeight <= innerHeight`; diện tích `twin-scene` ≥ 60 % diện tích cửa sổ; mở bảng: ≥ 45 %;
  - sau khi chạy BV01 mock tới `completed`: vẫn không cuộn dọc;
  - mở trang lần đầu: `twin-inspector` ẩn; đúng các phần tử mức 1 của D62 nhìn thấy được; không phần tử nào trong bốn dòng dưới của bảng trên nhìn thấy được;
  - bảng vị trí ở trên, từng dòng: mở vùng chứa (`openInspector` hoặc `openDisplayMenu`) rồi mọi `data-testid` của dòng đó nhìn thấy được;
  - mở thẻ Kỹ thuật, tải lại trang: thẻ Kỹ thuật vẫn mở;
  - 390 × 844: `twin-transport` nằm trong khung nhìn; mở bảng chi tiết không che `twin-transport`;
  - 1280 × 640: trang cuộn được và `twin-transport` vẫn nằm trong khung nhìn (Review: màn hình thấp).
- [ ] **Step 3:** Viết ba file UI; `html()` thành `runBar + khung nhìn + inspector + transportBar`; chuyển nội dung theo bảng; xóa các quy tắc CSS của `.twin-top`, `.twin-presets`, `.twin-grid`, `.twin-side`, `.twin-bar` không còn markup dùng; sửa các spec e2e hiện có để dùng helper.
- [ ] **Step 4:** `pnpm typecheck && pnpm exec vitest run && node scripts/test-mock-e2e.mjs` xanh (toàn bộ spec mock). Commit `feat: viewport-first twin layout with a run bar, a transport bar and a details inspector`.

---

### Task U02: Vấn đề, nhãn mô phỏng, bộ chọn kịch bản

**Files:**
- Create: `src/ui/problems.ts`, `tests/unit/twin-problems.test.ts`
- Modify: `src/ui/run-bar.ts`, `src/ui/workspace.ts`, `src/ui/operations-panel.ts`, `tests/e2e/twin-layout.spec.ts`

**Interfaces:**
- Consumes: `preflight` (`scenarios/preflight.ts`), `explain`, `reconcilable` (`twin/coffee-cell.ts`), `backendSetOptions` (`scenarios/support.ts`), `nextAction`, `presets`.
- Produces:
  ```ts
  // problems.ts
  export interface Problem {id:string;severity:'blocker'|'attention'|'notice';text:string;codes:string[];entityId?:string;action?:{id:string;label:string}}
  export function collectProblems(i:{paired:boolean;health:TwinHealth|null;healthChecked:boolean;checks:ReturnType<typeof preflight>;view:RunView|null;linkState:LinkState;notice:string}):Problem[]   // blocker, rồi attention, rồi notice; trong nhóm giữ thứ tự đầu vào
  export function problemsPanel(p:readonly Problem[],open:boolean):string            // data-testid problems-panel; mỗi dòng: câu mô tả, nút tới đối tượng, mã lý do trong <code>
  export function nextStrip(p:readonly Problem[],next:NextAction):string             // data-testid next-action; rỗng khi không có việc cho con người
  // run-bar.ts
  export interface PickerItem {id:string;title:string;summary:string;runnable:boolean;reasons:string[]}
  export function pickerItems(all:readonly TwinPreset[],health:TwinHealth|null):PickerItem[]   // mục chạy được trước; còn lại giữ thứ tự catalog; chưa có health thì mọi mục runnable:true
  export function scenarioPicker(items:readonly PickerItem[],currentId:string,open:boolean):string   // data-action twin-preset như cũ
  export function caveatPopover(mode:string,limitations:readonly string[],open:boolean):string       // data-testid caveat-detail
  ```
  `attention-reason` (chuỗi attention hiện có) nằm trong `problemsPanel`. `data-action` mới: `twin-problems-toggle`, `twin-caveat-toggle`, `twin-picker-toggle`.

- [ ] **Step 1: Unit fail trước** (`twin-problems.test.ts`): chưa ghép nối → một `blocker` có `action.id==='twin-runtime-toggle'`; hai mục preflight chưa đạt → hai `blocker` mang `reasonCodes` của chúng trong `codes`; run `needs_attention` với hai attention → hai `attention`, cái `reconcilable` có `action.id==='twin-reconcile'`; `linkState:'runtime_lost'` → một `blocker`; `notice` khác rỗng → một `notice` xếp cuối; không có gì → mảng rỗng và `nextStrip` rỗng khi `next.action` vắng. `pickerItems`: với health chỉ có mock, các preset `irsim-*`, `webots-*` có `runnable:false` và `reasons` khác rỗng, xếp sau các preset mock.
- [ ] **Step 2: e2e thêm vào** `twin-layout.spec.ts`: chưa ghép nối → `problems-count` hiện "1", mở ra thấy câu mô tả và nút dẫn tới hộp runtime; chạy `coffee` rồi chèn lỗi `cup-removed` → `problems-count` tăng, dòng đầu có nút tới đối tượng, `next-action` hiện trong khung nhìn; bấm `mode-badge` → `caveat-detail` liệt kê `limitations` của report; mở bộ chọn: preset chạy được đứng trước, preset Webots bị vô hiệu kèm lý do.
- [ ] **Step 3:** Viết `problems.ts`, bộ chọn và hộp giải thích nhãn; thay 10 thẻ preset và khối `checks()`/`reasons` đang hiện thường trực.
- [ ] **Step 4:** `pnpm typecheck && pnpm exec vitest run && node scripts/test-mock-e2e.mjs` xanh. Commit `feat: one problems list, a persistent simulation label and a scenario picker`.

---

### Task U03: Thanh điều khiển, phím, chế độ xem, mốc xem lại

**Files:**
- Create: `src/ui/keys.ts`, `tests/unit/twin-keys.test.ts`, `tests/e2e/twin-transport.spec.ts`
- Modify: `src/ui/transport.ts`, `src/ui/workspace.ts`, `src/ui/report-panel.ts`, `src/styles/main.css`

**Interfaces:**
- Consumes: `transportBar`, `ReplayState`, `openReplayV2`, `clockControls`.
- Produces:
  ```ts
  // keys.ts
  export const KEYMAP:Readonly<Record<string,string>>={' ':'twin-toggle-play',ArrowRight:'twin-step',f:'twin-camera-fit',i:'twin-inspector-toggle',w:'twin-watch','?':'twin-help',Escape:'twin-escape'};
  export function keyAction(e:{key:string;ctrlKey:boolean;metaKey:boolean;altKey:boolean;target:{tagName?:string;isContentEditable?:boolean}|null},dialogOpen:boolean):string|null   // null khi đang gõ trong input/select/textarea/contenteditable, khi có phím bổ trợ, hoặc khi hộp thoại mở (trừ Escape)
  export function shortcutsDialog(open:boolean):string                                 // data-testid shortcuts
  // report-panel.ts
  export function replayMarks(report:RunReport,max?:number /* 200 */):{tick:number;label:string}[]   // một mốc cho mỗi tick có business event; quá max thì giữ các mốc cách đều
  ```
  `twin-toggle-play`: đang xem lại → `twin-replay-play`; đang chạy → `twin-stop` nếu đang tự chạy, ngược lại `twin-play`. `twin-escape`: thoát chế độ xem, rồi đóng menu/hộp đang mở, rồi đóng bảng chi tiết. Chế độ xem đặt lớp `watch` trên vùng làm việc: chỉ còn khung nhìn, `mode-badge`, `run-status`, `run-tick` và thanh điều khiển.

- [ ] **Step 1: Unit fail trước** (`twin-keys.test.ts`): `keyAction` trả đúng hành động cho từng phím của `KEYMAP`; `null` khi `target.tagName` là `INPUT`, `SELECT`, `TEXTAREA`; `null` với `metaKey`; hộp thoại mở thì chỉ `Escape` có hành động; `replayMarks` cho report có 300 tick sự kiện trả đúng 200 mốc tăng dần, mốc đầu và cuối được giữ.
- [ ] **Step 2: e2e fail trước** (`twin-transport.spec.ts`, launcher mock): `Space` bắt đầu tự chạy và `Space` lần nữa dừng; `→` tăng `run-tick`; gõ `w` trong ô mã ghép nối không vào chế độ xem; `w` ngoài ô nhập ẩn thanh ứng dụng, thanh run (trừ ba nhãn nêu trên) và bảng chi tiết, `Escape` trả lại; `?` mở `shortcuts`; sau khi `completed`, mở xem lại từ thẻ Báo cáo: thanh điều khiển chuyển sang thanh trượt có mốc, kéo thanh trượt đổi `run-tick`, `Space` phát và dừng xem lại.
- [ ] **Step 3:** Viết `keys.ts`; đăng ký `keydown` trong `mounted()` và gỡ trong `leave()`; chuyển `replayBody`/thanh trượt xem lại từ `report-panel.ts` sang `transportBar`; CSS lớp `watch`.
- [ ] **Step 4:** `pnpm typecheck && pnpm exec vitest run && node scripts/test-mock-e2e.mjs` xanh. Commit `feat: one transport bar for live and replay, keyboard control and a watch mode`.

---

### Task U04: Khung nhìn — cảnh giữ nguyên, bộ đệm mẫu, góc nhìn, menu Hiển thị

**Files:**
- Create: `src/twin/sample-buffer.ts`, `tests/unit/sample-buffer.test.ts`, `tests/unit/twin3d-structure.test.ts`
- Modify: `src/viewer/twin3d.ts`, `src/ui/workspace.ts` (`tick()`, `mounted()`, menu Hiển thị), `src/twin/arm/arm-telemetry.ts`, `tests/e2e/twin-layout.spec.ts`, `tests/e2e/brand-accessibility.spec.ts`

**Interfaces:**
- Consumes: `TwinStore` (`twin/store.ts`), `armJointsView`, `displayJoints`, `overlayShapes`, `armFrames`, `armChain`.
- Produces:
  ```ts
  // sample-buffer.ts
  /** Phát lại các mẫu đã nhận theo thời gian mô phỏng với độ trễ cố định. Không bao giờ trả giá trị nằm ngoài khoảng giữa mẫu cũ nhất và mới nhất đang giữ. */
  export class SampleBuffer<T> {constructor(lerp:(a:T,b:T,u:number)=>T,delayMs?:number /* 150 */,cap?:number /* 64 */);
   push(simNs:bigint,wallMs:number,value:T):void;at(wallMs:number):T|null;clear():void}
  export const lerpJoints=(a:readonly number[],b:readonly number[],u:number):number[]
  // twin3d.ts
  export interface TwinPoses {arms:Record<string,{jointsRad:number[];gripperOpeningM:number|null}>;bodies:Record<string,{positionM:[number,number,number];quaternionXyzw:[number,number,number,number]}>}
  export function structureKey(f:TwinFrame,vs:ViewState):string       // đổi khi project, cảnh điều hướng, lớp, lựa chọn, tập đối tượng hoặc nguồn hiển thị của tay máy đổi; không đổi khi chỉ pose đổi
  export interface Twin3d {canvas:HTMLCanvasElement;attach(host:HTMLElement):void;update(f:TwinFrame,vs:ViewState):void;pose(p:TwinPoses):void;home():void;fit(entityId:string|null):void;dispose():void}
  ```
  `at(wallMs)`: thời điểm mô phỏng cần hiển thị = `newest.simNs − delayMs·rate + (wallMs − newest.wallMs)·rate`, kẹp vào `[oldest.simNs, newest.simNs]`; `rate` (ns mô phỏng trên ms thực) ước từ hai lần `push` gần nhất, kẹp vào `[0, 64·1e6]`; nội suy giữa hai mẫu kề thời điểm đó. `update()` chỉ dựng lại khi `structureKey` đổi và tăng `canvas.dataset.rebuilds`; `pose()` chỉ đổi phép biến đổi. Vòng `requestAnimationFrame` trong `workspace.ts` chạy khi link `live`, có mẫu trong 1 s gần nhất và `matchMedia('(prefers-reduced-motion: reduce)')` không khớp; ngoài ra vẽ theo từng mẫu như hiện nay. Mẫu cũ quá ngưỡng (`armJointsView.stale`) không đi qua bộ đệm: tay máy đứng yên và vẽ dạng khung dây như hiện nay. `data-action` mới: `twin-camera-home`, `twin-camera-fit`.

- [ ] **Step 1: Unit fail trước** (`sample-buffer.test.ts`):
  - mẫu tại sim 0/100/200 ms đến lúc thực 0/100/200 ms, giá trị `[0]`/`[1]`/`[2]`: `at(250)` trả `[1]` (đang phát tại sim 100 ms); `at(300)` trả `[1.5]`; mọi `at(t)` với `t` từ 200 tới 1000 nằm trong `[0,2]` và không vượt `[2]`;
  - Review Focus 2: sau các mẫu trên, `at(60_000)` (tab ẩn một phút) trả `[2]`; `push` tiếp sim 60 100 ms lúc thực 60 100 ms rồi `at(60_101)` trả giá trị trong `[2, giá trị mới]` gần `[2]`, không quét lại các mẫu cũ;
  - một mẫu duy nhất → `at` trả mẫu đó; chưa có mẫu → `null`; quá `cap` thì mẫu cũ nhất bị bỏ;
  - `lerpJoints` nội suy từng khớp; hai mảng khác độ dài → trả `b`.
- [ ] **Step 2: Unit fail trước** (`twin3d-structure.test.ts`): `structureKey` bằng nhau cho hai frame chỉ khác pose AMR và góc khớp; khác nhau khi bật một lớp, đổi lựa chọn, thêm một đối tượng, hoặc tay máy chuyển từ `observed` sang `unknown`.
- [ ] **Step 3: e2e thêm:** chạy `coffee` mock 5 s tự chạy: `canvas.dataset.rebuilds` không tăng trong lúc `run-tick` tăng; nút góc nhìn gốc đưa camera về (so `canvas.dataset.camera` trước và sau khi xoay); menu Hiển thị bật/tắt một lớp; với `page.emulateMedia({reducedMotion:'reduce'})` không có vòng `requestAnimationFrame` (đếm qua `page.evaluate` bọc `requestAnimationFrame` trước khi tải trang) và hình vẫn cập nhật theo mẫu; `brand-accessibility.spec.ts` chạy axe trên trang twin với bảng chi tiết đóng, mở từng thẻ, và menu Hiển thị mở: không vi phạm `serious`/`critical`.
- [ ] **Step 4:** Viết `sample-buffer.ts`; sửa `twin3d.ts` (đối tượng theo `entityId` giữ qua các lần `pose`; đổ bóng mềm từ một đèn hướng; `dataset.camera` ghi vị trí camera làm tròn 3 chữ số); `workspace.tick()` đẩy mẫu vào bộ đệm theo `simTimeNs` và gọi `viewer.pose` từ `at(performance.now())`.
- [ ] **Step 5:** `pnpm typecheck && pnpm exec vitest run && node scripts/test-mock-e2e.mjs` xanh. Commit `feat: the 3D twin keeps its scene and plays samples through a sim-time buffer`.

---

### Task U05: Mesh tay máy, tay kẹp và cốc theo plant

**Files:**
- Create: `src/viewer/arm-mesh.ts`, `tests/unit/arm-mesh.test.ts`
- Modify: `scripts/sync-engineering-contracts.mjs`, `src/viewer/twin3d.ts`, `src/twin/arm/arm-telemetry.ts`, `src/twin/scene.ts`
- Thêm bởi sync: `fixtures/engineering/xarm6-g2-v1/{component.json,physics.json,cell-layout.json,fk-golden.json,manifest.json,coffee-cell-project.json}`, `public/fixtures/xarm6-g2-v1/{NOTICE,blobs/<sha256>.stl}`

**Interfaces:**
- Consumes: fixture `xarm6-g2-v1` (M02), telemetry `providerId:'mujoco_arm'` với `observed.gripperOpeningM` và mẫu cốc có `positionM`, `quaternionXyzw` (M01, M06), `armFrames`, `armChain`, `sha256Hex` (`twin/hash.ts`), `STLLoader` (`three/addons/loaders/STLLoader.js`).
- Produces:
  ```ts
  // arm-mesh.ts
  export interface ArmMeshSet {group:THREE.Group;links:THREE.Object3D[];fingers:{object:THREE.Object3D;multiplier:number}[]}
  export async function loadArmMeshes(component:unknown,physics:unknown,blob:(sha256:string)=>Promise<ArrayBuffer>,material:THREE.Material):Promise<ArmMeshSet>   // ném `ARM_MESH_UNAVAILABLE:<sha256>` khi blob thiếu hoặc sha256 nội dung khác tên
  export function poseArmMeshes(set:ArmMeshSet,frames:readonly Mat4[],gripperOpeningM:number|null):void
  export const meshFlange=(set:ArmMeshSet):[number,number,number]
  // arm-telemetry.ts: ArmJointsView thêm gripperOpeningM:number|null; armModelFor(providerId:string):'xarm6-g2-v1'|'arm-ref-3d-v1'
  ```
  `sync-engineering-contracts.mjs` chép fixture sau khi kiểm sha256 theo `manifest.json` của fixture (cùng cách đang làm với `arm-ref-3d-v1`), từ chối khi cây fixture của source bẩn. Cốc có mẫu `mujoco_arm` được vẽ tại pose của mẫu; cốc không có mẫu giữ cách vẽ theo quyền giữ hiện nay.

- [ ] **Step 1: Unit fail trước** (`arm-mesh.test.ts`, blob đọc từ `public/fixtures/xarm6-g2-v1/blobs/` bằng `fs`): với mọi pose của `fk-golden.json`, `poseArmMeshes` rồi `meshFlange` lệch `flangeChainM` ≤ 1e-6 m (cột chuỗi khớp của component, không phải `flangeDhM`); `gripperOpeningM` bằng 0 và bằng `openingMaxM` cho hai vị trí ngón khác nhau đúng theo `multiplier`; `null` giữ ngón ở vị trí mở; blob trả về bị đổi một byte → `ARM_MESH_UNAVAILABLE:<sha256>`; `armModelFor('webots_arm')==='arm-ref-3d-v1'`.
- [ ] **Step 2:** Sửa sync script và chạy `node scripts/sync-engineering-contracts.mjs && pnpm check:source`.
- [ ] **Step 3:** Viết `arm-mesh.ts`; `twin3d.ts` tải mesh một lần mỗi model, dùng `poseArmMeshes` trong `pose()`; Review Focus 5: tải lỗi → dùng `armChain` và đặt lý do `ARM_MESH_UNAVAILABLE` vào danh sách Vấn đề (mức `notice`), run vẫn chạy.
- [ ] **Step 4: e2e** thêm vào `twin-layout.spec.ts` với route Playwright chặn `**/blobs/*.stl` trả 404: trang vẫn vẽ tay máy (chuỗi trụ), `problems-count` có mục `ARM_MESH_UNAVAILABLE`, chạy mock tới `completed`.
- [ ] **Step 5:** `pnpm typecheck && pnpm exec vitest run && node scripts/test-mock-e2e.mjs twin-layout.spec.ts` xanh. Commit `feat: the twin draws the xArm 6 from its vendor meshes and cups where the plant reports them`.

---

### Task U06: Hộp runtime, preset `mujoco-coffee`, launcher và e2e trên MuJoCo thật

**Files:**
- Modify: `src/ui/run-bar.ts`, `src/ui/workspace.ts`, `src/scenarios/catalog.ts`, `src/scenarios/support.ts`, `src/ui/operations-panel.ts`, `src/ui/report-panel.ts`, `scripts/start-irsim.mjs`, `scripts/test-irsim-e2e.mjs`, `package.json`, `README.md`
- Create: `tests/e2e/mujoco-coffee.spec.ts`, `tests/unit/runtime-popover.test.ts`

**Interfaces:**
- Consumes: `RuntimeTarget`, `parseTarget`, `saveTarget`, `mayAutoProbe` (N03); capability `sim3d_arm_contact_v1`, set `engineering-mujoco-arm-v1`, scenario `MJ-BV01` (M01, M07); `prepareWebots`, `checkWebotsHealth`, `venvProblem` (`scripts/start-irsim.mjs`).
- Produces:
  ```ts
  // run-bar.ts: runtimePopover của U01 đổi chữ ký thành
  export function runtimePopover(s:{open:boolean;target:RuntimeTarget;draftUrl:string;paired:boolean;busy:boolean;health:TwinHealth|null;pin:{expected:string;actual:string|null};error:string|null}):string
  //   data-testid runtime-popover; radio "Máy này" (rỗng hoặc http://127.0.0.1:4176) và "Địa chỉ khác"; ô #twin-runtime-url; form #twin-pair-form với ô mã #twin-pair-token (giữ id); nút data-action twin-connect; dòng commit ghim và commit runtime
  // catalog.ts
  export const MUJOCO_ARM_SET='engineering-mujoco-arm-v1';   // preset id 'mujoco-coffee': MJ-BV01, seed 42, project = fixtures/engineering/xarm6-g2-v1/coffee-cell-project.json
  // support.ts: PORTABLE_CAPABILITY.mujoco_arm='sim3d_arm_contact_v1'
  // start-irsim.mjs: --provider mujoco → prepareMujoco(o,launch_,lock,track), checkMujocoHealth(health,lock); --mujoco-python (mặc định <source>/.venv-mujoco/bin/python)
  // package.json: "lab:mujoco":"node scripts/start-irsim.mjs --provider mujoco", "test:mujoco-e2e":"node scripts/test-irsim-e2e.mjs --provider mujoco"
  ```
  Thông báo lỗi kết nối (ba ngôn ngữ): `LOOPBACK_BLOCKED` → "Trình duyệt chặn kết nối tới 127.0.0.1 từ trang này. Dùng Chrome, Edge hoặc Firefox và cho phép khi được hỏi, hoặc chạy `pnpm lab:mujoco` rồi mở http://127.0.0.1:4175."; `RUNTIME_PIN_MISMATCH` → hiện hai commit và chặn chạy; `PAIRING_RATE_LIMITED` → chờ một phút. Nhãn nguồn hàng khớp: `thực (MuJoCo)` / `lệnh`. Thẻ Báo cáo hiện khối `armPlant` của MuJoCo, bảng waypoint IK và `not_calibrated`.

- [ ] **Step 1: Unit fail trước** (`runtime-popover.test.ts`): `runtimePopover` với đích `same_origin` chọn sẵn "Máy này"; với `pin.actual` khác `pin.expected` hiện cả hai commit và vô hiệu nút chạy; với `error:'LOOPBACK_BLOCKED'` hiện câu hướng dẫn; `backendSetOptions` với health thiếu `sim3d_arm_contact_v1` trả set MuJoCo `selectable:false` với `CAPABILITY_MISSING:sim3d_arm_contact_v1`; preset `mujoco-coffee` có `backendSetId===MUJOCO_ARM_SET`.
- [ ] **Step 2:** Viết hộp runtime và nối vào `workspace.ts` (`twin-connect`: `parseTarget` → `saveTarget` → health → kiểm pin → `pair`); thêm preset, capability, nhãn, khối report; `prepareMujoco` (kiểm closure, venv theo lock, không cần engineering catalog) và `checkMujocoHealth`; provider `mujoco` trong `test-irsim-e2e.mjs` với mẫu tiến trình sót `mujoco_worker`.
- [ ] **Step 3: e2e** `mujoco-coffee.spec.ts` (INT15; một spec mỗi launcher): `pnpm lab:mujoco`, ghép nối qua hộp runtime, chọn `mujoco-coffee`, tự chạy ở 1× trong 10 s rồi 16× tới `completed`; `run-served` là 2; trong lúc chạy `canvas.dataset.rebuilds` không tăng; mở thẻ Kỹ thuật thấy hai cột khớp và nhãn `thực (MuJoCo)`; thẻ Báo cáo có `not_calibrated`, `contact` và bảng waypoint; chụp `screens/mujoco-coffee.png` ở 1440 × 900 với bảng chi tiết đóng. Spec mặc định bị Playwright bỏ qua như `webots-*.spec.ts`.
- [ ] **Step 4:** `pnpm typecheck && pnpm exec vitest run && pnpm test:mock-e2e && pnpm test:mujoco-e2e -- mujoco-coffee.spec.ts && pnpm test:irsim-e2e -- irsim-journey.spec.ts && pnpm test:webots-e2e -- webots-coffee.spec.ts` xanh (INT16). Commit `feat: runtime connection box, the mujoco coffee preset and its launcher`.
