# Bench kit: baseline ngày 2026-11-26

Mốc để K01 và K16 so sánh. Mọi số dưới đây lấy từ lệnh chạy trong worktree `bench-kit` (nhánh `bench/kit`) ngày 26/11. Không có số nào chép từ trí nhớ. **R5 chưa đóng**: chuỗi ghi đang chạy (mục 1), nên baseline này khóa theo tuple đang được ghi, không theo một record đã đọc lại.

## 1. Chuỗi ghi

`pgrep -fl "record-sim-extension|run-final-chain"` trả hai tiến trình (exit 0):

```
79266 bash evidence-archive/r5-handover-2026-11-26/run-final-chain-v7.sh …/evidence-archive/r5-chain-0d365afd 0d365afd26314d7cb1bee717769c0ab2db83f136 ea54ebe729c6e175a56f723ab7b278853c2cb492
79268 caffeinate -dims bash …run-final-chain-v7.sh (cùng đối số)
```

Chuỗi `r5-chain-0d365afd` chạy trên **đúng tuple của worktree này** (source `0d365afd` / Lab `ea54ebe7`). Theo lệnh người dùng, việc bench chạy ở worktree riêng song song với chuỗi; task này không dừng chuỗi, không ghi gì vào checkout chính hay `evidence-archive`. Checkout chính: `git -C …/source status --porcelain | wc -l` = 0 (chỉ đọc, không kiểm gì thêm).

Trong cây chỉ có record `r5-candidate-01-6da4ca94-lab-78c9c38-2026-11-26` (tuple cũ). Chưa có thư mục candidate-02 trong cây.

## 2. Git

| Mục | Giá trị |
|---|---|
| Nhánh | `bench/kit` |
| `git status --short` | rỗng (0 dòng) |
| `HEAD` (mốc `git diff` cho KRG01; không phải commit source) | `ea54ebe729c6e175a56f723ab7b278853c2cb492` (`chore: pin source runtime 0d365afd`) |
| `main` | `ea54ebe729c6e175a56f723ab7b278853c2cb492` (bằng HEAD) |
| `origin/main` | `b37347f2e794b3e72c19664a0ef9400d9f3a5a8d` (`docs: record the repository merge`); `main` đi trước 68 commit, chưa push (`rev-list --left-right --count origin/main...main` = `0 68`) |
| Commit source theo đường dẫn (`log -1 -- . ':(exclude)apps/lab'`) | `0d365afd26314d7cb1bee717769c0ab2db83f136` |
| Commit Lab theo đường dẫn (`log -1 -- apps/lab`) | `ea54ebe729c6e175a56f723ab7b278853c2cb492` |

## 3. Pin của Lab

`apps/lab/config/source-runtime.lock.json`:

| Trường | Giá trị |
|---|---|
| `sourceCommit` | `0d365afd26314d7cb1bee717769c0ab2db83f136` (bằng commit source theo đường dẫn) |
| `schemaHash` | `20dcb91def3429f6212ff00bc8c627e4227a10949b071848d1880cf3bb134db2` |
| `artifactSha256` | `061c633740f6aa236a1430468d5d77222b1682c79c6f065e224bc382f97291b3` |
| `portableToolsDigest` | `2c788ca437f59bbc99212b58667c55cbe4050c572d44bcfbd0781bb09d849caa` |
| `protocolMajor` / `protocolMajors` | 2 / [1, 2] |
| `dirty`, `toolchain.node` | `false`, `v24.22.2` |

## 4. Các mốc KRG01 sẽ so

