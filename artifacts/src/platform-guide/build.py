#!/usr/bin/env python3
"""Build a standalone Vietnamese product/deployment guide; no external assets."""
import base64
import hashlib
import html
import json
from pathlib import Path
import shutil

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parents[2]
LAB = SOURCE.parent / 'lab'
OUT = SOURCE / 'artifacts/mekoniq-platform-lab-guide-2026-11-06.html'
EVIDENCE = LAB / 'docs/implementation/evidence/bv01-native-simulation'
summary = json.loads((EVIDENCE / 'implementation-summary.json').read_text())
pin = summary['runtimeLock']
esc = html.escape
images = json.loads((HERE / 'capture-manifest.json').read_text())
archive = [
 ('source-settings', 'Preset và bố trí nhà hàng', SOURCE / '.lab/shots/out/c03-settings-preset.png', '/admin/settings'),
 ('source-catalog', 'Quản trị thực đơn', SOURCE / '.lab/shots/out/c04-catalog.png', '/admin/catalog'),
 ('source-customers', 'CRM và điểm thành viên', SOURCE / '.lab/shots/out78/c12-admin-customers.png', '/admin/customers'),
 ('source-promotions', 'Khuyến mãi và voucher', SOURCE / '.lab/shots/out78/c11-admin-promotions.png', '/admin/promotions'),
 ('source-reservations', 'Đặt bàn và danh sách chờ', SOURCE / '.lab/shots/out78/c13-admin-reservations.png', '/admin/reservations'),
 ('source-chain', 'Phát hành cấu hình chuỗi', SOURCE / '.lab/shots/out911/c20-chain-configuration.png', '/admin/chain/configuration'),
 ('source-tenders', 'Chia bill, nhiều cách trả và hoàn tiền', SOURCE / '.lab/shots/out56/w06-checkout-tenders-refund.png', '/checkout'),
 ('lab-bv01', 'BV01 hoàn tất: hai cốc tới bàn', EVIDENCE / 'F05-coffee-completed-desktop-vi.png', '#twin'),
 ('lab-cup-fault', 'Thiếu cốc: giữ luồng và đối soát', EVIDENCE / 'F05-missing-cup-desktop-vi.png', '#twin'),
 ('lab-schedule', 'Lịch chèn lỗi được lưu trong project', EVIDENCE / 'V06-scheduled-cup-mock.png', '#twin'),
 ('lab-replay', 'Replay và trace theo thời gian', LAB / 'docs/implementation/evidence/digital-twin-v2/F06-replay-trace-desktop-vi.png', '#twin'),
]
for ident, title, original, route in archive:
    dest = HERE / 'screenshots' / (ident + '.png')
    if original.exists():
        shutil.copyfile(original, dest)
    elif not dest.exists():
        raise FileNotFoundError(f'Missing original and archived screenshot: {dest.name}')
    repo = ident.split('-')[0]
    current = original.parent == EVIDENCE
    images.append(dict(id=ident, title=title, file=dest.name, repo=repo, origin='evidence',
        revision=summary['testedLabCommit'] if current else 'Không gắn commit trong metadata ảnh lưu trữ',
        capturedAt='Evidence 06/11/2026' if current else 'Ảnh lưu trữ; không xác minh ngày chụp gốc',
        scope=('Browser journey trên runtime source f82b205; mock, không phải native engine.' if current else
               'Ảnh UI từ bộ fixture local đã lưu; không phải ảnh production hoặc lần kiểm HEAD mới.'),
        route=route, original=str(original.relative_to(SOURCE.parent))))
for im in images:
    im['sha256'] = hashlib.sha256((HERE / 'screenshots' / im['file']).read_bytes()).hexdigest()
(HERE / 'screenshots-manifest.json').write_text(json.dumps(images, ensure_ascii=False, indent=2)+'\n')
def data_img(ident):
    item = next(i for i in images if i['id'] == ident)
    return 'data:image/png;base64,' + base64.b64encode((HERE / 'screenshots' / item['file']).read_bytes()).decode()

# F01–F30 is the complete product scope. Current status comes from implementation
# evidence and code, not the obsolete "not implemented" preamble of the scope spec.
locations = [
 'Cloud login, membership và device enrollment', '/admin/settings', '/admin/catalog; tablet /pos',
 'Tablet /pos', 'Tablet /pos, /kiosk, /robot-screen; guest web', 'Tablet /pos, /kitchen',
 'Tablet /kitchen; beverage domain', 'Tablet /fleet; Lab Twin', 'Tablet /robot-setup, /fleet',
 'Tablet /checkout', 'Tablet /checkout; provider adapters', 'Tablet /checkout; reconciliation',
 'Tablet /cash', 'Tablet /print', 'Tablet /guest-requests', '/admin/reservations; tablet',
 '/admin/promotions; tablet', '/admin/customers; tablet', 'Tablet /inventory',
 'Tablet /inventory → mua hàng', 'Tablet /staff', 'Tablet /reports; /admin/operations',
 '/admin/chain/configuration, /admin/chain/reports', '/order/[venueId]; channel adapters',
 'Provider interface và invoice requests', 'Tablet /pos; settings', 'SDK / Node-RED / API',
 'Release tools, jobs và runbooks', 'Tablet native / sync / outbox', 'Maintenance / import / recovery',
]
pending = {
 'F09': 'Simulator và adapter protocol có kiểm thử. Valetudo, S100/ZLTECH và robot thật cần commissioning theo model/firmware.',
 'F11': 'Tiền mặt/ghi nhận giao dịch ngoài có phần mềm; cổng thanh toán thật cần credential, sandbox/conformance và nghiệm thu provider.',
 'F14': 'Hàng đợi và chống in lặp có code; cần nghiệm thu máy in/driver mục tiêu.',
 'F24': 'Web/channel sandbox có code; đăng ký kênh, tài khoản và ACK từ nhà hàng thật cần xác minh riêng.',
 'F25': 'Interface và xử lý timeout/query có code; chưa chứng minh phát hành hóa đơn thật qua provider.',
 'F28': 'Tooling/local checks có evidence; cần kiểm hosted capacity, recovery drill và acceptance theo release hiện deploy.',
 'F29': 'Sync/ownership/isolation có kiểm thử local; hai tablet Android thật, mất LAN/WAN và soak vẫn là gate riêng.',
}
features = []
for line in (SOURCE / 'docs/product/2026-10-30-capability-matrix.md').read_text().splitlines():
    if not line.startswith('| F'):
        continue
    cells = [s.strip() for s in line.split('|')[1:-1]]
    ident, title, detail, criteria, _ = cells
    title = title.split(' — ')[0]
    n = int(ident[1:])-1
    features.append(dict(id=ident,repo='source',title=title,detail=detail,where=locations[n],
        status='progress' if ident in pending else 'software',
        limit=pending.get(ident, 'Đã có phần mềm/kiểm thử local trong W00–W11; cần smoke đúng venue, quyền và preset của deployment thực.'),
        source='Source registry + W00–W11 / Gate D; phạm vi F01–F30', criteria=criteria))

