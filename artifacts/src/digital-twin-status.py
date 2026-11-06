#!/usr/bin/env python3
"""Build the dated, portable Vietnamese status report. Run from any directory.
Content lives here; CSS/JS sit beside this file. This never deploys anything.
"""
from collections import Counter
from html import escape as esc
import hashlib
import json
from pathlib import Path

SRC = Path(__file__).resolve().parent
OUT = SRC.parent
SOURCE = OUT.parent
LAB = SOURCE.parent / 'lab'
EVIDENCE = LAB / 'docs/implementation/evidence/digital-twin-v2/plan02-03-remediation/manifest.json'
record = json.loads(EVIDENCE.read_text())
pin = record['labVerification']['runtimeLock']
assert pin['sourceCommit'] == 'a89a077ed12648931a857333f899e3d6c1ea9719', 'This dated report requires its original evidence snapshot'
LAB_REV = '3a92e6579793aa47c30c0a3abd44942d95c679c3'

refs = {
 'plans': ('Bộ kế hoạch Digital Twin 01–03', '../../lab/docs/plans/2026-11-05-digital-twin/README.md', 'Phạm vi và thứ tự release gate; không dùng checkbox kế hoạch làm bằng chứng hoàn thành.'),
 'mock': ('Plan 01 · bằng chứng mock', '../../lab/docs/implementation/evidence/digital-twin-v2/mock-report.md', 'Mốc c1d1ea7: 41 acceptance tests, 96/106 dòng pass; R-MOCK chưa accepted.'),
 'sim': ('Plan 02 · simulation evidence', '../../lab/docs/implementation/evidence/digital-twin-v2/plan02-simulation.md', 'Compiler, worker, coffee simulation, coverage; các run trên host này là not_run.'),
 'arm': ('Plan 03 · controller & hardware', '../../lab/docs/implementation/evidence/digital-twin-v2/plan03-arm-hardware.md', 'A01–A06 và giới hạn controller, GUI, release, BV01.'),
 'fix': ('Review remediation R01–R12', '../../lab/docs/reviews/2026-11-06-plan-02-03-remediation.md', 'Các lỗi đã đóng, quyết định triển khai và phạm vi chưa nghiệm thu.'),
 'checks': ('Validation manifest & raw logs', '../../lab/docs/implementation/evidence/digital-twin-v2/plan02-03-remediation/manifest.json', '21 lệnh có exit code/checksum; source a89a077, artifact fe49fcea…'),
 'compat': ('Compatibility snapshot', '../../lab/config/simulation-compatibility.json', 'Revision, model/schema hashes, backend và gate còn mở.'),
 'lab': ('Lab · launcher, import, offline', '../../lab/README.md', 'Lệnh cài/chạy/rollback; các đoạn trạng thái cũ cần đối chiếu manifest mới.'),
 'bridge': ('Arm bridge · triển khai IPC', '../integrations/arm-controller/docs/bridge-deployment.md', 'Identity, hai socket, group tách biệt và recovery.'),
 'restore': ('Arm · install / trust / rollback', '../integrations/arm-controller/docs/restore-runbook.md', 'Provisioning policy, signed artifact, kiểm integrity, restore.'),
 'hw': ('Hardware work packages H00–H05', '../../lab/docs/plans/2026-11-05-digital-twin/03-arm-hardware.md', 'Vendor integration, IPC/drive, shadow, HIL, FAT và SAT.'),
 'cli': ('SIL CLI hiện có', '../scripts/lab-sil.mjs', 'doctor / run / verify; thiếu prerequisite phải giữ not_run.'),
 'image': ('ROS/Gazebo build environment', '../robotics/simulation/Dockerfile', 'Dockerfile hiện có build ROS workspace; không phải gói Node orchestrator hoàn chỉnh.'),
}
# Counts refer to these reporting groups, not plan task completion percentages.
features = [
 ('D01','done','Nền tảng','F01','Contracts & authority','Protocol v1/v2, schema/hash pin, capability registry và admission. Source giữ quyền quyết định nghiệp vụ.','Đã có code và kiểm thử; renderer không tự xác nhận arrival, cargo hoặc handoff.','mock','Phần mềm'),
 ('D02','done','Thiết kế','F02 / Lab','Thiết kế robot & mặt bằng','Cấu hình robot, 2D/3D, BOM minh họa, world revision, migration và project persistence.','Thông số catalog/BOM là giả định; dữ liệu cơ khí chưa đo vẫn unknown.','mock','Mock / UI'),
 ('D03','done','Giao món','F03','AMR mock & delivery','Giao món, admission, queue, tải/giao qua confirmation và parking theo scenario.','Đã kiểm domain/journal; không suy ra năng lực tránh vật cản của robot thật.','mock','Mock'),
 ('D04','done','Pha chế','F04','Coffee domain & cup custody','Recipe, ingredient reservation/consumption, process state, cup readiness và transfer ownership.','Mock workflow và negative/recovery cases đã kiểm; chưa phải driver máy pha.','mock','Mock / domain'),
 ('D05','done','Chiến dịch','F03–F04','Food + coffee / hai AMR','FD02-cups và campaign chạy food/coffee, allocation và contention.','Mock business flow có evidence; campaign SIL tích hợp vẫn ở nhóm in progress.','mock','Mock'),
 ('D06','done','Trải nghiệm','F05','Twin workspace & điều hành','2D/3D, live state, entity inspector, nguyên nhân lỗi và thao tác đối soát có xác nhận.','Giao diện VI/JA/EN; browser journey đã chạy trên runtime pin mới.','checks','UI / browser'),
 ('D07','done','Báo cáo','F06','Telemetry, replay & KPI','Timeline theo cursor, locked inputs, residual/compare và tách queue/travel/human-wait/cell-busy.','Evidence immutable; thay model/world/recipe/profile đánh dấu phạm vi cũ cần chạy lại.','mock','Mock evidence'),
 ('D08','done','Phục hồi','F03 / F06','Restart, reclaim & fault flows','Journal/effects, duplicate handling, reclaim chỉ xem/đối soát và reset từ input đã khóa.','Không tự resend motion chưa rõ kết quả; source quyết định custody.','fix','Phần mềm'),
 ('D09','done','Đóng gói','F07','Launcher & runtime artifact','Một lệnh lab:mock, pairing một lần, import theo hash/schema, rollback pin và offline builder.','Import artifact sạch và ba browser journeys đã kiểm trên pin mới; gói phân phối mới chưa build.','checks','Local mock'),
 ('D10','done','Mô phỏng','P02 · T1','World compiler & navigation bindings','Biên dịch geometry, map, fixture, semantic binding/yaw và manifest có hash.','Regression dùng compiler Python thật và so goal của SourceSession với binding đã compile.','fix','Compiler'),
 ('D11','done','Mô phỏng','P02 · T2–4','SIL worker & orchestration code','Nav2 protocol, scene loop, clock/barrier, actors/blockers, fault schedule, telemetry và freshness.','Test qua production boundary/doubles đã pass; chưa có native ROS/Gazebo run ở revision này.','fix','Software only'),
 ('D12','done','Mô phỏng','P02 · T5–6','Coffee I/O & transfer model','coffee_io_sim, plant observations và luật chuyển cốc hai phía.','Process model minh họa; chưa có thermal/fluid physics hoặc pickup controller-backed hoàn chỉnh.','sim','Modelled'),
 ('D13','done','Hình học','P02 · T6','ARM03 geometric checker','Capsule swept-path, self/scene/attached-cup scope, allowed contact và Python/TS parity.','Trace mất mẫu/identity/time gap không được pass; kết quả chỉ có giá trị trong geometry đã khai báo.','fix','Geometry only'),
 ('D14','done','Arm','A01','Reference model & unit oracle','PUMA 560 pin từ sample LinuxCNC; DH/frames, inch/deg ↔ SI và oracle FK.','Mock illustrative model và controller reference model được phân biệt bằng revision.','arm','Model / software'),
 ('D15','done','Arm','A03–A05','Bridge, arbiter & client/HMI code','Một owner, lease/token/channel, durable outcomes, restart reconcile, jog stop, adapter/session và QtVCP handler.','Real Unix socket + native API stub đã kiểm; Qt GUI và native controller cần Linux acceptance riêng.','fix','Software only'),
 ('D16','done','Release','A06','Export / trust / install tooling','Signed manifest, policy revision chống replay, allowlist copy, bytecode verification và rollback theo calibration.','Installer và signature tests dùng khóa tạm/prefix tạm; chưa ký release bằng signing station thật.','fix','Software only'),
 ('I01','progress','Nghiệm thu','R-MOCK','Nghiệm thu trải nghiệm mock','Phần mềm và evidence đã có; owner acceptance chưa đóng.','Cần UX ≥5 người mới, fresh machine, host network-off, cold boot, Linux và tablet thật theo gate.','mock','Chờ người / môi trường'),
 ('I02','progress','Phân phối','F07 / pin mới','Gói offline trên runtime vừa sửa','Builder đã có; tarball được ghi nhận trong repo vẫn là Plan 01 / c1d1ea7.','Build lại theo OS/architecture từ pin a89a077, kiểm integrity, boot và FD01/BV01 trên gói mới.','lab','Chưa đóng gói pin mới'),
 ('I03','progress','Native SIL','G-SIM-NAV','Gazebo/Nav2 trên Linux','Worker/compiler/orchestrator đã có regression; chưa có native evidence mới.','Provision ROS 2 Jazzy + Gazebo Harmonic; chạy FD01/FD02/FD03/FD04/FD07 và xác minh raw telemetry.','sim','blocked_external'),
 ('I04','progress','Controller','CONTROLLER-POC','LinuxCNC SIM & QtVCP GUI','Profile/model/bridge/HMI có code; dependency lock còn candidate, chưa verify trên host sạch.','Chạy terminal smoke, GUI, IK/units và restart; chốt package/image hashes từ môi trường thực.','arm','blocked_external'),
 ('I05','progress','Co-simulation','R-SIM / BV01','Coffee-to-table controller-backed','AMR, coffee process và arm port đã có từng phần; runner BV01 linuxcnc_sim chưa hoàn chỉnh.','Nối orchestrator/fixture; cần observation kẹp/cốc có nghĩa. Grip null không được tự xác nhận pickup.','arm','Thiếu integration code'),
 ('I06','progress','Cup transfer','A05 / P02','Admission & world cup lifecycle','Có handoff oracle và attachment/session hooks.','Nối oracle vào runtime; hook custody với plant.takeCup; restore cup ở khay sau release, bỏ ghost obstacle.','arm','Còn implementation gaps'),
 ('I07','progress','Evidence UI','A05','ARM03 controller → RunReport','Checker/session sinh record; Lab inspector hiện vẫn đọc shape mock của Plan 02.','Đưa controller record vào RunReport, map verdict/coverage/provenance đúng và kiểm browser trên trace controller.','arm','Còn integration gap'),
 ('I08','progress','Deployment','A06 / R-READY','Signed release & clean Linux install','Verifier/installer đã kiểm phần mềm; repo trust policy không có active key.','Provision keys/policyRevision, disjoint groups; chạy service/UID isolation, verify-install và rollback trên Linux sạch; review license.','restore','blocked_external'),
 ('I09','progress','Hardening','Deferred minors','Các hạng mục hoãn sau review','R01–R12 đã đóng; backlog minor trong handover không tự được coi là đã xử lý.','Triage payloadHash/schema/JCS-Ed25519 edges, journal growth, HMI blocking và scene/campaign edge cases. Xem danh sách bên dưới.','arm','Backlog còn mở'),
 ('I10','progress','Regression','CI / Postgres','Full integration dựa Postgres','SQLite, Python và browser đã xanh; Docker/Supabase tắt ở lượt kiểm cuối.','Chạy CI đủ Postgres suites trên đúng source revision; lưu kết quả trước quyết định tích hợp/phát hành.','checks','Chờ môi trường CI'),
 ('N01','todo','Thiết bị','H00','Driver máy pha / đá / sữa thật','Chưa có native vendor integration của work package H00 trong cell-adapters.','Chọn model/firmware/API, profile/device matrix, conformance emulator, durable IPC executor và vendor bench evidence.','hw','Chưa triển khai H00'),
 ('N02','todo','Phần cứng','H01','IPC, drive stack & EtherCAT','Chưa chọn MEKONIQ drive/IPC, cấu hình EtherCAT và budget real-time cho arm này.','Chốt BOM/manual/ESI/firmware, kernel/NIC/IgH/lcec theo thiết bị; không lấy timing VM làm bằng chứng.','hw','Chưa chọn thiết bị'),
 ('N03','todo','Calibration','H02','Shadow trên máy thật','Hạ tầng model/residual có sẵn; chưa có measured profile/held-out traces cho cell mục tiêu.','Thu calibration riêng, pin geometry/tool/frames, chạy connector read-only và xác minh zero actuation.','hw','Chưa có evidence thiết bị'),
 ('N04','todo','Bench','H03','Guarded HIL','Chưa thực hiện HIL một drive rồi sáu drive theo profile của cell.','Qualified bench + quyền commissioning; đo PDO/DC, cycle/jitter/drop, enable/fault/watchdog và no auto-restart.','hw','Chưa thực hiện'),
 ('N05','todo','Nghiệm thu','H04','FAT & coffee-cell qualification','Chưa có FAT cho serial/tool/payload/calibration cụ thể.','Kiểm limits, braking, retention, power loss, E-stop/guard, accuracy, nhiệt/chất lỏng, cleaning/food contact và restore.','hw','Chưa thực hiện'),
 ('N06','todo','Venue','H05','SAT & live tại địa điểm','Chưa có site acceptance hoặc authorization mở hardware/live.','Chốt layout/site profile, handoff/recovery thật, đào tạo operator, local authorization và chữ ký nghiệm thu.','hw','Chưa thực hiện'),
 ('N07','todo','Phát hành','R-INDUSTRIAL','Pilot → industrial rollout','Chưa có chuỗi pilot evidence, support và qualification cho phát hành công nghiệp.','Sau SAT: pilot theo phạm vi, controlled update/rollback, traceability và change-impact/requalification.','plans','Giai đoạn sau'),
 ('N08','todo','R&D tùy chọn','Beyond MVP','Dynamics / force / fluid & nấu ăn','Không nằm trong năng lực đã nghiệm thu của Digital Twin hiện tại.','Dynamics/torque/CFD là spike tùy chọn; cooking là roadmap riêng, không suy từ mock pha chế.','hw','Ngoài đường găng'),
]
labels={'done':'Đã hoàn thành','progress':'In progress','todo':'Chưa thực hiện'}
counts=Counter(f[1] for f in features)
def link(key,text=None):
    title,url,_=refs[key]
    return f'<a class="ref" href="{esc(url)}">{esc(text or title)} ↗</a>'
