# Bàn thử servo: runbook cho người vận hành

Công cụ là `scripts/bench.mjs` (bench agent) và `scripts/record-bench.mjs` (ghép bản ghi). Spec: `robot/docs/2026-11-26-hardware-bench/02-bench-agent-spec.md` (§1, §6) và `04-contracts-and-evidence.md` (§2, §3, §7).

## 1. Công cụ là gì, không là gì

- Nó **cấp mô-men cho motor thật** khi bạn gõ mã cấp phép. Nó chỉ chạy các case đã đăng ký, trong giới hạn của hồ sơ bộ kit và dưới trần ghi cứng trong code. Không có lệnh chuyển động tự do, không có cổng mạng nhận lệnh.
- Nó **không phải chức năng an toàn**. Phần mềm dừng nhanh khi có lỗi hoặc khi bạn bấm phím, nhưng thứ bảo vệ người là nút dừng khẩn cắt nguồn động lực, độc lập với máy tính. Không case nào là thử nghiệm chức năng an toàn; `G-SAFE1` luôn `blocked_external`.
- Mọi điều bạn khai trong file phiên (nút dừng khẩn, kẹp motor, ai đấu nguồn) là **lời khai**. Phần mềm in lại để bạn đọc, kiểm hình dạng, nhưng không kiểm được nội dung.
- Bản ghi luôn `accepted:false`, `hardwareValidated:false`, `controlAuthority:false`. Chấp nhận là một sidecar `acceptance.json` do người ký viết, ràng với SHA-256 của `bench-record.json`. Công cụ không bao giờ viết sidecar đó.

## 2. Hôm nay chạy được gì

- **Chỉ slave giả** (`bus.backend: 'sim'`, kit `robotics/bench/fixtures/kit-sim-v1.json`). Kết quả mang nhãn `protocol_double`: nó kiểm giao thức, luồng phiên, từ chối và bằng chứng, **không nói gì về một drive thật**. Mọi gate phần cứng của bản ghi từ slave giả là `blocked_external`.
- Kit `soem` (bus EtherCAT thật) bị từ chối, exit 2: "the soem bus arrives with the first hardware session".
- Chưa có `KCF04` và `KCF01` (đến ở K09). Cho tới khi có, các case đo của `--suite measure` ra `not_run BENCH_ORDER_VIOLATION` sau `KCF02`, và không có bộ dữ liệu hiệu chuẩn.

## 3. Chuẩn bị máy (làm ở buổi phần cứng đầu tiên, chưa làm)

Máy bàn thử: Ubuntu 24.04, checkout đúng commit của nhánh. Các bước dưới đây **chưa chạy và chưa kiểm**; lock `robotics/bench/requirements.lock` chưa có (sinh ở K08 bằng `uv pip compile requirements.in --python-version 3.12 --generate-hashes`, như lock của các worker khác).

- [ ] `python3.12 -m venv --copies .venv-bench && .venv-bench/bin/pip install --require-hashes --no-deps -r robotics/bench/requirements.lock`
- [ ] `sudo setcap cap_net_raw,cap_net_admin,cap_sys_nice+ep "$(readlink -f .venv-bench/bin/python3)"` (quyền trên bản python của venv, không trên python hệ thống)
- [ ] Card mạng EtherCAT **không nhận IP** (tắt DHCP và IPv6 cho card đó).
- [ ] Người vận hành thuộc nhóm `dialout` (cổng nối tiếp của LiDAR và IMU).
- [ ] Luật udev đặt `latency_timer` của bộ chuyển FTDI về 1 (mặc định 16 ms).
- [ ] `node scripts/bench.mjs doctor --kit <kit>.json`: exit 0. Mục nào chưa đạt thì sửa máy, không sửa code. Lưu output.
- [ ] Trước buổi cảm biến đầu tiên trên phần cứng, các case cảm biến phải chạy không có worker bus nào (buổi đó nguồn drive tắt và không được ghi gì vào drive). Hiện `sensors` vẫn cấu hình worker bus; điều đó chỉ được chấp nhận trên slave giả.

`doctor` in một dòng JSON `{id, ok, detail}` cho mỗi mục: `node` (24), `python` (`BENCH_PYTHON` hoặc `python3`, ≥ 3.9), `worker` (worker trả lời `describe` trên kit giả), `venv` (`.venv-bench`; thiếu là bình thường trước buổi phần cứng đầu), và với kit `soem`: `nic`, `cap_net_raw`, `serial_ports`, `ftdi_latency`, `kernel` (chỉ ghi lại phiên bản và PREEMPT_RT; kernel thời gian thực chỉ bật khi số đo jitter đòi). Trên Mac các mục chỉ có ở Linux báo `ok:false`, `linux only`.

