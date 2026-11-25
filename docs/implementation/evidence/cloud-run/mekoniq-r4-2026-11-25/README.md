# CLD03 — Cloud Run smoke của R4 candidate 02 (25/11/2026)

`accepted:false`; chưa ai ký chấp nhận. Chạy theo lệnh deploy của người dùng ngày 25/11/2026.

- Image: bản native-tested `sha256:840c286e…bbcbee1` (linux/amd64, nhãn revision `0650ecbd`), đẩy lên `asia-southeast1-docker.pkg.dev/mekoniq/lab/mekoniq-lab-runtime:r4-0650ecbd`, digest registry `sha256:1333d28d4a604dca6cc238f6bae71b18afc3476b4806d7288f89375713dde12c`; daemon cục bộ phân giải digest này về đúng configuration ID (`promotion.json`).
- Cloud Run `mekoniq-lab-runtime` (project `mekoniq`, `asia-southeast1`): revision `mekoniq-lab-runtime-00004-92t`, 100 % traffic; health báo Source `0650ecbd`, schema `353b06e2…` (`health.json`). Revision trước `mekoniq-lab-runtime-00003-q7v` (Source `3d8c2a8`) còn nguyên để rollback.
- Lab công khai `https://mekoniq-lab.vercel.app` đã ghim Source `0650ecbd` (artifact `5cf17557…`), triển khai từ nhánh `r4/virtual-commissioning` của Lab (`de4d0c3`) bằng Vercel preview rồi `promote`; `main` của Lab chưa đổi.
- Smoke: `node scripts/record-r4-cloud.mjs execute --release-approved` (log `execute.log`): ghép phiên, readiness cell và wheel, MJ-CELL-BV01 10.700 tick + bench 500 tick; `status: tested`; 28,7 ms/tick (cell), 9,7 ms/tick (bench), hệ số thời gian thực 0,70 (`summary.json`).
- Guard: `LAB_SIMEXT_EVIDENCE_DIR=<r4-candidate-02> LAB_CLOUD_EVIDENCE_DIR=<thư mục này> pnpm test:acceptance -- cloud-run` đạt 1/1. Test có timeout cứng 300 s; lần đầu quá hạn vì đọc lại record 3,7 GB, lần chạy lại với timeout nâng tạm thời (hoàn nguyên, không commit) mất 324 s và đạt.
