"""Stage documentation from settled observed-results, never mutate producer checkouts.
Called only after raw/archive/readback freeze. Later publication heads remain distinct.
"""
from pathlib import Path
import json,hashlib,datetime,collections
b=Path(__file__).resolve().parent;active=b.parents[4];x=json.loads((b/'observed-results.json').read_text());e=Path(x['paths']['root']);stage=e/'publication-staging';repo=stage/'source';docs=repo/'docs/implementation/web-lab-to-physical/post-n1-final-recording';raw=repo/'docs/implementation/evidence/web-lab-to-physical/post-n1-final-recording';docs.mkdir(parents=True,exist_ok=True);raw.mkdir(parents=True,exist_ok=True)
assert (stage/'public-readbacks/index.json').is_file(),'EXTRACTED_PUBLIC_READBACKS_REQUIRED'
def put(path,text):path.parent.mkdir(parents=True,exist_ok=True);assert not path.exists();path.write_text(text)
def exitof(name):
 r=x['checks'].get(name);return str(r['exitCode']) if r else 'not_run'
def tests(name):
 r=x['testResults'].get(name);return f"{r['numPassedTests']} passed / {r['numFailedTests']} failed / {r['numPendingTests']} not_run" if r else 'not_run; see actual admission receipt'
def cases(name):return ', '.join(f'{v} {k}' for k,v in x['qualifications'].get(name,{}).get('caseStatusCounts',{}).items()) or 'not_run; no real candidate'
def gates(name):return '; '.join(f"{k}: {v['status']}" for k,v in x['qualifications'].get(name,{}).get('gates',{}).items()) or 'not_run; no admitted current qualification candidate'
mockfailed=', '.join(r['id'] for r in x.get('mockRegression',{}).get('commands',[]) if r.get('exitCode')!=0) or 'none recorded'
mockfailuretext='The complete mock retained two Source unit failures in the bounded child-output tests: empty output instead of `retained` under the 100 ms timeout fixture, and empty output instead of `started` under the 150 ms abort fixture. Its Source engineering row also failed the amr-delay intent test (stored `STACK_TRACE_ERROR`, about 8033 ms; static fixture bound 8000 ms) and the operator-restart test (`awaiting_operator` instead of `observed_transition`). These native-provider tests use transport doubles, not a Linux/hardware qualification run. The four actual failures are not classified as flaky or repaired. No retry, deadline relaxation or new product fix/review wave was applied; later dependency admission uses this failed upstream unchanged.' if x.get('mockRawTestFailures') else 'No raw Source assertion failure was recorded.'
mockskips='; '.join(r['id']+': '+str(r.get('summary',{}).get('skipped',0))+' not_run' for r in x.get('mockRegression',{}).get('runs',[]) if (r.get('summary') or {}).get('skipped',0)) or 'No skipped raw row reported'
r3=x.get('r3Preparation',{});r3text=f"{r3.get('actualCandidates',0)} of 6 actual candidates; {r3.get('actualOwn0',0)} of 36 required invocations own exit 0; {len(r3.get('missingInvocations',[]))} missing / {len(r3.get('nonzeroInvocations',{}))} nonzero"
supp=x.get('supplemental',{}).get('r2a',{});rows=supp.get('rows',[]);supptext=f"{len(rows)} indexed rows: {sum(r.get('exitCode')==0 for r in rows)} own exit 0, {sum(r.get('exitCode') not in [None,0] for r in rows)} nonzero, {sum(r.get('status')=='not_run' for r in rows)} not_run; exact table coverage {bool(supp.get('completeCoverage'))}"
def suite_text(s):
 r=(s.get('result') or {}).get('summary')
 return f"{s['id']}: {r['passed']} passed / {r['failed']} failed / {r['skipped']} not_run (own exit {s.get('exitCode')})" if r else s['id']+': not_run, no executed result'