Giá trị khởi điểm, **chốt lại ở buổi phần cứng đầu** khi biết motor và drive: trần 30 rad/s và 30 % mô-men định mức (đổi trần là đổi code có review, không có cờ), chu kỳ bus 4 ms, chế độ `csv`.

## 4. Kiểm tra an toàn trước mỗi buổi có mô-men

Theo thứ tự một người đi quanh bàn:

- [ ] Aptomat trên nguồn chính; drive và motor nối đất.
- [ ] Nguồn DC: nguồn động lực và nguồn logic tách nhau; nút dừng khẩn cắt nhánh động lực. Nguồn chọn theo mục cấp nguồn và mục hãm tái sinh của manual đã ghim.
- [ ] Bộ kit 220 VAC: đấu nối do người có chuyên môn điện làm; file phiên khai `mainsQualified: true`. Thiếu thì `run` từ chối.
- [ ] Nút dừng khẩn cắt nguồn động lực của **cả hai** drive, độc lập với máy tính. Nên để nguồn logic vẫn sống khi bấm (drive ở lại trên bus, báo trạng thái). Đã thử nút hôm nay.
- [ ] Motor kẹp chặt xuống bàn. Trục trần, hoặc một đĩa nhẹ có vạch dấu. Không có gì vướng vào trục: dây, dụng cụ, tay áo.
- [ ] Một người ngồi ở bàn phím, tay với tới nút dừng khẩn. Buổi enable đầu tiên có thêm một người quan sát.
- [ ] Đọc các mục manual liệt kê trong `readManualSections` của file phiên.

Phần mềm tự giữ: `identify` chạy worker chỉ đọc; `run` đòi bản nhận dạng của đúng các số serial đang nối; giới hạn mô-men và tốc độ được ghi vào drive rồi đọc lại trước OP; mã bốn chữ số cho mỗi lần chạy có enable; phím bất kỳ trong lúc chạy gửi dừng nhanh rồi tắt enable; sau lỗi, dừng nhanh, dừng khẩn hay mất worker thì bộ case dừng và không tự chạy lại.

## 5. File phiên

`--session FILE` là bắt buộc cho `identify`, `run`, `sensors`. Mỗi buổi một file mới, sửa từ mẫu này (`BenchSessionV1`, schema `robotics/bench/schemas/bench-session-v1.schema.json`):

```json
{
  "schemaVersion": 1,
  "documentType": "bench-session",
  "operator": "Tên người ngồi ở bàn phím",
  "observer": "Tên người quan sát, hoặc null",
  "location": "Nơi đặt bàn thử",
  "startedAt": "2026-12-01T09:00:00+07:00",
  "declarations": {
    "estopCutsMotorPower": true,
    "estopTestedToday": true,
    "motorsClamped": true,
    "shaftLoad": "bare",
    "powerWiredBy": "Tên người đấu nguồn động lực",
    "mainsQualified": null,
    "readManualSections": ["mục cấp nguồn", "mục an toàn"]
  },
  "instruments": [{"id": "marker-1", "kind": "marker", "note": "vạch sơn trên trục"}]
}
```

| Trường | Ý nghĩa |
|---|---|
| `operator`, `observer`, `location`, `startedAt` | Ai, ở đâu, lúc nào. `observer` là `null` khi không có người quan sát |
| `estopCutsMotorPower` | Nút dừng khẩn cắt nguồn động lực. `false` thì `run` từ chối (`SESSION_ESTOP_REQUIRED`) |
| `estopTestedToday` | Đã bấm thử nút hôm nay |
| `motorsClamped` | Motor kẹp chặt. `false` thì `run` từ chối (`SESSION_CLAMP_REQUIRED`) |
| `shaftLoad` | `bare` (trục trần) hoặc `marker_disc` (đĩa nhẹ có vạch). Trong B1 không gắn tải |
| `powerWiredBy` | Người đấu nguồn động lực. Rỗng thì `run` từ chối (`SESSION_POWER_OWNER_REQUIRED`) |
| `mainsQualified` | `null` với DC. Bộ kit `ac_mains` cần `true` (`SESSION_MAINS_QUALIFICATION_REQUIRED`) |
| `readManualSections` | Các mục manual đã đọc trước buổi |
| `instruments` | Dụng cụ đo (`tape`, `marker`, `multimeter`, `other`); id của chúng vào lời chứng của dữ liệu đo |