def feature_rows():
    out=[]
    for ident,status,group,code,title,detail,next_step,ref,flag in features:
        out.append(f'<tr data-feature="{ident}" data-status="{status}"><td>{esc(group)}<span class="group-code">{esc(code)} · {ident}</span></td><td><strong>{esc(title)}</strong><p>{esc(detail)}</p></td><td><span class="pill {status}">{labels[status]}</span><span class="small-flag">{esc(flag)}</span></td><td><p>{esc(next_step)}</p>{link(ref)}</td></tr>')
    return '\n'.join(out)
command_index=0
def command(title,code,note=''):
    global command_index
    command_index+=1
    ident=f'command-{command_index}'
    return f'<div class="command"><div class="command-head"><span>{esc(title)}</span><button class="copy" data-copy="{ident}" aria-label="Sao chép: {esc(title)}">Sao chép</button></div><pre><code id="{ident}">{esc(code.strip())}</code></pre>'+ (f'<p class="command-note">{esc(note)}</p>' if note else '')+'</div>'

mock_commands = command('01 · Chuẩn bị đúng source revision', '''# Chạy từ thư mục cha chứa source/ và lab/. Cần Git, nvm và pnpm.
WORKSPACE_DIR="$PWD"
REPORT_WORK="$(mktemp -d "${TMPDIR:-/tmp}/mekoniq-twin.XXXXXX")"
git -C "$WORKSPACE_DIR/source" worktree add --detach \
  "$REPORT_WORK/source" a89a077ed12648931a857333f899e3d6c1ea9719
cd "$REPORT_WORK/source"
nvm use
pnpm install --frozen-lockfile
node scripts/export-lab-runtime.mjs "$REPORT_WORK/runtime"''', 'Dùng cùng terminal cho bước 01–02. Worktree tạm pin đúng snapshot và không sửa checkout đang làm việc. Lần cài dependencies đầu tiên cần mạng. Node đã kiểm: 24.22.2; pnpm 10.32.1.')
mock_commands += command('02 · Import vào Lab và kiểm pin', '''cd "$WORKSPACE_DIR/lab"
# Lab snapshot của báo cáo: 3a92e6579793aa47c30c0a3abd44942d95c679c3
git rev-parse HEAD
nvm use
pnpm install --frozen-lockfile
node scripts/import-runtime.mjs "$REPORT_WORK/runtime"
pnpm check:source
pnpm test
pnpm build
pnpm test:runtime-e2e
node scripts/test-mock-e2e.mjs arm-simulation.spec.ts coffee-journey.spec.ts''', 'Đối chiếu Lab HEAD trước chạy; nếu dùng revision khác, đó là một lần validation mới. check:source phải báo source a89a077…, schema 8b398544…, protocol 1/2. Browser tests cần Chrome/Chromium; đặt CHROME_PATH trên host khác macOS.')
mock_commands += command('03 · Chạy demo nội bộ', '''# Từ lab/, sau khi import/check thành công:
pnpm lab:mock''', 'Mở http://127.0.0.1:4175 → Twin → nhập mã pairing in ở terminal (một lần, hết hạn 5 phút). Runtime ở 4176. Ctrl-C dừng đúng tiến trình launcher đã mở; journal ở runs/.')
mock_commands += command('Rollback runtime về pin trước', '''# Từ lab/, dừng launcher trước khi đổi pin:
node scripts/import-runtime.mjs --rollback
pnpm check:source
pnpm test
pnpm build
pnpm test:runtime-e2e''', 'Chỉ giữ một pin rollback gần nhất trong .runtime/rollback.lock.json; quay xa hơn phải export/import revision cần dùng.')
offline_command=command('Build gói offline mới theo OS/architecture', '''# Từ lab/, runtime mới đã import và check:
pnpm check:source
pnpm build
node scripts/build-offline.mjs --out /tmp/mekoniq-lab-offline-a89a077

# Trên máy cùng OS/architecture, sau khi chép nguyên gói:
cd /path/to/mekoniq-lab-offline-a89a077
./start''', 'Output phải chưa tồn tại. /path/to/... là đường dẫn gói trên máy nhận cần thay. Node được đóng gói sẵn. Gói releases/...c1d1ea7.tar.gz cũ không chứa các fix a89a077; lượt remediation chưa rebuild tarball mới.')
sil_commands=command('01 · Chuẩn bị ROS workspace trên Linux', '''# Từ source checkout đã pin a89a077, trên Linux đã provision ROS/Gazebo/colcon:
. /opt/ros/jazzy/setup.bash
colcon build --base-paths robotics/description robotics/navigation robotics/simulation \
  --packages-select mekoniq_description mekoniq_navigation mekoniq_simulation
. install/setup.bash
python3 -m venv --system-site-packages .venv-sil
. .venv-sil/bin/activate
python -m pip install -r robotics/simulation/requirements-dev.txt -e robotics/agent
nvm use
pnpm install --frozen-lockfile
node scripts/lab-sil.mjs doctor --backend gazebo_nav2 --json''', 'Ubuntu 24.04 / ROS 2 Jazzy / Gazebo Harmonic là baseline trong image.lock.json. Các ROS packages theo robotics/simulation/Dockerfile phải có trước. Đây là hướng dẫn validation chưa chạy trên host Linux của lượt này; doctor xanh là prerequisite, chưa phải SIL pass.')
sil_commands+=command('02 · Bắt đầu từ AMR-only, rồi verify evidence', '''# Cùng Linux shell đã source ROS, workspace và venv:
node scripts/lab-sil.mjs run --scenario FD01 --seed 23 --repeat 3 \
  --backend-set simulation-default --out /tmp/mekoniq-sil-fd01-a89a077
node scripts/lab-sil.mjs verify --input /tmp/mekoniq-sil-fd01-a89a077''', 'Sau FD01, lần lượt mở FD02, FD03, FD04 và FD07 với thư mục output riêng. Required backends theo scenario; không tự thay unavailable bằng mock.')
sil_commands+=command('03 · Campaign chỉ sau khi bổ sung integration còn thiếu', '''# Chưa phải đường chạy hoàn chỉnh ở snapshot hiện tại:
node scripts/lab-sil.mjs run --campaign food-beverage --seed 23 --repeat 3 \
  --out /tmp/mekoniq-sil-campaign-a89a077
node scripts/lab-sil.mjs verify --input /tmp/mekoniq-sil-campaign-a89a077''', 'BV01/campaign còn thiếu runner/controller-backed coupling và fixture/evidence phù hợp. Hiện tại thiếu backend/fixture phải giữ not_run (exit 2), không coi campaign có skips là pass.')
arm_commands=command('01 · Doctor và controller smoke trên host Linux đã provision', '''# Từ source checkout đã pin, python3 phải import được linuxcnc:
node scripts/lab-sil.mjs doctor --backend linuxcnc_sim --json
cd integrations/arm-controller
bash scripts/smoke-sim.sh --profile configs/sim/puma560/mekoniq.ini \
  --evidence-dir /tmp/mekoniq-arm-terminal-a89a077
bash scripts/smoke-sim.sh --profile configs/sim/puma560/mekoniq.ini \
  --evidence-dir /tmp/mekoniq-arm-gui-a89a077 --gui''', 'Dependency lock là candidate: Debian 12 amd64, LinuxCNC/PyQt5/QScintilla; cần chốt phiên bản và image/package hashes từ host sạch. Không áp dụng apt install như thể lock đã qualified. GUI cần desktop; smoke dùng virtual HAL, không nối drive thật.')
