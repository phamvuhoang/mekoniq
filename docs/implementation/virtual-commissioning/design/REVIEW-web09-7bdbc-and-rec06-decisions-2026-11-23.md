# Review WEB09 7bdbc1a5 và quyết định tiếp theo cho REC06 — 2026-11-23

**Kết luận:** capture mới trên Source `7bdbc1a532dc713b1a75ee2d0a164c297e9ea24d` / Lab `d76909c0ecb750560e70e62efde03464a5c84f61` chạy và đọc lại được nguyên bản. Kiểm sample hữu hạn, pass đứng yên hoàn toàn và ghost theo cursor đã hoạt động. Finding ghost của vòng trước được đóng. Hai finding trước vẫn còn một phần chưa xử lý: **P2 về tập trục/engine của bench và P2 về tiến trình bên trong một pass**. Chưa nên ghi chuỗi qualification nhiều giờ.

Review chỉ đọc implementation, chạy kiểm tra và lưu tài liệu/probe ngoài hai repo. Không thay code, pin, HEAD, requirements hoặc dữ liệu gốc; không push, deploy hay ký acceptance. Các đề xuất dưới đây không tự đưa một program/experiment revision vào registry.

## Kiểm chứng trên tuple mới

- Source: **51/51** test của `r4-web09-readback`, `r4-readback` và `r4-replay-readback`; zero failed/skipped. Không chạy lại toàn bộ CI/typecheck/lint hoặc worker suite trong lượt review này.
- Lab: `mujoco-perf.spec.ts` nguyên bản trên production build, real MuJoCo, **1/1 pass**. Command lấy trực tiếp từ `tableR4().suites`, chạy bằng `runR2bCaseCommand`, cùng hàm ghi process mà recorder production dùng.
- Process ghi trực tiếp `2026-11-23T10:48:56.171Z` → `10:52:03.217Z`. Không dựng lại ranh giới. `checkPlaywrightResult`, `checkPlaywrightProcess` và `verifyWeb09Record` đều trả **`[]`**.
- Plot: 61.008 ms, rAF p95 **16,7 ms**. Hai wheel axis thật có 5.000 mẫu đo và 10 mẫu ban đầu mỗi trục.
- Belief: 78.783,2 ms, hai pass 20 → 1950; tổng sim time 77.200 ms, tổng span 77.306,4 ms. 4.599 render, rAF p95 **16,8 ms**, render duration p95 **1,9 ms**, cadence p95 **18,6 ms**, max in-pass render gap **85,1 ms**, ghost share **82,80%**.
- Selector `beliefAt` thật của Lab thấy 791 cursor không có belief, nhưng **không có claim ghost sai** trong capture gốc. Reader mới từ chối probe đặt mọi ghost flag thành true.
- Source/Lab sạch trước/sau; không đổi HEAD. Đây là capture review, không phải qualification candidate hoặc chuỗi regression R4 mới.

[Archive](../../../../../evidence-archive/r4-web09-7bdbc-review-2026-11-23/README.md) giữ script chạy, receipt, report, package, build, test JSON, readback và các probe. Mọi mutation trong negative tests chỉ ở memory; các file gốc giữ nguyên.

## Findings còn lại

### F01 — P2: kiểm sample đã chặt hơn, nhưng chưa bắt buộc workload đúng tập trục và engine