File phiên được chép vào phần kết quả. Policy (`--policy FILE`, file có hash, khóa trước buổi đo) cũng do bạn chỉ định, không có đường dẫn mặc định; không nới ngưỡng sau khi thấy case trượt.

## 6. Thứ tự các buổi

Mỗi lệnh ghi một **phần** vào `--out`, ngoài mọi repository (ví dụ `~/bench-runs/2026-12-01/identity`). Thư mục đã có thì bị từ chối, trừ `run --from`.

```sh
K="--kit <kit>.json --policy <policy>.json --session <session>.json"
node scripts/bench.mjs identify $K --out ~/bench-runs/D/identity                       # chỉ đọc, không bao giờ enable
node scripts/bench.mjs run $K --identity ~/bench-runs/D/identity --suite conformance --out ~/bench-runs/D/conformance
node scripts/bench.mjs run $K --identity ~/bench-runs/D/identity --suite measure --out ~/bench-runs/D/measure
node scripts/bench.mjs sensors $K --out ~/bench-runs/D/sensors
node scripts/record-bench.mjs --identity ~/bench-runs/D/identity --conformance ~/bench-runs/D/conformance \
  [--measure …] [--sensors …] --out ~/bench-runs/D/record --candidate-id bench-D-01
node scripts/bench.mjs verify --record ~/bench-runs/D/record                            # exit 0 khi đọc lại không có issue
```

- `identify` (buổi 1) chạy worker chỉ đọc: quét bus, đọc định danh, serial, firmware, các object mà hồ sơ dựa vào, ánh xạ PDO lúc khởi động, 6502h; chấm KID02–KID05. Mâu thuẫn giữa thiết bị và tài liệu dừng buổi enable cho tới khi hồ sơ có revision mới.
- `run` đọc lại file phiên, kiểm lời khai, đòi phần nhận dạng **sạch** (KID02–KID05 đều `tested`, không thì `BENCH_IDENTITY_NOT_CLEAN` kèm danh sách, không worker nào chạy), quét bus và so serial từng vị trí với phần nhận dạng, rồi mới cấu hình và sang OP. Mỗi case có mô-men hỏi mã bốn chữ số trên màn hình: gõ đúng mã đó. Câu hỏi giữa case (ví dụ độ lệch vạch dấu) trả lời ở cùng bàn phím.
- **Thứ tự chuyển động đầu tiên là cố định: KCF02 → KCF04 → KCF01**, cả ba đạt trước mọi case khác trong cùng buổi. Buổi đo là một buổi mới (drive đã tắt nguồn, thiết lập tạm đã ghi lại), nên `--suite measure` chạy lại ba case này trước các case đo; chúng nằm trong phần `measure`. Khi một case có mặt ở nhiều phần, bản ghi lấy trạng thái tệ nhất (`failed` > `not_run` > `unsupported_by_device` > `tested`). KCF02 enable khi đứng yên (không có chuyển động nào trước khi biết drive vào và ra enable đúng); KCF04 kiểm đơn vị và chiều quay ở tốc độ bò (một hệ số đơn vị sai thì mọi tốc độ sau đó sai); KCF01 thử nút dừng khẩn ở tốc độ thấp khi đơn vị đã đúng. Phần mềm giữ thứ tự này bằng `requires` của từng case; không có cờ bỏ qua.
- `sensors`: worker cảm biến chỉ đọc; worker bus cũng được cấu hình (worker chỉ đọc không cho `step`) nhưng không có cấp phép, nên không lệnh enable nào ra bus. Chỉ chấp nhận trên slave giả (xem §3). Một case cảm biến trượt không dừng bộ (không có mô-men).
- Trong `run`, **một case trượt là bộ dừng**, dù lý do do bộ chạy hay do phép chấm của case: như §7. `not_run` và `unsupported_by_device` không dừng bộ; `requires` của case sau tự quyết.
- `measure` ghi bộ dữ liệu hiệu chuẩn vào `<out>/calibration/` khi có ít nhất một trial của KMS01 `tested`. Nhãn do phần mềm suy ra: `synthetic` khi worker chạy slave giả, `measured` chỉ khi bus thật và phiên có lời chứng.
- `record-bench` không chạy lại bộ test nào: nó tính lại verdict của từng case từ trace đã lưu, rồi đọc lại bản ghi vừa viết; có issue thì xóa output.
- JSON cấp trên của bản ghi vào `docs/implementation/evidence/bench/<candidate>/`; trace thô ở `evidence-archive/`, ngoài Git.

## 7. Khi bộ case dừng

