# Bench kit: spike vị trí code (K01), 2026-11-26

Mọi phép đo chạy trong một clone tạm (`git clone --no-hardlinks` từ worktree `bench-kit`, HEAD `0f3ef0a3`, `pnpm install --frozen-lockfile --offline`), dưới `taskpolicy -b nice -n 19` và `alarm 900`. Clone đã xóa; không file nào của thí nghiệm vào nhánh `bench/kit`. Mốc so sánh: [baseline.md](baseline.md).

Tài liệu thiết kế được trích là bộ thiết kế tại `robot/docs/2026-11-26-hardware-bench/` (ngoài repo; chỉ được chép vào `docs/implementation/bench/design/` ở task đóng): `04-contracts-and-evidence.md` §3 "Wire giữa phần TS và worker" (envelope `sessionId`, bảng lệnh, hạn ACK) và `plans/README.md` §4 "Khi nào dừng một nhánh" (mục ba: chép kỷ luật wire vào `packages/bench/src/worker.ts`, tối đa khoảng 150 dòng).

## 1. Phép đo

Hai commit thí nghiệm trong clone. Lần 1: ba file hợp lệ (`packages/bench/src/index.ts` rỗng, `robotics/bench/schemas/x.schema.json` = `{}`, `robotics/bench/bench_worker/__init__.py` rỗng) cùng một bản sao `scripts/export-lab-runtime-meta.mjs` của script export, chỉ thêm `metafile:true` vào lệnh `build({...})` (dòng 40 của bản gốc) và in `Object.keys(result.metafile.inputs)`. Lần 2: `index.ts` import `diffDriveBaseV1` từ `../../lab-runtime/src/v2/control/diff-drive-base` và `hashJson` từ `../../lab-runtime/src/v2/hash`, nạp bằng `scripts/k01-load.mjs` (`tsImport`). Export chạy trực tiếp trên cây sạch (không `--clean-checkout`), exit 0 cả hai lần.

| Phép đo | Kỳ vọng | Số thực | Đạt |
|---|---|---|---|
| `schemaHash`, lần 1 (3 file rỗng) | `20dcb91d…134db2` | `20dcb91def3429f6212ff00bc8c627e4227a10949b071848d1880cf3bb134db2` | đạt |
| `schemaHash`, lần 2 (import runtime) | không đổi | `20dcb91def3429f6212ff00bc8c627e4227a10949b071848d1880cf3bb134db2` | đạt |
| Digest closure, `portableToolClosure(root)` gọi trực tiếp, lần 1 | `2c788ca4…849caa`, 348 file | `2c788ca437f59bbc99212b58667c55cbe4050c572d44bcfbd0781bb09d849caa`, 348 file | đạt |
| Digest closure trong `manifest.json` (`portableSimulationTools.closure.digest`), lần 1 và 2 | không đổi | cùng giá trị trên | đạt |
| Đường dẫn bench trong `metafile.inputs`, lần 1 | 0 | 0 trên tổng 455 input (1 output) | đạt |
| Đường dẫn bench trong `metafile.inputs`, lần 2 (có import) | 0 | 0 trên tổng 455 input; danh sách lần 1 và lần 2 giống hệt từng phần tử; có `packages/lab-runtime/src/v2/hash.ts` và `…/control/diff-drive-base.ts` (nên regex bắt được đúng định dạng đường dẫn) | đạt |
| `tsImport` nạp `packages/bench/src/index.ts` (import 2 file runtime) | nạp được | in `{"controller":"function","digest":"015abd7f…f862"}`, exit 0 | đạt |
| `artifactSha256` (tham khảo, không phải điều kiện) | đổi, vì commit source nằm trong bundle | lần 1 `4f7a451a20b1764abf5fb3402071d7ff64045c58bc31bd0903a1cc053d7637e2` (source `bc479ad8`); lần 2 `ccb029fcaf25b9d01d19dca8339e45f4e4cbea691ae412d20f4fb5599ce46eca` (source `4c820441`); baseline `061c6337…91b3` (source `0d365afd`) | đúng kỳ vọng |
| `git status --short` trong clone sau mỗi export; `__pycache__` ngoài `node_modules` | rỗng | 0 dòng; không có | đạt |
| `pnpm-lock.yaml` | không đổi | `git status` sạch sau install và sau thêm file (thư mục mới không có `package.json`, nên `packages/*` của `pnpm-workspace.yaml` không coi là package) | đạt |