lab_rows = [
 ('L01','software','Thiết kế robot 2D/3D','Khung gầm, 2–4 khay, pin, cảm biến, tải, tách lớp và chọn linh kiện.','#design','Mô hình/BOM minh họa; chưa phải thông số đo hoặc báo giá.'),
 ('L02','software','Mặt bằng và semantic world','Bàn, trạm, điểm đỗ, kích thước, bindings, footprint và world revision.','#restaurant','Bố trí cần map binding và kiểm scene trước khi dùng native/hardware.'),
 ('L03','software','Project và cấu hình','Lưu IndexedDB, undo/redo, import/export và migration dữ liệu project.','ProjectStore','Dữ liệu theo browser origin; đổi domain không tự chuyển dữ liệu.'),
 ('L04','software','Kịch bản và admission','Catalog scenario, seed, robot/backend capability và điều kiện bắt đầu.','#scenarios / #twin','Backend unavailable hoặc profile không phù hợp phải chặn chạy.'),
 ('L05','software','Twin workspace','Quan sát 2D/3D, trạng thái, inspector, hành động tiếp theo; VI/JA/EN.','#twin','Renderer không tự xác nhận robot tới đích hoặc giao hàng.'),
 ('L06','software','AMR và chiến dịch hai robot','Load/handoff, queue, giao nhiều điểm, tranh chấp tài nguyên và campaign.','FD01 / FD02 / campaign','Đã kiểm mock/domain; tránh va chạm vật lý cần native/hardware evidence.'),
 ('L07','software','Coffee và nguyên liệu','Recipe revision, reservation/consumption, pha espresso/cà phê sữa đá, process observations.','CoffeeDriver / beverage','Process model minh họa, chưa có driver máy pha thương mại.'),
 ('L08','software','BV01 coffee-to-table','Pha → arm lấy cốc → khay AMR → tới bàn → xác nhận giao; hai recipe.','#twin → Cà phê sữa đá','Browser mock pass với served=2; native BV01 chưa chạy.'),
 ('L09','software','Cup custody và handoff','Durable ledger, plant.takeCup, xác nhận hai phía, projection idempotent và phục hồi crash-cut.','I01 / I02','Mỗi cốc có một owner; grip chưa rõ không tự coi là đã nhấc cốc.'),
 ('L10','software','Lỗi, restart và đối soát','Disconnect, missing cup, journal/effects, hold, human reconcile và retry với input khóa.','#twin / recovery','Không tự phát lại chuyển động có outcome unknown.'),
 ('L11','software','Scenario fault schedule','Editor lưu target, trigger, duration; đánh dấu fault đã bắn bền vững.','I05 / #twin','Mock schedule đã chạy; fault trên engine thật cần qualification riêng.'),
 ('L12','software','Simulation readiness','Backend/dependency/protocol/world/model inventory, freshness và admission kiểm lại.','I04 / native readiness','Doctor/readiness thành công chưa phải physics test pass.'),
 ('L13','software','Telemetry, KPI, replay và compare','Timeline, locked inputs, queue/travel/human-wait/cell-busy, replay cursor và JSON/CSV/HTML.','#results / #twin','Thiếu dữ liệu hiện unknown; không biến không đo thành số 0.'),
 ('L14','software','ARM03/controller trong RunReport','Verdict geometric checker, coverage, controller outcomes, transfer evidence và raw clock mapping.','I03 / inspector','Browser import dùng fixture; không chứng minh LinuxCNC engine đã chạy.'),
 ('L15','software','World compiler và SIL orchestration','Geometry/map export, Nav2 worker, clock/barriers, actors/blockers và shared faults.','Plan 02 / N02–N06','Compiler/protocol doubles đã kiểm; raw Gazebo telemetry chưa có ở pin này.'),
 ('L16','software','PUMA model, bridge và QtVCP code','Reference model, FK/unit oracle, lease arbiter, Unix socket, pause/cancel/reconcile và HMI.','Plan 03 / arm-controller','Python/TS/socket tests pass; GUI và native IK smoke còn not_run.'),
 ('L17','software','Gripper SIM và native coordinator code','SIM gripper, tray observation độc lập, SSH supervisor, native tool closure và gateway/UI.','N04–N06','Software complete; hai engine thật chưa được chạy cùng nhau.'),
 ('L18','progress','Offline package và R-MOCK','Bundle Node + UI + runtime pin; cold start/rollback tooling; macOS ARM64 BV01 pass.','F07 / R02','Còn clean-machine, OS network-off, Linux target và usability ≥5 người.'),
 ('L19','progress','UTM và hai VM Linux','Runbook/preflight có sẵn cho Ubuntu 24.04 ARM64 và Debian 12 ARM64.','N01 / UTM runbook','Chưa cài UTM/boot VM trong evidence. Cần volume đủ 120 GiB và reserve host 20 GiB.'),
 ('L20','progress','Native AMR / controller / BV01','FD01→FD02/03/04/07, LinuxCNC terminal/QtVCP, rồi combined BV01.','G-SIM-NAV / CONTROLLER-POC / R-SIM','6 prerequisite checks exit 2/not_run; không có native simulation pass.'),
 ('L21','progress','Signed release / Linux amd64','Manifest, trust policy, verifier/installer và rollback tooling có tests.','R03 / R-READY','Chưa ký release thật hoặc clean amd64 install/reboot/restore.'),
 ('L22','todo','Driver thiết bị và EtherCAT','Máy pha/đá/sữa, servo/drive/IPC, fieldbus và profile thiết bị cụ thể.','H00 / H01','Chưa có qualification thiết bị mục tiêu; không dùng timing VM để thay timing IPC.'),
 ('L23','todo','Calibration, guarded HIL, FAT/SAT','Measured geometry, shadow, safety, E-stop/STO, power loss, venue acceptance và pilot.','H02–H05 / industrial','Cần hardware và người nghiệm thu; simulation không đóng các gate này.'),
 ('L24','todo','Capacity/ROI và R&D nâng cao','Batch capacity 1–3 AMR, ROI với giả định, lực/mô-men/chất lỏng và nấu ăn.','Roadmap tiếp theo','Chưa có bộ sản phẩm capacity/ROI hoàn chỉnh; BOM/KPI hiện có không thay năng suất đo thực.'),
]
for ident,status,title,detail,where,limit in lab_rows:
    features.append(dict(id=ident,repo='lab',title=title,detail=detail,where=where,status=status,limit=limit,
        source='Lab Plans 01–03 + BV01/native implementation-summary; source pin f82b205',criteria=''))