fullsuites='; '.join(suite_text(s) for s in x['qualifications'].get('r2b',{}).get('suites',[])) or 'not_run; actual prerequisite refusal produced no full suite record'
partialExists=x['qualifications'].get('r2a-partial',{}).get('exists',False);fullExists=x['qualifications'].get('r2b',{}).get('exists',False)
partialLabel='Genuine R93 partial R2a' if partialExists else 'R93 R2a admission refused; no candidate'
partialLimit='Missing suites remain missing; supplemental rows never spliced into candidate' if partialExists else 'Actual current R1.1 lineage refused/missing; no current partial qualification was synthesized'
partialSupplement='Each available unchanged row ran separately and does not alter the genuine partial candidate.' if partialExists else 'Each available unchanged row ran separately. There is no current R2a candidate; these rows do not synthesize or substitute one.'
r2bLayout='The current R2b tree contains `qualification.json` and `inputs/physics`, `inputs/cell`, `inputs/web`, plus copied partial lineage and semantic-study artifacts. All listed parts are required; qualification metadata alone cannot reconstruct it.' if fullExists else 'No current R2a or R2b qualification candidate was produced after the genuine upstream refusals. There is no current R2b `qualification.json`/full input tree to extract or read. Any emitted refusal-directory bytes are not a candidate. Payload, cell, study and web records remain independent archived trees with their own actual reader scope. The old Source 981 full R2b tree is a separately identified historical record at its own exact reader, never a substitute for a current candidate.'
r2bReaderIntro='Read the complete verified current R2b reassembly at clean exact Source 0d:' if fullExists else 'Future-only R2b reader example: use these entry points only after a separately authorized normal recorder has produced a real complete candidate and its exact matching reader is checked out. They were not run on an absent current candidate. For the old Source 981 candidate, use its unchanged historical guide/reader, not Source 0d:'
status=f'''# Current recording after N1

Observed on 16 November 2026 at clean Source `{x['paths']['producerSource']}` / Lab `{x['paths']['producerLab']}`, runtime `{x['paths']['runtimeArtifact']}`, build `{x['paths']['buildSha256']}` (200 files). The full R3 checker is `6f464a9b4968f9270435a393539a16c42dbbfa4c9890a45cea62a7d8894392c3`. Later publication commits add documentation/evidence and do not retag these producers or export a new runtime. All candidates retain `accepted:false`; simulation remains `not_calibrated`.

The web flow and stored replay are available locally. The current 185-second production capture is **invalid**, so it does not qualify live smoothness or real-time 1×. Its measured rate is **0.366375×** at selected 1×. Actual draw interval p95 is **18.3 ms** against 33 ms, worker IPC p95 **7.198542 ms** against 15 ms, final-step receipt bound about **59.8 ms** against 500 ms, and click-to-paused UI about **91.5 ms**. These are separate measurements; HTTP timings are observed bounds, not internal Source commit timestamps.

The normal producer completed with exit 0 and cleanup complete, but the unchanged public reader returned exit 1 with exactly `CAPTURE_PAUSE_CORRELATION`, `CAPTURE_STREAM_GAP` and `CAPTURE_RENDER_PROGRESSION`. The recorded request begins 5.21484375 ms before the recorded click; one actual draw gap is 716.4 ms and the corresponding advancing-horizon gap is 869.8 ms. The underlying scheduling/instrumentation cause is unassigned. No unchanged repeat, threshold relaxation or additional fix wave was used. The final paused/stable/exported view is H3454, served 1; this does not show a complete two-cup live mission. Four minutes remains a guided replay narrative.

A [bounded read-only root observation](retention/sdd/README/root-post-n1-capture-residual-observations.json) correlates the H783→784 gap with a 1077 ms gap between worker ACKs and about 1066 ms before the next same-process request. Two near-sequential recorded sync waits were about 337 ms and 460 ms while browser sampling and successful display requests continued. This is consistent with progress waiting on persistence and the bounded display refusing invented poses; it does not establish OS/storage causation or justify weakening durability. The pause check compares browser performance epoch with Playwright network timing without a measured clock-offset calibration, so the negative 5 ms alone does not show Source acting before the user event. Future investigation should measure the durability path and validate a common click/dispatch/network clock under a separately declared scope. No correction or retry was applied here.

The current same-build closed browser passed 1 case and strict replay/story passed 5 cases, each with own receipts and cleanup. The distinct public stock launcher/full unchanged browser case also passed with health 200 and owned cleanup. The functional closed case passed, but the mandatory public browser-artifact reader separately rejects `WEB_BROWSER_INVOCATION`: the normal producer records explicit `--output <owned browser-artifacts>` arguments while the unchanged reader expects exact argv without that selector. The other invocation/result-hash/metadata fields match. No raw argument normalization, guard change or rerun was applied; browser execution is not accepted artifact qualification. Their VI/JA/EN, viewport 390/1024/1440, keyboard, reduced-motion/2D, axe and blanket offline-denial assertions retain their actual scope. They do not override the failed production capture, establish cold boot/new-host installation, or qualify every browser.

| Recorded scope | Actual current result | Limit |
|---|---|---|
| Payload campaign | Recorder {exitof('payload-campaign')}; verifier {exitof('verify-payload-campaign')}; 19 registered cases | Nominal seeds and explicit faults, no calibration/robustness extrapolation |
| Corrected physical evidence row | {tests('mj-evidence-result.json')}; public row readback {exitof('mj-evidence-row-readback')} | Exact two executed files; generic cloud payload remains separately required |
| Shared cell campaign | Recorder {exitof('cell-campaign')}; verifier {exitof('verify-cell-campaign')}; 8 registered cases | Three nominal seeds and five registered faults, shared modeled engine |
| Complete mock | Recorder {exitof('mock-regression')}; acceptance {tests('mock-acceptance-tests.json')} | Offline mock journeys are separate from physics/native installation |
| Official IR-SIM | Recorder {exitof('record-irsim')}; campaign verifier {exitof('verify-irsim-campaign')}; {tests('acceptance-irsim.json')} | Actual isolated Lab/default output, inherited XML limits retained |
| Normal R1 | Recorder {exitof('record-r1')}; {cases('r1')} | External guard {exitof('acceptance-r1-external')}; exact data-only legacy staged guard {exitof('acceptance-r1-staged')} |
| Normal R1.1 | Recorder {exitof('record-r11')}; {cases('r11')} | External guard {exitof('acceptance-r11-external')}; staged guard {exitof('acceptance-r11-staged')} |
| {partialLabel} | Recorder {exitof('record-r2a-partial')}; {cases('r2a-partial')} | {partialLimit} |
| Three-engine X01 study | Own invocation {exitof('semantic-study')} | Actual IR-SIM/Webots/MuJoCo observations; no engine ranking/statistical/calibration claim |
| Full R2b | Recorder {exitof('record-r2b-full')}; {cases('r2b')} | Public reader {exitof('readback-r2b-full')}; {tests('acceptance-r2b-full.json')} |
| Six R3 profiles | {r3text} | `image:null`, `nativeReady:false`, native/physical `not_run`, `accepted:false` |

{mockfailuretext} Failed mock commands: {mockfailed}.

The current R1 Webots journey also failed after Run: `Simulation · not run` remained instead of `Simulation · not calibrated` within the unchanged 5-second expectation. The separate fleet case passed. No underlying admission cause is assigned. Its failed JSON/log and six pre-Run assembly images survive, but the referenced failure PNG and error-context Markdown were already absent at first default-directory inspection after the next internal spec reused that directory. The owner had scheduled default preservation after the complete recorder and did not capture those two files before reuse; no original bytes/hash are invented. Later isolated-default copies preserve only what actually survived. This concrete gap is indexed separately from the five privacy exclusions.

The normal mock recorder used `physical-robot-lab` without `--ci`; it is not full service-backed CI or fresh-host qualification. Its raw skipped rows remain separate: {mockskips}. Required absent result/prerequisite entries retain their actual manifest `notRun` reasons; acceptance-test counts do not erase them.

The independent R2a supplemental table has {supptext}. {partialSupplement} Container prerequisites remain not_run.

Full-recorder suite summaries: {fullsuites}. These are separate actual file/process scopes, not additive unique coverage.

Full R2b gates: {gates('r2b')}. Current upstream lineage/admission outcomes, required owned-service/cloud scopes, unavailable container image and unassigned HTTPS host keep their own actual failed/not_run or blocked_external states. A refused admission does not create a partial or full qualification candidate. Passing supplemental suites and browser counts cannot repair those records. See [the machine-readable results](../../evidence/web-lab-to-physical/post-n1-final-recording/observed-results.json) for exact cases, suites and original receipts, and [the archive index](../../evidence/web-lab-to-physical/post-n1-final-recording/index.json) for complete retained bytes and extracted outcomes.

The retained whole-branch review, consolidated I1–I4 correction, scoped review and bounded N1 follow-up are historical verdicts at their recorded tuples and inspected scopes. They do not close the later fresh current capture failure or four unresolved mock assertions. N1 is addressed only at its reviewed shared-world receipt/control-start scope. Its 90 passing affected checks and build/export/pin checks were reused at unchanged bytes; they are not a passing verdict for all later quality gates. The unchanged navigation runner still has a separately recorded cached-control admission observation; platform-wide replay correctness is not claimed. Four deferred Minors and all native/security/controller/contact/ALG04/host gaps remain visible in [dispositions](dispositions.md).

R3 acceptance definitions repeat per profile; their execution counts are not distinct unique cases. Only the PUMA subject selects the native tool closure, while all identity snapshots retain their unchanged closure boundary. Prepared-only handoffs have no image or native proof.

The older Source 981 / Lab d4 capture remains failed under its own identity. The intermediate Source cb5 / Lab fded capture passed its public reader with 17.8 ms draw p95, 4.87 ms worker p95 and about 61 ms receipt bound, but is historical after N1. Neither is relabeled as this Source 0d / Lab 7c observation. The old 190669-byte recording report, 121 archives and current/initial readable maps stay unchanged and are referenced by exact hash in the new index.

Five explicit private originals remain external: the historical private owner DB, two full-host process JSON snapshots, full host-sleep log, and the added N1 settlement-process snapshot. Public descriptors/marked derivatives identify their exact hashes; original inventory and receipt hashes still attribute excluded originals. Indexed-public-member verification does not claim those private bytes were published. No original SQLite engine was opened. See [privacy exclusions](../../evidence/web-lab-to-physical/post-n1-final-recording/privacy-exclusions.json).

Use [reproduction](reproduce.md) for launch/replay commands and exact-reader extraction. Both hardware branches have concrete preparation below; no Linux/native, physical, human acceptance, deployment or D0/GTM launch is closed by this local handoff.
'''
put(docs/'status.md',status)
put(docs/'README.md','''# Bàn giao local sau N1

Có thể dùng local: web/shared cell MuJoCo, đổi thí nghiệm và xem lại dữ liệu đã ghi qua replay. Producer là Source `0d46403` / Lab `7c97b20`, khác commit công bố tài liệu. Browser/replay, payload 19 ca và cell 8 ca có bằng chứng riêng; sáu profile Linux/hardware mới ở mức **prepared**, chưa chạy native/phần cứng.

Case browser chạy pass không đồng nghĩa artifact reader chấp nhận: reader hiện còn từ chối argv `--output` do producer ghi khác danh sách lệnh nó đợi.

**Còn lỗi, chưa nghiệm thu:** capture 185 giây bị reader từ chối; mock còn 4 assertions thất bại; Webots journey có thêm 1 lỗi mode badge. Lineage kế tiếp giữ refusal/thiếu candidate thật, không dùng kết quả độc lập để thay thế. Các verdict review là lịch sử ở đúng tuple/scope, không đóng những lỗi ghi sau đó. `accepted:false`, `not_calibrated`; D0 chưa mở.

- [Lệnh chạy shared cell và replay](reproduce.md)
- [Kết quả hiện tại và từng failure/not_run](status.md)
- [Việc còn lại cho hai nhánh xArm và custom/PUMA](dispositions.md)
- [Readiness GTM và demo guided replay bốn phút](../../../gtm/2026-11-14-web-simulation/09-post-n1-engineering-readiness.md)

[Raw index](../../evidence/web-lab-to-physical/post-n1-final-recording/index.json), [bản đồ đầy đủ report/review](retention/current-readable-location-map.json) và [nguyên văn rulings](retention/rulings-whole-lines.md) giữ bằng chứng chi tiết. Hai file ảnh/context của lỗi journey đã thiếu trước lần kiểm default đầu tiên; khoảng thiếu được ghi rõ, ảnh trước Run không thay thế chúng. [Thế hệ cũ](../retention/full-readable-copy-map.json) giữ nguyên byte và identity lịch sử.
''')
put(docs/'dispositions.md','''# Current correction and deferred dispositions

The historical whole-branch, consolidated correction, scoped review, bounded N1 correction and follow-up review are retained at their explicit tuples/scopes through the [current readable map](retention/current-readable-location-map.json). The [whole literal rulings](retention/rulings-whole-lines.md) preserve the exception, its cost, intentional duplicates and the exact navigation boundary. Subsequent current capture and four mock assertion failures remain unresolved; review completion does not mean all quality gates or issues closed. Earlier deferred findings remain in the [complete original ledger](../retention/sdd/deferred-findings.md); new current ledger bytes are mapped without rewriting the old snapshot.

| Finding | Actual disposition |
|---|---|
| I1 shared-cell display/control | Immutable paired committed world publication, received-endpoint interpolation and priority control at existing tick/durability boundaries were reviewed. The new capture still fails three coherence predicates; no full live performance qualification is inferred. |
| I2 reclaim authority | Exact session expiry/revocation is rechecked after each await, with persisted safety/epoch ordering. Reviewed deterministic cases are retained; no real host/device authorization claim. |
| I3 physical table/result provenance | Exact two-file physical evidence selector and per-file result validation were corrected. Generic cloud payload remains required in regression. Targeted current row and normal full recorder are separate actual runs. |
| I4 capture duration/coherence | Full active wall duration is separate from draw-bearing RAF slices; cadence, source progression, correlation and gaps stay independent unchanged gates. Current raw capture fails three predicates and remains failed. |
| N1 repeated shared-world control receipt | The bounded fix separates authorized receipt lookup from a new control start. Same reviewer addressed N1 with no new scoped breakage. Earlier probe/failures and the exception/cost remain preserved. |
| Unchanged navigation admission | Existing test explicitly observes a cached control affecting a later two-tick IR-SIM batch. Unchanged and out of N1 scope; do not claim platform-wide replay repair. |
| Current capture | Three unchanged reader failures remain unresolved; bounded persistence/clock observations are follow-up pointers, not a cause proof or correction. |
| Current browser invocation evidence | The functional closed case passed, but public artifact readback rejects producer argv with explicit --output against exact expected argv without it. Original args/hash remain unchanged; not an accepted evidence bundle. |
| Current complete mock | Four actual Source assertions failed (two bounded child-output tests, two native-provider transport-double tests); full mock guard failed. No flaky/pass reclassification or timing relaxation. |
| Current R1 journey/lineage | Mode badge remained not_run after Run, while the separate fleet passed. R1 INT11/REG01 failed, gates G-INT2/G-REG1 not_run; R1.1 and later inputs preserve genuine refusals/missing lineage. No underlying browser admission cause assigned. |
| Missing journey failure attachments | PNG and error-context absent at first inspection after internal default reuse; after-whole-recorder preservation missed them. Exact references and unknown bytes/hash gap retained. Six pre-Run images are not replacements; no rerun/reconstruction. |
| M1–M4 | Negative-zero native normalization, oversized PUMA traces, untouched negative-fixture precision and inherited malformed JUnit remain deferred. JSON/process receipts support current results; no XML repair or broad native refactor was added. |
| R2a/regression admission | Current R2a admission refused and produced no candidate. Independent passing rows do not synthesize a partial candidate; failed upstream guards, skipped scopes and owned-service prerequisites retain their actual boundaries. |
| WEB05/WEB06 | Container/image and assigned HTTPS prerequisites remain separate, unavailable/unassigned; no repeated probe, provisioning or deployment. |

For xArm, assign Ubuntu 24.04 / ROS 2 Jazzy / Gazebo Harmonic, then implement/admit the actual adapter, native observer, TF/UUID and DEPSEC provenance. Collect restart recovery, planning and G2 contact evidence on that exact host/profile; check arm64 adapter availability separately. A Linux machine alone does not produce those missing proofs.

For a custom arm, keep the PUMA reference distinct from the future physical model. Assign the Debian 12 / LinuxCNC profile and produce controller-clock/synchrony, joint/cartesian, terminal trust and ALG04 traces; then bind the actual machine geometry, limits, calibration, stop/E-stop and supervised commissioning evidence. Do not substitute xArm/ROS results or the reference PUMA model for an unselected custom robot.

Six prepared packages have no image/native record, `nativeReady:false` and `accepted:false`. Security/licensing/toolchain contracts, calibration and human signatures remain required before native/physical acceptance. Lab has no robot-control route. No extra engineering review/fix wave, hardware action, deployment, spend or outreach is part of this publication.
''')
# Reproduction text is intentionally an exact-subject guide, not a new run claim.
put(docs/'reproduce.md',('''# Launch, replay and reproduce exact evidence

Launching needs sibling `workspace/{source,lab}` repositories. The four-repository `workspace/{source,lab,web,trial}` layout was used only for the workspace-wide documentation-link and ordinary-clone checks; web/trial are not required to launch the Lab. [Source producer](https://github.com/phamvuhoang/mekoniq/tree/0d4640324d7fdb2f169ed9078db2208aae61b589) and [Lab producer](https://github.com/phamvuhoang/mekoniq-lab/tree/7c97b202143dd156d8e7751dfa2bbf198d17f9b9) are distinct from later publication heads. The Lab pin is Source 0d/runtime 73ca9b. A documentation commit needs no runtime re-export. Remote GitHub access/hosting is not implied by local link/reachability checks.

From Lab with Node 24.22.2, pnpm 10.32.1, matching locked Python 3.11 environments and the installed pinned runtime:

```sh
pnpm check:source
pnpm lab:mujoco -- --mujoco-mobile
```

Open `http://127.0.0.1:4175`, pair with the one-use terminal code, choose **Coffee delivery · simulated physical cell** (`mujoco-cell`), wait for readiness and create a run. Scenario/fault changes create a new run. Play/Pause/Resume operate on observed Source state; selected 1× is a pacing request and current measured throughput is 0.366×. Lab never controls a physical robot.

For saved data, export the replay ZIP, keep it unchanged, extract into a new folder and open **Explore recordings** at `/#replay`. Import the complete folder, verify run/horizon and move the tick cursor. Missing world samples remain unavailable; final fault/KPI values do not appear at earlier cursors. The current long capture ends H3454/served 1; separate nominal headless cases are not a live two-cup demonstration. The same-build replay tests deny all `/lab` traffic and cover locales, responsive layouts and accessible interaction at their recorded scope.

A production UI can serve replay without a runtime:

```sh
pnpm build
pnpm exec vite preview --host 127.0.0.1 --port 4175 --strictPort
# http://127.0.0.1:4175/#replay
```

The actual production tests used the same Vite preview/config through its owned API. This CLI guide is not another recorded browser run. `node scripts/build-offline.mjs --out <new-directory>` creates an **offline mock** package for the matching OS/ISA, started by `./start`; it is separate from a MuJoCo/ROS/LinuxCNC worker host or a fresh-host installation qualification.

Use the [raw index](../../evidence/web-lab-to-physical/post-n1-final-recording/index.json) to select a tree and its complete member indices. Verify each archive/index SHA-256 before safe extraction with the retained `record-archive.py` helper. Its extraction rejects absolute, traversal, duplicate, undeclared and nonregular members; dependency symlinks are descriptors and are never followed/materialized. A multi-part tree preserves the full original relative paths in each part: safely extract every listed part to its own new directory, then combine the disjoint files and declared directories at one empty root. The tree-retention record identifies all parts, the exact assembled layout and every original file hash/mode. Verify the **complete** reassembled inventory before a public reader. No status, raw path or content is rewritten.

__R2B_LAYOUT__ Original and extracted outcomes have separate own receipts in the index; a timeout or different first assertion remains its actual outcome.

At a clean exact Source 0d checkout with matching lock dependencies, use the public readers:

```sh
node scripts/lab-mujoco.mjs verify --input <reassembled-payload>
node scripts/lab-mujoco.mjs verify --input <reassembled-cell>
node scripts/verify-r3.mjs <reassembled-r3-profile>
```

__R2B_READER_INTRO__

```sh
node --input-type=module -e "import {verifyR2bDirectory} from './scripts/r2b-readback.mjs'; const p=await verifyR2bDirectory(process.argv[1]); console.log(JSON.stringify(p)); process.exit(p.length?1:0)" <reassembled-r2b>
LAB_SIMEXT_EVIDENCE_DIR=<reassembled-r2b> pnpm test:acceptance -- sim-extension
```

The full R3 checker must be `6f464a9b4968f9270435a393539a16c42dbbfa4c9890a45cea62a7d8894392c3`. Strict reader checks use exact clean producer/checker checkouts; ordinary publication-head pin/contract/license/closure checks are a different boundary. Historical 89/cb5 captures use their exact historical reader commits. The old L01/874 reproduction remains [unchanged in its prior guide](../reproduce-final-recording.md).

Every campaign/whole-recorder reproduction must use fresh outputs, clean pinned producers, its required worker/GUI/service prerequisites and both historical selectors:

```sh
export MEKONIQ_RETAINED_INPUTS=<verified-prepared-corpus>/inputs.json
export MEKONIQ_RETAINED_INPUTS_SHA256=30351aae82c52171d3744d07446fc13341850da7eda155976de586493498a56f
```

Prepare that corpus using the public retained-input tool and the unchanged historical archive/index referenced by the new inventory. Do not open original authority/retained SQLite engines. Official IR-SIM/R1 Playwright defaults used a fresh isolated Lab. Surviving output was copied/indexed after each whole recorder, but the two internal R1 journey failure attachments were already absent after sequential default reuse. The exact gap has unknown original bytes/hash; later copies do not prove those missing files survived. Data-only legacy acceptance staging is an exact-code reader layout, not a clean producer or a repaired external result. A skipped suite is `not_run`; a prerequisite refusal must not create a fake candidate. No service borrowing, host setup, native/hardware or deployment action is authorized by these reproduction instructions.
''').replace('__R2B_LAYOUT__',r2bLayout).replace('__R2B_READER_INTRO__',r2bReaderIntro))
gtm='''# Readiness kỹ thuật sau N1 — 16/11/2026

Đây là bàn giao local trên hai worktree feature. Đọc [kết quả hiện tại](../../implementation/web-lab-to-physical/post-n1-final-recording/status.md), [hướng dẫn chạy/replay](../../implementation/web-lab-to-physical/post-n1-final-recording/reproduce.md) và [phạm vi còn mở](../../implementation/web-lab-to-physical/post-n1-final-recording/dispositions.md) trước khi dùng pitch. Producer là Source `0d46403` / Lab `7c97b20`; commit tài liệu sau đó có identity riêng.

Web/shared cell và replay có thể dùng local. Browser production 1 case, replay/story 5 case và public stock launcher có kết quả riêng; chúng không thay thế phép đo dài. Capture 185 giây mới bị public reader từ chối vì pause correlation, stream gap và render progression. Draw p95 18.3 ms, worker p95 7.20 ms và receipt khoảng 59.8 ms nằm trong từng ngưỡng, nhưng capture vẫn invalid. Tốc độ thực 0.366× khác lựa chọn 1×. Không quảng bá live realtime, hoàn tất hai cốc trong lượt live này, Linux/native hay phần cứng đã nghiệm thu.

Case closed browser thực thi pass nhưng public artifact reader còn trả `WEB_BROWSER_INVOCATION`: producer ghi cờ output riêng, reader hiện đòi argv không có cờ đó. Không sửa argv/raw/guard để coi pass; đây là lỗi tương thích evidence riêng với failure capture.

Demo bốn phút là **guided replay** với mốc đã chọn và dữ liệu ghi thật. Phần có thể trình bày: trạng thái công việc/cốc theo cursor, lỗi và lý do cần người xử lý, nguồn/horizon/model của bằng chứng, và các giới hạn `not_calibrated`/`not_run`. Giải thích rõ live có thời lượng riêng và kết quả campaign headless không được thay thành bằng chứng live. Capture cb5/fded từng pass là lịch sử trước N1, không retag thành producer mới.

Lượt Webots R1 journey cũng thất bại: sau Run vẫn thấy “Simulation · not run” trong khi test đợi “Simulation · not calibrated”; fleet riêng pass. Điều này khác scope MuJoCo live/replay đã pass. R1 và lineage kế tiếp giữ failure/refusal thật. Hai file PNG/error-context của journey đã mất trước lần kiểm default đầu tiên sau internal reuse; JSON/log và ảnh trước Run còn, không thay thế hai original thiếu.

Whole-branch review, sửa I1–I4, scoped review và ngoại lệ N1 giữ verdict lịch sử ở đúng tuple/phạm vi đã đọc; N1 đã qua follow-up ở scope hẹp. Capture mới và bốn assertions mock thất bại sau đó vẫn chưa được giải quyết; không nói mọi gate/issue đã đóng. Không gọi đây là sửa mọi replay/navigation path. Cả hai hướng xArm/ROS 2 và custom/PUMA/LinuxCNC có gói prepared và danh sách native cần thực chạy; một Linux host chưa đủ thay adapter/observer/TF/UUID, DEPSEC, restart/planning/contact, clock/synchrony/cartesian/terminal trust hoặc calibration/hardware.

D0 chưa mở. Docker/image, host HTTPS, service regression, native/physical và chữ ký con người giữ gate riêng. Funnel, ngân sách, traction và Việt Nam/đối tác Nhật trong kế hoạch GTM vẫn là giả thuyết để founder duyệt; không có chiến dịch, spend, outreach hoặc analytics publication mới. Giữ CTA “Xem mô phỏng 4 phút” ở scope guided replay và CTA thương mại “Đánh giá luồng phục vụ của quán”, không hứa ROI hay thay nhân sự đã được đo.

[Bộ GTM ban đầu](README.md) giữ các snapshot theo ngày. [Readiness thế hệ 981/d4](08-final-engineering-readiness.md) và toàn bộ archive/report cũ không bị viết lại. Bằng chứng mới giữ đủ kết quả thất bại/not_run và năm private-original exclusions; việc kiểm thành viên public không có nghĩa mọi dữ liệu host riêng tư đã được công bố.
'''
put(repo/'docs/gtm/2026-11-14-web-simulation/09-post-n1-engineering-readiness.md',gtm)
print('Staged 5 current handoff documents from actual settled observations; no producer checkout mutation.')