| Mốc | Giá trị | Cách đo |
|---|---|---|
| `schemaHash` | `20dcb91def3429f6212ff00bc8c627e4227a10949b071848d1880cf3bb134db2` | `node scripts/export-lab-runtime.mjs <thư mục ngoài repo>` (exit 0, dưới `taskpolicy -b nice -n 19`, `alarm 900`); bằng pin |
| `artifactSha256` | `061c633740f6aa236a1430468d5d77222b1682c79c6f065e224bc382f97291b3` | cùng lần export; bằng pin. **Chỉ để tham khảo**: đổi theo mọi commit phía source, nên không dùng làm điều kiện KRG01 |
| Digest closure công cụ | `2c788ca437f59bbc99212b58667c55cbe4050c572d44bcfbd0781bb09d849caa` (348 file) | `portableToolClosure(root)` từ `scripts/native-sim/tool-identity.mjs`, gọi bằng `node --input-type=module -e`; bằng `portableToolsDigest` của pin. `node scripts/lab-irsim.mjs doctor` **không dùng được**: exit 2, `MISSING irsim-worker: IRSIM_WORKER_UNAVAILABLE: WORKER_SPAWN_FAILED` (worktree không có venv Python); dòng `OK node24: node 24.22.2` |
| SHA-256 `robotics/catalog/catalog.json` | `26f981a191272140ca22fc918042e5f7d4bca0deed9f3f2fdafcb3b5ac3288fe` | `shasum -a 256` |
| SHA-256 `robotics/catalog/electrical/manifest.json` | `301d4542faa74f913405e926e11f534584ff0d5347cd9788e660dbed0d415532` | `shasum -a 256` |

Sau export và tính digest: `git status --short` vẫn rỗng, không có `__pycache__` trong worktree.

## 5. Cloud Run

Một `curl -s` GET `https://mekoniq-lab-runtime-ojykcqdkja-as.a.run.app/lab/v2/health` (không cần khóa):

- `sourceCommit` = `0650ecbd126ee4b0b6004412942d5109e5b253a6`
- `schemaHash` = `353b06e2bbbbf84f7b4cf0ce8e7f8be5091c95a296ba02f9081fa4e9c4cc1cd2`

Khác pin ở mục 3 (cả commit lẫn schema hash). Khớp với ghi chú trong [status-2026-11-25.md](../hardware-electrical/status-2026-11-25.md): pin trên `main` cục bộ đi trước Cloud Run; không có lệnh deploy.

## 6. Guard của record R5

`not_run: recording chain in progress; deferred to the closing task`. Lý do: chuỗi đang ghi trên cùng tuple; theo quy tắc của controller, mọi việc cần chuỗi dừng được hoãn tới task đóng. Số guard cuối cùng đang có là số ghi trong [r5-qualification.md](../../operations/r5-qualification.md) và status 25/11 (candidate-01 ở `f4c72c29`: R4 12/12, R5 12/12); K00 không kiểm lại chúng.

## 7. Sáu câu hỏi cho người dùng (README §8)

Ghi ngày 2026-11-26, theo lời người dùng nói với controller; K00 không hỏi trực tiếp.

| # | Câu hỏi | Trả lời |
|---|---|---|
| 1 | Model driver/motor chính xác | chưa trả lời model. Người dùng chọn **servo DC điện áp thấp** và muốn công cụ chuẩn bị sẵn cho 220 VAC |
| 2 | Khung gầm, hộp số, bánh | chưa trả lời |
| 3 | PC nào | chưa trả lời |
| 4 | Ai đứng ở bàn thử; ai đấu nguồn motor | đứng ở bàn thử: **người dùng**. Người đấu nguồn motor: chưa trả lời |
| 5 | Vị trí bàn thử | chưa trả lời (ngầm hiểu: chỗ người dùng đang ở) |
| 6 | Nới quy tắc "Lab không bao giờ nói chuyện với robot thật" | **cho phép**, lời lẽ do controller chọn: Lab không bao giờ gửi lệnh tới thiết bị thật; runtime cục bộ có thể nghe một luồng bàn thử một chiều, chỉ đọc |

K01–K07 không phụ thuộc các câu chưa trả lời.

## 8. Việc khác

- Không có commit nào vào `main`, không chạm checkout chính, không sửa record hay evidence nào. File này là thay đổi duy nhất của task.
- Nhánh `bench/kit` đã tạo sẵn từ `main` (không do task này tạo).