arm_commands+=command('02 · Export tại signing station được provision', '''# Từ source sạch. Các biến phải trỏ đến cấu hình signing station thật:
: "${ARM_EXPORT_DIR:?Thiet lap thu muc output moi}"
: "${ARM_RELEASE_KEY_FILE:?Thiet lap duong dan private key cua signing station}"
: "${ARM_RELEASE_KEY_ID:?Thiet lap key id da provision}"
node scripts/export-arm-controller.mjs "$ARM_EXPORT_DIR" \
  --signing-key "$ARM_RELEASE_KEY_FILE" --key-id "$ARM_RELEASE_KEY_ID"''', 'Không đưa private key vào repo/artifact. --allow-unsigned chỉ tạo development artifact bị installer từ chối. Repo trust policy có 0 key, revision 0; host phải được provision policy có active key và positive policyRevision.')
arm_commands+=command('03 · First install từ provisioning package tin cậy', '''# Trên Linux SIM IPC, tài khoản quản trị đã provision identity/group/policy:
: "${ARM_PROVISIONING_DIR:?Thu muc provisioning package da xac thuc}"
: "${ARM_ARTIFACT_DIR:?Thu muc signed artifact da chuyen den IPC}"
: "${ARM_TRUST_POLICY:?Duong dan trust policy do provisioning cap}"
bash "$ARM_PROVISIONING_DIR/scripts/install-sim.sh" \
  --prefix /opt/mekoniq-arm-sim \
  --artifact "$ARM_ARTIFACT_DIR" --trust-policy "$ARM_TRUST_POLICY"
bash /opt/mekoniq-arm-sim/current/scripts/verify-install.sh \
  --prefix /opt/mekoniq-arm-sim''', 'Installer/verifier phải đến từ trusted provisioning, không chạy từ chính artifact đang kiểm. Provision service user mekoniq-arm; group mekoniq-lab và mekoniq-arm-operators tách biệt. Chỉ service thuộc cả hai; client không dùng service UID.')
