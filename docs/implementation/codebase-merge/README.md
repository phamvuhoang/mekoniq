# Gộp repo Lab vào source (2026-11-25)

Bộ thiết kế (README, spec MG-01–MG-13, plan M0–M10, hướng dẫn domain) nằm ở [design/](design/README.md), chép nguyên từ workspace `robot/docs/2026-11-20-codebase-merge/`. Ghi chép diễn tập và cutover (M0–M9, review sau M7): [rehearsal-2026-11-25.md](rehearsal-2026-11-25.md).

Kết quả: Lab ở `apps/lab` (nhập bằng `git subtree`, giữ SHA), một lockfile, định danh theo đường dẫn (`scripts/repo-identity.mjs`). Hostname: `www.mekoniq.app` app cloud, `lab.mekoniq.app` Lab (`mekoniq-lab.vercel.app` chuyển hướng 308), `mekoniq.app` trang marketing. Runtime Cloud Run chỉ cho origin `https://lab.mekoniq.app`. Plan này không đóng gate nào và không ghi record nào.
