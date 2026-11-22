# Giao thức hiệu chuẩn (G3)

Trạng thái: **giao thức và công cụ đánh giá; chưa có dữ liệu đo nào**. G3 `not_run` cho tới khi có dataset đo thật. Kế hoạch này không chạy chuyển động phần cứng và không mua thiết bị.

## Nguyên tắc

- Chỉ `sourceKind: "measured"` có thể đạt. Dữ liệu mô phỏng/tổng hợp luôn bị từ chối (`MEASURED_DATA_REQUIRED`); tệp thử nghiệm của validator không phải bằng chứng.
- Ngưỡng (`policy`) được khai báo **trước** khi đo và nằm trong dataset: sai số tuyệt đối/tương đối từng kênh, số trial tối thiểu mỗi điều kiện, khoảng cách đồng hồ tối đa, ánh xạ kênh → capability.
- Tối thiểu 3 trial độc lập mỗi điều kiện ở tập validation; các trial validation được giữ lại, không dùng để chỉnh tham số. Trùng `trialId` giữa tune và validation là rò rỉ (`CALIBRATION_SPLIT_LEAKAGE`).
- Đơn vị, miền đồng hồ và hash cấu hình mô hình phải khớp giữa dữ liệu đo và dự đoán; không tự quy đổi. Đổi revision linh kiện/mô hình đổi `configDigest` và làm mất hiệu lực hiệu chuẩn cũ (`CONFIG_DIGEST_MISMATCH`, `invalidatedBy`).
- Không nội suy dự đoán qua khoảng trống lớn hơn `maxClockGapNs`. Giá trị validation ngoài miền đã tune là `OUT_OF_DOMAIN`.
- Sai số: `|dự đoán − đo| ≤ max(absoluteTolerance, relativeTolerance · |đo|)`; độ bất định của thiết bị đo không được lớn hơn `absoluteTolerance`.

## Đại lượng cần đo

| Nhóm | Điều kiện | Thiết bị tối thiểu | Capability |
|---|---|---|---|
| Chuyển động AMR | rỗng/đầy tải; thẳng, quay, phanh | encoder bánh + đo vị trí ngoài (mốc/đo laser) | actuator, rigidBody |
| Năng lượng | chu trình giao món | đo dòng/áp pin | actuator |
| TCP tay máy | các tư thế tham chiếu | đo vị trí ngoài (touch probe/laser tracker) | geometry |
| Kẹp cốc | cốc mẫu, lực kẹp thay đổi | cảm biến lực/đo trượt | grasp |
| Pha chế | thể tích/khối lượng xả | cân (load cell đã hiệu chuẩn) | process |

Thiết bị, điều kiện và ngưỡng cụ thể do người đo chốt và ghi vào `policy` trước khi thu thập.

## Bài đo dùng tín hiệu bench

Với một trục (bánh hoặc khớp tay máy), bài đo trên thiết bị thật dùng **đúng các tín hiệu bench** của bàn chỉnh (R4-D42): bước nhảy, hình thang, giữ, với biên độ đã đăng ký (`BENCH_AMPLITUDES`: khớp 0,05 / 0,1 / 0,2 rad, bánh 2 / 5 rad/s). Cùng một tín hiệu chạy trong mô phỏng và trên thiết bị nên so sánh là so cùng điều kiện. Ai chạy thiết bị, điều kiện an toàn và thiết bị đo là việc của người vận hành và nằm **ngoài Lab**: Lab và runtime không điều khiển thiết bị đo (R4-D41); log đi vào bằng file cục bộ và không được tải đi đâu (R4-D50).

### Định dạng log

Một trial = một file CSV + một mục trong **sidecar** JSON.

- CSV: dòng đầu `time_ns,<kênh>,<kênh>…`; thời gian là số nguyên nanosecond **tăng nghiêm ngặt**; mọi ô là số hữu hạn (không rỗng, không `NaN`/`inf`); tối đa 100.000 dòng (giới hạn của schema dataset) và 16 MiB. Không sắp xếp lại, không nội suy, không quy đổi đơn vị.
- Kênh bench có thể dự đoán: `command` (mục tiêu của bench), `position` (trạng thái thật của trục; rad với khớp, rad/s với bánh), `encoder` (phản hồi bộ điều khiển thấy; không có ở đoạn bị mất), `torque` (N*m).
- Gốc thời gian: `time_ns = 0` là mẫu ngay trước substep đầu tiên dưới tín hiệu (bước nhảy: đầu tick `atTick`; giữ: tick đầu sau khi mọi trục báo enabled). Mẫu trước đó có thời gian âm. `clockOffsetNs` trong sidecar cộng vào thời gian của log để về gốc này; miền đồng hồ (`sim` | `wall` | `instrument`) khai trong sidecar và phải trùng giữa dữ liệu và dự đoán.
- Sidecar khai: `sourceKind` (`measured` | `synthetic`), `deviceId`, `configDigest` (định danh plant + drive model + control profile mà bài đo được so với), `clockDomain`, `clockOffsetNs`, `units` và `uncertainty` cho **mọi** kênh, `policy` (khai trước khi đo), `attestation` (`operator`, `instrument`, `recordedAt`; bắt buộc với `measured`) và danh sách `trials` (`trialId`, `split`, `condition`, `file`, `axisId`, `signal`). File log chỉ được nằm trong thư mục của sidecar.
- Log do công cụ sinh có `generator` và không bao giờ là `measured` (`GENERATED_DATA_NOT_MEASURED`).

