# Bàn giao: cụm V01–V03 của R4.1 (drive ảo trong worker MuJoCo)

**Viết ngày 2026-11-19 cho một phiên làm việc khác.** Người dùng đã cho phép bắt đầu V01. Đọc file này trước, rồi đọc các tài liệu ở mục 3. Không cần đọc lại lịch sử hội thoại.

## 1. Việc được giao

Ba task liền nhau của [plan 01](01-drive-and-cil.md), làm theo đúng thứ tự:

| Task | Làm gì | Đầu ra chính | Dừng lại báo người dùng khi |
|---|---|---|---|
| **V01** | Spike đo đạc: drive trên actuator gốc của MuJoCo. Không sửa module nào của worker | `source/robotics/simulation-mujoco/probe_drive.py`, `source/docs/research/2026-11-virtual-drive-spike.md`, output thô, ba digest của đường legacy | **Luôn dừng sau V01** và báo số đo. Chỉ làm V02 khi người dùng xác nhận, hoặc khi mọi tiêu chí Exit của V01 đạt và người dùng đã nói trước là cứ làm tiếp |
| **V02** | Hợp đồng drive, fixture, mock drive | 4 schema mới, 6 schema mở rộng, `fixtures/drive-v1/`, `control/{drive-io,controller,mock-drive}.ts` | Scene cũ không còn giữ byte |
| **V03** | `drive_model.py` và nối vào ba engine | Drive chạy trên engine thật; đường legacy giữ đúng ba digest của V01 | Model lý tưởng không trùng bit; chi phí tick vượt ngân sách |

V04 và V05 không thuộc lần bàn giao này.

## 2. Trạng thái lúc bàn giao

| Mục | Giá trị |
|---|---|
| Source | Nhánh `r4/virtual-commissioning` tại `818df49` (từ `main` `33847b9`), đã push lên `origin`; `main` trùng `origin/main`. Cây làm việc đang ở nhánh R4 |
| Lab | `main` tại `65a4593`, đã push (production). Nhánh `r4/virtual-commissioning` đã tạo từ đó ở local, chưa có commit riêng, chưa push; cây làm việc đang ở `main`, cần `git -C lab checkout r4/virtual-commissioning` trước khi re-pin |
| Pin của Lab | Source `3d8c2a8` (`lab/config/source-runtime.lock.json`) |
| Cloud Run | Báo `3d8c2a8` ở `GET /lab/v2/health`, cùng schema hash với pin |
| V00 | Xong. Tài liệu baseline: `source/docs/implementation/post-r2b-baseline.md`. Sổ ghi của lần chạy V00: `source/.superpowers/sdd/01-drive-and-cil/progress.md` |
| Chưa có | Số đo `MJ-CELL-BV01` trên Cloud Run (`not_run`, cần khóa truy cập của người dùng). Không chặn cụm này |

Kiểm lại trước khi bắt đầu: `git -C source status -sb`, `git -C lab status -sb`, và pin. Cây bẩn hoặc khác bảng trên thì dừng và hỏi, không tự sửa.

## 3. Tài liệu phải đọc, theo thứ tự

1. [plans/README.md](README.md): Global Constraints, quy ước thực thi, điều kiện dừng.
2. [plans/01-drive-and-cil.md](01-drive-and-cil.md): Review Focus, rồi Task V01, V02, V03. Mỗi task có Files, Interfaces, các bước và lệnh kiểm.
3. [Spec R4-A](../02-r4-control-chain-spec.md) §3 (kiến trúc và hai đích chạy), §4 (quyết định R4-D01 tới R4-D20), §5.1–5.2 (drive mô phỏng gì, cơ chế số), §5.4 (năm thí nghiệm drive).
4. [Contracts](../05-contracts-and-evidence.md) §1–3 (identity, tài liệu mới, wire của một tick có drive) và §9 (case DRV01–DRV08).
5. [Nghiên cứu](../01-research.md) §1.1 (số đo ngày 19/11), §2 F01–F04 (actuator và vòng lặp hiện tại), §3.1 U07–U09 (tính năng actuator của engine).
6. `source/robotics/simulation-mujoco/mujoco_worker/{compile,compile_mobile,compile_world,engine,mobile_engine,world_engine,drive,session}.py` và `probe_mobile.py` cùng thư mục (mẫu của một probe).

## 4. Điều đã biết, không cần làm lại

- **Tính năng gốc của engine có thật trên wheel đã cài** (MuJoCo 3.17.0, arm64, model một khớp). Chạy lại: `source/.venv-mujoco/bin/python -I -B docs/2026-11-19-virtual-commissioning/probes/native-actuator-probe.py` từ `robot/`. Kết quả: `pid` với `ki=0` trùng bit với `position`; `delay` dời đúng số substep và đổi được lúc chạy qua `actuator_delay`; bộ đệm trễ với `delay=0` trùng bit; bit nhóm của `disableactuator` cho lực 0; đổi `forcerange` lúc chạy có hiệu lực; `dcmotor` biên dịch được. V01 phải lặp lại trên **model thật của cell và mobile**, qua compiler hiện có.
- **Ba điều dễ sai khi nối drive** (plan V03): actuator `pid` nhận nhiều ô `ctrl`, nên mọi chỗ ghi `ctrl` phải lập chỉ mục theo `actuator_ctrladr`; mỗi trục cần một nhóm actuator riêng trong 0–30 để tắt độc lập; `nsample` của bộ đệm trễ cố định lúc compile.
- **Chi phí tick của cell**: tổng 13,3–16,6 ms/tick tùy độ trễ ghi bền của máy; phần không tính fsync ổn định ở 10,2–11,0 ms/tick. Đo theo cặp xen kẽ legacy/có drive trong cùng phiên và so phần không tính fsync, `(wallMs − fsyncTotalMs)/ticks`. Lệnh: `node scripts/native-sim/tick-cost-probe.mjs --ticks 1500 --seed 1 --chunk 25`.
- **Golden**: Webots đã có (`robotics/simulation-3d/tests/test_compile_arm.py::test_amr_world_unchanged`). `MJ-BV01` chưa có digest: V01 ghi SHA-256 của chuỗi `qpos`/`qvel` theo tick của đường legacy (mobile 300 tick, arm 300 tick, world 500 tick) và V03 khẳng định lại đúng ba digest đó.
- **Runtime ticks tiếp tới hết bước sau khi nhiệm vụ xong** và chỉ tăng revision khi bước trả về (`scenario-runner.ts`, vòng `step`). Mọi thứ đọc trạng thái giữa bước phải tính tới điều này.
- **So sánh trùng bit chỉ có nghĩa trong cùng kiến trúc.** Máy này là arm64, Cloud Run là x86-64. Ghi `platform.machine()` vào mọi output.

