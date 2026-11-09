# Simulation extension — baseline và probe Webots R2025a (W00)

Ngày: 2026-11-10. Máy: macOS 26.5 arm64, Python 3.11.15, Node v24.22.2. Spike nằm ngoài repo (scratchpad), không commit. Kết luận: **TIẾP TỤC** (không trượt tiêu chí nào).

## 1. Baseline (trước khi sửa code)

Trên `source/main 103448f` (chỉ thêm spec/plan so với `e52b841`) và `lab/main a89276c`:

| Lệnh | Exit | Thời lượng |
|---|---:|---:|
| `pnpm install --frozen-lockfile` | 0 | 1 s |
| `pnpm contracts:check` | 0 | 0 s |
| `pnpm typecheck` | 0 | 8 s |
| `pnpm lint` | 0 | 6 s |
| `pnpm build` | 0 | 18 s |
| `LAB_IRSIM_EVIDENCE_DIR=…/candidate-03 pnpm test:acceptance -- linkforge-irsim` | 0 | 2 s |
| lab: `pnpm install --frozen-lockfile` | 0 | 0 s |
| lab: `pnpm check:source` (pin `c5a9d73`) | 0 | 0 s |
| lab: `pnpm typecheck` | 0 | 3 s |
| lab: `pnpm exec vitest run` | 0 | 13 s |

## 2. Cài đặt

- Nguồn: GitHub release `cyberbotics/webots` tag `R2025a`, `webots-R2025a.dmg` (107 119 977 byte).
- sha256 dmg: `484f6cc84ca794dd33e410b0bfc030132cc5b163a882c350c1d293d06d87584f`.
- `/Applications/Webots.app/Contents/MacOS/webots --version` → `Webots version: R2025a`.
- sha256 executable: `0ba7fdf2603a0b5cc2cac628e590c6f8afddbc85a8f1b1f5329056183c57a642`.
- Bản bundle không kèm proto robot (không có `Pioneer3dx.proto`…); spike dựng world bằng node nguyên thủy. Compiler W05 vì vậy không được phụ thuộc proto của Webots (đúng D04).

## 3. Bảy tiêu chí (spec §6.1)

Spike: world `.wbt` tay với sàn `Plane`, một tường, hai robot hai-bánh + hai caster cầu + LiDAR 360 tia (0.05–10 m), một supervisor; tất cả `<extern>`, `synchronization TRUE`, `basicTimeStep 20`, `optimalThreadCount 1`, `randomSeed 7`, `coordinateSystem "ENU"`. Ba tiến trình controller Python 3.11 (venv trần).

| # | Tiêu chí | Kết quả | Số đo |
|---|---|---|---|
| 1 | Cài R2025a; version; sha | **đạt** | `R2025a`; sha mục 2 |
| 2 | Extern controller từ venv 3.11 nối vào Webots do tiến trình cha khởi động | **đạt** | xem mục 4 |
| 3 | 1000 tick, `simTime == tick×20 ms`; engine đứng khi một controller chưa `step` | **đạt** | 1000/1000 tick, sai lệch tối đa 0.0 s. Controller `r2` ngủ 3 s trước tick 101: `step` của supervisor kéo dài 3006 ms và simTime chỉ tăng đúng 20 ms (2.00 → 2.02 → 2.04) |
| 4 | LiDAR hữu hạn khi minimize; có/không với `--no-rendering` | **đạt cả hai** | `--minimize`: 360 tia, 128–176 tia hữu hạn tùy tư thế (còn lại `inf`: không có vật trong 10 m). `--no-rendering`: 144 tia hữu hạn, min 0.967 m → **dùng được `--no-rendering`** |
| 5 | Hai lần chạy cùng seed/lệnh: lệch pose | **đạt** | 600 tick, lệnh đổi theo tick, hai robot: lệch tối đa 8.5e-15 m (vị trí + ma trận quay, mọi tick) ≪ 1e-6. **Không bit-identical** (khác ở ULP) |
| 6 | p50/p95 wall-clock mỗi tick với hai robot | **đạt** | đo ở `step` của supervisor trên 997 tick (loại tick 1 và tick stall): p50 0.33 ms, p95 0.48 ms, p99 0.70 ms, max 1.09 ms → ≥ 40× realtime. RSS Webots ≈ 286 MB (tiến trình cha đo bằng `time -l`: 267 MB) |
| 7 | Kill Webots giữa chừng | **đạt** | `SIGKILL` Webots: cả ba controller thoát sau 0.01–0.04 s; `pgrep -f "Webots|ctrl.py"` rỗng ngay sau đó |