Sau một case trượt, một lỗi, dừng nhanh, phím bấm, dừng khẩn hay mất worker, `run` dừng ngay: không case nào sau đó bắt đầu, chúng ghi `not_run SUITE_STOPPED_AFTER_<lý do>`, phần vẫn được ghi, exit 1. Công cụ không tự cấp phép lại. Nó in case dừng và lệnh chạy tiếp:

1. Tìm nguyên nhân trên bàn trước (đọc lý do, xem drive, xem dây).
2. Chạy tiếp trong cùng phần: `run … --out <cùng thư mục> --from <case đã dừng>`. Các case trước đó phải `tested` trong phần đã lưu, không thì `FROM_EARLIER_NOT_TESTED`. Kết quả cũ được giữ, case từ `--from` trở đi chạy lại và gõ mã cấp phép mới.

## 8. Chuyển động bất ngờ, mùi khét, tiếng lạ, nút dừng khẩn không cắt mô-men

Dừng tất cả: bấm nút dừng khẩn, ngắt aptomat nếu nút không cắt được. Đây không còn là việc của phần mềm. Không chạy lại, không `--from`, không sửa code để đi tiếp. Ghi lại điều đã thấy, giữ nguyên phần kết quả, kiểm phần cứng (đấu dây, nguồn, nút dừng khẩn) với người đấu nguồn. Nút dừng khẩn không cắt mô-men nghĩa là bàn thử không đạt điều kiện vào của §4 cho tới khi sửa xong và thử lại.

## 9. Mã từ chối

Exit 2: dùng sai lệnh hoặc từ chối trước khi worker chạy. Exit 1: một case không `tested`, hoặc từ chối dựa trên bằng chứng.

