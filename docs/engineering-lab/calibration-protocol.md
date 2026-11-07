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

## Chạy đánh giá

```sh
node scripts/assess-engineering-calibration.mjs --dataset <measured.json> --prediction <prediction.json> --out <report-moi.json>
```

Thoát 0 (pass), 1 (fail), 2 (không có dataset/đầu vào không đọc được → G3 `not_run`). Tệp `--out` phải chưa tồn tại.
