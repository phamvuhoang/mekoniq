# Spike E01: catalog mở rộng và bản tóm tắt file mô tả

Ngày 2026-11-25, cây `main` tại `585ca972`. Thô: `docs/research/electrical-spike/`.

## Số đo

| Thử | Kết quả |
|---|---|
| `loadCatalog` trên bản sao có thêm `deviceProfiles: []` | Cùng `components` (13), `models`, `quotes`, `problems` (0). Loader hiện tại bỏ qua khóa lạ. |
| Thêm `robotics/catalog/devices/spike.json` rồi tính `portableToolClosure` và `nativeToolClosure` | Cả hai digest **không đổi** (`5292583e…c4be`, `eb1a4eae…5fa50`). `robotics/catalog` không nằm trong `PORTABLE_TOOL_PATHS`. |
| `export-lab-runtime.mjs` | Không nhắc tới catalog; artifact không đổi khi thêm file dưới `robotics/catalog`. |
| `packages/contracts/schemas` | **Nằm trong** `PORTABLE_TOOL_PATHS`. Mọi schema mới của E02/E04 làm đổi `portableToolsDigest`, `schemaHash` và `artifactSha256` → cần re-pin Lab; bản web công khai lệch runtime Cloud Run tới lần deploy do người dùng ra lệnh (đã biết, không sửa bằng cách push). |
| Nơi đọc catalog | `loadCatalog` (runtime-options, gateway, `scripts/export-engineering-reference.ts`, test) quét theo **tên trong `catalog.json`**, không quét thư mục. `scripts/import-engineering-vendor.mjs` và `generate-xarm6-fixture.mjs` ghi/đọc `documents/<sha256>`. Image cloud dựng catalog riêng bằng `deploy/lab-runtime/prepare-catalog.mjs` từ `serve-3d-components.json`; nó **không** chép `robotics/catalog`. |

## Quyết định

1. **Hồ sơ thiết bị ở `robotics/catalog/devices/`, thiết kế điện ở `robotics/catalog/electrical/`**, khai trong `catalog.json` (`deviceProfiles`, tùy chọn). Không đụng closure nào, không đổi golden. Không dùng nhánh dự phòng "thư mục anh em ngoài closure".
2. **Schema mới đi vào `packages/contracts/schemas`** (đường chuẩn của contracts); re-pin sau mỗi commit đổi schema, gộp một lần cho E02 và E04 nếu được.
3. **Cloud:** `compileElectrical` là hàm thuần TS không cần catalog trên đĩa nếu route nhận hồ sơ đã nạp. E19/E20 quyết định cách image nhận hồ sơ (mở rộng `prepare-catalog.mjs` bằng thư mục `devices/` cần thiết); không làm ở E01.
4. **Định dạng `DescriptionSummary`:** như plan, `{kind:'eds'|'esi', fileSha256, vendorId, productCode, revision, supportedModes, objects[{index,subindex,name,access,pdoMappable}]}` sắp theo `(index, subindex)`. Probe EDS cho 545 đối tượng, nhóm 6xxx có 54 mục (`605A–605E` quick stop/halt/fault option code, `6085` quick stop deceleration, `6502` = `0x2D`); probe ESI đọc được `RxPdo/TxPdo` của ELD3 (`ProductCode #x100A`). Tóm tắt do `scripts/describe-device.py` (thư viện chuẩn) sinh ở E03, commit thành JSON, TS chỉ đọc.