```sh
node scripts/import-calibration-log.mjs --sidecar <sidecar.json> --out <dataset-moi.json>
```

Thoát 0 (nhập được, file `--out` mới được ghi), 1 (có issue, mỗi dòng một mã theo file, ví dụ `trial-3.csv:TIME_NOT_MONOTONIC`), 2 (không đọc được input hoặc `--out` đã tồn tại). Dự đoán từ bench (`predictTrials`) chạy lại đúng tín hiệu đã khai trên model hiện tại và đưa kết quả cho `assessCalibration` ở trên; đánh giá không đổi.

## Nhận dạng tham số (R4.5, V15)

Khi đã có dataset đo (`measured`, có `attestation`), kỹ sư khai một **kế hoạch nhận dạng** (`identification-plan-v1`) và băm nó **trước** khi fit: tham số nào, điểm bắt đầu và biên, kênh và trọng số của hàm mục tiêu, thiết lập bộ tối ưu (số vòng lặp, dung sai, bước sai phân, số điều kiện Jacobian tối đa). Tối đa 12 tham số, mọi đường dẫn phải thuộc tập đăng ký (`engineering/parameter-paths.ts`): quán tính rotor từng khớp `armatureKgM2[k]`, cản và ma sát khớp `jointDynamics.damping|frictionloss` (**một giá trị chung cho sáu khớp**, nên cần dữ liệu của nhiều khớp để có nghĩa), và `driveModel.axes[k].torque.scale` (chỉ trục có đường mô-men dạng `envelope_ref`, tức là bánh; trục tay máy là `effort` nên không có hệ số để fit).

```sh
node scripts/identify-drive-model.mjs --config-digest xarm-1/J3     # định danh cấu hình mà dataset phải khai trong sidecar
node scripts/identify-drive-model.mjs --plan <plan.json> --dataset <dataset.json> --sidecar <sidecar.json> --out <thu-muc-moi> [--control <profile.json>]
```

`configDigest` nhận dạng **cấu hình đã đo** (plant, tải, các trục), không gồm tham số đang hiệu chuẩn: một revision đã fit vẫn hợp lệ với cấu hình nó được fit cho, còn đổi plant, tải hoặc bộ trục làm bản hiệu chuẩn cũ hết hiệu lực (`CONFIG_DIGEST_MISMATCH`). Fit chỉ thấy trial `tune`; kết luận đến từ trial `validation` giữ lại qua `assessCalibration` (không đổi). Thoát 0: bản ghi đạt và một revision **mới** được ghi vào `--out` (file đã có không bao giờ bị ghi đè; fixture và profile gốc giữ byte). Thoát 1: không đạt; bản ghi vẫn được ghi cùng mã lý do, không có revision. Thoát 2: thiếu input, dùng sai, `--out` đã có hoặc không có MuJoCo.

Bản ghi không sinh revision khi: dữ liệu `synthetic` hoặc chạy ở chế độ tự kiểm công cụ (`SYNTHETIC_DATA`, `TOOL_SELF_TEST`), fit không hội tụ (`NOT_CONVERGED`), có tham số chạm biên (`PARAMETER_AT_BOUND`), số điều kiện Jacobian vượt giới hạn của kế hoạch (`IDENTIFIABILITY_POOR`, sai số chuẩn là `null`), hoặc tập validation không đạt (`VALIDATION_FAILED`). Dataset ghi cho cấu hình khác không được fit (`CONFIG_DIGEST_MISMATCH`).

Cách ghi log để tham số nhận dạng được (rút từ tự kiểm công cụ, G-CAL1):

- Quán tính rotor và cản khớp hiện ra trong **đoạn quá độ** của bước nhảy (khoảng 0,6 s sau bước): giữ đoạn đó, không cần phần đã ổn định (phần ổn định chỉ thêm nhiễu lượng tử hóa vào hàm mục tiêu). Trên J3, bước 0,1 rad đủ lớn để thấy +30 % quán tính rotor; bước 0,2 rad làm J3 báo lỗi drive.
- Tập validation phải nằm trong miền của tập tune (`OUT_OF_DOMAIN`): dùng biên độ nhỏ hơn hoặc bằng biên độ tune.
- Hệ số mô-men của bánh **chưa chứng minh được** bằng tự kiểm: trên bánh danh định bước 5 rad/s bị giới hạn bởi độ bám (tốc độ bánh không đổi khi hệ số từ 0,85 lên 1), trên drive giới hạn mô-men tốc độ bánh chỉ đổi theo hệ số trong khoảng 60 ms đầu, và sau đó nhạy tới mức hệ số lệch 1 % đổi tốc độ bằng lệch 20 % (va chạm bánh–đất). Đường dẫn vẫn được đăng ký, nhưng G-CAL1 không khẳng định nó.

Mức trưởng thành của model (`illustrative` < `assumed` < `nominal` < `calibrated`) là hàm thuần của nguồn tham số, tính **theo nhóm** (hình học, quán tính, drive, tiếp xúc, cảm biến) và nhóm chỉ trưởng thành bằng tham số yếu nhất của nó; health và manifest của run mang `modelMaturity`. Không có trường để gõ tay mức. Hôm nay mọi nhóm của cả hai plant là `assumed`.

## Chạy đánh giá

```sh
node scripts/assess-engineering-calibration.mjs --dataset <measured.json> --prediction <prediction.json> --out <report-moi.json>
```

Thoát 0 (pass), 1 (fail), 2 (không có dataset/đầu vào không đọc được → G3 `not_run`). Tệp `--out` phải chưa tồn tại.