(HERE / 'feature-inventory.json').write_text(json.dumps(features,ensure_ascii=False,indent=2)+'\n')
labels = {'software':'Có phần mềm · kiểm local/mock','progress':'In progress · chờ nghiệm thu','todo':'Chưa thực hiện'}
def feature_cards():
    return '\n'.join(f'''<article class="feature" data-repo="{f['repo']}" data-state="{f['status']}">
<div class="meta">{f['repo'].upper()} / {f['id']} <span class="tag {f['status']}">{labels[f['status']]}</span></div>
<h3>{esc(f['title'])}</h3><p>{esc(f['detail'])}</p><p class="where">Mở tại: {esc(f['where'])}</p>
<p class="limit">{esc(f['limit'])}</p><small>{esc(f['source'])}</small></article>''' for f in features)
def gallery():
    return '\n'.join(f'''<figure id="shot-{i['id']}" class="shot" data-shot-repo="{i['repo']}">
<a href="{data_img(i['id'])}" class="zoom" aria-label="Phóng to: {esc(i['title'])}"><img src="{data_img(i['id'])}" alt="{esc(i['title'])} — {esc(i['scope'])}" loading="lazy" width="1440" height="960"></a>
<figcaption><span class="meta">{i['repo'].upper()} · {'CHỤP MỚI LOCAL' if i['origin']=='fresh' else 'EVIDENCE LƯU TRỮ'}</span><h3>{esc(i['title'])}</h3><p>{esc(i['scope'])}</p><small>{esc(i['route'])} · {esc(i['capturedAt'])}<br>Revision: {esc(i['revision'])}</small></figcaption></figure>''' for i in images)
command_count = 0
def code(text, lang='sh'):
    global command_count
    command_count += 1
    return f'<div class="codebox"><button class="copy" data-copy="cmd-{command_count}" aria-label="Sao chép khối lệnh {command_count}">Sao chép</button><pre><code id="cmd-{command_count}" data-lang="{lang}">{esc(text.strip())}</code></pre></div>'
def table(headers, rows):
    return '<div class="table-wrap"><table><thead><tr>'+''.join('<th>'+h+'</th>' for h in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+c+'</td>' for c in r)+'</tr>' for r in rows)+'</tbody></table></div>'
def step(number,title,body):
    return f'<article class="step"><span class="step-n">{number}</span><div><h3>{title}</h3>{body}</div></article>'

