# Baseline sau R2b/R3 cho R4 (V00b)

Chụp 2026-11-19 trên nhánh `r4/virtual-commissioning` của source (tách từ `main` `33847b9`). Tài liệu chỉ đọc và đo: không sinh record mới, không sửa evidence cũ, không ghi `accepted:true` hay sidecar `acceptance.json`. Hash là SHA-256 của byte file, trừ khi ghi khác. Máy: Mac arm64, Node v24.22.2, pnpm 10.32.1. Việc sửa hiển thị của Lab (task V00 mục 2) đã làm riêng ở Lab; mục [Lab](#lab-và-lỗi-hiển-thị-đã-sửa) ghi lại.

## Trạng thái cây và HEAD lúc bắt đầu

| Mục | Giá trị |
|---|---|
| `git -C source status --short` | rỗng (sạch) trên `main` `33847b94dc3a26e97c124c15a9c8825b0990e858` |
| `git -C lab status --short` | rỗng (sạch) |
| Source HEAD | `33847b9` `docs: record six R3 prepared profiles at 3d8c2a8/4b57a9a`; `origin/main` cùng commit (đã push) |
| Lab HEAD | `260f4aa5561220d41db660eeffe42f923865556b` `fix: keep the final frame of a completed cell run`; `main` đi trước `origin/main` 1 commit (chính commit này, chưa push) |
| Tuple đã ghi | source `3d8c2a8` / Lab `4b57a9a`. Lab HEAD khác tuple này đúng một commit: bản sửa hiển thị `260f4aa` (chỉ `src/ui/workspace.ts` và test của nó; pin không đổi) |
| Source HEAD so với `3d8c2a8` | `33847b9` = `3d8c2a8` + `4e7789d` (test: timeout guard) + `837e15e` (record) + `33847b9` (record R3 prepared); không có thay đổi runtime, schema hay tool sau `3d8c2a8` |

Cây sạch, pin khớp tuple đã ghi (bên dưới); không có gì cần dừng.

### Lock của Lab (`lab/config/source-runtime.lock.json`, nguyên văn)

| Trường | Giá trị |
|---|---|
| `dirty` | `false` |
| `sourceCommit` | `3d8c2a8daa025cab6373fd86b0cec7f40864fdb0` |
| `schemaHash` | `8ffe1fe9039cfe44094ab0e47b6b038a70c4811ebe7ad292092108963123a95b` |
| `artifactSha256` | `e485aaa353d62dcaa23201f1da43bf06fcde0dc605667c9f8a8449ba06633737` |
| `portableToolsDigest` | `9619232757017bfb74cb70724b07ccf69054e369f2398e7d1e70d523747ed3e5` |
| `protocolMajor` / `protocolMajors` / `nodeMajor` / `entrypoint` / `packageVersion` | `2` / `[1,2]` / `24` / `runtime.mjs` / `0.1.0` |

Closure đã ghi trong cả năm record (`identity.before`): portable `9619232757017bfb74cb70724b07ccf69054e369f2398e7d1e70d523747ed3e5` (bằng `portableToolsDigest` của pin), native `34eafd36b027d554fc71acdccce672f0ce925a7274600290debf3a5ad91836d3`. Chưa tính lại closure của cây hiện tại: V00b không export, không chạy launcher.

### Engine lock (SHA-256 của file)

| Lock | Hash |
|---|---|
| `robotics/simulation-mujoco/requirements.lock` (`mujoco==3.17.0`, Python 3.11) | `a3c78091c9042b3a9b0428eaa9b140eb2b9c3a1bb89e57033fb1f81f9f0b4d84` |
| `robotics/navigation-2d/requirements.lock` (IR-SIM 2.12.0) | `428308122946981ae3da4e3080f55357a0c56ee6d9a73ccacff9929edb8322e4` |
| `robotics/model-validation/requirements.lock` (LinkForge 1.6.0) | `f45c10abeb0971cc436d29aee600b1f5fb5dcc7ccae202ddef7a0bf7ae98d56c` |

### Digest fixture (manifest, SHA-256 của file)

| Fixture | Manifest |
|---|---|
| `robotics/simulation-mujoco/fixtures/xarm6-g2-v1` | `51bad5842206673d9f417a5f0f4813ac904f64b12a53cbfb403e1e12294b3407` |
| `robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1` | `c98024f99ab13571cf8c767844009a1f98c0abd9ec37d3ea70b653ead5bb072e` |
| `robotics/simulation-mujoco/fixtures/coffee-delivery-world-v1` | `2fc80b1e6bda399309ee9d8a22eb66893f9ee3adec6f869099a34d20423d3428` |
| `robotics/simulation-mujoco/fixtures/serve-payload-v1` | `c93d677ab4c71bfaa2d345b687377eae21964bc44180ac4f5906df3bd7e102c8` |
| `robotics/simulation-3d/fixtures/serve-3d-v1` | `920d586700e6cbfd4995322c26881b5445538505835963602c0d3207df57bc31` |
| `robotics/navigation-2d/fixtures/serve-demo-v1` | `802902b194932b083e567c85fa1c1da78a2ba859c0cb93a46179177b638d4d4f` |

## Record và gate

Năm record nằm trong cây (chỉ JSON cấp trên cùng + `index.json`); bản đầy đủ ở `robot/evidence-archive/records-3d8c2a8-lab-4b57a9a/` (ngoài Git; archive nén trong `raw-3d8c2a8-lab-4b57a9a/` kèm `SHA256SUMS`). Cả năm có `accepted:false`, `acceptedBy:null`, không có `acceptance.json`.

| Record (thư mục trong `docs/implementation/evidence/`) | `qualification.json` SHA-256 | Gate |
|---|---|---|
| `candidate-11`: `linkforge-irsim/irsim` | `195000948174ed2b76516e1971f98ece2ed2e1413805438c3418997b7f81ec50` | G-LF1, G-LF2, G-IR1, G-IR2, G-IR3, G-INT1 `tested` |
| `r1-candidate-09`: `sim-extension/r1` | `a8ef5566a05052cd6dfea71a82747df9ee6bba05773165ea443fada55e73f492` | G-ALG1, G-ALG2, G-WB1, G-WB2, G-INT2, G-REG1 `tested`; ALG04 `not_run` (cần LinuxCNC bridge) |
| `r11-candidate-06`: `sim-extension/r11` | `e47149ba211d3f6513f75319ecb5a87ff663a0e3be1a43972cd0b3ea354c8e15` | G-WA1, G-WA2, G-INT3, G-REG2 `tested` |
| `r2a-candidate-04`: `sim-extension/r2a-candidate-04` | `eafd2227b48c1f3034d183fb608d493c859a3e49118e1c6b6ffa25ba1d3a3fd9` | G-MA1, G-MA2, G-RT1, G-RT2, G-UI1, G-INT4, G-REG3 `tested`; **G-CLOUD1 `blocked_external`**, CL01 `not_run` |
| `r2b-candidate-03`: `sim-extension/r2b-candidate-03` | `e083b6ea07b18f1509816e9cb787c79ba41c719e4c7f2bb3d2850a39c3b35662` | G-MJ1, G-CELL1, **G-WEB1**, G-X1, G-REG4 `tested`; **G-HOST1 `blocked_external`**, WEB06 `not_run` |
| `sim-extension/r3-prepared-3d8c2a8-4b57a9a` (sáu profile) | chỉ `index.json` | G-PREP `tested`; mọi ca native `not_run`, `nativeReady:false` |

G-WEB1 là `tested` (không còn `not_run`). Hai gate còn mở:

- **G-HOST1 `blocked_external`** (WEB06: chưa có host HTTPS được giao). Không chặn task R4 nào: R4 không phụ thuộc host, Linux native, GPU hay phần cứng (plan R4, Global Constraints).
- **G-CLOUD1 `blocked_external`** (CL01 trong record R2a; bằng chứng riêng đã PASS ngày 14/11 ở `evidence/cloud-run/mekoniq-2026-11-14/` và được guard `cloud-run` kiểm, không qua `qualification.json`). Không chặn task R4 nào. Tương ứng của R4 là CLD03 và G-CLOUD2, chỉ chạy sau một lần deploy theo lệnh người dùng: V05, V07, V10, V13 chỉ cần CLD01/CLD02 (không deploy); V16 cần CLD03 và nếu chưa có lệnh deploy thì CLD03 `not_run` với lý do `deploy_order_pending`, G-CLOUD2 không thành `tested`, các task sau vẫn đi tiếp.
- Native (G-NATIVE-MJ/AMR/ARM) và phần cứng (G-HW): `not_run`, ngoài phạm vi R4.

### Guard chạy ngày 19/11 (nguyên kết quả)

Chạy trên bản đầy đủ đã giải nén của năm record, `PATH` Node 24.22.2, `PYTHONDONTWRITEBYTECODE=1`, dưới `perl alarm`, ở source `33847b9` (khác `3d8c2a8`, chỉ thêm commit docs/test). Log: `source/.superpowers/sdd/01-drive-and-cil/logs-V00b/guard-*.log`.

| Lệnh | Kết quả |
|---|---|
| `LAB_IRSIM_EVIDENCE_DIR=<archive>/irsim pnpm test:acceptance -- linkforge-irsim` | exit 0, 6/6 passed (0,82 s) |
| `LAB_SIMEXT_EVIDENCE_DIR=<archive>/r1 pnpm test:acceptance -- sim-extension` | exit 0, 12/12 passed (1,05 s) |
| `LAB_SIMEXT_EVIDENCE_DIR=<archive>/r11 …` | exit 0, 12/12 passed (0,26 s) |
| `LAB_SIMEXT_EVIDENCE_DIR=<archive>/r2a …` | exit 0, 12/12 passed (0,29 s) |
| `LAB_SIMEXT_EVIDENCE_DIR=<archive>/r2b …` | exit 0, 12/12 passed (63,5 s; đọc lại ~0,5 GB) |

`<archive>` = `robot/evidence-archive/records-3d8c2a8-lab-4b57a9a`. Guard của chuỗi ghi lúc 05:57 ngày 19/11 từng fail (r1/r11/r2a/r2b) vì record chưa nằm trong cây; sau commit `837e15e` chúng đạt. Không có suite nào bị bỏ qua.

Không chạy: guard R3 (`verify-r3`, cần handoff trong `r3-prepared.tar.gz`; lý do `not_run`: ngoài phạm vi V00b và không đổi theo R4), guard `cloud-run` (supplement `evidence/cloud-run/mekoniq-2026-11-14` gắn với byte R2a của 14/11, không phải `r2a-candidate-04`), pytest worker (không cần cho baseline; không chạy nên không để `__pycache__`).

## Golden cần giữ nguyên byte (R4 không được đổi)

Đọc lại, không sinh lại. Mức hash: **file** = SHA-256 của file trong cây; **retained** = SHA-256 của file trong `robot/evidence-archive/` (ngoài Git).

| Golden | Tên và vị trí | Hash |
|---|---|---|
| Mock BV01 | `tests/unit/bv01-mock-golden.test.ts` (seed 42): outcome digest và arm-trace digest nhúng trong test | file `b3f7ea126b04b47d26b34644fd6f0fa58e9eddea4d5a29108552f05cfe299133`; outcome `9cfda98a693941cde4e0ecbfe028d48471877c6f8440295fc26e7e5061a1a2a2`; armTrace `70ff6e4014be2e7db90b986aefc679fb00810ebaa813c3214bbf6a8f2e1beeff` |
| IR-SIM chunk | `tests/fixtures/navigation2d/ir-chunk-hashes.json` (IR-FD01@5, IR-FD07@7; kiểm bởi `tests/integration/irsim-plant-port.test.ts`) | file `a25969a9d37acf265591d7c63595abd507a42a9a98252c9b96d9b1f244abd79f`; test `35f80cf06684529d7bac30b0b7c40a771b881085a17777582d713ef9e9dd0b07` |
| Webots bytes | Không có byte-golden commit trong cây. Bản giữ lại: world Webots do semantic study sinh ra, `evidence-archive/r2b-inputs-3d8c2a8-lab-4b57a9a/study/out/webots_3d/run/worker/world.wbt` | retained `c1958d634628678caa15e656269723b591cbdb2c07a8652b6bf5fed70463aced`; `semantic-study.json` `33f61864630449e5cd96578a8c03a9a7a656720df020290e4d1c9a3d38472461` |
| MJ-BV01 | Không có digest outcome commit riêng. Neo: fixture `robotics/simulation-mujoco/fixtures/xarm6-g2-v1` (`fk-golden.json`, `programs.json`) và hành vi trong `tests/integration/mujoco-arm-bv01.test.ts` | `fk-golden.json` `87dc76938e7687fb9543046c0fc1c3c8b522bf78c0ec286d9cd6d88206137d90`; `programs.json` `af99b362b9d22ca2bbb327deef6ab820ae6de9dc181643e6ffd61b85e1ce0e48`; test `f1e35ec9ab3fb908ada9f035610ffb88ca12141f23e369ba1726a4cd9efd0f3c` |
| Payload 19 ca | `robotics/simulation-mujoco/campaigns/payload-v1.json` (`payload-v1`, 19 case, đã đếm) và campaign đã ghi của R2b | file `65b6249a58beb1fec9cdefd78476a6d228f578d756a652e798387af79a33034a`; retained `r2b-inputs-…/physics/campaign.json` `9a7b795c00402277446fc2377c8c11a17f80a510c31fc5c64b687dce8665a88c` (khớp `physicsCampaign.sha256` trong record R2b) |
| Cell 3 seed + 5 fault | `robotics/simulation-mujoco/campaigns/mj-cell-bv01-v1.json` (`nominalSeeds` 7, 42, 99; fault `dock-drift`, `cup-fall`, `cancel-held`, `worker-loss`, `lost-ack`; 8 run) và campaign đã ghi | file `270373713f61734a2ff411bc65fa85046af6e9ad6d6269927ccdc9e22ce63fa7`; test `tests/integration/mujoco-cell-bv01.test.ts` `65c844d967784266aebf64380cb53c84eab300e90617a782a936b851dc9fc93e`; retained `r2b-inputs-…/cell/campaign.json` `504abf12d458606601a25308dfe89a1f3337dbedb98728d1144c8d1b7c297ec0` (khớp `cellCampaign.sha256`) |
| Ba replay package | `evidence-archive/retained-corpus-copy/` — catalog `inputs.json` (ba input: `cell-nominal-7` 82 file, `cell-nominal-export` 1 file, `payload-cup-fall` 41 file) | `inputs.json` `30351aae82c52171d3744d07446fc13341850da7eda155976de586493498a56f`; `cell-nominal-export/manifest.json` (web-replay-package, runId `9821d890-85d2-41f0-91f8-d070ab7c222a`) `b3eb6e7cc0e6c2287092c358e02ab3c860e76e5bc828a5ed41bae4e83bbebaea`; `cell-nominal-7/nominal-report.json` `c09a8cfd47de75cddf04067d0bce7fc85a5e3e6d9dee9e5e59827510fcb47b6e`; `payload-cup-fall/report.json` `b4b76a1b2b7c982779f4f8b9869c097d41fe3a57a88f09a0adfe9839af41be50` |

Hai mục chưa có byte-golden riêng (Webots bytes, MJ-BV01): V00b không tạo golden mới. REG05 nên chốt hai neo trên hoặc ghi hai golden mới ở một task có phạm vi rõ, trước khi đổi đường legacy.

Mức dùng được cho CLD/REG: so hash chỉ có nghĩa trong cùng kiến trúc (arm64 ghi, arm64 chạy lại).

## Chi phí tick trên Mac

`node scripts/native-sim/tick-cost-probe.mjs --ticks 1500 --seed 1 --chunk 25`, `perl alarm 600`, không có tải nặng do V00b; tải nền máy khoảng 4,3 (load average; `fseventsd`, ứng dụng khác). Hai lần chạy liên tiếp:

Lần 1 (JSON nguyên văn):

```json
{"world":"coffee-delivery-cell-v1","seed":1,"chunk":25,"ticks":1500,"status":"running","error":null,"wallMs":24906.764,"msPerTick":16.605,"fsyncCount":1678,"fsyncPerTick":1.119,"fsyncTotalMs":9158.366,"fsyncMsP50":3.86,"fsyncMsP95":14.88,"flushMs":[25.504,53.237,22.538,24.501,23.895,27.237,28.37],"fsyncByFile":{"run.json.tmp":{"count":120,"perTick":0.08,"totalMs":506.79},"pending.ndjson":{"count":1500,"perTick":1,"totalMs":8459.902},"write.intent.tmp":{"count":7,"perTick":0.005,"totalMs":49.244},"world-evidence":{"count":29,"perTick":0.019,"totalMs":78.888},"evidence-chunk.tmp":{"count":7,"perTick":0.005,"totalMs":23.366},"manifest.json.tmp":{"count":8,"perTick":0.005,"totalMs":22.052},"pending.ndjson.tmp":{"count":7,"perTick":0.005,"totalMs":18.125}}}
```

Lần 2 (cùng lệnh; log đầy đủ ở `logs-V00b/tick-probe-2.json`): `wallMs` 22646,215, `msPerTick` **15,097**, `fsyncCount` 1678, `fsyncPerTick` 1,119.

Kết luận: 16,6 và 15,1 ms/tick, cao hơn số tham chiếu 13,3 ms/tick (19/11) và cao hơn dải 12,75–14,45 của spec R4-A. Dư thời gian ở 1× (tick 20 ms) còn khoảng 3,4–4,9 ms thay vì 6,7 ms. Số fsync/tick (1,119) và phân bố theo file giống nhau giữa hai lần: `pending.ndjson` chiếm ~8,5 s trên ~9,2 s fsync. Chênh lệch có thể do tải nền của máy; chưa kiểm chứng. V03 trở đi nên đo lại trên máy yên tĩnh trước khi dùng 13,3 làm ngưỡng so sánh. Chi phí thêm cho đường tick của R4 phải đo cùng điều kiện với chính lần đo ngay trước đó.

## Baseline cloud

`GET https://mekoniq-lab-runtime-ojykcqdkja-as.a.run.app/lab/v2/health` (một lần, không credential): **HTTP 200**, không cần xác thực.

| Trường | Giá trị |
|---|---|
| `sourceCommit` | `3d8c2a8daa025cab6373fd86b0cec7f40864fdb0` (bằng pin Lab; `CLAUDE.md` còn ghi `4f893ac` là bản cũ: dịch vụ đã được cập nhật sau đó) |
| `schemaHash` | `8ffe1fe9039cfe44094ab0e47b6b038a70c4811ebe7ad292092108963123a95b` (bằng pin Lab) |
| `protocolMajor` / `protocolMajors` | `2` / `[1,2]` |
| `deployment` | `{"bind":"public"}` |
| `scenarioIds` | `FD01, FD07, FD02, FD03, FD04, FD04-blocked, FD04-reopen, FD05-payload, FD05-battery, FD05-capability, FD05-binding, BV01, FD02-cups, CAMPAIGN-FD02-FD07-BV01-BV03, IR-FD01, IR-FD03, IR-FD04, IR-FD04-blocked, IR-FD07, MJ-FD01, WB-FD01, WB-FD07, WB-BV01, MJ-CELL-BV01, MJ-BV01` (25 mục, đủ) |
| Backend bật (`installed`/`enabled` true) | `mock_amr`, `mock_coffee`, `mock_arm`, `mujoco_arm`, `mujoco_3d` |
| `capabilities` | `web_replay_package_v1`, `sim3d_world_experiments_v1`, `engineering_bundle_v1`, `sim3d_mujoco_mobile_v1`, `sim3d_payload_experiments_v1`, `sim3d_arm_contact_v1` |
| `engineeringCompilerProfiles` | `engineering-mujoco-3d-v1` |

Chạy `MJ-CELL-BV01` trên Cloud Run từ Lab: **`not_run`**, lý do `access_key_not_provided`. Biến `MEKONIQ_ACCESS_KEY`/`MEKONIQ_LAB_ACCESS_KEY` không có trong môi trường và V00b không tìm khóa ở nơi khác. Các số phục vụ, tick cuối, thời gian tường, ms/tick và tốc độ thật vì vậy chưa có. Để đo: người dùng đặt `MEKONIQ_LAB_ACCESS_KEY` (≥32 ký tự) trong môi trường rồi ra lệnh chạy; không deploy. Chưa có số này không chặn V01.

## Lab và lỗi hiển thị đã sửa

Lab commit `260f4aa` `fix: keep the final frame of a completed cell run` trên `lab/main` (local, chưa push): `frame()` không để cặp world/view hết hạn sau 500 ms khi `run.status` là `completed` và khung cuối không mang nhãn `stale`; `paused`, `cancelled`, `failed` giữ nguyên. Pin runtime không đổi (vẫn `3d8c2a8`); đưa lên `lab/main` cần lệnh riêng vì push `main` là deploy production.

## Giới hạn còn mở

- Mọi record `accepted:false`, không sidecar; vật lý `not_calibrated`, mọi tham số `assumed`.
- G-HOST1, G-CLOUD1 `blocked_external`; native, Linux host, phần cứng `not_run`.
- Số tick Mac cao hơn tham chiếu (xem trên); số tick cloud chưa đo.
- Webots bytes và MJ-BV01 chưa có byte-golden commit.
- Các khoảng tick đứng > 500 ms ở capture web của chuỗi 19/11 chưa được điều tra; điều tra trước khi R4 ghi capture web.
- Có `.pytest_cache` sẵn dưới `robotics/model-validation/` và `robotics/navigation-2d/` (tạo 19/11 lúc 02:41, trước V00b, bị Git bỏ qua): theo quy ước pin chúng làm launcher Lab từ chối closure (`PORTABLE_TOOLS_MISMATCH … :BYTECODE`), cần xóa trước khi ghi record hay chạy launcher.