Lưu ý: không chạy export đối chứng trên commit không có bench, nên không có "số input của baseline". Tiêu chí đạt là không có đường dẫn bench, không phải số input. Khi lọc closure theo `/bench/` sẽ ra ba file có sẵn (`packages/contracts/schemas/bench-request-v1.schema.json`, `robotics/simulation-mujoco/campaigns/bench-v1.json`, `bench-v2.json`): đó là "bench" ảo của R4, không phải của task này. Mọi kiểm tra sau này phải neo tiền tố `^(packages|robotics)/bench/`.

Nguyên nhân cấu trúc (đã đọc, không đoán): bundle chỉ gom những gì `packages/lab-runtime/src/cli.ts` import; `PORTABLE_TOOL_PATHS` (`scripts/native-sim/tool-identity.mjs:16`) là danh sách đường dẫn cụ thể, không có `robotics/bench`; `nativeToolClosure` (dòng 13) cũng không. Hệ quả: `robotics/bench/**` nằm ngoài cả hai closure, nhưng `packages/contracts/schemas` nằm trong closure, nên **schema của bench không được đặt ở đó**.

## 2. Bốn quyết định và hai sự kiện kèm theo

| # | Câu hỏi | Quyết định | Bằng chứng |
|---|---|---|---|
| 1 | Vị trí schema | `robotics/bench/schemas/*.schema.json` (không đụng `packages/contracts/schemas`, thư mục đó nằm trong cả `schemaHash` lẫn closure công cụ). `packages/bench/src/**` import runtime bằng đường dẫn tương đối; chiều ngược lại cấm. | Bảng mục 1: ba file không đổi hash, digest, bundle. `export-lab-runtime.mjs` tính `schemaHash` chỉ từ `packages/contracts/schemas/*.json`; closure ở `tool-identity.mjs:16` |
| 2 | `spawnWorker`: dùng lại hay chép | **CHÉP** kỷ luật wire vào `packages/bench/src/worker.ts` (`plans/README.md` §4 mục ba), kèm đúng test KSW01. Chi tiết mục 3. | `worker-client.ts:101-107`, `:95`, `:96` và spec `04-contracts-and-evidence.md` §3 |
| 3 | Bộ ghi chunk dùng chung | **Không có hàm dùng chung** để ghi `*.ndjson.gz` `NNNNNN-<8hex>`. Dùng lại được hai thứ: `writeDurable(dir,name,bytes)` và `READ_LIMITS`. Mẫu để bắt chước: `openBenchTrace`. Chi tiết mục 4. | `navigation2d/evidence.ts:72`, `:29`; `control/bench-runner.ts:173-192` |
| 4 | Cách bench nạp TS của runtime | Script: `import {tsImport} from 'tsx/esm/api'` rồi `await tsImport(join(root,'packages/bench/src/<file>.ts'),import.meta.url)`, `root=resolve(dirname(fileURLToPath(import.meta.url)),'..')`. Chạy được cả file bench lẫn file runtime, kể cả khi file bench import runtime tương đối (đã chạy: exit 0). | `scripts/lab-hardware.mjs:14` (import), `:26` và `:37` (cách gọi); `scripts/k01-load.mjs` trong clone |
| 5 | Test và typecheck | `tests/unit/*.test.ts` import được cả `../../packages/bench/src/index` lẫn `../../packages/lab-runtime/src/v2/hash`, **không đổi cấu hình**. `pnpm typecheck` tự thấy `packages/bench` (qua bước `tsc --noEmit`). | `vitest.config.ts` `include:['tests/**/*.test.ts']`; `package.json:13` (`typecheck` = `next typegen && tsc --noEmit && pnpm --filter mekoniq-robot-lab typecheck`; chỉ bước `tsc --noEmit` liên quan, hai bước kia là Next và Lab); `tsconfig.json` `include` có `packages/**/*.ts`, `tests/**/*.ts`; `moduleResolution:Bundler`. Đã chạy |
| 6 | Hợp lệ với lint | `eslint .` bao `packages/bench`, `tests/unit`, `scripts`; ignore chỉ có `apps/lab/**`, `generated`, `dist`, `.venv*`… Không cần sửa. | `eslint.config.mjs`; `eslint packages/bench tests/unit/k01-probe.test.ts` exit 0 |