arm_commands+=command('04 · Bật bridge sau khi controller & identity sẵn sàng', '''# Chạy bằng tài khoản provisioning có quyền quản trị, trên SIM IPC:
cp /opt/mekoniq-arm-sim/current/packaging/systemd/mekoniq-arm-bridge.service \
  /etc/systemd/system/mekoniq-arm-bridge.service
systemctl daemon-reload
systemctl enable --now mekoniq-arm-bridge.service
systemctl status mekoniq-arm-bridge.service --no-pager
journalctl -u mekoniq-arm-bridge.service -n 80 --no-pager''', 'Bridge không tự khởi động LinuxCNC. Phải có controller SIM chạy bằng host procedure đã xác minh và python3 có jsonschema/referencing + native module. Unit dùng prefix /opt/mekoniq-arm-sim; đổi prefix phải sửa unit tương ứng. Test thực tế quyền hai socket sau mỗi restart trước cấp client access.')
arm_commands+=command('05 · Cập nhật từ installer đã cài', '''# Update signed artifact; dùng biến ARM_ARTIFACT_DIR đã xác định:
bash /opt/mekoniq-arm-sim/current/scripts/install-sim.sh \
  --prefix /opt/mekoniq-arm-sim --artifact "$ARM_ARTIFACT_DIR"
bash /opt/mekoniq-arm-sim/current/scripts/verify-install.sh \
  --prefix /opt/mekoniq-arm-sim''', 'Điều phối dừng/chạy service theo maintenance procedure của host; installer đổi current không chứng minh process đã nạp revision mới. Rollback yêu cầu artifact còn trusted và calibration schema tương thích; không rollback trust policy revision.')