local = step('01','Chuẩn bị toolchain và xác định baseline', '<p>Chạy từ thư mục workspace chứa hai repository. Node 24.22.2 và pnpm 10.32.1; Docker Desktop cần hoạt động cho Supabase local. Giữ hai branch hiện tại và ghi lại commit trước build.</p>'+code('''cd /Users/hoangpham/source/prv/robot
nvm install 24.22.2
nvm use 24.22.2
node --version
pnpm --version
git -C source rev-parse --abbrev-ref HEAD
git -C source rev-parse HEAD
git -C lab rev-parse --abbrev-ref HEAD
git -C lab rev-parse HEAD''')+'<p class="note">Nếu chưa có pnpm đúng version, cài pnpm 10.32.1 theo setup của máy. Các terminal tiếp theo cũng phải chọn Node 24. Không khởi động trial hoặc thay đổi port robot 1880/1884.</p>')
local += step('02','Khởi động database và cloud app local', code('''cd /Users/hoangpham/source/prv/robot/source
pnpm install --frozen-lockfile
pnpm doctor
pnpm supabase:start
# Áp dụng migration còn thiếu trên DB local đã tồn tại
pnpm exec supabase migration up --local
# Chỉ chạy một lần trên môi trường mới, chưa bootstrap
pnpm local:bootstrap
pnpm dev:cloud''')+'<p>Mở <code>http://localhost:3400/login</code>. Bootstrap tạo owner, venue trống và <code>apps/cloud-web/.env.local</code>; lấy tài khoản trong <code>.lab/bootstrap/owner-credentials.json</code> trên máy. Lệnh từ chối ghi đè cấu hình/venue đã tồn tại: với máy đã setup, giữ file và bỏ qua bootstrap.</p><p>Supabase API <code>57421</code>, PostgreSQL <code>57422</code>, mail sink <code>57424</code>; project local <code>mekoniq-w00-w04</code>. Dữ liệu nằm trong Docker volume. Không dùng <code>db reset</code> cho dữ liệu cần giữ.</p>'+code('''curl --fail http://localhost:3400/health/live
curl --fail http://localhost:3400/health/ready''')+'<p class="note">Ready chỉ kiểm kết nối SQL bằng <code>select 1</code>. Đăng nhập, quyền, schema, jobs và từng nghiệp vụ cần smoke riêng.</p>')
local += step('03','Mở tablet web bằng fixture cô lập', '<p>Hai terminal trong <code>source/</code>, đều dùng Node 24:</p>'+code('''# Terminal A — coordinator fixture
MEKONIQ_DEV_LAB=1 pnpm dev:coordinator''')+code('''# Terminal B — tablet UI
MEKONIQ_DEV_LAB=1 pnpm dev:tablet''')+'<p>Mở <code>http://127.0.0.1:3452</code>; coordinator fixture ở <code>3451</code>. Có POS, bếp, fleet, thu ngân, kho, ca làm và báo cáo. Đây là môi trường thử nghiệm local. Tablet production dùng native enrollment/transport, không deploy fixture server lên Vercel.</p>')
local += step('04','Chuẩn bị runtime source và chạy Lab', '<p>Nếu <code>lab/.runtime</code> đã khớp lock, chạy <code>pnpm check:source</code> rồi launcher. Checkout mới cần lấy đúng artifact từ release nội bộ hoặc export từ source commit đã chọn:</p>'+code('''# Workspace root; thư mục output phải là đường dẫn mới
cd /Users/hoangpham/source/prv/robot/source
node scripts/export-lab-runtime.mjs /var/tmp/mekoniq-runtime-guide --clean-checkout
cd ../lab
pnpm install --frozen-lockfile
node scripts/import-runtime.mjs /var/tmp/mekoniq-runtime-guide
pnpm check:source
pnpm lab:mock''')+'<p><code>--clean-checkout</code> export committed HEAD; cần dependencies có trong pnpm store cho bước offline install. Import có thể cập nhật lock/mirror; review và commit pin cùng thay đổi runtime. Mở <code>http://127.0.0.1:4175</code>, nhập mã pairing một lần từ terminal. Runtime ở <code>4176</code>, SQLite journal theo run trong data directory; không dùng PostgreSQL của source.</p><p>Chọn <b>Bản sao số → Cà phê sữa đá → Chạy mock → Tự chạy</b>. Kiểm served=2, owner cốc ở bàn và export RunReport. Thử missing cup để thấy hold/đối soát; không coi animation là evidence giao hàng.</p>')
local += step('05','Build và phân phối gói offline', code('''cd /Users/hoangpham/source/prv/robot/lab
pnpm check:source
pnpm build
node scripts/build-offline.mjs --out /var/tmp/mekoniq-offline-guide
/var/tmp/mekoniq-offline-guide/start''')+'<p>Output phải chưa tồn tại. Gói chứa Node, UI và runtime, chỉ chạy đúng OS/CPU đã build. Người nhận chạy <code>./start</code>, không cần pnpm. Dùng <code>--data-dir /absolute/persistent/runs</code> để giữ journal ngoài thư mục release; dừng instance cũ trước khi chạy instance mới trên 4175/4176. Browser project/report cần export riêng.</p>')
local += step('06','Dừng dịch vụ và giữ dữ liệu', '<p>Ctrl+C ở các terminal do bạn mở; dùng wrapper bên dưới để dừng đúng Supabase project. Không xóa volume, không tắt các Docker project khác.</p>'+code('''cd /Users/hoangpham/source/prv/robot/source
pnpm supabase:stop''')+'<p>Trước nâng cấp: backup DB, export Lab project/report, ghi pin và sao lưu SQLite khi runtime đã dừng (hoặc dùng SQLite backup API). Không chỉ copy file DB đang có WAL hoạt động.</p>')