## 5. Quy tắc làm việc

- **Nhánh:** source và Lab đều làm trên `r4/virtual-commissioning`. Không commit R4 lên `main`. Không push, không deploy, không sửa `trial/`, `web/`, cổng 1880/1884. Không ghi `accepted:true`.
- **Pin của Lab chỉ đổi trên nhánh R4 của Lab.** `probe_drive.py` nằm trong portable tool root, nên commit V01 đã làm đổi closure và cần re-pin. `lab/main` phải giữ pin `3d8c2a8` cho tới khi người dùng ra lệnh deploy lại Cloud Run, nếu không Lab production sẽ lệch runtime cloud.
- **Khi source đang ở nhánh R4 thì `pnpm lab:mujoco` từ `lab/main` sẽ từ chối** (`PORTABLE_TOOLS_MISMATCH`), vì launcher so cây source với closure đã pin. Muốn demo bản `main`: `git checkout main` ở cả hai repo (cây phải sạch), demo xong chuyển lại.
- **Re-pin sau mỗi commit source đổi runtime, schema hoặc tool** (trong `lab/` trên nhánh R4): `node ../source/scripts/export-lab-runtime.mjs <thư mục tạm ngoài hai repo>`, `node scripts/import-runtime.mjs <thư mục đó>`, `node scripts/sync-engineering-contracts.mjs && pnpm check:source`, commit `chore: pin source runtime <sha>`.
- **Môi trường:** `export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"` trước mọi `pnpm`/`node`. Lệnh dài chạy dưới `perl -e 'alarm N; exec @ARGV' …`. Pytest: `PYTHONDONTWRITEBYTECODE=1 … -p no:cacheprovider`. Không để `__pycache__` dưới `robotics/simulation-mujoco` (launcher từ chối closure có bytecode; `.pytest_cache` thì vô hại).
- **Mỗi task:** viết test fail trước, xác nhận fail đúng lý do, cài tối thiểu, chạy focused test rồi suite liên quan, review diff, commit. Tiền tố `feat:`/`fix:`/`test:`/`docs:`/`chore:`/`build:`; kết thúc bằng dòng `Co-Authored-By` của phiên làm việc.
- **Không đổi** gain, ngưỡng, policy hay fixture của R2b. Mọi fixture drive là file mới. Mọi tham số mới ghi `assumed`. Không thêm dependency Python hay npm; không nâng `mujoco==3.17.0`.
- **Ngưỡng oracle khóa trước khi chạy** và không nới sau khi thấy test fail. Kết quả xấu là kết quả: ghi lại và dừng theo [README §4](README.md#4-khi-nào-dừng-một-nhánh).

## 6. Tiêu chí xong của cụm

- V01: tài liệu spike có số đo cho cả năm ca, ba digest legacy, ánh xạ gain sang thuộc tính actuator đọc lại từ `MjModel`, và giá trị khởi điểm của năm thí nghiệm drive kèm nhãn `assumed`. Lab đã re-pin trên nhánh R4.
- V02: `pnpm contracts:check`, `pnpm typecheck`, test hợp đồng và test fixture đạt; scene cũ không có ref giữ đúng byte.
- V03: toàn bộ pytest của worker và các test integration R2b của mobile, arm, cell đạt; đường legacy cho đúng ba digest của V01; model lý tưởng trùng bit; số đo chi phí tick theo cặp được ghi; Lab đã re-pin.
- Cả cụm: hai cây sạch, chưa push, một bản báo cáo ngắn nêu số đo, quyết định cơ chế đã khóa và mọi điểm chưa đạt.

## 7. Điều chưa giải quyết, cần biết khi làm tới

- Lab chủ động xóa hình 3D khi lý do dừng của run khớp `WORLD_UNKNOWN|WORLD_RESTART|ENGINE_|WORKER_|PLANT_|PHYSICAL_UNKNOWN` (`applyView()` trong `lab/src/ui/workspace.ts`), hiện nhãn sai `WORLD_SCENE_IDENTITY_MISMATCH` và đọc lại liên tục. Đó là hành vi có từ trước, chưa sửa. Khi đặt mã lỗi drive ở V03 (`DRIVE_*`, `COMMAND_TIMEOUT`, `FEEDBACK_LOSS`…), đừng dùng tên khớp biểu thức đó nếu muốn hình còn hiện sau khi run dừng. Quy tắc này có giữ hay không là quyết định của người dùng, làm ở V09.
- 5 test tích hợp của Lab về launcher fail khi có launcher khác đang giữ cổng 4175/4176. Không liên quan thay đổi của cụm này; ghi rõ nếu gặp.