Kiểm chứng mục 5: test thăm dò `tests/unit/k01-probe.test.ts` (không commit) chạy `pnpm test:unit -- tests/unit/k01-probe.test.ts`, 1 passed, 715 ms. `pnpm exec tsc --noEmit --listFilesOnly` liệt kê `packages/bench/src/index.ts` và file test. Chưa chạy `pnpm typecheck` (cấm theo context; chuỗi ở `package.json:13`, bước `tsc --noEmit` dùng `tsconfig.json` có `packages/**/*.ts`, nên kiểm bằng danh sách file là đủ cho kết luận này). `robotics/bench/**` không vào `tsc` (không phải `.ts`). Không có `package.json` dưới `packages/bench`: thêm vào sẽ biến nó thành package workspace và đổi `pnpm-lock.yaml`, nên K02 không được thêm.

Việc K02 cần biết thêm về tên: đã có `tests/unit/bench-catalog-experiments.test.ts`, `tests/unit/bench-signals.test.ts`, `packages/lab-runtime/src/v2/control/bench-{campaign,runner,signals}.ts`, `packages/contracts/schemas/bench-request-v1.schema.json` (bench ảo, R4). Tên mới trong kế hoạch (`bench-contracts`, `bench-session`, `bench-cases`…) không trùng, nhưng đặt tên kiểu và hằng không được trùng `BenchRequestV1`, `BenchPlant`, `BenchTraceManifest`, `BENCH_TRACE_LIMITS`, `benchCatalog`… khi import cùng lúc.

## 3. `spawnWorker`: bằng chứng cho quyết định CHÉP

File `packages/lab-runtime/src/v2/navigation2d/worker-client.ts`.

`SpawnOptions` (dòng 30-46) bắt buộc: `python`, `workerRoot`, `runId`, `bundleRoot`, `runDirectory`, `lockDigest`, `schemaDir` (dòng 33 và 35). Tùy chọn: `sceneDigest`, `fixtureSha256`, `deadlinesMs`, `entry`, `webotsHome`, `payloadPerturbationId`, `onRequestTiming`. `bundleRoot` và `schemaDir` chỉ được `resolve` rồi đưa vào argv; không kiểm tồn tại. `sceneDigest` tùy chọn. Riêng điều kiện "tham số riêng của mô phỏng" trong brief: **đạt** (bench có thể đưa thư mục hồ sơ làm `bundleRoot`, thư mục schema làm `schemaDir`).

Argv cố định (dòng 57): `--run-id --bundle-root --schema-dir --lock-digest` (+ `--scene-digest` nếu có, + `wire.extraArgs(o)`), qua `isolatedPythonArgs`. Môi trường cố định (dòng 59): `PATH:'/usr/bin:/bin'`, không chuyển biến nào từ process cha, chỉ thêm `wire.env`. Tiến trình `detached:true` (dòng 60), lỗi nào cũng `killGroup` SIGKILL.

Kiểm response trong `onLine` (dòng 91-128), cái nào vướng bench:

| Dòng | Kiểm | Bench |
|---|---|---|
| 92 | `wire.validateResponse` (kiểu trả `IRSimResponseV1`) | tự viết được, ép kiểu như `SIM3D_WIRE` |
| 95 | `r.runId === o.runId` | spec `04-contracts-and-evidence.md` §3 đặt envelope là `sessionId`, không có `runId`: phải đổi tên hoặc thêm trường |
| 96-97 | `bootId` không đổi, `tick` không giảm | spec không có `bootId` ở response |
| 101-103 | op `create`/`step`/`getState` **bắt buộc** có snapshot (`result.schemaVersion===1`); op khác **cấm** | `step` của bench trả phản hồi drive, hàng chu kỳ, mẫu cảm biến, thống kê thời gian (spec `04-contracts-and-evidence.md` §3), không phải snapshot: bị `WORKER_PROTOCOL` ngay lần `step` đầu |
| 104 | op khác `describe` phải có `result.state` | `open`/`scan`/`configure`/`start`/`silence`/`imuConfigure` không có trường này trong spec |
| 105-107 | op ngoài `step`/`describe` phải trả `tick === expectedTick`; `step` phải trả `tick === payload.targetTick` | payload `step` của bench là `DriveCommandV1[]`, không có `targetTick` |
| 111 | `simTimeNs === tick × 20 ms` | chỉ chạy khi `result.schemaVersion===1`; bench không dính nếu không trả snapshot |
| 154-157 | `close()` gửi `stop` với `expectedTick:lastTick`, rồi `stdin.end()`, đợi 2 s rồi SIGKILL cả nhóm | khớp "stdin đóng = stop", nhưng hạn grace 2 s, không phải hạn `stop` 5 s của spec |

