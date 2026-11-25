# LinkForge + IR-SIM cho MEKONIQ Lab

Ngày: **2026-11-08**. Trạng thái: **spec/plan đề xuất; chưa triển khai tích hợp**. Tài liệu chính đặt trong repository `source` để contracts, workers và runtime dùng cùng một đặc tả. Các liên kết dưới đây dùng layout workspace `source/` và `lab/` cạnh nhau.

- [Nghiên cứu sâu: code baseline, nguồn chính thức, probe và giới hạn](../../../source/docs/research/2026-11-08-linkforge-irsim.md).
- [Spec chính và các quyết định kiến trúc](../../../source/docs/superpowers/specs/2026-11-08-linkforge-irsim/README.md).
- [Contracts/provenance/footprint và multi-drive](../../../source/docs/superpowers/specs/2026-11-08-linkforge-irsim/contracts.md).
- [Worker protocol, mission authority, UI và feature flags](../../../source/docs/superpowers/specs/2026-11-08-linkforge-irsim/workers-runtime.md).
- [Gates, scenario oracles và regression bắt buộc](../../../source/docs/superpowers/specs/2026-11-08-linkforge-irsim/verification.md).
- [Implementation plan tổng, dependency và ước lượng](../../../source/docs/superpowers/plans/2026-11-08-linkforge-irsim/README.md).
- [Task C01–C03: Lab UI, launcher, hai robot và qualification](../../../source/docs/superpowers/plans/2026-11-08-linkforge-irsim/03-lab-qualification.md).

Phần Lab bổ sung validation panel, provider selector, controls theo clock capability, LiDAR/footprint/collision layers và report/replay. UI tiếp tục dùng renderer/gateway hiện tại, ba ngôn ngữ và 2D fallback. Python workers cùng domain/mission authority thuộc `source`.

Baseline Lab đọc ở commit `d503f06b5c0e5f4065c4dd845c87cfd367bfdbb7`; runtime pin hiện tại được ghi trong nghiên cứu. Đợt tạo tài liệu này không repin runtime, không sửa code sản phẩm hoặc evidence lịch sử. **R-MOCK chưa accepted**; `blocked_external`/`not_run` của native/hardware không thay đổi. Plan yêu cầu chụp lại baseline trước khi bắt đầu phát triển.
