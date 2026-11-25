# Spec R4-C — Hiệu chuẩn, mức trưởng thành của model và các lane hoãn

**Mã:** MKQ-SIM-R4-C-01 · **Trạng thái:** đề xuất sau R2b/R3, chưa được thực thi. Chưa có dữ liệu đo nào; chưa có phần cứng nào được chọn. Theo hướng người dùng chốt ngày 19/11, R4.5 là **đợt tùy chọn sau R4**: nó không nằm trong đường đóng R4 và chỉ mở khi có dữ liệu đo hoặc lịch phần cứng.

Đọc cùng [nghiên cứu](01-research.md), [contracts §8](05-contracts-and-evidence.md#8-hiệu-chuẩn) và [plan 04](plans/04-calibration-and-closeout.md).

## 1. Kết quả sản phẩm

Mọi tham số động lực học của Lab hôm nay là `not_calibrated`: khối lượng và giới hạn của xArm là giá trị danh định của hãng, còn gain, ma sát, tiếp xúc, drive và bố cục là giả định. Repo đã có giao thức hiệu chuẩn G3 và bộ đánh giá so dự đoán với số đo, nhưng chưa có đường đưa log thật vào, chưa có bước nhận dạng tham số, và chưa có cách nói cho người xem biết một model đáng tin tới đâu.

R4.5 chuẩn bị đúng phần đó, để ngày có motor, driver hay tay máy thật trên bàn thì việc còn lại là **đo**:

1. Nhập log đo (lệnh, encoder, thời gian) thành dataset có đơn vị, đồng hồ, độ bất định và policy khai trước.
2. Chạy lại đúng bài đo đó trong mô phỏng và so từng kênh.
3. Nhận dạng một tập nhỏ tham số trong biên khai trước, trên tập `tune`; đánh giá trên tập `validation` giữ lại.
4. Sinh **revision mới** của model với nguồn, miền hiệu lực và bản ghi; không ghi đè gì.
5. Hiển thị mức trưởng thành của model ở mọi nơi có kết quả mô phỏng.

| Đợt | Trong phạm vi | Điều kiện ra |
|---|---|---|
| R4.5 (tùy chọn) | Nhập log, dự đoán từ bench, nhận dạng có biên, revision hiệu chuẩn, hàm mức model, màn hình hiệu chuẩn, tự kiểm công cụ bằng dữ liệu tổng hợp | G-CAL1 |

Không thuộc R4.5: lấy số đo, điều khiển thiết bị để đo, chọn phần cứng, đóng G3. G3 giữ `not_run` cho tới khi có dataset đo thật; G-CAL1 chỉ nói công cụ hoạt động.

**Điều kiện mở R4.5:** có ít nhất một bộ log đo từ thiết bị thật, hoặc đã chọn phần cứng và có lịch đo. Trước lúc đó V14–V15 không được làm: một công cụ hiệu chuẩn chỉ kiểm được bằng dữ liệu tổng hợp chưa đem lại gì cho hai đích hiện tại là Mac local và cloud. R4 đóng mà không cần G-CAL1. Các lane hoãn ở [§6](#6-các-lane-hoãn-và-điều-kiện-mở) không đổi.

## 2. Hiện trạng trong code

| Quan sát | Nguồn | Hệ quả |
|---|---|---|
| Giao thức G3: chỉ dữ liệu `measured` mới đạt; tách tune/validation; ≥ 3 trial validation mỗi điều kiện; policy khai trước; không tự quy đổi đơn vị | `source/docs/engineering-lab/calibration-protocol.md` | Giữ nguyên; R4.5 chỉ thêm đường vào và bước fit |
| `assessCalibration` so `PredictionSeries` với `CalibrationDataset`, từ chối dữ liệu mô phỏng/tổng hợp, lệch `configDigest`, lệch đồng hồ/đơn vị | `source/packages/lab-runtime/src/engineering/calibration.ts` | Dùng lại nguyên vẹn làm bước đánh giá |
| `residuals.ts` căn chỉnh và tính residual, **không fit**, không ghi vào controller | `source/packages/lab-runtime/src/v2/residuals.ts` | Bước fit là phần mới, tách riêng |
| `SourceRef.kind` có `manufacturer`, `measured`, `derived`, `assumed` | `engineering-component.schema.json` | Đủ để tính mức model, không cần enum mới |
| Profile tải và drive mang `calibration:'not_calibrated'` cố định | `load-profile-v1.schema.json`, fixture `serve-payload-v1` | Mức model phải đến từ nguồn tham số, không từ nhãn tĩnh |
| Hồ sơ đích vật lý và điều kiện commissioning đã có ở R3.2 | `physical-target-dossier-v1.schema.json`, `docs/operations/robot-commissioning.md` | Hiệu chuẩn là đầu vào của hồ sơ đó; không cấp quyền chạy máy |

## 3. Quy trình

| Bước | Ai làm | Bằng gì | Đầu ra |
|---|---|---|---|
| 1. Chạy bài đo trên thiết bị | Người vận hành, theo quy trình an toàn của họ, **ngoài Lab** | Đúng các tín hiệu bench của bàn chỉnh: bước nhảy, hình thang, giữ | Log thô của thiết bị |
| 2. Chuẩn hóa log | Người đo | CSV mỗi trial + sidecar khai đơn vị, đồng hồ, độ bất định, policy, người đo, thiết bị đo | Bộ log |
| 3. Nhập | Kỹ sư | `import-calibration-log.mjs` | `CalibrationDataset` |
| 4. So sánh | Kỹ sư | Bench chạy lại trong mô phỏng → `PredictionSeries` → `assessCalibration`; màn hình hiệu chuẩn trên Lab | Residual từng kênh, miền, kết quả đạt/không |
| 5. Nhận dạng | Kỹ sư | `identify-drive-model.mjs` với kế hoạch nhận dạng đã băm | `CalibrationRecordV1` |
| 6. Phát hành revision | Kỹ sư, có người duyệt | Ghi revision mới của drive model hoặc physics profile | File mới có nguồn `derived`, miền hiệu lực, tham chiếu bản ghi |

Bài đo dùng lại tín hiệu bench có một hệ quả tốt: cùng một thử nghiệm chạy trong mô phỏng và trên thiết bị, nên so sánh là so cùng điều kiện, và bàn chỉnh sau này dùng luôn model đã hiệu chuẩn.

## 4. Quyết định

| ID | Quyết định |
|---|---|
| R4-D41 | Lab và runtime không lấy số đo và không điều khiển thiết bị để đo. Log đi vào bằng file cục bộ |
| R4-D42 | Bài đo là tín hiệu bench đã đăng ký. Tín hiệu mới cho hiệu chuẩn được thêm vào danh mục bench, không phải đường riêng |
| R4-D43 | Dùng lại `CalibrationDataset`, `PredictionSeries`, `CalibrationResult` và `assessCalibration`. R4.5 chỉ thêm kế hoạch nhận dạng và bản ghi |
| R4-D44 | Nhận dạng bằng bình phương tối thiểu có biên, tất định, tối đa 12 tham số thuộc tập đăng ký; do TS điều phối và chạy lại đúng bench của bàn chỉnh. Không thêm thư viện tối ưu. Gói `mujoco.sysid` chính thức đã nằm trong wheel đang ghim nhưng cần thêm scipy/matplotlib/plotly và chưa ổn định phần mô hình phép đo; nó là đường nâng cấp khi cần tốc độ hoặc khoảng tin cậy đầy đủ, trong một venv công cụ riêng ([nghiên cứu §5.2](01-research.md#52-từng-chủ-đề)) |
| R4-D45 | Fit chỉ thấy tập `tune`; đánh giá chỉ trên `validation`. Tham số chạm biên hoặc fit không hội tụ thì không sinh revision |
| R4-D46 | Kết quả là revision **mới**. Không ghi đè fixture/profile gốc; không tự áp vào control profile hay cấu hình controller sản xuất. Control profile đã chỉnh trên model cũ mất hiệu lực với model mới (lệch digest) và phải chỉnh lại |
| R4-D47 | Dữ liệu tổng hợp chỉ dùng để tự kiểm công cụ và không bao giờ sinh revision. Log do công cụ sinh mang dấu `generator` và bị từ chối nếu khai là `measured` |
| R4-D48 | Mức trưởng thành là hàm thuần của nguồn tham số, tính theo nhóm; không có trường để gõ tay. Qualification là trục riêng |
| R4-D49 | Hiệu chuẩn có miền hiệu lực và hết hiệu lực khi cấu hình đổi (`configDigest`), như giao thức hiện có |
| R4-D50 | Log đo là dữ liệu cục bộ của người dùng: không tải lên dịch vụ nào; archive thô lớn nằm ngoài Git theo quy ước evidence hiện có |

Tham số nhận dạng được trong R4.5: quán tính rotor phản ánh từng khớp tay máy (`armatureKgM2`), cản và ma sát khớp, hệ số đường mô-men của trục. Hai giới hạn của model hiện tại quyết định phạm vi này: cản và ma sát khớp của tay máy là **một giá trị chung** cho sáu khớp, nên fit là fit giá trị chung và cần dữ liệu của nhiều khớp để có nghĩa; khớp bánh chưa có tham số quán tính rotor hay cản trong compiler, nên với bánh chỉ fit được hệ số mô-men. Tham số riêng từng khớp và tham số của bánh cần đổi compiler, không thuộc R4.5. Trễ lệnh/phản hồi là số nguyên substep: tìm bằng quét lưới một tham số trước khi fit phần liên tục. Hình học động học của AMR (bán kính và khoảng cách bánh), ma sát tiếp xúc và lực kẹp cần bài đo khác với bench một trục; xem [§6](#6-các-lane-hoãn-và-điều-kiện-mở).

Tự kiểm công cụ: sinh "số đo" bằng chính simulator với tham số ẩn bị lệch, thêm lượng tử encoder, rồi yêu cầu công cụ tìm lại tham số ẩn trong dung sai khai trước. Nó chứng minh công cụ nhận dạng được khi tín hiệu đủ kích thích; nó không nói gì về model so với thiết bị thật.

## 5. Mức trưởng thành của model

| Mức | Nghĩa | Điều kiện máy kiểm | Được nói | Không được nói |
|---|---|---|---|---|
| Minh họa (`illustrative`) | Hình học và chuyển động để minh họa, không có cơ sở vật lý | Model mock | "Minh họa luồng" | Bất kỳ số đo vật lý nào |
| Giả định (`assumed`) | Có vật lý, tham số là giả định tường minh | Có ít nhất một nguồn `assumed` trong nhóm | "Trong model giả định này, quan sát thấy…" | "Robot sẽ…" |
| Danh định (`nominal`) | Tham số lấy từ tài liệu nhà sản xuất | Mọi nguồn trong nhóm là `manufacturer` | "Theo thông số danh định…" | Sai số thực tế, tải thực tế |
| Đã hiệu chuẩn (`calibrated`) | Tham số khớp dữ liệu đo trong một miền | Nguồn `measured`, hoặc `derived` có bản ghi đạt, còn hiệu lực với cấu hình hiện tại | "Khớp số đo trong miền M với residual R" | Ngoài miền M; an toàn |

Mức được tính riêng cho từng nhóm tham số: hình học, quán tính, drive, tiếp xúc, cảm biến. Một nhóm chỉ trưởng thành bằng tham số yếu nhất của nó. Report và UI hiện mức theo nhóm, vì một kết luận về trượt cốc phụ thuộc nhóm tiếp xúc chứ không phụ thuộc nhóm hình học.

Đề xuất gốc có bốn nhãn: Illustrative, Nominal, Calibrated, Qualified. Bộ này đổi hai điểm, có chủ ý:

- Thêm **Giả định** giữa Minh họa và Danh định. Đó là trạng thái của phần lớn tham số hiện tại, và gộp nó vào "Danh định" sẽ nói quá.
- Tách **Qualified** ra khỏi thang. Qualified là trạng thái của một record (gate `tested`, chấp nhận do người ký trong sidecar), không phải tính chất của tham số. Một model `assumed` vẫn có thể thuộc một record đã `tested`; một model `calibrated` vẫn có thể chưa qua gate nào. Hiển thị hai trục cạnh nhau, không trộn. Không trục nào là chứng nhận an toàn.

## 6. Các lane hoãn và điều kiện mở

Mỗi lane dưới đây có giá trị, nhưng hôm nay thiếu một điều kiện bên ngoài hoặc chưa có câu hỏi cần nó trả lời. R4 chuẩn bị seam; không xây lane.

| Lane | Vì sao chưa làm | Seam R4 để lại | Điều kiện mở |
|---|---|---|---|
| **Drive từ FMU (FMI co-simulation)** | Chưa có FMU nào của drive mà MEKONIQ định dùng. FMU là gói nhị phân theo nền tảng: FMU của Siemens DriveSim Designer chỉ có cho Windows, cần giấy phép lúc chạy, và ở chế độ tải ngoài khuyến nghị bước giao tiếp 62,5 µs, nhỏ hơn substep 2 ms của Lab 32 lần. Không chạy được trong worker macOS/Linux hiện tại | Hợp đồng `DriveCommandV1`/`DriveFeedbackV1` và vị trí của drive quanh mỗi substep: một drive FMU thay actuator và `DriveGroup` cho các trục nó mô hình | Có FMU cụ thể kèm giấy phép và binary cho host của worker; có lịch co-simulation xác định giữa bước của FMU và substep; qua được DRV03–DRV06 trên chính FMU đó |
| **Hardware-in-the-loop (L4)** | Chưa có bộ điều khiển hay driver thật; cần host có đồng hồ ổn định và cách ly điện/mạng | Cùng hợp đồng drive; controller là đặc tả có vector chuẩn | Có phần cứng điều khiển cụ thể, người chịu trách nhiệm an toàn, và hồ sơ R3.2 cho đích đó |
| **Intrinsic Core làm backend workcell** | Xem [§6.1](#61-intrinsic-core-và-omts) | Ánh xạ sang `CellAdapter` ở [R4-B §9](03-r4-perception-recovery-spec.md#9-ranh-giới-workcell); belief world và phục hồi đã có bản gốc trong Lab | Xem §6.1 |
| **Camera render và bộ ước lượng pose thật** | Thêm render headless, model học máy và giấy phép model trước khi có camera thật để đối chiếu; ảnh render không so được giữa các backend đồ họa | `PerceptionProfileV1`: tham số của mô hình sai số là thứ sẽ được hiệu chuẩn từ dữ liệu camera thật | Có camera và vật thể cụ thể; có dataset pose đo để hiệu chuẩn mô hình sai số trước |
| **Machine tending CNC** | Dòng sản phẩm khác với robot phục vụ; chưa có máy, chưa có khách | Ranh giới workcell và chính sách phục hồi dùng lại được | Có định hướng kinh doanh và một bài toán nạp/lấy phôi cụ thể |
| **Nâng MuJoCo lên 4.x** | Đổi engine giữa lúc thêm lớp drive làm mất mỏ neo trùng bit; 4.0 đổi cách đóng gói và renderer | Mọi kiểm DRV/CIL chạy lại được trên pin mới | Candidate riêng: chạy lại toàn bộ gate R2b và R4 trên pin mới, so sánh có báo cáo |
| **Auto-tuning, đáp ứng tần số** | Model chưa hiệu chuẩn; gợi ý giải tích đủ cho điểm khởi đầu | Danh mục tín hiệu bench mở rộng được | Có model `calibrated` cho trục cần chỉnh |
| **Hiệu chuẩn hình học AMR, tiếp xúc, lực kẹp** | Cần bài đo nhiều trục và thiết bị đo ngoài | Dataset/policy/assessor dùng chung | Có AMR hoặc tay kẹp thật và thiết bị đo theo bảng của giao thức G3 |

### 6.1 Intrinsic Core và OMTS

Kết quả kiểm nguồn ngày 19/11 ở [nghiên cứu §3](01-research.md#3-nguồn-upstream-đã-kiểm). Những điểm quyết định:

- **Hạ tầng.** Hướng dẫn yêu cầu Ubuntu 26.04, x86-64, tối thiểu 32 GiB RAM, k3s và Bazel; ARM được ghi là không hỗ trợ. Bản chạy thử trên máy Apple của cộng đồng là máy ảo Linux arm64 dùng fork, không phải macOS. MEKONIQ chưa có host Linux x86-64 phù hợp.
- **Robot.** Trong cây có module phần cứng cho Universal Robots, KUKA và ABB; không có file nào cho xArm/UFACTORY. OMTS dùng UR5e/UR3e. Cầu `ros2_control` chỉ nhận tay máy điều khiển vị trí và không có I/O số.
- **Vòng đời vật thể.** Bản Core không có dịch vụ spawn vật thể trong mô phỏng đang chạy. Hành trình cốc của MEKONIQ (sinh tại vòi, được lấy đi tại bàn) dựa vào đúng khả năng đó.
- **Bằng chứng.** Ghi log có cấu trúc, đóng gói bản ghi và replay được ghi là thuộc bản Enterprise. Trên Core chỉ có sự kiện của executive và trạng thái lỗi có cấu trúc. Chuẩn evidence của Lab (stream bền theo tick, có coverage, đọc lại fail-closed) không có sẵn nguồn tương ứng.
- **Điều phối.** Executive nhận tối đa một operation tại một thời điểm, với các lệnh tạo, chạy, tạm dừng, hủy và đọc trạng thái; khớp với `CellAdapter` (`execute`, `cancel`, `reconcile`) mà không cần hợp đồng mới.
- **Giấy phép.** Hai repo là Apache-2.0. Trọng số model nhận thức đi theo giấy phép riêng của từng model; một trong số đó có điều kiện truy cập và hạn chế sử dụng. Phải rà từng model trước khi dùng trong sản phẩm.

Vì vậy thứ tự hợp lý là: lấy **khái niệm** vào Lab ngay (belief world, sai số nhận thức, cấu trúc thử lại/phục hồi cho chuyển động tiếp xúc, trạng thái lỗi có chuỗi nguyên nhân) và hoãn **runtime**.

Điều kiện mở lane, tất cả phải có:

1. Host Linux x86-64 đúng yêu cầu của bản release được ghim, có người vận hành.
2. Quyết định về robot: chạy OMTS nguyên bản với UR như một profile riêng (không gọi là xArm), hoặc có đường xArm đã được kiểm qua cầu `ros2_control`.
3. Kế hoạch evidence: adapter phía source tự ghi sự kiện operation, trạng thái lỗi và observation của cell theo chuẩn Lab; chỗ nào thiếu thì ghi `unavailable`, không suy.
4. Cách xử lý vòng đời vật thể trên Core, hoặc scenario không cần sinh/loại vật thể.
5. Rà giấy phép các model nhận thức định dùng.

Khi mở, các bước là: (III) dựng runtime và OMTS ở chế độ mô phỏng, chưa bật nhận thức, ghi một chu trình; (IV) bật nhận thức và so với kết quả `perception-gap-v1` của Lab; (V) viết `CellAdapter` cho runtime đó ở source và hiện report trong Lab. Bước (I) nghiên cứu và (II) hợp đồng đã nằm trong bộ tài liệu này. Mỗi bước có gate riêng; không bước nào đóng gate phần cứng.

## 7. Yêu cầu đo được

| ID | Yêu cầu | Plan / case |
|---|---|---|
| R4-31 | Nhập log fail-closed: đồng hồ, cột, giá trị, đơn vị, kích thước, đường dẫn, nhãn nguồn | V14 / CAL01 |
| R4-32 | Dự đoán chạy lại đúng tín hiệu bench của trial và gắn đúng `configDigest`; đánh giá bằng assessor hiện có | V14 / CAL02 |
| R4-33 | Nhận dạng tất định trong biên; tự kiểm phục hồi tham số ẩn; chạm biên, không hội tụ, rò rỉ, ngoài miền đều bị bắt | V15 / CAL03, CAL04 |
| R4-34 | Revision mới có nguồn và miền; file gốc giữ byte; hết hiệu lực khi đổi cấu hình; dữ liệu tổng hợp không sinh revision | V15 / CAL05 |
| R4-35 | Mức model là hàm thuần, hiện theo nhóm ở report và UI; màn hình hiệu chuẩn đọc bản ghi cục bộ | V15 / CAL05, CAL06 |
| R4-36 | Qualification R4 ghi đủ case/gate ở một tuple, regression chuỗi trước, `accepted:false` | V16 / REG05 và mọi gate R4 |

R4-31 tới R4-35 chỉ áp dụng khi R4.5 được mở. R4-36 áp dụng cho việc đóng R4 và không phụ thuộc R4.5.

## 8. Điều R4.5 không khẳng định

- Không có model nào trở thành `calibrated` trong R4 nếu không có dữ liệu đo thật.
- Khớp số đo trong một miền không phải là chứng nhận an toàn và không thay hồ sơ commissioning R3.2.
- Tự kiểm bằng dữ liệu tổng hợp không nói gì về độ đúng của model so với thiết bị.
- Gain chỉnh trên model chưa hiệu chuẩn chỉ đúng cho model đó; sau khi hiệu chuẩn phải chỉnh lại.