| Mã | Ý nghĩa | Việc phải làm |
|---|---|---|
| `MISSING_OPTION`, `INVALID_OPTION` | Thiếu tùy chọn bắt buộc, hoặc tùy chọn không có (không có `--yes`, `--force`, `--no-arm`, `--skip-identity`) | Sửa dòng lệnh |
| `BENCH_KIT_INVALID`, `BENCH_POLICY_INVALID`, `BENCH_SESSION_INVALID` | File không đúng schema hoặc digest không khớp | Sửa file; kit và policy phải niêm phong lại bằng revision mới |
| `BENCH_BUS_MISMATCH` | `--bus` khác `bus.backend` của kit | Bỏ `--bus` hoặc dùng đúng kit |
| `BENCH_BUS_UNAVAILABLE` | Kit `soem`: bus thật chưa có | Chờ buổi phần cứng đầu |
| `OUT_EXISTS` | Thư mục kết quả đã có | Chọn thư mục mới, hoặc `--from` để chạy tiếp |
| `OUTPUT_MUST_BE_OUTSIDE_REPOSITORIES` | `--out` nằm trong một repository | Ghi ra ngoài, ví dụ `~/bench-runs` |
| `SESSION_ESTOP_REQUIRED`, `SESSION_CLAMP_REQUIRED`, `SESSION_POWER_OWNER_REQUIRED`, `SESSION_MAINS_QUALIFICATION_REQUIRED` | Lời khai không cho phép mô-men | Làm cho điều đó đúng trên bàn, rồi mới sửa file phiên |
| `BENCH_IDENTITY_CHANGED` | Serial trên bus khác phần nhận dạng, phần nhận dạng của kit khác hoặc bị sửa, hoặc định danh slave khác hồ sơ | Kiểm dây và thứ tự slave; thiết bị đã đổi thì chạy `identify` lại |
| `BENCH_IDENTITY_NOT_CLEAN` | Một trong KID02–KID05 của phần nhận dạng không `tested` (danh sách kèm lý do) | Sửa hồ sơ bằng revision mới (hoặc tìm vì sao không đọc được), chạy `identify` lại |
| `FROM_EARLIER_NOT_TESTED` | `--from` mà các case trước chưa `tested` trong phần đã lưu | Chạy tiếp từ case đầu tiên chưa đạt |
| `PART_MANIFEST_MISMATCH`, `KIT_DIGEST_MISMATCH`, `POLICY_DIGEST_MISMATCH` | Phần đã lưu bị sửa, hoặc của kit hay policy khác | Không sửa tay phần kết quả; chạy vào thư mục mới |
| `BENCH_NOT_ARMED` | Không gõ đúng mã (ba lần), hoặc stdin không phải terminal | Chạy ở terminal của máy bàn thử, gõ mã hiện trên màn hình |
| `BENCH_PROMPT_UNAVAILABLE`, `PROMPT_TIMEOUT` | Case cần câu trả lời mà không có terminal, hoặc 60 s không trả lời | Chạy ở terminal; trả lời trong lúc trục được giữ |
| `OPERATOR_ABORT` | Bạn bấm phím hoặc Ctrl-C, hoặc tiến trình nhận SIGINT, SIGTERM, SIGHUP (phần vẫn được ghi) | Xem §7 |
| `UNEXPECTED_FAULT` | Drive báo lỗi ngoài kịch bản | Đọc mã lỗi của drive và manual; xem §7 |
| `HOST_TICK_LATE` | Nhịp 20 ms trễ quá `tickLatenessMaxMs`: lỗi của máy chủ | Sửa máy (quyền ưu tiên, kernel, C-state); không nới policy |
| `BENCH_STOP_INCOMPLETE` | Chuỗi dừng không đưa mọi tầng công suất về tắt | Bấm nút dừng khẩn; kiểm drive trước khi làm gì khác |
| `CASE_SCRIPT_ERROR`, `CASE_EVALUATE_ERROR` | Lỗi trong code của case | Báo lỗi phần mềm; không chạy tiếp case đó |
| `WORKER_TIMEOUT`, `WORKER_LOST`, `SENSOR_WORKER_LOST` | Worker không trả lời hoặc đã thoát; không bao giờ được thay trong một lần chạy | Kiểm máy và cáp; chạy lại bằng `--from` |
| `BENCH_ORDER_VIOLATION` | Case chạy khi case nó đòi chưa đạt, hoặc lệnh worker sai thứ tự | Chạy theo thứ tự của bộ |
| `BENCH_READ_ONLY` | Lệnh ghi hoặc enable trong phiên chỉ đọc | Đúng như thiết kế với `identify` |
| `BENCH_LIMIT_EXCEEDED` | Giới hạn của kit vượt trần, hoặc `sdoWrites` mâu thuẫn với giới hạn | Sửa hồ sơ bộ kit bằng revision mới |
| `BENCH_SDO_NOT_LISTED`, `BENCH_SDO_READBACK_MISMATCH`, `BENCH_PDO_MAP_REFUSED` | Ghi SDO ngoài danh sách, đọc lại khác giá trị ghi, drive từ chối ánh xạ PDO | Dừng; đối chiếu hồ sơ bộ kit với manual và ESI |
| `BENCH_SLAVE_COUNT` | Số slave trên bus khác số trục của kit | Kiểm dây, nguồn logic của từng drive |
| `BENCH_NOT_OPERATIONAL`, `BENCH_SYNC_LOST` | Drive không vào OP, hoặc mất đồng bộ | Kiểm chu kỳ và kiểu đồng bộ theo ESI; không nới ngưỡng của drive |
| `BENCH_PORT_UNAVAILABLE` | Không mở được cổng nối tiếp của cảm biến | Kiểm cáp, nhóm `dialout`, `doctor` |
| `SENSORS_UNAVAILABLE` | Case cảm biến chạy không có worker cảm biến | Dùng `sensors` |
| `SUITE_STOPPED_AFTER_<lý do>` | Case không chạy vì bộ đã dừng ở case trước | Xem §7 |
| `SOURCE_DIRTY` (`record-bench`) | Cây source có thay đổi chưa commit | Commit hoặc bỏ thay đổi; bản ghi gắn với một commit |
| `SESSION_DECLARATION_MISSING`, `SERIAL_SET_MISMATCH`, `VERDICT_NOT_REPRODUCED`, `RECORD_READBACK_FAILED` (`record-bench`) | Phần thiếu lời khai, các phần không cùng bộ serial, kit hay policy, verdict không tính lại được, bản ghi đọc lại có issue | Không ghép các phần đó; chạy lại buổi thiếu |
| `CHECKSUM_MISMATCH`, `FILE_MISSING`, `FILE_UNEXPECTED` (`verify`) | File của bản ghi bị sửa, thiếu hoặc thừa | Bản ghi không dùng được; lấy lại từ archive |

## 10. Biến môi trường

- `BENCH_PYTHON`: interpreter của worker (mặc định `python3`; trên máy bàn thử là `.venv-bench/bin/python`).
- `BENCH_TEST_ARMING=1` và `BENCH_TEST_ANSWERS=<file JSON promptId → câu trả lời>`: **chỉ cho test**, chỉ có tác dụng với kit slave giả; với kit `soem` công cụ bỏ qua và in ra là đã bỏ qua. Không đặt chúng trên máy bàn thử.
