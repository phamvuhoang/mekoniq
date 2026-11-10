# arm-ref-3d-v1

Tay máy 6 khớp cho plant Webots của R1.1, dưới dạng một `engineering-component`. **Không phải dữ liệu PUMA và không phải tay máy sản phẩm.**

## Nguồn

- **Hình học** suy ra từ bảng Lab `PUMA560_REFERENCE` (`packages/lab-runtime/src/v2/models/arm-kinematics.ts`, modified DH của Craig, đổi sang SI bằng `toSI`). Bảng controller `integrations/arm-controller/models/puma560-reference/` không được dùng.
- **Khớp** `J1..J6` (`jointNameForLinuxcnc`), `revolute`, trục `[0,0,1]` trong khung link con. Gốc khớp i trong khung link cha: `xyz = [a, −sin(alpha)·d, cos(alpha)·d]`, quay `Rx(alpha)·Rz(thetaOffset)`.
- **Link** `base`, `link1..link6`. Mỗi link là một trụ bán kính `DEFAULT_ARM_GEOMETRY.linkRadiusM` (0,025 m) nối gốc link tới gốc khớp kế tiếp, hoặc một cầu cùng bán kính khi hai gốc trùng nhau (base, link1, link4, link5, link6). Hai đoạn trụ (link2, link3) cũng là hai capsule mà kiểm va chạm ARM03 dùng.
- **Giới hạn khớp** (`lower`, `upper`, `velocity`) lấy từ bảng Lab (làm tròn 12 chữ số).

## Tham số giả định (`assumed`)

| Tham số | Giá trị | Ghi chú |
|---|---|---|
| `massKg` base, link1..6 | 10, 8, 6, 4, 1.5, 1, 0.5 | khởi đầu của spike X00, không chỉnh. Base cố định với thế giới, khối lượng chỉ để đủ bản ghi |
| `effort` J1..J6 (N*m) | 200, 200, 100, 30, 20, 10 | X00: J2 giữ được từ 40 N*m trở lên, võng ở 20 N*m |
| `inertiaKgM2` | trụ/cầu đặc tại tâm khối | `derived` từ khối lượng và hình học |

Mọi tham số này sẽ đổi nếu có dữ liệu tay máy thật (DH hoặc URDF, khối lượng, mô-men khớp): chỉ cần sửa `scripts/generate-arm-fixture.mjs` và sinh lại.

## Sinh lại

```sh
pnpm exec tsx scripts/generate-arm-fixture.mjs        # ghi component.json và manifest.json tại đây
```

Ngoài `component.json` còn `fk-golden.json` (5 pose và vị trí mặt bích từ `forwardKinematics` của Lab) để test compiler (`tests/test_compile_arm.py`) dựng lại chuỗi khớp từ văn bản `.wbt` và so ở 1e-9 m, và `manifest.json` (sha256, số byte, `componentDigest`).

Đầu ra tất định: số làm tròn 12 chữ số, khóa JSON sắp xếp. `tests/unit/arm-fixture.test.ts` sinh lại vào thư mục tạm và so từng byte, kiểm schema, và so FK của chuỗi khớp (`chainFk`) với `forwardKinematics` của Lab tại mọi pose của `arm-fk-golden.json`: lệch lớn nhất 9e-13 m, ngưỡng 1e-9 m.
