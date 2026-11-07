#!/usr/bin/env python3
"""Build the VI-only 2026-11-07 guide from explicit release facts and fresh captures."""
import argparse
import base64
import hashlib
import html
import json
import re
import subprocess
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
E = html.escape
STATUSES = {'pass', 'fail', 'not_run', 'skipped', 'blocked'}
LABELS = {'software': 'Có phần mềm · phạm vi kiểm ghi riêng', 'progress': 'Còn bước kiểm / nghiệm thu', 'todo': 'Chưa thực hiện'}

def require(condition, message):
    if not condition:
        raise ValueError(message)

def string(obj, key):
    value = obj.get(key)
    require(isinstance(value, str) and bool(value.strip()), f'Missing nonempty string: {key}')
    return value

def digest(obj, key, size):
    require(re.fullmatch('[0-9a-f]{%d}' % size, string(obj, key)) is not None, f'Invalid {key}')

def timestamp(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(parsed.tzinfo is not None, 'Timestamp requires timezone')
    require(parsed.date().isoformat() >= '2026-11-07', 'Only fresh 2026-11-07 or later facts/captures allowed')
    return parsed

def validate_release(r):
    require(r.get('schemaVersion') == 1, 'release.schemaVersion must be 1')
    timestamp(string(r, 'generatedAt'))
    for repo in ['source', 'lab']:
        digest(r[repo], 'commit', 40)
        require(r[repo]['branch'] == 'main', 'Release branches must be main')
    for key, size in [('sourceCommit', 40), ('artifactSha256', 64), ('schemaHash', 64)]:
        digest(r['runtime'], key, size)
    require(r['runtime']['sourceCommit'] == r['source']['commit'], 'Runtime export must match released Source commit')
    require(bool(r['checks']), 'No release checks supplied')
    for c in r['checks']:
        for key in ['name', 'command', 'summary', 'evidence']:
            string(c, key)
        require(c['status'] in STATUSES, 'Invalid check status')
    require(len(r['deployments']) == 2 and {d['repo'] for d in r['deployments']} == {'source', 'lab'}, 'Exactly both production deployments required')
    for d in r['deployments']:
        for key in ['url', 'id', 'smoke']:
            string(d, key)
        require(d['status'] in STATUSES, 'Invalid deployment status')
        digest(d, 'commit', 40)
        require(d['commit'] == r[d['repo']]['commit'], 'Deployment commit differs from release')
        require(d['url'].rstrip('/') == {'source': 'https://www.mekoniq.app', 'lab': 'https://mekoniq-lab.vercel.app'}[d['repo']], 'Unexpected production URL')
        timestamp(string(d, 'verifiedAt'))
    require(len(r['gates']) == 5 and {g['id'] for g in r['gates']} == {'G0', 'G1', 'G2', 'G3', 'hardware'}, 'Exactly all five gates required')
    for g in r['gates']:
        require(g['status'] in STATUSES, 'Invalid gate status')
        string(g, 'reason'); string(g, 'evidence')
        if g['id'] != 'G0':
            require(g['status'] in {'not_run', 'blocked'}, 'Native/calibration/hardware gates remain open in this release')

def validate_captures(manifest, release):
    require(manifest.get('schemaVersion') == 1, 'capture.schemaVersion must be 1')
    timestamp(string(manifest, 'capturedAt'))
    images = manifest['images']
    require(bool(images), 'Fresh captures are required; no archive fallback')
    require(len({i['id'] for i in images}) == len(images), 'Duplicate screenshot IDs')
    for im in images:
        require(re.fullmatch('[a-z0-9-]+', string(im, 'id')) is not None, 'Invalid screenshot ID')
        for key in ['title', 'url', 'scope', 'file']:
            string(im, key)
        require(im['repo'] in {'source', 'lab'}, 'Invalid screenshot repository')
        require(im['environment'] in {'production-public', 'local-fixture', 'local-compiler-preview'}, 'Unknown capture environment')
        timestamp(string(im, 'capturedAt')); digest(im, 'revision', 40); digest(im, 'sha256', 64)
        require(im['revision'] == release[im['repo']]['commit'], 'Capture revision differs from release')
        require(im.get('runtimePin') is None or im['runtimePin'] == release['runtime']['sourceCommit'], 'Capture runtime pin mismatch')
        require(type(im['width']) is int and type(im['height']) is int and min(im['width'], im['height']) > 0, 'Invalid screenshot dimensions')
        p = (HERE / im['file']).resolve()
        require(p.is_relative_to((HERE / 'screenshots').resolve()), 'Screenshot file must be under screenshots/')
        data = p.read_bytes()
        require(hashlib.sha256(data).hexdigest() == im['sha256'], 'Screenshot digest mismatch: ' + im['id'])
        require(p.suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp'}, 'Unsupported screenshot format')
        im['_data'] = 'data:image/' + ({'.jpg': 'jpeg'}.get(p.suffix.lower(), p.suffix.lower()[1:])) + ';base64,' + base64.b64encode(data).decode()
    require({'source', 'lab'} <= {i['repo'] for i in images}, 'Capture both Source and Lab')
    return images

COMMANDS = []
def code(text):
    text = text.strip()
    # Parse shell syntax only. Never run these operational examples.
    subprocess.run(['bash', '-n'], input=text, text=True, check=True, capture_output=True)
    COMMANDS.append(text)
    ident = 'cmd-' + str(len(COMMANDS))
    return f'<div class="codebox"><button class="copy" data-copy="{ident}">Sao chép</button><pre><code id="{ident}" data-lang="sh">{E(text)}</code></pre></div>'

def table(headers, rows):
    return '<div class="table-wrap"><table><thead><tr>' + ''.join('<th>'+E(h)+'</th>' for h in headers) + '</tr></thead><tbody>' + ''.join('<tr>'+''.join('<td>'+str(v)+'</td>' for v in row)+'</tr>' for row in rows) + '</tbody></table></div>'

def ref(path):
    # Links resolve from artifacts/<guide>.html when checked out; text remains useful offline.
    href = '../' + path[7:] if path.startswith('source/') else '../../' + path
    return f'<a href="{E(href)}"><code>{E(path)}</code></a>'

def section(ident, number, title, content):
    return f'<section id="{ident}"><div class="section-title"><span class="eyebrow">{number} / HƯỚNG DẪN 07.11.2026</span><h2>{title}</h2></div>{content}</section>'

def build(release, images):
    features = json.loads((HERE/'feature-inventory.json').read_text())
    cards = ''.join(f'<article class="feature" id="feature-{f["id"]}" data-repo="{f["repo"]}" data-state="{f["status"]}"><div class="meta">{f["repo"].upper()} / {f["id"]}<span class="tag {f["status"]}">{LABELS[f["status"]]}</span></div><h3>{E(f["title"])}</h3><p>{E(f["detail"])}</p><p class="where">Mở tại: {E(f["where"])}</p><p class="limit">{E(f["limit"])}</p><small>{E(f["source"])}</small></article>' for f in features)
    hero = next((i for i in images if i['id']=='lab-compiler-scene'), next((i for i in images if i['environment']=='local-compiler-preview'), next((i for i in images if i['repo']=='lab'), images[0])))
    env = {'production-public':'PRODUCTION · TRANG CÔNG KHAI', 'local-fixture':'LOCAL · DỮ LIỆU TỔNG HỢP', 'local-compiler-preview':'LOCAL · COMPILER PREVIEW · CHƯA CHẠY ENGINE'}
    gallery = ''.join(f'<figure id="shot-{i["id"]}" class="shot" data-shot-repo="{i["repo"]}"><a href="{i["_data"]}" class="zoom" aria-label="Phóng to: {E(i["title"])}"><img src="{i["_data"]}" alt="{E(i["title"])} — {E(i["scope"])}" width="{i["width"]}" height="{i["height"]}" loading="lazy"></a><figcaption><span class="meta">{env[i["environment"]]}</span><h3>{E(i["title"])}</h3><p>{E(i["scope"])}</p><small>{E(i["url"])}<br>{E(i["capturedAt"])}<br>Commit: {i["revision"]}<br>Runtime pin: {i["runtimePin"] or "Không dùng runtime trong ảnh này"}<br>SHA-256: {i["sha256"]}</small></figcaption></figure>' for i in images)
    content = '<section id="overview" class="hero"><div><span class="eyebrow">MEKONIQ / 07.11.2026</span><h1>Từ nhà hàng số đến <em>Physical Robot Lab.</em></h1><p class="lead">Chức năng Source và Lab, phiên bản production, ảnh chụp mới và hướng dẫn phát triển lắp ráp robot có thể truy vết.</p><div class="actions"><a class="primary" href="#physical">Tìm hiểu Physical Robot Lab</a><a class="secondary" href="#gallery">Xem ảnh thực</a></div><p class="small">Tài liệu tiếng Việt · một file HTML tự chứa · đọc offline · lệnh chỉ để sao chép</p></div>' + f'<a class="hero-image" href="#shot-{hero["id"]}"><img src="{hero["_data"]}" alt="{E(hero["title"])}"><span>{E(hero["title"])} · {env[hero["environment"]]}</span></a></section>'
    content += '<div class="stats"><div><b>F01–F30</b><span>Phạm vi nền tảng nhà hàng</span></div><div><b>A01–D04</b><span>Phần mềm và cổng vật lý tách riêng</span></div><div><b>'+str(len(images))+'</b><span>Ảnh chụp mới có SHA-256</span></div><div><b>G1–G3 mở</b><span>Chưa có native / calibration / hardware pass</span></div></div>'
    deployments = table(['Ứng dụng', 'Production / deployment', 'Revision và smoke'], [(E(d['repo']),f'<a href="{E(d["url"])}">{E(d["url"])}</a><br>{E(d["id"])}',f'<code>{d["commit"]}</code><br>{E(d["status"])} · {E(d["verifiedAt"])}<br>{E(d["smoke"])}') for d in release['deployments']])
    content += section('release','01','Phiên bản phát hành và cách đọc bằng chứng', '<p>Snapshot được đóng lúc '+E(release['generatedAt'])+'. Các dòng dưới lấy từ biên bản release; deployment thành công không tự đóng cổng vật lý. Source và Lab là hai repository, hai build và hai deployment độc lập.</p>'+deployments+'<div class="hashes"><p>Source · revision code đã kiểm cho release: <code>'+release['source']['commit']+'</code></p><p>Lab · revision code đã kiểm cho release: <code>'+release['lab']['commit']+'</code></p><p>Runtime Source pin: <code>'+release['runtime']['sourceCommit']+'</code></p><p>Artifact: <code>'+release['runtime']['artifactSha256']+'</code></p><p>Schema: <code>'+release['runtime']['schemaHash']+'</code></p></div><p>Đây là danh tính code của release đã kiểm; các commit chỉ thêm guide/evidence về sau không đồng nghĩa runtime đã được export lại hoặc acceptance đã chạy tại HEAD mới. Khi chạy lại acceptance với bằng chứng đã ghi, dùng đúng revision Source trong biên bản và runtime pin tương ứng.</p><p class="notice">Production Source phục vụ nghiệp vụ cloud. Production Lab phục vụ frontend thiết kế và xem báo cáo. Runtime loopback, compiler Python và ROS/Gazebo không tự xuất hiện trong Vite dist hoặc Source Vercel. Ảnh UI và compiler preview không chứng minh engine vật lý đã chạy.</p>')
    architecture = '<div class="architecture"><article><strong>Source · nghiệp vụ và authority</strong><p>Cloud Next.js, Supabase PostgreSQL/Auth/Storage, tablet coordinator và đồng bộ. Domain, journal, custody, compiler và admission của Lab nằm trong Source.</p></article><article><strong>Lab · thiết kế và quan sát</strong><p>Frontend Vite/Three.js, lưu dự án IndexedDB theo origin, import/export, scenario, timeline, report/replay. Assembly dùng EngineeringProjectStore riêng; legacy Designer/Twin giữ luồng tương thích.</p></article><article><strong>Runtime · tiến trình riêng</strong><p>Runtime artifact được pin từ Source. Gateway loopback có pairing, session và CSRF; SQLite journal và content store lưu run/bundle. Engineering chỉ bật khi operator cấu hình catalog và compiler.</p></article></div><p class="note">Giữ nguyên trial, robot đang vận hành và cổng 1880/1884. Các ví dụ dev dùng UI 4175 và runtime 4176. Dữ liệu browser không tự chuyển giữa localhost, Preview và Production.</p>'
    content += section('architecture','02','Nền tảng, frontend và runtime phối hợp thế nào',architecture)
    controls = '<p>Phạm vi F01–F30 giữ đủ; L01–L24 ghi chức năng Lab cũ; P01–P10 ghi phần mở rộng Physical Robot Lab. Nhãn “có phần mềm” mô tả code; kết quả kiểm thực tế nằm trong biên bản bên dưới.</p><div class="controls"><label>Repository<select id="repo-filter"><option value="all">Source + Lab</option><option value="source">Source</option><option value="lab">Lab</option></select></label><label>Trạng thái<select id="status-filter"><option value="all">Tất cả</option><option value="software">Có phần mềm</option><option value="progress">Chờ kiểm / nghiệm thu</option><option value="todo">Chưa thực hiện</option></select></label><label class="search">Tìm chức năng<input id="search" type="search" placeholder="cà phê, F29, assembly, BOM…"></label><button id="reset">Bỏ lọc</button></div><p id="feature-count" role="status" aria-live="polite">'+str(len(features))+' nhóm chức năng</p><div class="feature-grid">'+cards+'</div><p id="no-results" hidden>Không có kết quả phù hợp.</p>'
    content += section('features','03','Chức năng: có gì, mở ở đâu và giới hạn nào',controls)
    content += section('gallery','04','Ảnh mới từ production và môi trường kiểm thử','<p>Mỗi ảnh ghi môi trường, thời điểm, commit và phạm vi. Trang production công khai và trang local dùng fixture có nhãn riêng. Không dùng lại ảnh lưu trữ của hướng dẫn ngày 06/11. Nhấn ảnh để phóng to, Esc để đóng.</p><label class="gallery-control">Lọc ảnh<select id="gallery-filter"><option value="all">Tất cả</option><option value="source">Source</option><option value="lab">Lab</option></select></label><div class="gallery">'+gallery+'</div>')
    content += section('physical','05','Physical Robot Lab: từ linh kiện đến bundle bất biến',physical_content())
    content += section('task-status','06','A01–D04: code hiện có và phần qualification còn mở',task_content())
    content += section('developer','07','Hướng dẫn thêm linh kiện, mô hình và chẩn đoán',developer_content())
    content += section('workflow','08','Kiểm thử, pin runtime, export và phát hành',workflow_content())
    checks = table(['Bộ kiểm / trạng thái','Lệnh và kết quả','Bằng chứng'], [(E(c['name'])+'<br><strong>'+E(c['status'])+'</strong>', '<code>'+E(c['command'])+'</code><p>'+E(c['summary'])+'</p>',E(c['evidence'])) for c in release['checks']])
    gates = table(['Cổng','Trạng thái / phạm vi','Nguồn'],[(E(g['id']),E(g['status'])+'<p>'+E(g['reason'])+'</p>',E(g['evidence'])) for g in release['gates']])
    content += section('verification','09','Kết quả thực tế và cổng còn mở',checks+gates+'<p class="notice">pass chỉ có nghĩa trong phạm vi của dòng kiểm tương ứng. Fixture, pure Python và browser mock không được đổi nhãn thành native. Bài chưa chạy ghi not_run và blocker; assertion sai ghi fail. G1 rigid body, G2 contact manipulation, G3 measured calibration và hardware acceptance vẫn mở.</p>')
    content += section('next','10','Công việc tiếp theo và nguồn đối chiếu',remaining_content())
    footer = '<footer>MEKONIQ / SOURCE × LAB <span>07.11.2026 · Tiếng Việt · Ảnh mới · Offline</span></footer><dialog id="lightbox" aria-labelledby="lightbox-title"><div class="dialog-bar"><h2 id="lightbox-title">Ảnh giao diện</h2><button id="close-lightbox">Đóng ×</button></div><img id="lightbox-image" alt=""><p id="lightbox-caption"></p></dialog><div id="toast" role="status" aria-live="polite"></div>'
    nav = ''.join(f'<a href="#{i}">{t}</a>' for i,t in [('features','Chức năng'),('gallery','Ảnh'),('physical','Vật lý'),('developer','Phát triển'),('verification','Bằng chứng')])
    return '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>MEKONIQ · Source & Physical Robot Lab · 07.11.2026</title><style>'+ (HERE/'style.css').read_text()+'</style></head><body><a class="skip" href="#main">Đến nội dung</a><header><a class="brand" href="#overview"><span class="mark" aria-hidden="true">▥</span> MEKONIQ <small>FIELD GUIDE / 07.11</small></a><nav aria-label="Nội dung">'+nav+'</nav><button id="print">In / PDF</button></header><main id="main"><noscript><p class="notice">JavaScript đang tắt. Toàn bộ nội dung, ảnh và lệnh vẫn đọc được; dùng liên kết ảnh để xem lớn và chọn văn bản để sao chép.</p></noscript>'+content+'</main>'+footer+'<script>'+(HERE/'app.js').read_text()+'</script></body></html>'

def physical_content():
    rows = [
      ('1 · Catalog có provenance','ComponentRevision chứa identity/SKU/status, revision, links, joints, ports, tài liệu/license, model refs và tham số có đơn vị. manufacturer, measured và assumption phải được phân biệt. Digest canonical khóa nội dung; blob tài liệu/mesh kiểm SHA-256.', 'source/packages/lab-runtime/src/engineering/catalog.ts'),
      ('2 · Resolver và topology','Kiểm frame, root, joint tree, cycle, port mating, điện áp, signal, entity binding, blob/model closure và initial penetration. Port.link xác định link chuyển động để mount đúng. Chỉ component project dùng mới đưa lỗi vào kết quả.', 'source/packages/lab-runtime/src/engineering/assembly.ts'),
      ('3 · Khối lượng, inertia và tải','Tổng hợp tâm khối lượng và tensor inertia bằng biến đổi frame/định lý trục song song; payload theo rating và vùng cho phép. BOM giữ unknown khi không có báo giá hợp lệ. Không suy radius bánh từ vỏ hiển thị.', 'source/packages/lab-runtime/src/engineering/inertia.ts'),
      ('4 · Compiler duy nhất','EngineeringCompileInput chứa project + resolved assembly + runtime projection/assets + recipes. Python sinh scene/frames/BOM, URDF, SDF/world, occupancy map và cấu hình điều hướng/điều khiển từ cùng nguồn. BundleReceipt khóa project/assembly/scene/bundle digest.', 'source/robotics/simulation/compiler/engineering.py'),
      ('5 · Store và gateway','Content-addressed blobs + manifest; publish có staging, verify digest/closure, chống đường dẫn thoát root và giới hạn kích thước. Session chỉ đọc bundle/blob được cấp; reclaim được cấp lại quyền run cụ thể. Create/start/resume phải giữ identity và closure.', 'source/packages/lab-runtime/src/engineering/bundle-store.ts'),
      ('6 · Assembly và archive','Chọn reference hoặc thêm phần, mount/connect, kiểm blocker, undo/redo, tự lưu IndexedDB, export/import archive đầy đủ. Entity owner chỉ đọc; thêm phần tự gắn vào entity đầu tiên nếu có. Metadata tài sản/recipe/license/migration đi cùng snapshot, bytes theo digest. Startup restore trễ không ghi đè thao tác người dùng.', 'lab/src/ui/assembly-page.ts'),
      ('7 · Estimate và candidate','Adapter đọc component/model để chuẩn bị đầu vào drive/energy; Assembly hiện chỉ hiển thị khối lượng AMR và năng lượng dùng được danh định khi đủ dữ liệu. Engineering stability luôn trả stability:null / STABILITY_UNAVAILABLE, kể cả sau Compile; BOM đọc riêng từ bundle. Candidate khóa draft và receipt hiện tại; receipt cũ hoặc report khác digest không thành bằng chứng current.', 'lab/src/design/engineering-estimates.ts'),
      ('8 · Observation và report','Physics adapter kiểm clock/epoch/cup identity, sequence, freshness, coverage và contact window. Capability vector geometry/rigidBody/actuator/sensor/grasp/process/calibration giữ unsupported/modeled/verified theo evidence; report replay chỉ đọc.', 'source/packages/lab-runtime/src/engineering/evidence.ts'),
    ]
    body = '<p>Profile engineering mới hướng tới AMR hai bánh và trạm xArm 6/gripper/má kẹp cốc trong cùng world Gazebo. Nav2 điều hướng; MoveIt 2 lập kế hoạch; ros2_control điều khiển khớp. Source workflow giữ quyền chuyển custody và xác nhận nghiệp vụ. PUMA/LinuxCNC là profile legacy riêng.</p>'
    body += table(['Bước','Hành vi / ràng buộc','Code chính'],[(E(a),E(b),ref(c)) for a,b,c in rows])
    body += '<h3>Thao tác Assembly thực tế</h3><ol><li>Mở Lab → Assembly; chọn AMR tham chiếu FD01 hoặc nhập archive. Bảng catalog hiện family/id/status/SKU/khối lượng; đọc provenance và model trong file catalog/archive khi cần kiểm nguồn.</li><li>Kiểm entity owner đang hiển thị. Khi thêm linh kiện, UI tự gắn vào entity đầu tiên nếu có; chưa có trình sửa binding. Binding khác cần chuẩn bị trong project/archive hợp lệ. Chọn cổng mount/điện/dữ liệu rồi nối. Sửa blocker tại vị trí chỉ ra; Undo/Redo để thử cấu hình.</li><li>Lưu/xuất archive để giữ closure và metadata. Dữ liệu trình duyệt có thể bị quota hoặc bị xóa; khi save lỗi, draft trong bộ nhớ vẫn phải export được.</li><li>Pair runtime local bằng giao diện. Kiểm health có engineering_bundle_v1 rồi Compile. Preview cục bộ chỉ cho cấu trúc; scene compiler tải từ bundle mới là hình học đã biên dịch.</li><li>Đối chiếu projectDigest hiện tại với receipt; sửa draft làm receipt cũ mất hiệu lực. Xem BOM/estimates và xuất candidate với blocker còn lại.</li><li>Chỉ Start khi readiness của profile/engine đúng và receipt runnable=true. Release này compiler trả runnable=false; xem preview không tự cho phép native run.</li></ol>'
    body += '<h3>Sáu nhóm sửa trong đợt 07/11</h3><p>Validator buộc đúng dimension của process/actuator/sensor. Archive giữ assets/recipes theo snapshot, giữ license metadata dù bytes trùng; migration original/report không bị rơi. Export base64 xử lý blob lớn không spread toàn bộ bytes vào lời gọi. Restore bất đồng bộ kiểm thay đổi trước khi áp dụng. Compare có engineering identity nhưng thiếu assessment trả ENGINEERING_EVIDENCE_NOT_PASSED và KPI unavailable. Recorder tách screenshot browser/mock/offline trong output mới và đưa artifact/hash vào manifest. Kết quả kiểm từng sửa được ghi tại bảng biên bản release.</p>'
    body += '<p>'+ref('source/docs/engineering-lab/model-units.md')+' quy định process mL, mL/s, kg/m^3, degC; legacy unit 1 chỉ áp dụng đúng các trường process có tên đơn vị. Torque constant dùng N*m/A. Sensor range min/max/noise cùng unit khai báo. Không tự chuyển đổi đơn vị hoặc sửa digest catalog.</p>'
    body += '<h3>Pure physics, process và calibration</h3><p>Actuator model có saturation/torque-speed/current; arm và transfer guards kiểm phản hồi thay vì chỉ command completed. Process tích phân lưu lượng theo dt/deadline, bảo toàn nguyên liệu và đổi khối lượng cốc; nhiệt chưa quan sát phải unavailable. Những lớp portable này kiểm công thức và contract, chưa xác nhận ROS/Gazebo thực thi.</p><p>Grasp cần contact/jaw/lift/hold phủ đủ cửa sổ; release cần receiver độc lập và settling. Mẫu lặp/stale/truncated hoặc thiếu epoch/cupId không được nâng thành pass. Calibration chỉ nhận measured dataset, tối thiểu ba trial validation độc lập mỗi điều kiện, tune/validation tách nhau, unit/clock/configDigest khớp và toàn bộ observed range nằm trong miền đã kiểm. Đổi revision invalidates dữ liệu cũ; fixture không thể tự nâng capability thành verified.</p>'
    return body

TASKS = [
('A01','Schema và hợp đồng','JSON Schema strict, generated types, model/unit/range checks và engineering archive/candidate. Có boundary validation; không phải bằng chứng engine.', 'source/packages/lab-runtime/src/engineering/contracts.ts','source/tests/contracts/engineering-contracts.test.ts'),
('A02','Catalog tham chiếu','Catalog có provenance/digest/license và reference AMR/xArm/gripper/cup/process. Exact SKU, vendor mesh, ratings và báo giá thực còn thiếu ở các mục candidate/assumption.', 'source/robotics/catalog/catalog.json','source/robotics/catalog/selection.md'),
('A03','Resolver và assembly','Topology, joint/port/frame, entity binding, payload, inertia, BOM và collision sơ bộ có code. Hình học/ratings chưa đo không được nhận là calibrated.', 'source/packages/lab-runtime/src/engineering/assembly.ts','source/tests/unit/engineering-assembly.test.ts'),
('A04','Content store và API','Session-scoped compile/read/admit, digest closure, atomic publish và limits có code; test bảo mật tách khỏi qualification native.', 'source/packages/lab-runtime/src/engineering/gateway.ts','source/tests/security/engineering-bundle.test.ts'),
('B01','Môi trường native','Có profile locks/preflight/doctor/runbook; inventory package/version/digest và native target chưa qualified. Không provision VM trong đợt này.', 'source/docs/engineering-lab/native-environment.md','source/robotics/simulation/profiles/engineering-arm64.lock.json'),
('B02','Full project compiler','Sinh geometry, scene, URDF/SDF/map/config từ resolved assembly. Compiler hiện có thể inspect/preview; runtime opt-in không làm runnable=true.', 'source/robotics/simulation/compiler/engineering.py','source/robotics/simulation/tests/test_engineering_compiler.py'),
('B03','AMR profile và admission','Routing profile, engineeringRef, locked inputs, readiness và worker có code/pure tests. FD01 Nav2/rigid-body/sensor thật và raw native telemetry chưa chạy.', 'source/robotics/simulation/bridge/engineering_profile.py','source/robotics/simulation/tests/test_engineering_worker.py'),
('B04','Fidelity actuator','Torque/current/drive reference và fault/model validation có code; native motor/energy response và measured fit còn mở.', 'source/robotics/simulation/bridge/actuator_model.py','source/robotics/simulation/tests/test_actuator_model.py'),
('C01','Arm trajectory','Joint/tool/scene/limit checks và trajectory adapter có code. Vendor-compatible MoveIt/ros2_control build, observed FK/IK/TCP native chưa qualified.', 'source/robotics/simulation/bridge/engineering_arm.py','source/robotics/simulation/tests/test_engineering_arm.py'),
('C02','Contact transfer','Independent contact/grasp/receiver assessors có code và negative cases; cup contact trong Gazebo thật chưa chạy. Không teleport/parent để xác nhận custody.', 'source/packages/lab-runtime/src/engineering/physics-adapter.ts','source/robotics/simulation/tests/test_engineering_transfer.py'),
('C03','Beverage process','Flow/resource/thermal model, fault, deadline và variable cup mass có portable implementation. Chưa có calibration máy pha hoặc liquid CFD.', 'source/robotics/simulation/bridge/coffee_process.py','source/robotics/simulation/tests/test_engineering_process.py'),
('C04','BV01 orchestration','Provider routing và guards dùng chung workflow/cup ledger/recovery; restart không replay motion. Full BV01 cùng một engine với observed contacts chưa chạy.', 'source/tests/integration/engineering-physics.test.ts','source/tests/integration/engineering-profile-routing.test.ts'),
('D01','Assembly UI và persistence','Assembly route, archive, estimates, compiled viewer và history có code. Shared project toàn Designer/Twin, trình sửa entity binding, inspector trực tiếp và exploded engineering view còn chưa khép đủ.', 'lab/src/ui/assembly-page.ts','lab/src/project/engineering-store.ts'),
('D02','Evidence/report/replay','Capability vector, engineering identity, missing-evidence blocker, immutable report/compare và unavailable KPI có code; native report journey còn not_run.', 'lab/src/reports/compare.ts','lab/src/reports/engineering-view.ts'),
('D03','Package và preservation','Có exporter/importer/runtime pin, recorder --out/--suite và NR regression workflow. Kết quả lần chạy cuối đọc ở release receipt; clean-machine/offline native/signed target không tự đạt từ build host.', 'lab/scripts/record-regression.mjs','source/tests/acceptance/lab-v2-mock.acceptance.test.ts'),
('D04','Calibration','Có assessor/CLI/protocol và domain/invalidation guards. Không có measured dataset → G3 not_run; không chạy robot hoặc mua thiết bị.', 'source/packages/lab-runtime/src/engineering/calibration.ts','source/docs/engineering-lab/calibration-protocol.md'),
]

def task_content():
    return '<p>Đây là trạng thái theo code và tài liệu đọc cho hướng dẫn; checkbox “planned” trong bộ spec ngày 06/11 là lịch sử lúc viết. Không đánh đồng đã có implementation với hoàn thành task có native acceptance. Kết quả suite thực tế và full commits lấy từ release.json.</p>'+table(['Task','Đã có / phần chưa khép','Điểm vào code và test'],[(E(i)+'<br><strong>'+E(t)+'</strong>',E(d),ref(p)+'<br>'+ref(q)) for i,t,d,p,q in TASKS])

def developer_content():
    body = '<h3>1. Thêm component có thể truy vết</h3><p>Bắt đầu từ component cùng họ trong robotics/catalog/components. Khai báo id/revision, candidate/exact status và SKU nếu đã biết; tạo links với mass/center-of-mass/inertia/visual/collision và frame rõ. Khai báo joints cùng axis/limits, ports cùng link/mate/kind, voltage/data compatibility, payload/support points. Mọi Scalar ghi value/unit/provenance; assumption ghi nguyên nhân và giới hạn sử dụng. Không nhập giá hoặc rating như số thật khi chưa có nguồn.</p><p>Đưa tài liệu/mesh có quyền dùng vào documents/&lt;sha256&gt;; khai báo license/source/digest trong component. Model tham chiếu đặt models/&lt;canonical-digest&gt;.json. Tính digest bằng canonical hashJson/RFC 8785, cập nhật catalog.json và các componentDigest/model digest bị ảnh hưởng; không dùng hash của JSON pretty-print thay canonical hash. Source loadCatalog kiểm cả schema, provenance, blob/model digest; restart runtime sau đổi catalog vì catalog được cache theo process.</p>'
    body += '<p>Điểm vào: '+ref('source/packages/lab-runtime/src/engineering/catalog.ts')+', '+ref('source/packages/lab-runtime/src/engineering/contracts.ts')+', '+ref('source/robotics/catalog/components/drive-wheel-ref.json')+'. Với schema mới, chỉnh nguồn trong packages/contracts/schemas rồi regenerate/check; giữ schema v1/v2 legacy và discriminator engineering riêng.</p>'
    body += code('''# Working directory: source
pnpm contracts:generate
pnpm contracts:check
pnpm exec vitest run tests/contracts/engineering-contracts.test.ts
pnpm exec vitest run tests/unit/engineering
.venv/bin/python -m pytest robotics/simulation/tests/test_engineering_compiler.py -q''')
    body += '<h3>2. Thêm actuator, sensor hoặc process model</h3><p>Model cần id/kind/revision và tham số đúng dimension. Viết negative case cho đơn vị sai, non-finite, range đảo, noise âm, provenance thiếu và digest sai trước khi chấp nhận catalog. Actuator cần torque-speed/current/voltage/transmission và torque constant N*m/A khi khai báo. Sensor min/max/noise dùng cùng unit; process giữ rõ mL/s, density và temperature. Unit legacy 1 chỉ là convention đã tài liệu hóa cho đúng trường process. Chạy portable reference, sau đó native qualification riêng; không dùng fitted synthetic values làm measured.</p>'
    body += '<h3>3. Compile bằng runtime opt-in</h3><p>Đầu tiên export/import runtime sạch theo workflow phía dưới. Trong artifact đã export có runtime.mjs; catalog và simulation tree là đường dẫn tuyệt đối của Source được release pin. Tạo thư mục run mới, kiểm port 4176 rảnh và dùng terminal riêng. Ví dụ minh họa không tạo native backend.</p>'
    body += code('''# Working directory: thư mục runtime artifact đã export
# Đổi các đường dẫn /absolute/... theo checkout và output thực.
node runtime.mjs --port 4176 --data-dir /var/tmp/mekoniq-engineering-dev-20261107 \\
  --engineering-catalog /absolute/source/robotics/catalog \\
  --engineering-simulation /absolute/source/robotics/simulation \\
  --engineering-python /absolute/source/.venv/bin/python''')
    body += '<p>Python cần rfc8785, jsonschema, referencing, PyYAML theo requirements-dev.txt. Thiếu catalog/simulation/Python dependency phải fail rõ; health chỉ quảng bá engineering_bundle_v1 khi service khởi tạo được. Mở Lab dev ở 4175, pair qua UI, tải archive local tổng hợp, Compile và kiểm receipt + sceneDigest. Session cookie/CSRF được UI xử lý; không chép token hoặc cookie vào tài liệu, Git hoặc ảnh. Giao diện hiển thị MODEL_UNQUALIFIED/runnable=false là đúng với compiler chưa qualified.</p>'
    body += code('''# Working directory: lab, terminal riêng
pnpm dev''')
    body += '<p>Runtime opt-in và pnpm dev chạy ở hai terminal riêng để thao tác Compile thủ công qua UI. Các bài Playwright trong phần workflow bên dưới dùng preview/route fixture; chúng không là live-compiler E2E và không chạy cùng runtime/dev thủ công này.</p>'
    body += '<h3>4. Chẩn đoán theo blocker</h3>'
    body += table(['Dấu hiệu','Kiểm và xử lý'],[
      ('Không có capability / Compile tắt','Kiểm cờ opt-in và Python dependencies, catalogRoot/simulationRoot. Vercel frontend không có runtime local tự động.'),
      ('CATALOG_DIGEST_MISMATCH / MODEL_HASH_MISMATCH / BLOB_HASH_MISMATCH','So bytes với digest canonical (JSON) hoặc SHA-256 raw (blob); sửa index/ref có chủ đích, giữ revision lịch sử.'),
      ('PROVENANCE_UNRESOLVED / BLOB_UNAVAILABLE','Kiểm documentId/contentSha256 trong tài liệu component, license và closure; không bỏ validator để chạy.'),
      ('INSTANCE_UNBOUND / cycle / mount / payload','Xem path blocker, entityBindings, topology, Port.link, units, transform và rating. Sửa draft rồi compile lại.'),
      ('ENGINEERING_IDENTITY_MISMATCH / receipt cũ','Project đã sửa hoặc runtime/report khác pin; lưu draft và compile mới. Không gán receipt cũ vào draft mới.'),
      ('ENGINEERING_CLOSURE_MISSING / 403','Kiểm store manifest/blobs và ownership session; reclaim hợp lệ chỉ cấp quyền bundle run tương ứng. Không mở quyền blob toàn cục.'),
      ('MODEL_UNQUALIFIED / PROFILE_PLATFORM_MISMATCH','Compiler preview chưa đủ native capability; chạy doctor trên target Linux đúng lock. Giữ not_run khi chưa có target.'),
      ('ENGINEERING_EVIDENCE_NOT_PASSED / EVIDENCE_TRUNCATED','Kiểm assessment, manifest window/lastSequence, identity, contact coverage và clocks. KPI phải unavailable nếu evidence không đủ.'),
      ('Restore hoặc save lỗi','Export draft còn trong memory; kiểm IndexedDB/quota/schema trước retry. Không xóa legacy storage để “sửa” engineering archive.'),
    ])
    body += '<p>'+ref('source/docs/engineering-lab/native-environment.md')+' và '+ref('source/docs/engineering-lab/calibration-protocol.md')+' ghi rõ điều kiện target và dữ liệu đo. Doctor pass mới chứng minh prerequisite; test run và raw evidence mới quyết định gate tương ứng.</p>'
    return body

def workflow_content():
    body = '<p>Source và Lab chạy Git riêng. Dùng Node 24 / pnpm 10.32.1 theo lockfile. Trước release ghi HEAD, branch, dirty status và runtime lock; suite cần Postgres/Supabase phải dùng môi trường cô lập sẵn có. Không chạm trial hoặc robot operational.</p>'
    body += code('''# Working directory: source
pnpm lint
pnpm exec tsc --noEmit
pnpm contracts:check
pnpm exec vitest run tests/unit/engineering tests/integration/engineering tests/security/engineering tests/contracts
.venv/bin/python -m pytest robotics/simulation/tests -q''')
    body += '<p>Trước các bài Playwright fixture dưới đây, dừng runtime và dev server do bạn mở, để cả cổng 4175/4176 rảnh; Playwright khởi chạy dev server của nó. engineering-design kiểm preview khi không có runtime; engineering-pairing dùng route fake để kiểm session/CSRF. Hai bài này không kiểm compiler live hoặc engine native.</p>'
    body += code('''# Working directory: lab
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright test engineering-design.spec.ts engineering-pairing.spec.ts --workers=1''')
    body += '<h3>Thứ tự pin và recording</h3><ol><li>Hoàn tất fix/review/test rồi commit Source main sạch. Runtime export phải giữ Source commit, artifact SHA, schema hash và closure/license.</li><li>Export sang đường output mới; Lab import/check và commit code + config/source-runtime.lock.json trước recording.</li><li>Recorder đầy đủ dùng --ci --suite physical-robot-lab và --out mới chưa tồn tại; cần Postgres/Supabase dev sẵn sàng. Không đổi code/pin trong khi chạy. Browser/mock/offline có screenshot subdirectory riêng và manifest chứa hash mọi artifact.</li><li>Manifest đã flush mới chạy acceptance với LAB_V2_REGRESSION_DIR trỏ đúng root mới. Đọc chính xác fail/skipped/not_run; không đổi nhãn hoặc xóa evidence cũ để đạt.</li><li>Push main, build/deploy đúng hai project hiện có và ghi deployment IDs/commit/domain/smoke. Chỉ áp dụng migration đúng release runbook được duyệt; deploy frontend không tự đổi runtime hoặc đóng G1–G3.</li><li>Chụp ảnh mới trên release đã xác nhận; lưu capture metadata và release receipt rồi build guide. Giữ guide 06/11 và evidence lịch sử nguyên vẹn.</li></ol>'
    body += code('''# Working directory: source, sau commit sạch; output chưa tồn tại
node scripts/export-lab-runtime.mjs /var/tmp/mekoniq-runtime-release-20261107
# Chuyển từ repository Source sang repository Lab cùng workspace.
cd ../lab
node scripts/import-runtime.mjs /var/tmp/mekoniq-runtime-release-20261107
pnpm check:source''')
    body += '<p>Dừng tại đây: review thay đổi Lab, kiểm pin khớp artifact Source đã export rồi commit code và config/source-runtime.lock.json trong repository Lab. Chỉ chạy recorder ở khối riêng bên dưới khi cả hai repository đã sạch và danh tính release được khóa; ví dụ này không tự commit thay bạn.</p>'
    body += code('''# Working directory: lab; sau review + commit Lab code/pin, cả hai repo sạch
node scripts/record-regression.mjs --ci --suite physical-robot-lab --out /var/tmp/mekoniq-regression-20261107-fresh''')
    body += code('''# Working directory: source; recorder đã kết thúc và manifest đã flush
LAB_V2_REQUIRE_LAB_FIXTURES=1 \\
LAB_V2_REGRESSION_DIR=/var/tmp/mekoniq-regression-20261107-fresh \\
LAB_V2_MOCK_EVIDENCE=/var/tmp/mekoniq-regression-20261107-fresh/acceptance.json \\
  pnpm exec vitest run tests/acceptance/lab-v2-mock.acceptance.test.ts \\
  --reporter=default --reporter=json \\
  --outputFile=/var/tmp/mekoniq-regression-20261107-fresh/acceptance-vitest.json''')
    body += '<h3>Production và rollback</h3><p>Source build từ apps/cloud-web trong monorepo; Lab build dist từ root Lab. Đối chiếu thiết lập hiện có và deployment receipt, không tạo project thay thế. Các biến Supabase public thuộc frontend; service-role/database/job/private keys chỉ ở server environment, không nhúng HTML. Runtime vẫn cần tiến trình/disk bền vững, session/origin/CSRF và worker isolation riêng nếu muốn truy cập qua cloud.</p><p>Rollback Vercel chọn deployment tương thích của cả Source và Lab; không tự rollback PostgreSQL. Runtime giữ artifact/pin cũ, journal và run bundle; Lab export archive/report trước thay origin hoặc storage. Backup/restore DB và native clean-target/offline cần rehearsal/evidence riêng.</p>'
    body += '<h3>Bảo toàn NR01–NR12</h3><p>Giữ Designer với các bộ tính drive/energy/stability legacy và S01; các preset mock/mixed/hai AMR; recipe/scenario IDs; coffee/cup ledger và recovery; world/clock/fault; report/KPI/replay/controller import; archive/undo/redo; runtime package/offline/rollback và browser VI/JA/EN của ứng dụng. Giới hạn MVP engineering không thu hẹp profile cũ. Không đổi baseline pass thành skip để phát hành.</p><p>Nguồn: '+ref('lab/docs/specs/2026-11-06-physical-robot-lab/compatibility.md')+', '+ref('lab/docs/implementation/evidence/physical-robot-lab/compatibility.json')+', '+ref('lab/docs/plans/2026-11-07-physical-robot-lab-release.md')+'.</p>'
    return body

def remaining_content():
    rows = [
      ('Native targets / G1','Chưa provision Linux VM trong đợt này. Ubuntu 24.04 / ROS Jazzy / Gazebo Harmonic + Nav2/MoveIt/ros2_control cần inventory phiên bản/digest theo architecture, vendor/license closure, FD01 và raw physics telemetry. Lock chưa pin đủ không qualify host.'),
      ('Contact / G2','Cần arm/gripper/cup cùng world, feedback joint/TCP và contact streams, negative friction/drop/drift/restart. Full BV01 và independent receiver chưa được chứng minh bằng engine native.'),
      ('Calibration / G3','Chưa có dữ liệu đo thật. Thu thập theo policy đã định trước, ≥3 validation trials mỗi condition, đo AMR/energy/TCP/grip/dispense và kiểm uncertainty/clock/domain/configDigest.'),
      ('Shared project / inspector / exploded','Assembly có store riêng và compiled scene; cần hoàn tất đồng nhất project từ Designer đến Twin, trình sửa entity binding, inspector link/joint/port và exploded engineering view. Không lấy exploded legacy Designer làm bằng chứng phần mới.'),
      ('Stability / ratings / procurement','Engineering stability hiện chưa có kết quả: adapter luôn trả stability:null và STABILITY_UNAVAILABLE, kể cả sau Compile; Assembly chỉ hiển thị khối lượng AMR và năng lượng dùng được danh định khi đủ dữ liệu. Legacy Designer vẫn giữ các bộ tính drive/energy/stability riêng. Cần nối placement từ compiled assembly và bổ sung UI/readout, ratings của exact component, dữ liệu đo, tải thật và báo giá có ngày/nguồn. BOM hiện tại chưa là danh sách sẵn sàng mua.'),
      ('Release targets và hardware','Clean machine, OS network-off, native amd64/arm64, signed release/restore/usability còn cần evidence đúng target. Hardware driver, EtherCAT, E-stop/STO, guarded HIL, FAT/SAT và venue acceptance nằm ngoài kết luận của guide.'),
    ]
    body = table(['Việc còn mở','Điều kiện khép'],[(E(a),E(b)) for a,b in rows])
    refs = ['source/docs/product/2026-10-30-capability-matrix.md','source/docs/implementation/gates/D-full-scope.md','lab/docs/specs/2026-11-06-physical-robot-lab/README.md','lab/docs/plans/2026-11-06-physical-robot-lab/README.md','lab/docs/implementation/evidence/physical-robot-lab/README.md','source/docs/engineering-lab/model-units.md','source/docs/engineering-lab/native-environment.md','source/docs/engineering-lab/calibration-protocol.md','lab/config/source-runtime.lock.json']
    body += '<h3>Nguồn trong workspace</h3><ul>'+''.join('<li>'+ref(p)+'</li>' for p in refs)+'</ul><p>Link repository cần checkout tương ứng; toàn bộ nội dung và pixels vẫn đọc khi gửi riêng HTML. Sửa source trong artifacts/src/platform-guide-2026-11-07/, không sửa HTML sinh ra. release.json chứa facts; capture-manifest.json khóa nguồn ảnh; build-manifest.json khóa đầu vào/đầu ra và lệnh đã kiểm cú pháp.</p>'
    body += code('''# Working directory: source
python3 artifacts/src/platform-guide-2026-11-07/build.py
node artifacts/src/platform-guide-2026-11-07/verify.cjs''')
    return body

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    release = json.loads((HERE/'release.json').read_text())
    validate_release(release)
    captures = json.loads((HERE/'capture-manifest.json').read_text())
    images = validate_captures(captures, release)
    doc = build(release, images)
    default = HERE.parents[1] / 'mekoniq-platform-lab-guide-2026-11-07.html' if HERE.parent.name == 'src' else HERE / 'mekoniq-platform-lab-guide-2026-11-07.html'
    out = (args.out or default).resolve()
    out.write_text(doc)
    inputs = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [HERE/n for n in ['build.py','style.css','app.js','feature-inventory.json','release.json','capture-manifest.json']]}
    manifest = dict(schemaVersion=1, file=out.name, sha256=hashlib.sha256(out.read_bytes()).hexdigest(), inputs=inputs, screenshots=[{k:v for k,v in i.items() if not k.startswith('_')} for i in images], sourceCommit=release['source']['commit'], labCommit=release['lab']['commit'],runtime=release['runtime'],commands=COMMANDS)
    (HERE/'build-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(dict(file=str(out),bytes=out.stat().st_size,screenshots=len(images),shellBlocksSyntaxChecked=len(COMMANDS))))

if __name__ == '__main__':
    main()