cloud = '<div class="notice"><strong>Hai project đã có — giữ đúng liên kết hiện tại.</strong><p>Người dùng xác nhận deployment tồn tại. Phiên tạo tài liệu không đọc được dashboard có đăng nhập; chưa xác minh production domain, deployed commit, environment variables hoặc migration history. Các bước dưới là runbook cập nhật, không phải biên bản đã deploy.</p></div>'
cloud += table(['Thành phần','Project / đích','Cấu hình đối chiếu với code'],[
 ('Source cloud app','<a href="https://vercel.com/henry-projects/mekoniq">henry-projects / mekoniq ↗</a>','Repo source; Root Directory <code>apps/cloud-web</code>; Next.js; Node 24.x; include files outside root; output theo Next.js.'),
 ('Lab frontend','<a href="https://vercel.com/henry-projects/mekoniq-lab">henry-projects / mekoniq-lab ↗</a>','Repo lab; root <code>.</code>; Vite; Node 24.x; <code>pnpm build</code>; Output <code>dist</code>.'),
 ('Database / Auth / Storage','<a href="https://supabase.com/dashboard/project/dinpyoxktiixgwhowxpl">Supabase dinpyoxktiixgwhowxpl ↗</a>','API URL <code>https://dinpyoxktiixgwhowxpl.supabase.co</code>. Project ref do người dùng cung cấp; quyền/schema chưa đọc trực tiếp.'),
 ('Lab runtime / native engines','Local Mac hoặc Linux theo runbook','Runtime không nằm trong Vite dist; hiện bind loopback và dùng journal/process riêng. Chưa có remote runtime deployment được xác minh.'),
])
cloud += step('C1','Ghi nhận deployment hiện tại và tạo bản khôi phục', '<p>Ở mỗi Vercel project, xem Settings → Git và Deployments: ghi repository, Production Branch, commit, Deployment ID, Domains, Node version và scopes môi trường. Chọn cùng release pair source/Lab theo runtime lock; feature branch hiện tại không tự là production branch.</p><p>Trong Supabase, kiểm migration history và backup/restore theo gói dịch vụ thực tế. Backup dữ liệu nghiệp vụ và Storage cần quy trình riêng; không suy ra backup bucket từ database dump. Thử migration trên DB preview/staging tách biệt trước.</p>')
cloud += step('C2','Cấu hình project source trên Vercel', '<p>Root <code>apps/cloud-web</code>, bật <b>Include source files outside of the Root Directory in the Build Step</b>. File <code>apps/cloud-web/vercel.json</code> đã cấu hình:</p>'+code('''Install: cd ../.. && pnpm install --frozen-lockfile
Build:   cd ../.. && pnpm --filter @mekoniq/cloud-web... build
Output:  mặc định Next.js (không dùng dist)
Region:  sin1 — đối chiếu region Supabase trước khi đổi''','text')+'<p>Không dùng <code>pnpm dev:cloud</code> làm build command. Source monorepo cần packages dùng chung bên ngoài app root. <a href="https://vercel.com/docs/monorepos/monorepo-faq">Vercel: monorepo và root directory</a>.</p>')
env_rows = [
 ('<code>NEXT_PUBLIC_SUPABASE_URL</code>','Public configuration','Lấy từ <code>SUPABASE_URL</code> bạn cung cấp; code không tự đọc alias đó.'),
 ('<code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>','Public API key','Lấy publishable key của đúng Supabase project; không chép key vào tài liệu.'),
 ('<code>SUPABASE_SERVICE_ROLE_KEY</code>','Server only','Tên biến admin client hiện đọc. Cấu hình backend key đầy đủ, còn hiệu lực từ Supabase; alias <code>SUPABASE_SECRET_KEY</code> hiện chưa được code đọc.'),
 ('<code>DATABASE_URL</code>','Server only','Transaction pooler URL với role <code>mekoniq_app</code>, mật khẩu riêng và project ref; không phải Supabase HTTP API URL.'),
 ('<code>DEVICE_GRANT_PRIVATE_KEY</code>','Server only','ES256 private JWK cho device grant; provisioning khóa và public half theo runbook.'),
 ('<code>JOB_HMAC_SECRET</code>','Server only','≥32 ký tự; khớp Vault <code>mekoniq_jobs_hmac</code> của đúng môi trường.'),
 ('<code>CHANNEL_SECRET_MASTER</code>','Server only','≥32 ký tự cho channel secrets; provider credentials chỉ thêm khi bật profile tương ứng.'),
]
cloud += step('C3','Ánh xạ env và provisioning database', table(['Biến code đọc','Phạm vi','Cách cấu hình'],env_rows)+'<p>Thiết lập trong Vercel → Settings → Environment Variables của <b>mekoniq</b>; tách Preview và Production. Thay env cần redeploy. Lab static không cần các khóa Supabase này. Không đưa admin key vào biến <code>NEXT_PUBLIC_*</code> hoặc <code>VITE_*</code>.</p><p>Admin client dùng <code>createClient(url, key)</code> từ supabase-js. Supabase hỗ trợ publishable/secret keys mới; tên biến legacy trong repo không tự chứng minh key đã tương thích trên deployment. Gán đúng biến hiện đọc rồi kiểm auth/admin smoke trên Preview; không dán giá trị rút gọn có dấu “…”. <a href="https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys">Hướng dẫn chuyển API keys</a>.</p><p>Hosted migrations tạo app role <code>NOLOGIN</code>; provision LOGIN/mật khẩu riêng bằng kênh quản trị DB rồi điền pooler URL. Không áp dụng <code>supabase/seed.sql</code> local lên hosted. Giữ <code>DATABASE_ADMIN_URL</code> cho migration/test, không deploy vào app. Driver hiện đặt <code>prepare:false</code>; đối chiếu URL transaction pooler trong Dashboard Connect. <a href="https://supabase.com/docs/guides/database/connecting-to-postgres">Supabase: kết nối PostgreSQL</a>.</p><p>Giữ user/venue/membership đang có. Nếu môi trường hosted mới cần seed nghiệp vụ, provision theo quy trình owner/enrollment; <code>local:bootstrap</code> chỉ dành localhost. Cấu hình Auth Site URL/Redirect URLs theo domain thực được xem trong Vercel, không dùng URL dashboard làm Site URL.</p>')
cloud += step('C4','Áp dụng migration trước khi nâng app', '<p>Từ <code>source/</code>, operator đăng nhập Supabase CLI đúng account. Project dưới đây là project người dùng cung cấp; chỉ áp dụng sau kiểm target, backup và Preview. Lệnh apply sẽ thay đổi hosted DB.</p>'+code('''pnpm exec supabase login
pnpm exec supabase link --project-ref dinpyoxktiixgwhowxpl
pnpm exec supabase migration list --linked
pnpm exec supabase db push --dry-run
# Sau khi review danh sách pending migration và backup:
pnpm exec supabase db push''')+'<p>Snapshot repo có 15 migration SQL. Không dùng <code>--include-all</code>, reset hoặc repair history để bỏ qua mismatch chưa rõ nguyên nhân. Có schema drift thì dừng và đối chiếu trước; ưu tiên migration mở rộng tương thích app cũ. <a href="https://supabase.com/docs/guides/deployment/managing-environments">Supabase: môi trường và migration</a>.</p><p>Jobs: migration tạo Cron/pg_net; provision Vault <code>mekoniq_jobs_url</code> trỏ HTTPS <code>/internal/jobs/run</code> của source deployment và <code>mekoniq_jobs_hmac</code> khớp env. Kiểm job lease/retry/dead-letter trong smoke. Cron không là cơ chế giữ Free project luôn thức.</p>')
cloud += step('C5','Build, Preview và promote source', '<p>Chạy CI/static/tests trên commit đã chọn, tạo release manifest theo runbook. Trên project <b>mekoniq</b>, tạo Preview từ commit đó qua Git integration. Kiểm build log đúng root, dùng Supabase preview riêng; sau smoke mới promote/deploy production theo quyền team.</p>'+code('''# Local / CI trong source, dùng DB test cô lập
pnpm contracts:check
pnpm typecheck
pnpm lint
pnpm build
pnpm test:unit
pnpm test:contracts
pnpm test:integration
pnpm test:security
pnpm release:dry-run
pnpm release:verify''')+'<p>Release verifier có thể chặn khi thiếu acceptance evidence; không sửa verdict để lấy màu xanh. Workflow <code>.github/workflows/release.yml</code> có gate <code>RELEASE_DEPLOY_ENABLED</code> và protected environment. Nếu dùng workflow phải đối chiếu đúng Vercel project/env mapping và credentials CI; không giả định auto-deploy Git đã thực hiện các gate này.</p><p>Sau deploy, lấy URL công khai thực ở Domains rồi kiểm:</p>'+code('''# Thay bằng domain ứng dụng từ Vercel → Domains (không dùng URL dashboard)
SOURCE_APP_URL='https://your-source-domain.example'
curl --fail "$SOURCE_APP_URL/health/live"
curl --fail "$SOURCE_APP_URL/health/ready"''')+'<p>Smoke thêm login, tenant/RBAC, menu, publish pending→ACK, order/bill, storage và job scheduler. Một venue cloud mới chưa có enrolled coordinator có thể giữ lệnh pending; đây không tự chứng minh lỗi Supabase hoặc menu đã áp dụng.</p>')
cloud += step('C6','Build và cập nhật project Lab riêng', '<p>Project <b>mekoniq-lab</b>: repo lab, root <code>.</code>, Vite, Node 24.x, install <code>pnpm install --frozen-lockfile</code>, build <code>pnpm build</code>, output <code>dist</code>. Frontend build không yêu cầu cài native engine. File lock public được Vite xuất cùng bundle; commit lock/mirror khớp runtime release trước deploy.</p>'+code('''# Trong lab, trước push/Preview
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build''')+'<p><code>pnpm check:source</code> chạy ở môi trường có runtime artifact; clean Vercel frontend build thường không có <code>.runtime</code>. Không dùng launcher hoặc offline builder làm Vercel build. Tạo Preview, kiểm Thiết kế/Mặt bằng/Project/Import báo cáo; kiểm <code>/source-runtime.lock.json</code> và asset loading, rồi promote đúng commit.</p><p>Router hiện dùng hash (<code>/#design</code>, <code>/#twin</code>), không cần catch-all rewrite cho các hash này. Nếu sau này dùng pathname routes, thêm fallback theo <a href="https://vercel.com/docs/frameworks/frontend/vite">hướng dẫn Vite trên Vercel</a>; tránh rewrite <code>/lab/*</code> thành HTML vì đó là API.</p>')
cloud += step('C7','Phạm vi chạy mô phỏng từ cloud', '<p><b>Đã hoạt động theo kiến trúc hiện tại:</b> Vercel phục vụ frontend Lab; người dùng thiết kế, lưu project trong browser, xem/import report. Chạy mock đầy đủ qua launcher local <code>lab:mock</code> hoặc gói offline.</p><p><b>Cần phát triển/triển khai thêm để Start Simulation ngay trên domain cloud:</b> runtime service riêng có disk bền vững, session/authorization theo người dùng, HTTPS, origin/cookie/CSRF phù hợp, worker isolation, SSE và reverse proxy cùng origin cho <code>/lab/v1</code> + <code>/lab/v2</code>. Đây là kiến trúc đề xuất, chưa có remote deployment được nghiệm thu.</p><p>Vite <code>server.proxy</code> chỉ có tác dụng khi dev; build <code>dist</code> không mang proxy này lên Vercel. Source Vercel có API nghiệp vụ <code>/v1</code>, không tự cung cấp gateway <code>/lab/v2</code>. Không trỏ Lab vào source project rồi coi đó là tích hợp runtime. SQLite journal/worker lâu dài cần được thiết kế riêng; không mặc định deploy runtime loopback hiện tại như một request function.</p>')
cloud += step('C8','Rollback và dữ liệu sau deploy', '<p><b>Code:</b> ghi Deployment ID tốt gần nhất của cả hai project; promote/rollback về release tương thích schema. <b>DB:</b> rollback Vercel không rollback PostgreSQL; dùng forward fix tương thích hoặc restore có kế hoạch downtime sau diễn tập. <b>Lab:</b> giữ pin, artifact, journal và project/report export; IndexedDB thuộc từng domain/profile, không tự chuyển giữa Preview và Production.</p><p>Ghi biên bản cuối: source/Lab commit, Vercel IDs/domains, Supabase ref, migration list, env names (không values), runtime/schema hashes, smoke results và rollback target. Hosted deployment tồn tại và release đã accepted là hai thông tin cần ghi riêng.</p>')