Ổn định vật lý với `basicTimeStep 20`: nghiêng thân robot tối đa 0.37°, `z` 0.0884–0.0896 m trong 1000 tick có cua; robot đi thẳng `5 rad/s` × 0.09 m trong 1 s đi được 0.433 m (lý thuyết 0.45 m, trượt/khởi động).

## 4. Cách nối extern controller (đã chạy)

```sh
# Webots (tiến trình cha khởi động, port tự chọn)
/Applications/Webots.app/Contents/MacOS/webots --batch --minimize --mode=fast --stdout --stderr --port=<PORT> world.wbt
# mỗi controller (Python 3.11, không cần pip)
WEBOTS_HOME=/Applications/Webots.app \
PYTHONPATH=/Applications/Webots.app/Contents/lib/controller/python \
WEBOTS_CONTROLLER_URL=ipc://<PORT>/<tên Robot> \
python controller.py
```

`ipc://<PORT>/<name>` (cũng có `tcp://host:port/<name>`, dùng chuỗi `ipc://` trên host này). `from controller import Robot, Supervisor` hoạt động qua `ctypes` vào `libController.dylib`.

## 5. Quyết định rút ra

- **`basicTimeStep` = 20 ms** (1 tick nguyên = 1 bước vật lý; ước của 20 ms; nghiêng ≤ 0.37°). `oracle-profile-v1.json` và scene `webots_3d.basicTimeStepMs` dùng 20; schema W01 chấp nhận ước của 20 (1, 2, 4, 5, 10, 20).
- **Cờ cuối:** `--batch --minimize --mode=fast --stdout --stderr --port=<PORT>`; thêm `--no-rendering` được (LiDAR vẫn hữu hạn) nhưng worker dùng mặc định có rendering tối thiểu hóa cho tới khi W06 chứng minh khác (không có lợi ích đo được ở đây).
- **`speedMultipliers` = `[1,4,16,64]` giữ nguyên:** p95 tick 0.48 ms ≪ 20 ms; trần thực tế do runner/IPC của source quyết định, không phải Webots.
- **Điểm phải xử lý trong worker (W06):**
  1. Nạp world lần đầu mất hơn 6 s; chờ đủ N dòng `INFO: '<name>' extern controller: Waiting for local or remote connection on port <PORT>` trên stdout của Webots, **không** dùng `sleep`. Controller nối sớm hơn nhận `is not in the list of robots with <extern> controllers, retrying for another 50 seconds`.
  2. `SIGTERM` Webots không dừng nó trong 2 s (quan sát ở lần chạy đầu) → worker kill cả process group và dùng `SIGKILL` sau hạn.
  3. Controller tự thoát (qua `exit` trong libController) khi Webots chết, **không** chạy `atexit` của Python: worker nhận biết mất engine qua exit của tiến trình con / lỗi socket, không qua hook Python.
  4. Thư mục `/tmp/webots/<user>/<port>/` (`live.txt`) còn lại sau khi kill → phát hiện port bận bằng thử bind/listen, **không** bằng sự tồn tại của thư mục.
  5. Khi đặt `mass` trong `Physics` phải đặt `density -1`, nếu không Webots cảnh báo "Both 'density' and 'mass' specified".
  6. Hướng trục: bánh dựng bằng `HingeJoint axis 0 1 0` + `Pose{rotation 1 0 0 1.5708} → Cylinder` làm bounding object lăn đúng hướng (xem số đo trên); compiler W05 giữ cấu trúc này.
- **Chưa kiểm:** `WEBOTS_NO_GUI_SESSION` (cần phiên không có WindowServer, ví dụ SSH thuần); chỉ chạy được trong phiên GUI đang đăng nhập. W06 phải phát hiện bằng probe thật (`create` thử), không đoán.
- **Kết luận: TIẾP TỤC** (W01 trở đi, không dùng đường D07).
