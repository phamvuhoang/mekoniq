# Runbook — UTM + hai Linux VM trên Mac

Runbook ngày 06/11/2026, phục vụ [N01–N06](02-native-simulation.md). **Chưa provision/chưa boot VM** ở thời điểm viết: Mac M2 Pro/16 GiB chỉ có khoảng 4,4 GiB disk khả dụng, UTM chưa cài. [Preflight thực](../../implementation/evidence/bv01-native-simulation/utm-host-preflight-2026-11-06.json). Không copy các lệnh dưới thành bằng chứng đã chạy.

## 1. Host và storage

Từ Mac, kiểm lại trước download:

```sh
sysctl hw.memsize hw.ncpu
sw_vers
df -h .
ls /Volumes
```

Resource budget của dự án: volume lưu VM có ≥120 GiB khả dụng; ổ hệ thống macOS giữ ≥20 GiB trống, kể cả khi VM trên SSD ngoài. Đặt ISO, VM và build caches vào volume đã chọn, ngoài Git. Không dựa vào sparse disk 64 GiB để kết luận chỉ cần vài GiB free. Không xóa caches/files người dùng khi chưa được chỉ định.

| VM | CPU | RAM | Virtual disk | Chế độ |
|---|---:|---:|---:|---|
| `mekoniq-amr` | 4 | 8 GiB | 64 GiB | Ubuntu24.04 ARM64, headless simulator |
| `mekoniq-arm` | 2 | 4 GiB | 32 GiB | Debian12 ARM64, desktop QtVCP |

Trên host16 GiB chạy luân phiên để provision/qualify riêng. Combined là bài resource qualification sau cùng, không auto-start cả hai khi login. Thử budget6+3 GiB chỉ sau dừng workload development nặng do task sở hữu; đo memory pressure/swap/telemetry. Nếu không đạt, cần host đủ tài nguyên; replay hai lượt riêng không phải combined.

## 2. Cài UTM và chọn image