Hạn ACK (dòng 11, hợp nhất ở dòng 56): bản đồ tĩnh theo tên op, fix lúc spawn. `silence` của bench có hạn "theo tham số + 5 s", không biểu diễn được; một hằng chặn trên làm hỏng ý nghĩa timeout. Giới hạn dòng 2 MiB (`MAX_LINE_BYTES`) và hàng đợi 64 áp cho mọi wire.

Kết luận: tiêu chí brief ("không bắt tham số mô phỏng, quy tắc `simTimeNs` không kiểm response bench") đạt từng điểm, nhưng ba quy tắc op-theo-tên (dòng 101-107) khiến `step` của bench không thể đi qua nếu giữ spec §3 nói trên. Muốn REUSE phải đổi tên op `step` và thêm `result.state` vào mọi response, tức sửa spec, nên **chép**. Nếu sau này vẫn chọn REUSE, `BENCH_WIRE` cần đúng các trường `{protocol:'mekoniq-bench/1', module:'bench_worker', deadlinesMs:{open:10000,scan:30000,configure:30000,start:15000,step:200,silence:<chặn trên cố định>,imuConfigure:5000,stop:5000}, extraArgs:()=>['--role',role,'--kit',…] (một wire mỗi vai, vì `extraArgs` chỉ nhận `SpawnOptions`), validateRequest, validateResponse, fatalCodes:[…]}`, kèm worker Python chấp nhận bốn đối số cố định và trả `runId`, `bootId`, `tick`.

Được import mà không kéo gì thêm (lưu ý đo thời gian nạp bằng `tsImport` trong clone):

| Cần | Import | Chi phí nạp |
|---|---|---|
| `isolatedPythonArgs`, `bytecodeEnv` | `../../lab-runtime/src/engineering/python-env` (`python-env.ts:10,23`) | 176 ms |
| `WorkerLostError`, `MAX_LINE_BYTES`, `QUEUE_LIMIT` | `../../lab-runtime/src/v2/navigation2d/worker-client` | 1191 ms (kéo Ajv và hợp đồng navigation2d) |

Khuyến nghị cho K04: import `python-env`; chép lớp lỗi 3 dòng thay vì nạp `worker-client` (1,2 giây mỗi file test). `bytecodeEnv()` tạo một thư mục rỗng trong `os.tmpdir()`, không phải trong repo.

## 4. Bộ ghi chunk

Tìm trong `packages/lab-runtime/src`: `navigation2d/evidence.ts:206`, `simulation3d/physics-evidence.ts:76`, `simulation3d/world-evidence.ts:82`, `perception/belief-evidence.ts:53`, `control/bench-runner.ts:185` đều tự dựng tên `<tiền tố>-${String(n).padStart(6,'0')}-${randomBytes(4).toString('hex')}.ndjson.gz` ngay trong closure của recorder. Không có hàm xuất khẩu nào nhận tiền tố hay luồng tùy ý.

- Dùng lại được: `writeDurable(dir,name,bytes)` (`navigation2d/evidence.ts:72`: tmp, fsync, rename, fsync thư mục) và `READ_LIMITS` (`:29`: `chunkBytes` 16 MiB, `chunkInflated` 64 MiB, `lineBytes` 256 KiB, `linesPerChunk` 65536, `chunksPerStream` 2000). Bốn recorder khác (`physics-evidence.ts:8`, `world-evidence.ts:11`, `belief-evidence.ts:8`, `bench-runner.ts:28`) đã import đúng hai thứ này. `physics-evidence.ts:44-45` xuất thêm `physicsDirectoryBytes` và `readBoundedPhysicsFile`, `bench-runner.ts:32` dùng lại (quota và đọc có giới hạn).
- Bắt chước: `openBenchTrace` (`control/bench-runner.ts:174`, chú thích ở 173; ghi chunk và manifest ở 176-192): thư mục phải rỗng, `gzipSync`, tên chunk, quota, `writeDurable` chunk rồi mới `writeDurable` manifest (chunk chỉ có hiệu lực khi manifest đã ghi). Reader tương ứng `readBenchTrace` (`:235`).
- Hệ quả: `packages/bench/src/` có recorder riêng, dùng `writeDurable` và `READ_LIMITS` bằng import tương đối; tên chunk `NNNNNN-<8hex>` viết lại một dòng.

## 5. Không làm trong task này

Không `git worktree` hay clone nào còn lại (`git worktree list` chỉ có checkout chính và `bench-kit`); không động tới `source/` chính hay `evidence-archive`; không chạy toàn bộ `pnpm typecheck`, `pnpm lint` hay `pnpm test:unit`; không sửa script export thật. Cloud Run, guard của record R5: không thuộc K01.
