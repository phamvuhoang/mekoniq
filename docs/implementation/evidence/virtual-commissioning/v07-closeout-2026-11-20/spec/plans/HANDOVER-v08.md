# Handover V08 — đóng đợt sửa V01–V07 ngày 20/11/2026

**Kết luận phần mềm:** các phát hiện của review V01–V07 và review toàn bộ đợt sửa đã được xử lý. Có thể bắt đầu V08 trên nhánh `r4/virtual-commissioning`. Chưa triển khai tính năng V08; mọi record vẫn `accepted:false`. Chữ ký người chấp nhận, CLD03 và hiệu chuẩn/phần cứng là các gate riêng, không được suy ra từ kết quả bên dưới.

## Checkpoint dùng để tiếp tục

| Thành phần | Revision |
| --- | --- |
| Runtime đã kiểm chứng, Lab đang pin | `34cf316b822da231b869ff052527630d8450c3c2` |
| Source sau sửa công cụ sàng lọc sao lưu | `3411b832caf74b1a390c9749146da2afb7c632bf` |
| Lab UI đã kiểm chứng | `6973aa21fc708dd99e04ebfd3051a7a193a90ace` |
| Commit pin Lab | `7357cb0845b5de626018bdcabda1b529b18f2905` |
| Schema SHA-256 | `8a1f111d006484d099f4c96d8c7d9386143998dab11ee20b83c5ba730cd2bbfd` |
| Runtime bundle SHA-256 | `90068fd8e71724e041dcc1c8aded61a36462fb8cc1d0d2b8646b49c7a7b69457` |
| Portable tools digest | `22817c6b490dc10cf4afc4107c9e8a97971ede5fe964686d6410dcb051a9956f` |

Source `3411b832` chỉ đổi công cụ retention và test của nó; các commit đóng hồ sơ tiếp theo chỉ đổi tài liệu. Runtime/schema/physics không đổi sau `34cf316b`, vì vậy giữ pin đã được kiểm chứng. Khi V08 thay runtime/schema/portable tools: commit sạch, export/import/sync rồi commit pin Lab. Không dùng HEAD của tài liệu để gán lại nguồn của một run cũ.