Sau storage gate, tải bản stable từ [UTM official installation](https://docs.getutm.app/installation/macos/) và cài app. Không chọn beta chỉ để có API mới. Bản GitHub miễn phí; không cần mua App Store. Kiểm app và ghi version:

```sh
codesign --verify --deep --strict /Applications/UTM.app
spctl --assess --type execute /Applications/UTM.app
/Applications/UTM.app/Contents/MacOS/utmctl version
/Applications/UTM.app/Contents/MacOS/utmctl help
```

Nếu macOS cần quyền Automation cho Terminal/UTM, đó là bước tương tác hệ điều hành; không sửa TCC database hay bỏ Gatekeeper. Sử dụng CLI đúng bản cài. `utmctl` quản lý VM; tạo VM bằng UI/AppleScript theo [UTM scripting](https://docs.getutm.app/scripting/scripting/), không giả định có subcommand create.

Image sources:

- Ubuntu: [official 24.04 ARM64 images](https://cdimage.ubuntu.com/releases/24.04/release/), chọn **live-server-arm64 ISO**, không Raspberry Pi preinstalled image. Resolve point release hiện có, ghi filename/URL/checksum vào N01 inventory.
- Debian: [official archived releases](https://cdimage.debian.org/cdimage/archive/), chọn Debian **12.x Bookworm arm64 netinst**, không image mặc định Debian13 hoặc Pi. Dùng lightweight desktop XFCE cho QtVCP.

Kiểm signature của checksum list theo hướng dẫn distributor và so sha256 ISO; pin exact image sau kiểm. Không điền checksum đoán hoặc null vào lock verified. File ISO lớn chưa được tải trong đợt preflight này.

UTM: Create → Virtualize Linux; chọn QEMU backend với aarch64/hypervisor enabled, UEFI, virtio disk/network, không emulation x86. Chọn Shared/NAT network để guest ra internet và host SSH tới guest; kiểm inter-VM reachability trước N04. Không bridged vào mạng robot. Không USB passthrough. Dùng virtio display cho Debian; Ubuntu có serial/console để install rồi chạy server. Lưu VM bundle đúng volume đã chọn.

Nếu UI khác do phiên bản UTM, kiểm architecture/hypervisor/network từ config thực; không chỉ dựa tên “Linux”. Sau install eject ISO, reboot, tạo powered-off backup baseline. Không snapshot active LinuxCNC motion/journal để dùng như checkpoint application.

## 3. Guest baseline và chuyển source

Trong mỗi guest mới:

```sh
sudo apt-get update
sudo apt-get install openssh-server ca-certificates git build-essential python3-venv python3-pip
sudo systemctl enable --now ssh
uname -m
dpkg --print-architecture
cat /etc/os-release
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Debian GUI có thể cài XFCE qua installer. QEMU guest agent và SPICE guest tools theo [UTM Linux support](https://docs.getutm.app/guest-support/linux/); không share toàn bộ home Mac. Chỉ copy clean source snapshot/committed checkout; không copy macOS node_modules hoặc Python venv sang Linux.

SSH key tạo riêng cho lab, private key chỉ ở máy khởi tạo. So fingerprint bằng console UTM trước lưu known_hosts; không dùng StrictHostKeyChecking=no. Gán alias `mekoniq-amr` và `mekoniq-arm` trong SSH config của operator sau khi biết IP guest. Không mặc định IP từ ví dụ tài liệu.

Cài Node24.22.2 Linux ARM64 từ Node distribution, xác minh checksum; pnpm10.32.1. Ghi versions. Trong clean source checkout:

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
python3 -m venv --system-site-packages .venv
.venv/bin/pip install -r robotics/simulation/requirements-dev.txt
```

Venv system-site-packages để truy cập ROS/LinuxCNC modules do apt cung cấp. Python Ubuntu và Debian có thể khác; không ép Python3.12 venv đọc LinuxCNC binding build cho3.11. Ghi resolved Python/dependency versions theo từng guest; compatibility phải được chạy, không suy từ tests macOS.

## 4. Ubuntu — ROS/Gazebo/Nav2

Thiết lập ROS2 apt repository theo [official Jazzy Ubuntu installation](https://docs.ros.org/en/jazzy/Installation/Ubuntu-Install-Debs.html), đúng Noble/arm64 và signed keyring. Giữ [Jazzy/Harmonic supported pairing](https://gazebosim.org/docs/harmonic/ros_installation/). Ưu tiên ros-jazzy-ros-gz vendor packages như Dockerfile repository; không trộn thêm Gazebo classic hoặc rolling.

Sau repository setup, xem candidate trước khi install:

```sh
apt-cache policy ros-jazzy-ros-base ros-jazzy-navigation2 ros-jazzy-ros-gz-sim
sudo apt-get install ros-jazzy-ros-base ros-dev-tools ros-jazzy-navigation2 ros-jazzy-nav2-bringup ros-jazzy-ros-gz ros-jazzy-ros-gz-sim ros-jazzy-ros-gz-bridge ros-jazzy-xacro ros-jazzy-robot-state-publisher ros-jazzy-launch-testing-ament-cmake ros-jazzy-ament-lint-auto
```

Package candidate thiếu arm64 → blocked dependency, không thay library major ngẫu nhiên. Trong source checkout, shell bash:

```sh
source /opt/ros/jazzy/setup.bash
colcon build --base-paths robotics/description robotics/navigation robotics/simulation --packages-select mekoniq_description mekoniq_navigation mekoniq_simulation
source install/setup.bash
export PATH="$PWD/.venv/bin:$PATH"
export PYTHONPATH="$PWD/robotics/simulation:$PWD/robotics/agent${PYTHONPATH:+:$PYTHONPATH}"
export MEKONIQ_CONTRACTS_DIR="$PWD/packages/contracts/schemas"
node scripts/lab-sil.mjs doctor --backend gazebo_nav2 --environment-profile utm-ubuntu-arm64 --json
```

N02 đã thêm lựa chọn environment-profile và inventory thực. Lock ARM64 vẫn là candidate: `packageVersions` và `runtimePin` chưa được resolve, nên doctor sẽ chặn cho tới khi ghi và review inventory từ Ubuntu guest. Chạy `python3 -m bridge.native_profile --profile utm-ubuntu-arm64` trong môi trường đã source ROS/overlay để lấy `actual.packages` và `actual.runtime`; pin hai trường này vào lock sau khi kiểm dependency/paths/hashes, rồi chạy doctor lại. Không đổi `qualification` thành pass chỉ vì inventory khớp; phải chạy FD01 rồi FD02/03/04/07 theo command trong plan. `headless` không có window vẫn cần renderer nếu fixture dùng GPU sensors; kiểm real sensor output/EGL/software renderer và lưu logs. Nếu thiếu rendering, giữ failed/not_run đúng giai đoạn; không xóa lidar/contact từ fixture.

## 5. Debian — LinuxCNC SIM/QtVCP

Theo [official LinuxCNC install](https://linuxcnc.org/docs/html/getting-started/getting-linuxcnc.html), resolve bookworm arm64 package. Không cần realtime kernel cho SIM; không install EtherCAT/drives hoặc tự chuyển machine-control profile.

```sh
apt-cache policy linuxcnc-uspace python3-pyqt5 python3-pyqt5.qsci
sudo apt-get -s install linuxcnc-uspace python3-pyqt5 python3-pyqt5.qsci python3-opengl
sudo apt-get install linuxcnc-uspace python3-pyqt5 python3-pyqt5.qsci python3-opengl
python3 -c 'import linuxcnc; from PyQt5 import QtWidgets, Qsci; print("controller and Qt modules importable")'
linuxcnc --version
```

Nếu distro candidate không đủ QtVCP/PUMA features, resolve official LinuxCNC repo matching Bookworm ARM64 và pin version trước tiếp tục; không cài deb Pi/amd64 vì cùng tên. Apt simulation output phải được review, không purge/reinstall system packages mù. Dependencies lock chỉ chuyển verified sau N03.

Từ source root, activate `.venv`, chuyển vào arm-controller để không import nhầm ROS bridge:

```sh
cd integrations/arm-controller
../../.venv/bin/python -m pytest tests/test_arbiter.py tests/test_bridge_recovery.py -q
bash scripts/smoke-sim.sh --profile configs/sim/puma560/mekoniq.ini --dependencies-lock packaging/dependencies.arm64-vm.lock.json --evidence-dir /var/tmp/mekoniq-evidence/controller-terminal
bash scripts/smoke-sim.sh --profile configs/sim/puma560/mekoniq.ini --dependencies-lock packaging/dependencies.arm64-vm.lock.json --evidence-dir /var/tmp/mekoniq-evidence/controller-gui --gui
```

Lệnh cuối stage đúng file HMI và mở GUI trên desktop guest. Dùng thư mục evidence mới cho mỗi lượt; wrapper từ chối record cũ để tránh dùng lại PASS. Đóng GUI không tự đạt acceptance: wrapper ghi `manual_verification_required/not_run` nếu chưa có checklist độc lập. Thực hiện [HMI acceptance hiện có](../../../../source/integrations/arm-controller/docs/hmi-acceptance.md) qua đúng path workspace; nếu checkout tách, đọc file `integrations/arm-controller/docs/hmi-acceptance.md` trong source. Capture actual actions/joints/epochs, không kết luận pass chỉ từ GUI screenshot.

## 6. Chạy luân phiên và integrated topology

Từ Mac, sau khi VM tồn tại:

```sh
/Applications/UTM.app/Contents/MacOS/utmctl list
/Applications/UTM.app/Contents/MacOS/utmctl start mekoniq-arm
```

Shutdown từ guest `sudo shutdown -h now` khi không có run active; kiểm UTM state stopped trước mở VM khác. Không force-stop để tiết kiệm RAM giữa transfer; nếu cần kiểm fault đó phải journal đúng fault/test run.

Sau N04, coordinator ở Ubuntu mở tunnel tới Debian. Profile arm socket actual `/run/mekoniq-arm/bridge.sock`; local operator socket **không forward**. SSH alias cho connection này dùng principal chỉ thuộc `mekoniq-lab`, không dùng tài khoản admin provision VM. Command mẫu chạy trong Ubuntu, local directory do coordinator tạo mode0700 và chưa có socket:

```sh
ssh -N -a -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=yes -o ServerAliveInterval=5 -o ServerAliveCountMax=3 -L /run/user/1000/mekoniq-bv01/arm.sock:/run/mekoniq-arm/bridge.sock mekoniq-arm-lab
```

UID1000 chỉ là ví dụ, supervisor N04 resolve runtime directory thực. Cấu hình group/ACL dựa [bridge deployment](../../../../source/integrations/arm-controller/docs/bridge-deployment.md); không chmod777 socket. Không cho browser nhập arbitrary SSH host/path. `ExitOnForwardFailure` chỉ chứng minh local forward bind; vẫn cần adapter handshake và live controller status.

Mac browser truy cập UI phục vụ **trong Ubuntu** qua SSH loopback, giữ cùng origin4175; forward4176 chỉ khi transport browser hiện có yêu cầu runtime trực tiếp, mặc định tận dụng proxy cùng origin:

```sh
ssh -N -a -o ExitOnForwardFailure=yes -L 127.0.0.1:4175:127.0.0.1:4175 mekoniq-amr
```

Nếu4175 đang dùng, báo conflict và dừng launcher task-owned đúng cách, không kill tiến trình lạ. Gateway hỗ trợ opt-in `--native-config`; launcher `lab:mock` vẫn khởi động mock. Không mở port1880/1884, không forward operator socket. Dùng console VM cho QtVCP; không cần public VNC.

## 6a. Khởi động BV01 native qua gateway

Chỉ thực hiện sau N02/N03 standalone và N04 transport qualification. Các đường dẫn `/srv/mekoniq` dưới đây là ví dụ trong Ubuntu; thay bằng checkout/artifact đã pin thực tế. Không chạy trên Mac rồi đánh dấu native pass. Python tools và source checkout phải cùng revision với runtime export; gói offline mock không chứa ROS/LinuxCNC.

Compile fixture và scenario cùng file để giữ đúng world input hash, trong môi trường đã source ROS và workspace overlay:

```sh
cd /srv/mekoniq/source/robotics/simulation
PYTHONPATH=/srv/mekoniq/source/robotics/simulation:/srv/mekoniq/source/robotics/agent python3 -m compiler \
  --fixture /srv/mekoniq/source/tests/fixtures/digital-twin/sil/bv01.json \
  --scenario /srv/mekoniq/source/tests/fixtures/digital-twin/sil/bv01.json \
  --out /var/tmp/mekoniq-native-bv01-bundle
```

Tạo config server-owned `/srv/mekoniq/native-config.json` với đường dẫn và SSH alias đã xác minh. `parentDir` phải tồn tại, thuộc coordinator và đủ ngắn cho Unix socket; thư mục con/socket mỗi run do supervisor quản lý. Không lưu credential trong JSON hoặc project browser.

```json
{
  "sourceRoot": "/srv/mekoniq/source",
  "bundleDirectory": "/var/tmp/mekoniq-native-bv01-bundle",
  "environmentProfile": "utm-ubuntu-arm64",
  "python": "python3",
  "arm": {
    "tunnel": {
      "parentDir": "/run/user/1000",
      "alias": "mekoniq-arm-lab",
      "knownHosts": "/home/mekoniq/.ssh/known_hosts"
    }
  }
}
```

UID/path/alias phải thay theo tài khoản thực, không mặc định UID1000. Alias `mekoniq-arm-lab` dùng principal Lab riêng như N04, khác operator/admin. Gateway chỉ nhận config lúc khởi động; browser không chọn host/socket.

Trong hai terminal Ubuntu, chạy runtime export đã kiểm hash và Lab cùng pin:

```sh
node /srv/mekoniq/runtime/runtime.mjs --native-config /srv/mekoniq/native-config.json --data-dir /var/tmp/mekoniq-native-runs --port 4176
```

```sh
cd /srv/mekoniq/lab
pnpm check:source
pnpm dev
```

Mở qua SSH loopback4175 trên Mac, chọn preset native BV01 và ghép nối bằng token một lần từ terminal gateway. Start được quyết định bởi readiness và provider admission. Native telemetry tự tiến theo Gazebo clock; các nút step/auto-run của mock không điều khiển native. Pause/resume chỉ được dùng khi runtime khai báo hỗ trợ; không coi UI pause là controller đã dừng. Reopen giữ runId và chỉ đọc/đối soát, không gửi lại motion.

Campaign dùng cùng factory, compiler tạo bundle riêng cho từng lượt:

```sh
cd /srv/mekoniq/source
node scripts/lab-sil.mjs doctor --backend linuxcnc_sim --environment-profile utm-ubuntu-arm64 --native-config /srv/mekoniq/native-config.json --json
node scripts/lab-sil.mjs run --scenario BV01 --seed 23 --repeat 3 --backend-set coffee-simulation --environment-profile utm-ubuntu-arm64 --native-config /srv/mekoniq/native-config.json --out /var/tmp/mekoniq-evidence/N06-BV01
node scripts/lab-sil.mjs verify --input /var/tmp/mekoniq-evidence/N06-BV01
```

Fault schedule dùng chung shape `id/faultId/targetId/trigger/durationMs`, trong project đã khóa hoặc config server `faultSchedule`. Ví dụ cấu hình một lượt restart tại phase handoff:

```json
{
  "restartOperator": {"mode": "operator", "timeoutMs": 30000},
  "faultExpectation": {"faultId": "restart-at-handoff", "outcome": "needs_attention", "attentionReasons": ["CONTROLLER_RESTART_OPERATOR_REQUESTED"]},
  "faultSchedule": [
    {"id": "restart-at-handoff", "faultId": "controller-restart", "targetId": "arm-1", "trigger": {"kind": "phase", "value": "handoff"}, "durationMs": 1000}
  ]
}
```

Ghép hai trường này vào config server đầy đủ; giữ mỗi fault qualification ở output/run riêng. Khi `native-faults.json` ghi `awaiting_operator`, operator thực hiện restart controller SIM qua console/quy trình quản lý của Debian. Kênh Lab không được cấp sudo/operator group và không chạy command SSH tùy ý. Chỉ `observed_transition` với cả bootId và controllerEpoch đổi mới chứng minh restart đã xảy ra; deadline hết ghi `unperformed`. Intent hoặc operator bấm nút không đủ để pass. Để kiểm mất tunnel đúng lúc handoff, dùng `faultId: "tunnel-loss"` với cùng phase/target; không cần `restartOperator` cho fault này. Negative fault run có thể attention/served=0; `faultExpectation.faultId` tham chiếu ID entry (`restart-at-handoff`), không phải tên fault (`controller-restart`). Khai báo đúng attention reason mong đợi trước run; không thêm mọi lỗi gặp phải vào allowlist để đạt pass. Case assessment giữ nguyên business verdict, kiểm fault đã quan sát, custody/no-replay và coverage áp dụng. Coverage trước injection không chứng minh physics sau khi mất kết nối; các gate native/release rộng hơn vẫn cần evidence tương ứng.

Native browser check dùng `playwright.native.config.ts` với `LAB_NATIVE_BASE_URL` và `LAB_NATIVE_PAIRING_TOKEN` từ môi trường thật; đặt `CHROME_PATH` theo máy chạy browser. Hành trình import/replay riêng nhận bundle thật qua `LAB_NATIVE_IMPORT_BUNDLE`; phải copy đủ report và raw artifacts đúng hashes từ run, không thay bằng fixture mock. Không dùng `test:mock-e2e` cho bài này. Khi thiếu môi trường/token, test ghi not_run/skip và không mở native gate. Không đưa token vào evidence hoặc shell log công khai.

## 7. Kết thúc và evidence

Mỗi test lưu source/lab/runtime/profile/model revisions, exact command, UTC, architecture, package inventory, exit code/assertions, logs checksum. Native engine chạy trong ARM64 VM → software native evidence trên ARM64; grip vẫn modeled. `doctor`pass không phải scenario pass; CONTROLLER-POC chưa phải R-SIM. Combined phải có cùng runId và hai engine sống cùng thời điểm.

Stop coordinator/tunnel do task tạo, chờ journal flush rồi shutdown guest. Copy metadata/log bundle về Lab evidence store; kiểm hash. Không commit VM disks, downloaded ISO, SSH keys hoặc pairing tokens. Disk thiếu hiện tại giữ `blocked_external/not_run`, chỉ tiếp tục provisioning khi storage gate được giải quyết.

## Implemented qualification helpers

From workspace root under Node24, run `node source/scripts/native-sim/host-preflight.mjs --vm-root /absolute/existing/volume`. Exit2 records blockers; it never installs UTM or downloads an image. If VM and macOS share a filesystem, the preflight requires140GiB free (120GiB VM budget plus20GiB system reserve); separate storage still requires both independent budgets. On16GiB default to sequential VMs.

The Debian smoke supports `--dependencies-lock packaging/dependencies.arm64-vm.lock.json`. This candidate is separate from amd64 and remains unverified. It records `runtime-inventory.json` with actual installed packages and resolved binaries/modules, and refuses an architecture mismatch. Current host executions are in `N03-terminal/`; they exit2/not_run because LinuxCNC/Linux are absent. No GUI acceptance was performed.

## Native provenance và đồng hồ khi deploy

Clean export nhúng manifest `nativeTools` gồm worker, agent, schemas và local resources được dùng. `sourceRoot` trong config phải khớp đúng nội dung manifest; không chỉ cùng Git branch hoặc đường dẫn. Factory kiểm lại bytes trước khi mở providers và chép vào snapshot riêng `inputs/source` của từng run. Thay worker/agent sau export hoặc sau khi server khởi động sẽ bị từ chối; cần kiểm thử, commit và export/re-pin lại. Không có config key để bỏ qua kiểm tra này. CLI native chạy trực tiếp từ source yêu cầu checkout sạch và `sourceCommit` đúng HEAD; native runtime đã bundle từ chối export có cờ dirty. Lưu evidence/data/output ngoài checkout để lần chạy tiếp theo không tự làm bẩn source.

Khi capture inventory trên Ubuntu, `runtimePin.pythonPath` dùng các đường dẫn chuẩn hóa `$NATIVE_SOURCE/robotics/simulation` và `$NATIVE_SOURCE/robotics/agent`; giữ nguyên các đường dẫn ngoài closure. Actual execution paths vẫn được lưu riêng trong inventory. Bridge Debian phải được cập nhật cùng schema/runtime để phát controller version, profile hash và bridge code hash. Report giữ `native-tool-identity.json` và `native-inventory.json`; thiếu hoặc lệch controller inventory chặn verification. Inventory khớp chỉ chứng minh provenance, không thay thế chạy scenario.

Thời gian business/coffee vẫn theo Gazebo. Với arm command, adapter đo controller wall clock qua lease renewal và ghi mapping trước khi gửi stage/start: uncertainty tối đa 250 ms (full RTT + 1 ms), chênh wall clock tối đa 5 s cộng uncertainty. Đồng bộ đồng hồ hai VM/host trước khi chạy; vượt policy sẽ từ chối command. Wire expiry đầu tiên được giữ trong SQLite qua retry/recovery, không gia hạn command cũ. Raw simulation time, run origin và business epoch được giữ để replay/CSV dùng đúng timeline; không lấy timestamp wall clock làm bằng chứng hai simulator đã đồng bộ.