Vị trí: [r4-web09-readback.mjs:72](../../../../scripts/r4-web09-readback.mjs#L72), đặc biệt dòng 75–76.

`axisOk` kiểm từng axis nhưng không bắt buộc danh sách khác rỗng hoặc đúng tập wheel axis của workload. Đặt `trace.traces=[]`, `report.tuning.axisIds=[]` và bỏ `samplesPerSeries`/`plottedPoints`, reader vẫn trả `[]`: `.every()` trên mảng rỗng đúng và hai vế của phép so counter đều là `undefined`. Vì vậy artifact không có điểm nào vẫn có thể đạt WEB09.

Probe khác thay `tuning.engine.id` và `manifest.backends` thành mock, giữ backend-set ID, cũng trả `[]`. Đây là mâu thuẫn giữa các claim trong workload mà reader chưa phát hiện; không phải kết luận run gốc dùng mock.

Hai phản chứng này đã được nêu trong finding trước; bản sửa hiện tại đóng phần `{}`, số dạng chuỗi và dt, chưa đóng hết phần workload. Đã chạy lại harness cũ trên **capture mới**, bằng `openReplayPackage` thật: malformed samples/dt/sai run bị từ chối; empty axes và mock engine vẫn được chấp nhận.

Đề xuất hoàn tất: bắt buộc đúng hai wheel axis, không rỗng/không trùng; counter là số nguyên hợp lệ; đối chiếu engine/backend cụ thể với report và workload; dùng validator/schema trace/tuning hiện có cùng quy tắc 10 substep ban đầu. [Lab validBenchTraces](../../../../../lab/src/control/workbench.ts#L148) là tham chiếu về số mẫu đo và shape. Đừng chỉ sửa thêm một biểu thức cho trường hợp `{}`. Negative tests cần gồm empty set, missing counters, wrong/duplicate axis và engine trái với backend-set claim.

### F02 — P2: hai đầu pass khớp thời gian không chứng minh playback bên trong pass đang tiến

Vị trí: [r4-web09-readback.mjs:51](../../../../scripts/r4-web09-readback.mjs#L51), phép kiểm dòng 53.

Bản mới đã loại pass đứng yên hoàn toàn. Tuy nhiên, nó chỉ so `(lastTick - firstTick) × 20` với `lastTime - firstTime`. Một pass đứng yên lâu rồi chạy bù vẫn có hai đầu đúng và được tính đủ.

Phản chứng trên capture mới, giữ nguyên rAF, render timestamp/counter/duration, seek, ghost flag và package:

1. Trong mỗi pass, giữ cursor tại tick 20 suốt 20 giây đầu.
2. Cho cursor tiến nhanh hơn trong phần thời gian còn lại để kết thúc đúng tick 1950 và đúng timestamp cũ.
3. Reader vẫn trả **`[]`**, tính **77,2 giây** sim time. Nhưng mỗi pass chỉ có khoảng 18,65/18,64 giây còn lại để cursor tiến: tổng chưa tới **37,3 giây**.

Control giữ đứng yên **toàn bộ** pass 2 đã bị từ chối đúng bằng `PLAYBACK_STALLED` và `PLAYBACK_SHORT`. Vì vậy vấn đề còn lại nằm ở tiến trình trong pass, không phải sửa cũ không hoạt động.

Đề xuất: kiểm chuỗi `(timestamp, cursor)` trong từng pass với tốc độ playback 1×; giới hạn đoạn cursor đứng yên và mức chạy bù, chỉ tính thời gian active có căn cứ. Không chỉ dùng tổng tick ở hai đầu. Cho phép render lặp cùng tick vì renderer 60 Hz và world tick 50 Hz; capture thật lần này có span lặp tick tối đa 61,5 ms. Thêm negative test đứng 20 giây rồi chạy bù, và giữ positive test capture nguyên bản. Không tăng tolerance để che trường hợp này.

Repro đầy đủ: [midpass-progress-results.json](../../../../../evidence-archive/r4-web09-7bdbc-review-2026-11-23/probes/midpass-progress-results.json). Không có bằng chứng producer thật đang đứng yên như vậy; finding là reader chưa loại được dữ liệu trái điều kiện active playback đã chốt.

### Finding ghost trước đã đóng

`beliefAvailable` chọn record gần nhất không sau cursor, bỏ qua update dropped, kết thúc khi không còn belief vì lý do khác, và chỉ nhận `valid:true`. Nó khớp logic Lab cho package đang đo. Probe all-true bị từ chối; capture thật không có false claim. Không tìm thêm lỗi cần chặn ở phần này trong phạm vi review.

## REC06: kết quả audit và quyết định đề xuất

### Dữ liệu mới hỗ trợ kết luận nào

Đã kiểm SHA-256 của **90 trace, 150.429.713 byte (~143,5 MiB)** tại `evidence-archive/rec06-substep-traces-2026-11-23/`; không sửa archive đó. [Audit](../../../../../evidence-archive/r4-web09-7bdbc-review-2026-11-23/rec06-archive-audit.json) xác nhận:

| Nhóm | Trace | Có lực | Không có lực |
|---|---:|---:|---:|
| Ma trận đầu | 32 | 8 | 24 |
| Ma trận sửa đổi | 21 | 21 | 0 |
| Extension 16–19 N | 8 | 8 | 0 |

Ngoài ra có 29 trace sweep trước. Việc loại 24 mục void là đúng. Với trace 14,4 N/delay 1, close command bắt đầu ở substep 15911, force ở 15921, contact với body của tay ở 15934: lực tới 13 substep trước contact. Nên diễn đạt “delay 1–2: pad chạm sau khi lực bắt đầu, rồi giữ được cốc” thay vì hiểu là pad đã chạm ngay lúc trigger. Hai đơn vị tick và substep cần giữ nhất quán trong ruling.

Kết luận “chưa tìm thấy trong tập đã thử” phù hợp. Archive vẫn là diagnostic: chỉ chứa raw trace, README, SHA256SUMS; chưa có đầy đủ temporary patch/config và report của từng run. Trace mới có pose, quaternion, force magnitude, raw actuator command và contacting body names; không có aperture đo, torque vector, heldPropIds/restingOn hoặc outcome/recovery stream. Tôi xác nhận số mục có/không có lực và timing từ trace, không tự suy ra toàn bộ REC06 outcome chỉ từ những cột đó.

### Chọn khảo sát độ mở chương trình ở revision riêng

Sau hai vòng timing không tìm được recoverable miss, đề xuất **chuyển sang một khảo sát hữu hạn về độ mở trước khi gắp**, trong revision chương trình/fixture riêng. Giữ cốc, giá, friction, contact model, giới hạn phần cứng và recovery policy. Chưa thay default hoặc gọi đây là giải pháp đã chứng minh.

Lý do không tiếp tục hai hướng còn lại làm lựa chọn chính:

- Đẩy chéo có thể bổ sung một nhóm nhỏ để khép tập hướng, nhưng chưa có dữ liệu hứa hẹn một vùng miss ổn định; không nên mở thêm sweep lực không giới hạn.
- Giá hiện là geom tĩnh trong world, tại [compile.py:246](../../../../robotics/simulation-mujoco/mujoco_worker/compile.py#L246). “Đẩy vào giá” không thuộc nhánh giữ nguyên mô hình: muốn giá chuyển động phải thêm dynamics và admission mới.

Độ mở cũng **chưa phải một tham số độc lập sẵn có**. [mujoco-world-ports.ts:83](../../../../packages/lab-runtime/src/v2/simulation3d/mujoco-world-ports.ts#L83) đặt `programs.contact.openM = physics.gripper.openingMaxM`. Cùng `openM` còn dùng cho release observation ở dòng 182 và recovery. Không sửa `openingMaxM` để giả làm chỉnh chương trình, và không thay một biến chung rồi vô tình đổi cả release/recovery.

Điều kiện của khảo sát đề xuất:

1. Tách rõ **giới hạn mở vật lý** và **độ mở mục tiêu của pick** trong revision có identity/digest. Baseline R2b/default giữ nguyên. Cả lần gắp đầu và retry dùng cùng pick revision; không làm lần đầu kém hơn rồi đổi program riêng cho retry.
2. Trước khi thêm nudge, đo aperture thực và vùng offset gắp được của từng lựa chọn. Độ mở phải có clearance phù hợp với cốc đường kính 80 mm, gắp danh định được, không gây va chạm ngoài dự kiến. Không chọn một program vốn đã lỗi để tạo cảnh phục hồi.
3. Khai trước một dải nhỏ về độ mở và nudge, giữ các outcome kể cả refused/unknown. Mục tiêu là tìm **vùng tham số ổn định**, không một điểm sát cliff. Không override held/support facts, không giữ kẹp mở bằng test hook, không ghi pose trực tiếp.
4. Kiểm work region full-cell ±20 mm ngay khi đánh giá retry; rig ±45 mm chỉ là môi trường khảo sát. Mở rộng region để cho pass là thay đổi riêng, không nằm trong đề xuất này.
5. Chỉ khi có khả năng lặp lại, chốt spec/program/experiment revision mới, nối recorder/reader REC06 và kiểm full-cell ba seed: first known miss, recovery trong bound, retry lifted, served 2; fixed_program từ chối; ba nominal seed và năm fault giữ baseline. Không ghi thí nghiệm đã đổi dưới ID v1 cũ.

Nếu không còn độ mở hợp lý nào giữ được baseline và sinh recoverable miss, dừng vòng nghiên cứu rồi trình quyết định thu hẹp phạm vi hoặc đổi fixture. Không giảm tiêu chí acceptance chỉ vì số lượt thử đã nhiều.

### WEB10, CLD02, CLD03 và việc đóng R4

- **WEB10:** tiếp tục ưu tiên package từ full-cell REC06 hợp lệ. Harness là lựa chọn phạm vi có nhãn riêng cho demo/offline; nó không đóng REC06. Chưa cần chọn fallback trước khảo sát độ mở có giới hạn.
- **CLD02:** đề xuất chọn CI Linux native trên nhánh Source `r4/virtual-commissioning`. Push ở commit cuối sau khi các thay đổi Source đã khóa; workflow hiện chỉ trigger đúng nhánh này. Chạy ở 7bdbc1a5 rồi đổi reader/program tiếp sẽ phải chạy lại. Không cần push main để lấy CLD02; review này không thực hiện push.
- **CLD03:** chưa cần deploy lúc này. Chuẩn bị candidate hash, Source/pin, image digest, service và rollback sau local candidate; thực thi theo lệnh deploy cụ thể và ghi cloud supplement đúng tuple.
- **G-CAL1/G3:** vẫn ngoài điều kiện đóng R4 theo hợp đồng; ghi trạng thái thật. Human acceptance là sidecar riêng; record tự động vẫn `accepted:false`. Fast-forward/push main là bước phát hành riêng.

Thứ tự còn lại: hoàn tất hai kiểm tra WEB09 → khảo sát/chốt revision REC06 và mẫu WEB10 → commit/export/pin/khóa tuple → native CI/container và chuỗi qualification → cloud supplement sau deploy được chỉ định → review và chữ ký người.