**Đọc trước:** [review gốc](../REVIEW-v01-v07-2026-11-20.md), [contracts](../05-contracts-and-evidence.md), [R4-A §7](../02-r4-control-chain-spec.md), [Task V08](02-workbench-faults-tray.md#task-v08--danh-mục-lỗi-chèn-có-biên-nhận-oracle-và-báo-cáo-lỗi). Bản lưu trong Git, mapping phát hiện, quyết định, review và receipt nằm ở Source `docs/implementation/evidence/virtual-commissioning/v07-closeout-2026-11-20/`. Hai repo giữ nhánh R4; không merge/push main hoặc deploy production trong đợt này.

## Các thay đổi cần biết

- Worker giữ payload đã nhận khi seq lặp; bỏ motion gửi trước enable; khởi tạo đúng slew-only; ghi target thực sự áp dụng khi disable/fault. Corpus trước sửa `edb11dd9` khóa ba luồng (mobile không drive, mobile CIL, arm không drive), mỗi luồng 43 response, chỉ chuẩn hóa bootId.
- Wheel trapezoid dùng tích phân đúng từng tick; settling tính khoảng thời gian đã quan sát. Trace manifest có schema, reader có giới hạn, mask gap và giữ prefix đã xác minh khi ghi/đọc thất bại. Catalog và admission kiểm đủ mode, plant/provider và giới hạn.
- Bench lease mặc định 60 giây **host inactivity** nhả engine, giữ tick đã xác nhận cuối và lý do thu hồi. Đây không phải fault vật lý. Cold execution bị từ chối; evidence giữ cho offline review. Volume evidence vẫn cần quota/giám sát và archive theo runbook.
- CIL/cell dựng outcome từ journal/checkpoint/stream đã kiểm; replay đủ axis/mode/seq/tick/flags/target đúng controller revision. Mỗi execution UUID chỉ được nhận một lần trong cả campaign, kể cả legacy lồng trong case; bản sao đổi tên không thể đóng gate repeat.
- Lab ràng buộc operation/proof/history với runtime và generation. Deadline 30 giây bao gồm đọc body; mất ACK không retry mutation. Late CREATE giữ khả năng phục hồi ở đúng runtime, không thay kết quả mới. Close giữ kết quả đã đọc/export/A-B, proof chưa giải quyết không bị cắt vì lịch sử quá tám mục.
- HTTP trace trả `runId` và `manifestSha256`. Lab chỉ vẽ/archive khi cả hai khớp kết quả tuning đã kiểm. Trace cùng hình dạng nhưng khác run/manifest bị từ chối và vẫn cho đọc lại.
- Bench verifier kiểm schema tuning đầy đủ, outer status và dữ liệu wheel/body bắt buộc của `bench-v2`; selector rỗng hoặc không đăng ký không được pass rỗng. `bench-v1` vẫn dùng hợp đồng lịch sử.
- Profile v1 chỉ có một nguồn tuned cho mỗi nhóm loop/limits của cả profile. Export từ trục khác bị từ chối nếu làm mất provenance còn đúng của trục cũ; retune cùng trục được phép, hoặc người dùng chủ động quay lại profile khởi điểm. Digest phân biệt các export dù id/revision trùng nhau. Không âm thầm reset gain hay phát minh format mới.

## Kiểm chứng cuối

| Kiểm tra | Kết quả và phạm vi |
| --- | --- |
| Source unit | **1.250/1.250**, 133 file, không skip, checkout sạch `34cf316b` |
| Source contracts:check / typecheck / lint / build | Tất cả exit 0 tại `34cf316b`; contract suite 121/121 ở `b74755e9`, schema/contract không đổi sau đó |
| Bench integration/campaign; durable CIL | **39/39; 17/17** sau đợt sửa cuối `dead3cc3`; runtime code này không đổi ở `34cf316b` |
| Python worker | **266/266**, không skip ở native amd64 `34cf316b`; Darwin arm64 266/266 tại `cc9dedd1`, Python/corpus không đổi sau đó |
| Lab | **769/769**, 97 file, không skip/todo; typecheck/check:source đạt tại `6973aa21`, gồm launcher và offline checks |
| TUNE04 | Control engine thật, cookie + CSRF cùng origin: **1/1**, không retry/skip tại `6973aa21`; 14 ảnh, 390/1024/1440 và ba ngôn ngữ |
| TUNE05 | Suite gain-suggest **7/7** trong full Source unit, bench tính lại suggestion từ trace/inertia đã đọc bền, UI kiểm nhãn và apply suggestion |
| Twin có pacing | Remote mock bearer 1×/16×: **1/1 tại `32f42548`**; dùng lại bằng chứng đường pacing không đổi, không ghi là đã chạy lại ở UI cuối |
| CLD01 | Image native arm64 `34cf316b`: cell completed/served 2/tick 10900; bench completed/tick 500, trace/metric hợp lệ và bench thứ hai tiến triển |
| CLD02 | Native Linux amd64 `34cf316b`: **266/266**, 0 fail/skip, 37,015 giây; 8 stage exit 0, exact source/schema/bundle khớp pin |
| CIL mới | `cil-v2`: **38/38**, 0 issue/thiếu artifact; 3 ideal-vs-legacy và 5 repeat group đạt; 5 fault phát hiện đúng, không false serve |
| Bench mới | `bench-v2`: **16/16** ghi tại `34cf316b`, verify độc lập exit 0; registry/oracle giữ nguyên |
| Công cụ retention | **7/7 tại `3411b832`**, có 24 subcase biên token và đọc một CIL thật qua bản giữ khóa công khai |

**Nguồn CIL và checker khác nhau:** 38 case thực sự chạy ở checkout sạch `b74755e9`; có 44 UUID riêng biệt kể cả 6 legacy run lồng trong case. Sau đợt sửa verifier, original và bản verification được kiểm lại bằng code `dead3cc3`/`34cf316b`, đều 38/38. Controller/physics không đổi nên không gán lại producer hoặc ghi giả một campaign mới ở `34cf316b`. Bench được ghi mới vì trace API đã đổi.

CLD02: [run 44774073866](https://github.com/phamvuhoang/mekoniq/actions/runs/44774073866), job `136419069915`, artifact `14648681745`. Host Ubuntu 24.04 / Intel Xeon Platinum 8573C / Linux x86-64 dưới Microsoft virtualization, local Docker `linux/amd64`, không dùng giả lập tập lệnh. Python 3.11.2, MuJoCo 3.17.0, NumPy 2.4.6, pytest 9.2.0. Baseline worker `a93ae08d` và corpus `edb11dd9` được ghi trên cùng host. Cả tám ca từng lỗi dưới giả lập đã đạt; chưa suy ra một nguyên nhân duy nhất cho cả tám. ZIP SHA-256 `063a3b4df7ab9ea3822505280b24f946a8b606bc0b5a9e687601e7a04ec798c9`; 30 checksum đã khớp sau tải xuống.

## Vị trí evidence và chạy lại

- CIL original: `evidence-archive/r4-cil-v2-b74755e9/`; hash SHA256SUMS `db939c3e16a7159cd7db097dceef09c2fcc39da63545bfe3062f830f12802622` (3.596 entries).
- Bench cuối: `evidence-archive/r4-bench-v2-34cf316b/`; hash SHA256SUMS `27e49434dba6ba4458238f71e1c8615cf4cfffd93861aedfab6b4b414d8d046c` (516 entries).
- Lab cuối: `lab/runs/r4-v07-closeout-final-fix/`; remote pacing: `lab/runs/r4-v07-closeout-round1/clean-remote/`.
- Log/receipt đang ở `/tmp/r4-v07-closeout-record/`; bản lưu bền là archive `r4-v07-closeout-final-record.tar.gz` trong draft bên dưới. Snapshot working-record cũ có nhãn lịch sử; `final-current-record` là snapshot đóng đợt sửa trước lần kiểm chứng chuyển giao cuối.

Từ Source, Node 24.22.2/pnpm 10.32.1:

```sh
node scripts/lab-mujoco.mjs verify --input ../evidence-archive/r4-cil-v2-b74755e9
node scripts/lab-mujoco.mjs verify --input ../evidence-archive/r4-bench-v2-34cf316b
```

Full unit cần retained catalog thật: `MEKONIQ_RETAINED_INPUTS=$PWD/../evidence-archive/retained-corpus-copy/inputs.json`, `MEKONIQ_RETAINED_INPUTS_SHA256=30351aae82c52171d3744d07446fc13341850da7eda155976de586493498a56f`. Quy trình khôi phục có trong qualification inspection. Không ghi lại vào thư mục evidence cũ.

Cổng 4175/4176 vẫn thuộc launcher phiên khác (PID 61448/61443 lúc kiểm); không dừng để chạy test. Từ Lab, chọn cặp cổng rảnh và dùng runner đã commit:

```sh
node scripts/test-irsim-e2e.mjs --same-origin --provider mujoco --mujoco-mobile --ui-port 42455 --runtime-port 42456 mujoco-control.spec.ts
```

Các test launcher dùng cổng cô lập. Python dùng `PYTHONDONTWRITEBYTECODE=1`, `-B`, pytest `-p no:cacheprovider` để không làm bẩn portable closure.

## Sao lưu, khôi phục và giới hạn

[Draft backup](https://github.com/phamvuhoang/mekoniq/releases/tag/untagged-9ea6cc5fd070a0c581c4), ID `452762939`, tag `r4-v07-evidence-backup-20261120`, cần tài khoản được phép đọc draft. Giữ unpublished. Đọc `RESTORE.md`, `ACTIVE-SHA256SUMS` và các receipt trong draft; không dùng inventory lịch sử để đòi các asset đã bị thay thế.

Review cuối phát hiện **102 khóa ký EC tạm của run mô phỏng** trong ba archive CIL đã chuyển lên draft. Không có bằng chứng lộ credential production hoặc truy cập trái phép. Original trên máy giữ nguyên. Ba archive remote chứa khóa riêng đã được gỡ **sau** khi tải lại và khôi phục bản thay thế: chỉ giữ `kty/crv/x/y`, giữ nguyên journal/chữ ký, reseal inventory và map hash trước/sau từng member. Bản sao này dùng để kiểm chứng, không thể resume hoặc ký tiếp run. Người có quyền đọc draft có thể đã tải bản cũ; gỡ asset không thu hồi được các bản đã tải.

| Archive đang dùng | SHA-256 |
| --- | --- |
| `r4-cil-v1-4b36956-verification.tar.gz` | `a32336d06aeee7de597018758ddd7cced4ce17b635bc473c1198501eb2dd053c` |
| `r4-cil-v1-5e93570-verification.tar.gz` | `07657edfa0d70a8c4168436f078362ed764f58b621297ad3e97636fa5fc90b7a` |
| `r4-cil-v2-b74755e9-verification.tar.gz` | `bea0738434628107549c9c5e14ef1b0373aaa46fc821718a0c56f16b18f953b5` |
| `r4-bench-v2-34cf316b.tar.gz` | `397cd46b11e010e0595d63d323892b5da100a32b2695aab75b33f879dd2180e0` |

Bốn archive đã được kiểm từng member sau download: **8.794 file / 1.417.514.426 byte**. Receipt ghi remote asset ID, hash archive/index, mapping và việc ba raw asset đã vắng mặt. `4b36956` là registry lịch sử cũ: checker hiện tại từ chối cả original và verification copy đúng cùng lý do `CIL_CAMPAIGN_IDENTITY`; producer checker `4b36956190caaaedadf1651714cf775a54154e54` kiểm 26/26, thêm kiểm 1.429 chữ ký trên 29 run. Không nâng record đó thành coverage mới. `5e93570` đạt 26/26 với checker sửa cuối.

**CI tổng quát chưa xanh.** Run `44774074167` ở runtime cuối có đúng 49 failure entries như `44769077141`, không thêm/bớt: Vitest 47 fail/1.153 pass/48 skip và 2 suite-load errors; Python 1 fail/393 pass/1 skip. Nguyên nhân đã kiểm gồm portable venv/corpus/sibling Lab thiếu trong hosted setup, harness/DB ownership, giả định gcloud PATH và golden bytes đa nền tảng. Full unit local có đủ prerequisite đạt 1.250/1.250. Test inventory mới phát sinh đã sửa ở `93551be8`; không nới dung sai hoặc bỏ test để đổi màu CI.

Security rộng ở `b74755e9`: 212 pass, 1 timeout test cũ, 14 skip và 4 suite setup lỗi vì thiếu DB ownership receipt. Harness riêng từ chối khởi động vì Supabase hiện hữu giữ 57423; dịch vụ đó được giữ nguyên. File test timeout chạy lại nguyên trạng đạt 4/4. Đây không phải pass của toàn suite security; raw log và cách tái hiện được giữ trong qualification inspection.

CLD03 vẫn `not_run/deploy_order_pending`; Cloud Run đang chạy baseline R2b `3d8c2a8`, không phải R4. Chữ ký chấp nhận và hardware/calibration để người có thẩm quyền thực hiện. Wheel/body comparison chỉ tại tick cuối đã kiểm; peak slip, coupling, khay V10 và hiệu chuẩn R4.5 vẫn nằm trong các task tương ứng. R4.5 chưa mở.

## Các ràng buộc V08 phải giữ

1. `seq` bằng lần trước nghĩa là không có lệnh mới, tính vào watchdog; target, enable, quickStop và faultReset đều giữ payload đã nhận. Lệnh motion gửi trước khi enabled bị bỏ, cần seq mới sau khi enabled. `command-loss` không được truyền target mới bằng seq cũ.
2. Encoder-dropout trả `positionRad:null`, `velocityRadS:null`; không điền giá trị đo cuối kèm cờ ẩn. Plan 02 đã sửa cho khớp contracts.
3. Intent được ghi trước lệnh; receipt đối chiếu sau ACK và ghi bền. Mất ACK là unknown, không gửi lại mutation hoặc respawn để tiếp tục cùng run.
4. Đọc report từ stream/journal/checkpoint đã kiểm. Không tin outcome, events hoặc cờ complete trong report rồi tự chứng minh bằng chính các trường đó. Không bỏ mẫu ở gap để metric đẹp hơn.
5. Mọi fault deadline dùng thời gian mô phỏng. Lease bench là thời hạn thu hồi tài nguyên host; expiry ghi tick đã xác nhận cuối và lý do riêng, không trở thành một drive fault giả.
6. Giữ một world MuJoCo hoạt động mỗi runtime, một request đang bay, custody thuộc Source; Lab không có đường tới phần cứng.
7. Ngưỡng, registry và oracle khóa trước campaign. Run không tham chiếu input mới giữ đường legacy; so byte chỉ trong cùng kiến trúc/build.
8. Python luôn `PYTHONDONTWRITEBYTECODE=1`, `-B`, pytest `-p no:cacheprovider`; không tạo bytecode trong portable closure.

## Thay đổi ở controller và bằng chứng cần giữ khi làm V08

- Controller nominal/torque/latency/coarse dùng chung `serve-control-v2`, `diff-drive-base-v1` revision 2, giới hạn gia tốc 1 m/s² và jerk 10 m/s³. Đường ideal là `serve-control-legacy-ideal-v1` revision 1, giữ tính tương thích legacy và không công bố jerk. Không diễn giải so sánh ideal với nhóm revision 2 thành phép thử chỉ thay drive model.
- `exhausted-route-correction` revision 1 chỉ lập lại đường khi mục tiêu còn hiệu lực, robot đã được quan sát dừng và còn ngoài dung sai đến nơi. Mọi lần thay đường giữ đồng hồ tiến triển vật lý và hạn `NO_PROGRESS`; không lấy việc phát lệnh hoặc lập kế hoạch làm bằng chứng đã di chuyển. Fault/interlock/cancel/unknown ACK không được kích hoạt tiếp tục hành trình.
- Biên lệnh lấy từ scene và actuator đã được admit. `velocityLimitRadS` của drive là ngưỡng đánh giá `OVERSPEED`, không dùng làm trần lệnh để che mất thử nghiệm lỗi CIL05.
- `cil-v2` có 38 case, gồm 15 lần chạy mobile, 15 lần lặp bao phủ cả năm experiment và 8 case cell. Case repeat/torque phải có baseline tương ứng đã verify; không được pass với mảng equivalence rỗng. `cil-v1` giữ 26 case lịch sử và không tự trở thành bằng chứng coverage mới.
- Outcome phục vụ phải dựng từ mutation journal có chữ ký và checkpoint; lệnh được replay theo controller revision và so đầy đủ axis/mode/seq/tick/flags/target. Report hot/cold dùng cùng bundle và stream đã lưu, giữ prefix khi dữ liệu hỏng. Chữ ký với key nằm trong record chứng minh tính nhất quán nội bộ; inventory được lưu độc lập bảo vệ trước việc thay cả record.
- V08 phải mở rộng replay theo ý định và receipt thực tế của từng lớp lỗi. Không so một lệnh chưa chèn lỗi với wire đã biến đổi rồi nới checker để bỏ qua sai lệch. Những trường mới vắng mặt trên run legacy phải giữ nguyên response bytes đã khóa.

## Thứ tự bắt đầu V08

- Đọc [Task V08](02-workbench-faults-tray.md#task-v08--danh-mục-lỗi-chèn-có-biên-nhận-oracle-và-báo-cáo-lỗi), R4-A §7 và contracts. Dùng checkpoint đã ghi ở đầu handover trước khi đổi code.
- Viết negative tests/schema cho lịch fault và receipt, giữ các trường mới tùy chọn trên legacy. Kiểm biên, overlap, target và campaign-only trước khi tạo engine.
- Làm từng lớp command/drive/feedback/sensor; test receipt thực tế và fixed-step timing, không ghi vào qpos/qvel. `gaussianPair` dùng stream riêng theo plan.
- Dựng FaultReport từ bằng chứng đã đọc lại; verifier chống report mutation và thiếu receipt. Khóa `fault-v1` trước recording.
- Sau mỗi commit runtime/schema/portable tools: export sạch, import/sync và commit pin Lab; chạy regression worker/bench/CIL liên quan. V09 UI fault và V10 tray vẫn là task riêng.


## Đầu vào V16 đã bổ sung

`bench-v1` giữ profile/table lịch sử; `bench-v2` dùng profile khởi điểm sau sửa và giữ 16 case/ngưỡng. Plan 04 yêu cầu verifier theo đúng phiên bản cho `--bench-record` và `--fault-campaign`, map TUNE/FLT, kiểm tuple/oracle/checksum và negative tests cho record thiếu/hỏng/accepted:true. TUNE04/TUNE05 cần artifact riêng, không suy từ 16 bench run. Guard `cloud-run` cần gắn bản bổ sung R4 với exact tuple và giữ tương thích R2a cũ.

Bắt đầu V08 bằng schema/negative tests cho fault schedule và receipt; sau đó mới chèn từng lớp command/drive/feedback/sensor. V09 UI và V10 tray vẫn là task riêng.