checks = table(['Bộ kiểm đã ghi nhận','Kết quả','Giới hạn'],[(esc(c['name']),esc(c['result']),esc(c['scope'])) for c in summary['checks']])
counts = {s:sum(f['status']==s for f in features) for s in labels}
doc = f'''<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>MEKONIQ · Source & Lab — Chức năng và triển khai</title><style>{(HERE/'style.css').read_text()}</style></head><body>
<a class="skip" href="#main">Đến nội dung</a><header><a class="brand" href="#overview"><span class="mark">▥</span> MEKONIQ <small>PRODUCT / DEPLOYMENT</small></a><nav aria-label="Nội dung"><a href="#features">Chức năng</a><a href="#gallery">Màn hình</a><a href="#local">Local</a><a href="#cloud">Cloud</a><a href="#next">Tiếp theo</a></nav><button id="print">In / PDF</button></header>
<main id="main"><section id="overview" class="hero"><div><span class="eyebrow">FIELD GUIDE / 06.11.2026</span><h1>Từ vận hành nhà hàng<br>đến <em>Digital Twin.</em></h1><p class="lead">Toàn cảnh chức năng của source và Lab, ảnh chụp giao diện thực, cùng quy trình chạy local và cập nhật hai Vercel project với Supabase.</p><div class="actions"><a class="primary" href="#cloud">Mở hướng dẫn cloud ↗</a><a class="secondary" href="#gallery">Xem {len(images)} màn hình</a></div><p class="small">Một file HTML tự chứa · ảnh nhúng offline · không có khóa truy cập · không thực thi lệnh deploy</p></div><a class="hero-image" href="#shot-lab-design"><img src="{data_img('lab-design')}" alt="Ảnh chụp mới giao diện thiết kế robot trong MEKONIQ Lab"><span>LAB / Thiết kế robot · local preview</span></a></section>
<div class="stats"><div><b>30 + 24</b><span>Nhóm chức năng source / Lab</span></div><div><b>{len(images):02d}</b><span>Ảnh thực · 10 ảnh chụp mới</span></div><div><b>2 + 1</b><span>Vercel projects + Supabase</span></div><div><b>MOCK → SIM</b><span>Phần mềm đã kiểm; native còn chờ</span></div></div>
<section id="architecture"><div class="section-title"><span class="eyebrow">01 / SYSTEM MAP</span><h2>Ba nơi lưu dữ liệu. Hai cách sử dụng.</h2></div><div class="architecture"><article><span class="tag software">CLOUD BUSINESS</span><h3>source / mekoniq</h3><p>Next.js quản trị, guest web và API nghiệp vụ.</p><div class="connector">↕ DATABASE / AUTH / STORAGE</div><strong>Supabase PostgreSQL</strong><p>Tài khoản, tenant, projection đồng bộ, relay, jobs và dữ liệu cloud.</p><a href="https://vercel.com/henry-projects/mekoniq">Project source ↗</a></article><article><span class="tag software">DESIGN & EVIDENCE</span><h3>lab / mekoniq-lab</h3><p>Vite frontend: cấu hình robot, world, scenario, timeline và báo cáo.</p><div class="connector">↕ PROJECT / SAVED REPORTS</div><strong>Browser IndexedDB</strong><p>Lưu theo origin. Không có migration PostgreSQL riêng cho frontend Lab.</p><a href="https://vercel.com/henry-projects/mekoniq-lab">Project Lab ↗</a></article><article><span class="tag progress">LOCAL RUNTIME</span><h3>source runtime → Lab</h3><p>Artifact pin từ source, domain authority, orchestration và worker.</p><div class="connector">↕ JOURNAL / RUN EVIDENCE</div><strong>SQLite + evidence files</strong><p>Launcher local nối UI 4175 với runtime 4176. Remote runtime là hạng mục tiếp theo.</p><a href="#local">Chạy local ↗</a></article></div><p class="note">Tablet vận hành dùng local coordinator/native SQLite + đồng bộ lên cloud. Fixture coordinator 3451 là công cụ dev. Lab Twin và cloud business không tự dùng chung database hoặc tự đồng bộ đơn hàng.</p></section>
<section id="features"><div class="section-title"><span class="eyebrow">02 / COMPLETE CAPABILITY INVENTORY</span><h2>Chức năng có gì, mở ở đâu, còn thiếu gì.</h2><p>F01–F30 bao phủ phạm vi nhà hàng; L01–L24 bao phủ Lab, simulation và các cổng còn mở. Số nhóm là cách tổ chức tài liệu, không phải tỷ lệ hoàn thành dự án.</p></div><div class="legend"><span class="tag software">{counts['software']} nhóm có phần mềm / kiểm local</span><span class="tag progress">{counts['progress']} nhóm chờ tích hợp / nghiệm thu</span><span class="tag todo">{counts['todo']} nhóm chưa thực hiện</span></div><div class="controls"><label>Repository<select id="repo-filter"><option value="all">Source + Lab</option><option value="source">Source</option><option value="lab">Lab</option></select></label><label>Trạng thái<select id="status-filter"><option value="all">Tất cả trạng thái</option><option value="software">Có phần mềm / kiểm local</option><option value="progress">In progress / chờ nghiệm thu</option><option value="todo">Chưa thực hiện</option></select></label><label class="search">Tìm chức năng<input type="search" id="search" placeholder="Ví dụ: cà phê, PostgreSQL, POS, ARM03…"></label><button id="reset">Bỏ lọc</button></div><p id="feature-count" role="status" aria-live="polite">{len(features)} nhóm chức năng</p><div class="feature-grid">{feature_cards()}</div><p id="no-results" hidden>Không có kết quả phù hợp.</p></section>
<section id="gallery"><div class="section-title"><span class="eyebrow">03 / SCREEN GALLERY</span><h2>Ảnh giao diện thực, có nguồn gốc.</h2><p>Nhấn ảnh để phóng to, Esc để đóng. 10 ảnh mới chụp local trên HEAD hiện tại; 11 ảnh từ fixture/evidence đã lưu. Các trang cloud quản trị trong ảnh lưu trữ vẫn giữ giao diện thực của lần chụp, không được thiết kế lại cho báo cáo.</p></div><label class="gallery-control">Lọc ảnh<select id="gallery-filter"><option value="all">Tất cả ảnh</option><option value="source">Source / cloud admin / tablet</option><option value="lab">Lab / Twin / mock</option></select></label><div class="gallery">{gallery()}</div><p class="note">Không có ảnh chụp authenticated Vercel production trong bộ này. Metadata gốc, commit và SHA-256 của từng ảnh nằm trong <code>src/platform-guide/screenshots-manifest.json</code>; bản HTML đã nhúng đầy đủ pixels để gửi độc lập.</p></section>
<section id="local"><div class="section-title"><span class="eyebrow">04 / LOCAL PLAYBOOK</span><h2>Chạy source, database và Lab trên Mac.</h2><p>Lệnh bên dưới là hướng dẫn thao tác. Mỗi nhóm ghi rõ working directory; dịch vụ chạy ở terminal riêng. Không có lệnh nào được HTML tự động thực thi.</p></div>{local}</section>
<section id="cloud"><div class="section-title"><span class="eyebrow">05 / CLOUD PLAYBOOK</span><h2>Hai Vercel project. Một Supabase project đã xác định.</h2><p>Cập nhật đúng app, đúng database và đúng revision; giữ runtime simulation tách biệt theo kiến trúc hiện tại.</p></div>{cloud}</section>
<section id="verification"><div class="section-title"><span class="eyebrow">06 / EVIDENCE & LIMITS</span><h2>Đã kiểm tới đâu?</h2><p>Trích qualification đã ghi nhận trước phiên tạo tài liệu. Không chạy lại toàn bộ suite khi chỉ tạo HTML. Source <code>{summary['testedSourceCommit']}</code>; Lab code/pin <code>{summary['testedLabCommit']}</code>, HEAD tài liệu <code>fbae7b0</code>.</p></div>{checks}<div class="hashes"><p>Runtime artifact <code>{pin['artifactSha256']}</code></p><p>Schema <code>{pin['schemaHash']}</code> · 33 schemas · protocol v1/v2 · clean export · Node 24.22.2</p></div><p>Đã có full PostgreSQL + SQLite integration ở baseline này; thông tin “PostgreSQL chưa chạy” trong báo cáo cũ đã được thay bằng kết quả 941 pass / 2 skipped. Native engine và clean target vẫn còn not_run. Không cộng test counts thành điểm production readiness.</p>{table(['Trạng thái','Ý nghĩa'], [('implemented','Đã có code trong phạm vi nêu rõ.'),('verified_mock / verified_local','Đã chạy kiểm phần mềm, fixture, doubles hoặc mock.'),('verified_native','Đã chạy ROS/Gazebo hoặc LinuxCNC thật trong môi trường được ghi nhận; chưa có ở baseline này.'),('accepted','Đủ evidence và người có thẩm quyền đã nghiệm thu release/gate.'),('not_run / blocked_external','Bài kiểm chưa chạy hoặc thiếu môi trường/người/thiết bị.'),('failed','Đã chạy và phát hiện không đạt; không thay bằng skipped.')])}</section>
<section id="next"><div class="section-title"><span class="eyebrow">07 / NEXT STEPS</span><h2>Hoàn tất đường deploy, rồi xác minh native.</h2></div><ol class="roadmap"><li><b>Đối chiếu cloud hiện tại.</b> Ghi domain, deployed commit, scopes env, region và migration history của hai project; kiểm ánh xạ env Supabase, app DB role và jobs. Giữ bản ghi deployment riêng với acceptance.</li><li><b>Smoke release pair.</b> Source login/menu/relay/bill/RBAC/jobs; Lab thiết kế/import/export/report và pin. Trước mắt dùng local launcher cho Start Simulation đầy đủ.</li><li><b>Provision hai VM.</b> Theo <a href="../../lab/docs/plans/2026-11-06-bv01-native-simulation/utm-runbook.md">UTM runbook</a>: Ubuntu 24.04 ARM64 (4 vCPU, 8 GiB, 64 GiB disk) và Debian 12 ARM64 (2 vCPU, 4 GiB, 32 GiB disk). Host 16 GiB ưu tiên chạy luân phiên; combined cần đo headroom. Cần volume ≥120 GiB và reserve host ≥20 GiB; không suy ra đã đủ từ disk snapshot cũ.</li><li><b>Qualify từng engine rồi BV01.</b> Gazebo/Nav2 FD01 trước faults; LinuxCNC terminal/QtVCP, rồi hai engine cùng run với cup/gripper observations, raw telemetry và ARM03.</li><li><b>Khép cổng phát hành.</b> Clean-machine/offline/rollback, usability ≥5 người, Linux amd64 và signing station. ARM64 VM không tự chứng minh amd64 IPC hoặc safety hardware.</li><li><b>Nếu cần simulation qua domain cloud.</b> Thiết kế và nghiệm thu runtime hosting/gateway/session/persistence trước; sau BV01/native ổn định mới mở rộng fleet capacity và ROI.</li></ol></section>
<section id="references"><div class="section-title"><span class="eyebrow">08 / SOURCES</span><h2>Nguồn và cách cập nhật tài liệu.</h2></div><div class="references"><div><h3>Repository / bằng chứng</h3><ul><li><a href="../docs/product/2026-10-30-capability-matrix.md">F01–F30: capability scope</a> — chỉ lấy phạm vi; preamble cũ không dùng để suy trạng thái hiện tại.</li><li><a href="../docs/implementation/gates/D-full-scope.md">W00–W11 / Gate D</a> và <a href="../packages/domain/src/policy/registry.ts">feature registry</a>.</li><li><a href="../../lab/docs/implementation/evidence/bv01-native-simulation/README.md">BV01 / native evidence index</a>, <a href="../../lab/docs/implementation/evidence/bv01-native-simulation/qualification-final.json">qualification</a>.</li><li><a href="../apps/cloud-web/vercel.json">Source Vercel config</a>, <a href="../../lab/vite.config.ts">Lab Vite config</a>, <a href="../docs/operations/secrets.md">env / secrets</a>, <a href="../docs/operations/supabase-free.md">jobs / Supabase</a>.</li><li><a href="../docs/operations/cloud-deployment.md">Cloud runbook cũ</a>: câu “never executed” là lịch sử lúc viết, đã được lời xác nhận cloud tồn tại của người dùng thay thế trong tài liệu này.</li></ul></div><div><h3>Tài liệu chính thức</h3><ul><li><a href="https://vercel.com/docs/monorepos/monorepo-faq">Vercel monorepo settings</a></li><li><a href="https://vercel.com/docs/frameworks/frontend/vite">Vite trên Vercel</a></li><li><a href="https://supabase.com/docs/guides/deployment/managing-environments">Supabase migrations / môi trường</a></li><li><a href="https://supabase.com/docs/guides/database/connecting-to-postgres">PostgreSQL connection modes</a></li><li><a href="https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys">Publishable / secret API keys</a></li></ul><p>Tra cứu ngày 06/11/2026. Tên UI của dashboard có thể thay đổi; đọc setting thực trước apply.</p></div></div><p>Chỉnh source ở <code>artifacts/src/platform-guide/</code>, build từ source bằng <code>python3 artifacts/src/platform-guide/build.py</code>. Không sửa HTML sinh ra trực tiếp. Link repo cần workspace; toàn bộ nội dung và ảnh vẫn đọc offline khi gửi riêng HTML.</p></section>
</main><footer>MEKONIQ / SOURCE × LAB <span>Snapshot 06.11.2026 · Tài liệu chức năng & triển khai · Không chứa secret</span></footer><dialog id="lightbox" aria-labelledby="lightbox-title"><div class="dialog-bar"><h2 id="lightbox-title">Ảnh giao diện</h2><button id="close-lightbox">Đóng ×</button></div><img id="lightbox-image" alt=""><p id="lightbox-caption"></p></dialog><div id="toast" role="status" aria-live="polite"></div><script>{(HERE/'app.js').read_text()}</script></body></html>'''
OUT.write_text(doc)
(HERE / 'build-manifest.json').write_text(json.dumps(dict(file=OUT.name,features=len(features),states=counts,screenshots=len(images),commands=command_count,sourceCommit=summary['testedSourceCommit'],runtimeLock=pin,sha256=hashlib.sha256(OUT.read_bytes()).hexdigest()),indent=2)+'\n')
print(json.dumps({'file':str(OUT),'bytes':OUT.stat().st_size,'features':len(features),'screenshots':len(images),'commands':command_count}))
