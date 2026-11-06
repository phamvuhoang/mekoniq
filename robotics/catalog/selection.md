# Selection worksheet — AMR giao món + trạm pha chế (reference catalog)

Trạng thái: **giả định kỹ thuật, chưa phải quyết định mua**. Mọi giá trị trong bảng "Giả định" mang `kind: assumed` trong catalog. Chưa có SKU, báo giá hay đường torque–speed của hãng nào được chốt; xem cột "Chặn gate".

## 1. Đầu vào tải (giả định)

| Đại lượng | Giá trị | Ghi chú |
|---|---|---|
| Khối lượng robot không tải | 30 kg | khung 18 + 2 bánh 3 + 2 caster 0,8 + pin 6 + khay 1,2 + phần còn lại |
| Tải khay tối đa | 5 kg | cốc + đồ uống |
| Tổng khối lượng tính toán m | 35 kg | |
| Bán kính bánh r | 0,10 m | đường kính 200 mm |
| Tốc độ mục tiêu v | 0,8 m/s | |
| Gia tốc mục tiêu a | 0,5 m/s² | |
| Hệ số cản lăn Crr | 0,02 | sàn phẳng cứng; **chưa đo** |
| Số bánh chủ động | 2 | caster trước/sau không chủ động |

## 2. Tính tải truyền động (sàn phẳng)

```text
F      = m·a + m·g·Crr = 35·0,5 + 35·9,81·0,02 = 24,37 N
F/bánh = 12,18 N
T/bánh = F/bánh · r    = 1,218 N·m   (liên tục khi tăng tốc)
ω      = v / r         = 8 rad/s ≈ 76 vòng/phút
P/bánh = T · ω         = 9,7 W cơ học (chưa tính hiệu suất hộp số)
```

Dự phòng 2× cho dốc nhỏ/ma sát khởi động: **T đỉnh ≈ 2,4 N·m/bánh**. Bảng torque–speed giả định của reference model (phía bánh): 4,0 N·m tại 0 rad/s → 0 N·m tại 18 rad/s; hiệu suất hộp số 0,75; tỉ số 15.

## 3. Ứng viên và việc còn thiếu

| Khối | Ứng viên | Việc cần làm để khóa | Chặn gate |
|---|---|---|---|
| Motor + hộp số + driver | Oriental Motor BLV R (họ) | Chọn đồng bộ SKU motor/gear/driver theo mục 2; lấy đường torque–speed từ hãng hoặc đo | G3, mua sắm. G1 chạy với model giả định có nhãn |
| Lidar | SLAMTEC RPLIDAR S2 | Khóa đúng biến thể (S2/S2L/S2P/S2E không hoán đổi); range/noise/rate theo datasheet | Sensor fidelity `verified` |
| Tay máy | UFACTORY xArm 6 | Pin commit `xarm_ros2` nhánh Jazzy, license từng mesh, inertia/serial variant (C01) | G1 arm / G2 |
| Gripper | UFACTORY Gripper G2 + má kẹp riêng | Mass/COM/inertia, khoảng mở, giới hạn lực, friction má kẹp | G2 |
| Máy pha | Eversys Cameo (khảo sát) | Chưa chọn model; không suy API brew/cancel từ tài liệu telemetry | Hardware integration |
| Đo khối lượng | Phidgets FRC4115_0 (5 kg) | Bridge/ADC, mounting, tare, calibration | G3 |
| Pin, DC/DC, fuse, contactor, compute | Chưa chọn | Theo bus 24 V và power budget AMR | Procurement |

Trạm arm/máy pha có nguồn riêng; không nối mặc định vào pin AMR.

## 4. Cốc và má kẹp (reference fixture)

Cốc giấy rỗng: trụ r = 0,04 m, cao 0,10 m, khối lượng 0,02 kg (giả định). Má kẹp: hai tấm 0,02 × 0,06 × 0,08 m, khối lượng 0,05 kg mỗi tấm. **Friction và compliance chưa có trong catalog** — C02 phải khai báo contact model riêng; D04 đo với vật mẫu. Không dùng các số này để kết luận về lực kẹp thật.