arm_commands+=command('06 · Rollback riêng khi cần khôi phục', '''# Chỉ chạy khi cần quay lại last-known-good; không chạy sau update bình thường:
bash /opt/mekoniq-arm-sim/current/scripts/install-sim.sh \
  --prefix /opt/mekoniq-arm-sim --rollback
bash /opt/mekoniq-arm-sim/current/scripts/verify-install.sh \
  --prefix /opt/mekoniq-arm-sim''', 'Kiểm last-known-good còn trusted và calibration schema tương thích. Sau rollback, điều phối restart/health-check theo maintenance procedure; giữ journal và policyRevision đã chấp nhận.')


next_steps=[
 ('01','Khóa bản bàn giao & full CI','Platform + QA','Giữ cặp source a89a077 / Lab 3a92e65 làm baseline. Bật Docker/Supabase cho full Postgres suites rồi review quyết định merge hai repo.','Exit: CI đầy đủ xanh, lock/evidence khớp revision; ghi rõ quyết định tích hợp.'),
 ('02','Đóng R-MOCK, build offline mới','Product + Frontend + QA','Chạy usability với ≥5 người mới; build offline a89a077 theo từng OS/architecture và kiểm fresh install, network-off, cold boot.','Exit: owner duyệt R-MOCK và evidence theo host; không tái dùng tarball c1d1ea7 như bản mới.'),
 ('03','Gazebo/Nav2 validation','Robotics + QA','Provision Linux/ROS; bắt đầu AMR-only FD01, mở rộng các fault/actor/two-robot cases. Lưu contacts, separation, clock và raw reports.','Exit: G-SIM-NAV có actual runs với đúng source/image/fixture hashes và negative cases.'),
 ('04','Controller PoC trên Linux','Controls + QA','Chốt dependency lock, chạy LinuxCNC terminal/QtVCP smoke, units/IK, restart, lease và cross-UID socket isolation. Có thể làm song song bước 03.','Exit: controller PoC được xác nhận trên Linux; chưa tự nâng thành R-SIM.'),
 ('05','Hoàn thiện coffee-to-table','Platform + Robotics + Controls','Nối BV01 orchestration + gripper/cup observations; admission oracle, plant cup lifecycle và ARM03 → RunReport/inspector.','Exit: native combined run qua clock/transfer barriers, custody đúng, ARM03 đủ coverage; sau đó review R-SIM.'),
 ('06','Qualified SIM package','DevOps + Security + Controls','Provision signing/trust, review license/SBOM, clean Linux install, service startup và rollback/tamper/revoked-key tests.','Exit: package ký thật, restore reproducible, checklist R-READY phần mềm được owner duyệt.'),
 ('07','Chọn thiết bị & native contracts','Hardware + Controls + Device team','Chốt H00/H01 vendor/model/firmware/IPC/drive. Viết native adapters/conformance; đo geometry/calibration, thu shadow held-out traces.','Exit: accepted profile và bench plan; chưa mở live chỉ vì mock/SIL đã pass.'),
 ('08','HIL → FAT → SAT → pilot','Controls + Safety + QA + Venue owner','Theo gate H03–H05: qualified bench, real cell/process/safety measurements, site acceptance, đào tạo và local authorization.','Exit: evidence và chữ ký đúng serial/config/tool/site trước mỗi bước; industrial rollout sau pilot.'),
]
next_html=''.join(f'<article class="next-card"><span class="num">{n}</span><div><h3>{esc(title)}</h3><p>{esc(body)}</p><div class="exit">{esc(exit_)}</div><span class="owner">Vai trò đề xuất · {esc(owner)}</span></div></article>' for n,title,owner,body,exit_ in next_steps)
source_html=''.join(f'<a class="source" href="{esc(url)}"><b>{esc(title)} ↗</b><span>{esc(note)}</span></a>' for title,url,note in refs.values())
css=(SRC/'digital-twin-status.css').read_text()
js=(SRC/'digital-twin-status.js').read_text()
assert '</script' not in js.lower()
html=f'''<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><meta name="description" content="Báo cáo Digital Twin Plans 01–03: trạng thái chức năng, hướng dẫn deploy và next steps. Snapshot 06/11/2026."><title>MEKONIQ · Digital Twin — trạng thái & triển khai</title><style>{css}</style></head>
<body><a class="skip" href="#main">Đến nội dung chính</a>
<header class="topbar"><div class="top-inner"><a class="brand" href="#overview">MEKONIQ<small>ROBOT LAB / ENGINEERING</small></a><nav class="nav" aria-label="Điều hướng báo cáo"><a href="#overview">Tổng quan</a><a href="#features">Chức năng</a><a href="#evidence">Kiểm chứng</a><a href="#deploy">Deploy</a><a href="#next">Next steps</a></nav><button id="print" class="print-btn">In / Lưu PDF</button></div></header>
<noscript><div class="no-js">Báo cáo vẫn đọc đầy đủ khi tắt JavaScript. Bật JavaScript để lọc chức năng, chuyển tab deploy và sao chép lệnh.</div></noscript>
<main id="main" class="wrap"><div id="overview" class="hero"><div><div class="stamp">SNAPSHOT · 06.11.2026 · SAU REVIEW FIX</div><h1>Digital Twin.<br><span>Trạng thái &amp;<br>triển khai.</span></h1><p class="lede">Mock đã có kiểm thử đầu cuối. Code simulation và controller đã được review, nhưng còn cần chạy trên Linux và hoàn thiện hành trình coffee-to-table trước R-SIM.</p><div class="meta-line"><span>Source <code>a89a077</code></span><span>Lab <code>3a92e65</code></span><span>Node <code>24.22.2</code></span></div></div><aside class="hero-panel" aria-label="Ba mức sẵn sàng"><p class="eyebrow">Có thể dùng đến đâu?</p><div class="stage-row"><span class="stage-no">01</span><div><strong>Lab &amp; mock workflow</strong><span class="stage-tag">Dùng cho demo nội bộ</span><p>Delivery, coffee, mixed workload, replay và recovery. R-MOCK còn chờ owner acceptance.</p></div></div><div class="stage-row"><span class="stage-no">02</span><div><strong>Gazebo / Nav2 / LinuxCNC</strong><span class="stage-tag wait">Code có · native run chưa xác nhận</span><p>Software tests xanh; revision này chưa có ROS/Gazebo/LinuxCNC run, GUI hoặc clean Linux install.</p></div></div><div class="stage-row"><span class="stage-no">03</span><div><strong>Cell &amp; venue thật</strong><span class="stage-tag future">Chưa mở hardware / live</span><p>Vendor drivers, thiết bị, calibration, HIL/FAT/SAT và local authorization còn ở phía trước.</p></div></div><footer>Phạm vi: Digital Twin Plans 01–03 trong Lab/source. W00–W11 là nền tảng được tái sử dụng, không phải toàn bộ phạm vi nghiệm thu của báo cáo.</footer></aside></div>
<div class="metrics"><div class="metric done"><span class="label">Hoàn thành phần mềm</span><strong>{counts['done']:02d}</strong><small>Nhóm chức năng có code + test</small></div><div class="metric progress"><span class="label">In progress</span><strong>{counts['progress']:02d}</strong><small>Còn tích hợp hoặc nghiệm thu</small></div><div class="metric todo"><span class="label">Chưa thực hiện</span><strong>{counts['todo']:02d}</strong><small>Thiết bị / rollout / R&amp;D</small></div><div class="metric review"><span class="label">Review findings đã đóng</span><strong>12 / 12</strong><small>R01–R12 · reviewer độc lập</small></div></div><p class="footnote">Số đếm theo {len(features)} nhóm trong báo cáo, không phải phần trăm hoàn thành task của plan. “Hoàn thành” là phạm vi phần mềm đã kiểm; không đồng nghĩa release accepted.</p>
<section aria-labelledby="workstream-title"><div class="section-head"><div><span class="section-no">01 / WORKSTREAMS</span><h2 id="workstream-title">Ba plan, ba mức bằng chứng.</h2></div><p>Kế hoạch mô tả mục tiêu; trạng thái dưới đây lấy từ implementation, review và manifest đã ghi nhận.</p></div><div class="plan-grid"><article class="plan-card"><div class="code">PLAN 01 · F01–F08</div><h3>Nền tảng &amp; mock</h3><p>Contracts, model/world, source domain, coffee, twin workspace, replay và one-command launcher.</p><div class="bottom"><span class="pill done">Phần mềm hoàn tất</span><p style="margin:10px 0 0">41 acceptance tests ở mốc Plan 01; R-MOCK vẫn chờ nghiệm thu người dùng/host.</p>{link('mock')}</div></article><article class="plan-card"><div class="code">PLAN 02 · TASK 1–7</div><h3>Simulation &amp; orchestration</h3><p>World compiler, Nav2 bridge, clocks/faults, actor/obstacle, coffee plant và geometric checker.</p><div class="bottom"><span class="pill progress">Chờ native SIL + integration</span><p style="margin:10px 0 0">Protocol/logic đã kiểm. Không có physics pass từ lượt remediation; G-SIM-* còn mở.</p>{link('sim')}</div></article><article class="plan-card"><div class="code">PLAN 03 · A01–A06 → H00–H05</div><h3>Arm controller &amp; hardware</h3><p>PUMA model, LinuxCNC SIM profile, arbiter/bridge, QtVCP, Lab adapter và release tooling.</p><div class="bottom"><span class="pill progress">A software có · H chưa nghiệm thu</span><p style="margin:10px 0 0">Controller PoC chưa chạy Linux. Hardware/live vẫn khóa; chưa có cell qualified.</p>{link('arm')}</div></article></div></section>
<section id="features" aria-labelledby="feature-title"><div class="section-head"><div><span class="section-no">02 / FUNCTION INVENTORY</span><h2 id="feature-title">Chức năng &amp; phần việc còn lại.</h2></div><p>Mỗi dòng nói rõ đã làm gì, còn thiếu gì và nguồn đối chiếu. Một subsystem có thể đã xong code nhưng còn dòng nghiệm thu riêng.</p></div><div class="legend"><div><span class="pill done">Đã hoàn thành</span><p>Code và test cho phạm vi nêu trên dòng.</p></div><div><span class="pill progress">In progress</span><p>Chưa khép kín; gồm blocked_external, không hàm ý có người đang chạy tác vụ.</p></div><div><span class="pill todo">Chưa thực hiện</span><p>Deliverable hoặc lần nghiệm thu mục tiêu chưa có.</p></div></div><div class="toolbar"><div class="filters" role="group" aria-label="Lọc trạng thái"><button data-filter="all" aria-pressed="true">Tất cả · {len(features)}</button><button data-filter="done" aria-pressed="false">Hoàn thành · {counts['done']}</button><button data-filter="progress" aria-pressed="false">In progress · {counts['progress']}</button><button data-filter="todo" aria-pressed="false">Chưa thực hiện · {counts['todo']}</button></div><div class="search"><label for="feature-search">Tìm chức năng / gate / task</label><input id="feature-search" type="search" placeholder="Ví dụ: coffee, ARM03, HIL…"></div></div><p id="result-count" class="result-line" role="status" aria-live="polite">{len(features)} nhóm chức năng</p><table class="feature-table"><thead><tr><th scope="col">Workstream</th><th scope="col">Chức năng</th><th scope="col">Trạng thái</th><th scope="col">Bằng chứng / việc cần hoàn tất</th></tr></thead><tbody>{feature_rows()}</tbody></table><p id="empty" class="empty" hidden>Không có kết quả. Thử từ khóa khác hoặc chọn “Tất cả”.</p>
<details><summary>Backlog minor còn mở ngoài R01–R12</summary><div class="detail-body"><p>Danh sách theo handover Plans 02/03. Lượt remediation không tuyên bố đã đóng các mục này; cần triage/reproduce trước khi lên task.</p><ul><li><b>Plan 02:</b> provider pause acknowledgment / duplicate barrier id; zone entered state sau external release; served-after-handoff khi thiếu CargoLoaded; campaign requires mismatch một chiều; exporter digest thiếu package.xml; liquid estimate NaN; compiler output cũ còn file thừa; initial cup custody.</li><li><b>Plan 03:</b> Ed25519 point encoding không chuẩn; verifier chưa validate manifest schema; Python bridge chưa tính lại payloadHash; journal tăng không giới hạn/O(n)/fsync; provider freshness semantics; admission oracle thiếu machine input/chưa nối runtime; plant.takeCup/cup world lifecycle; scene revision kiểm một phần; ARM03 chưa vào RunReport; Qt send blocking; CLI quảng bá linuxcnc_sim khi campaign runner chưa có.</li></ul><p>R10 đã thêm kiểm freshness/continuity tại arm session; điều này không đồng nghĩa mọi freshness semantics của provider đã hoàn thiện.</p>{link('arm')}{link('sim')}</div></details></section>
<section id="evidence" aria-labelledby="evidence-title"><div class="section-head"><div><span class="section-no">03 / VERIFICATION</span><h2 id="evidence-title">Kết quả kiểm chứng đã ghi.</h2></div><p>Source kiểm trên commit sạch a89a077; Lab kiểm sau import artifact mới. Host macOS arm64, Node 24.22.2, Python 3.13.3.</p></div><div class="proof"><div class="proof-card"><h3>Regression sau remediation</h3><div class="test-row"><span>Contracts / typecheck / lint / build</span><b>exit 0</b></div><div class="test-row"><span>Source unit + contracts + arm security<small>25 test files</small></span><b>114 pass</b></div><div class="test-row"><span>Source SQLite integration<small>49 files · 1 skip tùy chọn</small></span><b>406 pass</b></div><div class="test-row"><span>Python agent / hardware schema / simulation<small>1 skip · không đóng native SIL gate</small></span><b>267 pass</b></div><div class="test-row"><span>Python arm-controller<small>1 skip Linux UID isolation · 11 subtests pass</small></span><b>108 pass</b></div><div class="test-row"><span>Lab unit / integration<small>1 skip tùy chọn · typecheck/build xanh</small></span><b>161 pass</b></div><div class="test-row"><span>Browser trên pin mới<small>Service journey · arm simulation · coffee journey</small></span><b>3 pass</b></div><p class="footnote" style="margin:15px 0 0">Các con số là kết quả lượt đã ghi, không phải suite vừa chạy khi mở HTML. Không cộng skips thành acceptance pass. {link('checks','Mở manifest và log')}</p></div><div><div class="callout"><strong>Chưa có native run / hardware acceptance</strong><p>Full Postgres integration chưa chạy vì Docker/Supabase không hoạt động. Linux/ROS/Gazebo/LinuxCNC, Qt GUI, systemd/UID isolation, clean Linux install và ký release thật vẫn chưa được kiểm chứng trong lượt này.</p></div><dl class="identity"><dt>Source runtime commit</dt><dd>{pin['sourceCommit']}</dd><dt>Lab report baseline</dt><dd>{LAB_REV}</dd><dt>Runtime artifact · SHA-256</dt><dd>{pin['artifactSha256']}</dd><dt>Schema · SHA-256</dt><dd>{pin['schemaHash']}</dd></dl><p class="footnote">29 schemas · protocol 1/2 · dirty:false. check:source xác minh artifact đã pin; không chứng minh native backend available.</p></div></div><div class="gate-strip"><div class="gate"><b>R-MOCK</b><small>Software tested<br>Chờ owner acceptance</small></div><div class="gate"><b>CONTROLLER-POC</b><small>Software tested<br>Chưa chạy Linux</small></div><div class="gate"><b>R-SIM / G-SIM-*</b><small>blocked_external<br>Chưa có full co-sim</small></div><div class="gate"><b>R-READY</b><small>Tooling từng phần<br>Chưa đạt đầy đủ</small></div><div class="gate"><b>Hardware / venue</b><small>Chưa nghiệm thu<br>Không mở live</small></div></div></section>
<section id="deploy" aria-labelledby="deploy-title"><div class="section-head"><div><span class="section-no">04 / DEPLOYMENT PLAYBOOK</span><h2 id="deploy-title">Deploy theo mức sẵn sàng.</h2></div><p>Chọn đúng môi trường. Các nút chỉ sao chép lệnh; HTML này không chạy lệnh, kết nối runtime hay điều khiển thiết bị.</p></div><div class="architecture" aria-label="Ranh giới triển khai"><div class="arch-node"><strong>Lab · 127.0.0.1:4175</strong><small>UI / thiết kế / replay / báo cáo</small></div><div class="arch-node authority"><strong>Source · 127.0.0.1:4176</strong><small>Domain / SQLite journal / dispatcher / authority</small></div><div class="arch-node"><strong>Backend theo mode</strong><small>Mock local · ROS/Gazebo Linux · arm bridge trên IPC</small></div></div><div class="deploy-tabs" role="tablist" aria-label="Môi trường deploy"><button role="tab" id="tab-mock" aria-controls="deploy-mock" aria-selected="true">A · Local mock<small>Có thể dùng nội bộ</small></button><button role="tab" id="tab-sil" aria-controls="deploy-sil" aria-selected="false">B · Gazebo/Nav2 SIL<small>Cần Linux validation</small></button><button role="tab" id="tab-arm" aria-controls="deploy-arm" aria-selected="false">C · Arm controller SIM<small>Candidate · cần provisioning</small></button></div>
<div class="deploy-panel" role="tabpanel" id="deploy-mock" aria-labelledby="tab-mock"><div class="deploy-intro"><h3>A. Lab + runtime mock</h3><span class="pill done">Đã kiểm trên macOS</span></div><p>Chuẩn bị Node 24.22.2, pnpm 10.32.1 và hai repository source/lab. Giữ cổng 4175/4176 trống; không dùng 1880/1884 của môi trường vận hành.</p>{mock_commands}<div class="callout green"><strong>Tiêu chí sẵn sàng demo</strong><p>check:source đúng pin → launcher ready → pairing được → một delivery/coffee journey hoàn tất đúng confirmation → report/replay có journal. UI tĩnh hoặc animation đơn lẻ chưa chứng minh runtime chạy.</p></div><div class="panel-section"><h3>Phân phối offline</h3>{offline_command}<p class="footnote">Sau build, chạy boot và browser journeys trên gói mới, lưu manifest/checksum. Fresh machine/network-off/cold boot là gate cần chạy thật, chưa được thay bằng kết quả developer host.</p></div>{link('lab')}</div>
<div class="deploy-panel" role="tabpanel" id="deploy-sil" aria-labelledby="tab-sil"><div class="deploy-intro"><h3>B. Gazebo / Nav2 SIL trên Linux</h3><span class="pill progress">Chưa có acceptance mới</span></div><p>Đây là playbook để tạo bằng chứng tiếp theo, chưa phải môi trường đã nghiệm thu. Native host cần Node/pnpm + ROS workspace + Python dependencies cùng có mặt. Dockerfile hiện có dành cho ROS tests; nó không tự đóng gói Node orchestrator.</p>{sil_commands}<div class="callout"><strong>Điều kiện công nhận kết quả</strong><p>Native worker sống, clock/lifecycle ready, telemetry/contact/separation có freshness và coverage, transfer barriers đủ ACK, source journal đúng. Protocol double, empty samples hoặc not_run không phải physics pass.</p></div><p class="footnote" style="margin-top:16px">Có evidence Gazebo cũ ở W06, nhưng không dùng để đóng gate cho compiler/worker/co-simulation mới ở revision a89a077.</p>{link('cli')}{link('image')}</div>
<div class="deploy-panel" role="tabpanel" id="deploy-arm" aria-labelledby="tab-arm"><div class="deploy-intro"><h3>C. LinuxCNC controller SIM</h3><span class="pill progress">Chỉ SIM · hardware disabled</span></div><p>LinuxCNC dùng môi trường riêng với ROS: baseline Debian 12 amd64 trong candidate dependency lock. Việc chọn/package version cần được xác nhận trên Linux sạch; không có giả định một image chạy cả hai backend.</p>{arm_commands}<div class="callout"><strong>Kiểm sau deploy</strong><p>Verify signature/files; controller native ready; terminal + GUI smoke; allow/deny đúng hai socket qua restart; timeout/lease/reconcile; install/rollback và preservation của journal/calibration. Kiểm này chưa chạy trên host hiện tại. Repo không có lệnh generic enable hardware/live.</p></div>{link('bridge')}{link('restore')}</div>
<details><summary>Checklist xử lý lỗi thường gặp khi deploy mock</summary><div class="detail-body"><ul><li><code>RUNTIME_NOT_INSTALLED</code>: import trusted artifact trước; preview UI không có runtime.</li><li><code>DIRTY_SOURCE_ARTIFACT</code> / hash mismatch: export từ revision sạch và import lại; không bỏ qua integrity check.</li><li><code>PORT_IN_USE</code>: kiểm tiến trình đang giữ 4175/4176; không tự kill tiến trình hoặc robot đang vận hành.</li><li><code>BACKEND_UNAVAILABLE</code>: xem prerequisite/capability; không chuyển sang mock rồi giữ nhãn SIL.</li><li>Trust policy thiếu/expired/revoked: dùng trusted provisioning recovery; không chỉnh manifest hoặc hạ policyRevision.</li></ul></div></details></section>
<section id="next" aria-labelledby="next-title"><div class="section-head"><div><span class="section-no">05 / NEXT STEPS</span><h2 id="next-title">Từ baseline xanh đến nghiệm thu thật.</h2></div><p>Thứ tự đề xuất theo dependency và gate; vai trò là gợi ý phân công, chưa phải owner đã nhận việc hoặc cam kết ngày.</p></div><div class="next-grid">{next_html}</div><div class="callout green" style="margin-top:22px"><strong>Ưu tiên gần nhất</strong><p>Full CI + mock acceptance/offline package; song song chuẩn bị hai môi trường Linux để có first native runs. Chỉ sau đó chốt phạm vi co-simulation và phần cứng bằng kết quả đo thực.</p></div></section>
<section id="sources" aria-labelledby="source-title"><div class="section-head"><div><span class="section-no">06 / SOURCES &amp; SCOPE</span><h2 id="source-title">Nguồn đối chiếu.</h2></div><p>Snapshot ngày 06/11/2026; trạng thái không tự cập nhật. Ưu tiên evidence/remediation mới hơn các đoạn trạng thái lịch sử trong README hoặc plan.</p></div><div class="sources">{source_html}</div><p class="footnote" style="margin-top:18px">File HTML tự chứa CSS/JavaScript, không cần mạng để đọc, lọc hoặc in. Liên kết tới code/tài liệu chỉ mở đúng khi file còn trong source/artifacts với lab/ ở cùng workspace; khi gửi file riêng, người nhận vẫn đọc đủ báo cáo và hướng dẫn nhưng không có các tài liệu liên kết. Báo cáo này không thay đổi acceptance ledger.</p></section>
<footer class="footer"><span>MEKONIQ · Digital Twin delivery report · VI · 06.11.2026</span><span>Software implemented ≠ native tested ≠ accepted.</span></footer></main><div id="toast" class="toast" role="status" aria-live="polite" hidden></div><script>{js}</script></body></html>'''
assert len(html.encode())<256*1024
path=OUT/'digital-twin-status-2026-11-06.html'
path.write_text(html)
print(json.dumps({'file':str(path),'bytes':path.stat().st_size,'features':dict(counts),'commands':command_index,'sourceCommit':pin['sourceCommit'],'sha256':hashlib.sha256(path.read_bytes()).hexdigest()},ensure_ascii=False,indent=2))
