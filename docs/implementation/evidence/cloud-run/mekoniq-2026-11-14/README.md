# Cloud Run `mekoniq` — CL01 ngày 2026-11-14

**CL01 qua HTTP đã đạt trên Cloud Run x86-64 thật.** Người dùng cho phép deploy vào project `mekoniq`, vùng `asia-southeast1`, sau khi được thông báo cấu hình và chi phí. Đây là bằng chứng thực thi bổ sung; `accepted:false`, không có sidecar chấp nhận và không có push `main` trong lần triển khai này.

| Mục | Giá trị |
| --- | --- |
| Runtime URL | `https://mekoniq-lab-runtime-ojykcqdkja-as.a.run.app` |
| Revision phục vụ 100% traffic | `mekoniq-lab-runtime-00002-9lx` |
| Source / pin Lab | `4f893ac6fb75dff414a3ee42a726defb7935c734` |
| Commit Lab khi kiểm | `a6ec316fb3ac2f71afff25e6fa77e931f4439e00` |
| Image amd64 | `asia-southeast1-docker.pkg.dev/mekoniq/lab/mekoniq-lab-runtime@sha256:fbdf4bb5c1af4ffd15c01550b4508b6df0ad3b4d69e444e5469cfe2b52e4b009` |
| Runtime artifact SHA-256 | `55dd3585fb386953512554ca52d54c9463e7028286a64a66425a4f5dbe8e6270` |
| Thời gian kiểm UTC | 2026-11-14T00:55:53.990Z – 2026-11-14T00:57:13.606Z |
| Tài nguyên | gen2, 1 vCPU, 2 GiB, min 0 / max 1 instance, concurrency 20, timeout 3600 s |
| Origin được phép | `https://mekoniq-lab.vercel.app` |

## Kết quả

| Ca kiểm | Kết quả | Bằng chứng |
| --- | --- | --- |
| Health: commit, schema, bearer, public bind, MuJoCo sẵn sàng | `tested` | `cl01-attempt-03/health.json` |
| Khóa sai trả 401; khóa đúng tạo phiên 201 | `tested` | Assertions trong `smoke.mjs`; `cl01-attempt-03/summary.json` |
| Mock FD01 hoàn tất | `tested` | `cl01-attempt-03/mock-report.json` |
| SSE ngắt rồi tiếp tục bằng Last-Event-ID, không mất hoặc lặp sự kiện | `tested` | `cl01-attempt-03/stream-reconnect.json` |
| MJ-BV01 hoàn tất, phục vụ 2, vẫn `not_calibrated` | `tested` | `cl01-attempt-03/mujoco-report.json` |
| Kiểm tay qua UI trên trình duyệt | `not_run` | Chưa push bản Lab ghim runtime này lên Vercel |

MJ-BV01 hoàn tất ở tick 4800 (96 giây mô phỏng). Vòng gửi bước HTTP mất 71 313 ms (khoảng 71,3 giây), gồm thời gian mạng và xử lý; đây không phải phép đo riêng thời gian CPU mỗi tick hay nhịp 1×. Không có `PLANT_UNSTABLE` trong lần chạy thật này. Lần chạy cùng image dưới giả lập amd64 trên Mac vẫn thất bại ở tick 1585; giữ nguyên kết quả ở `local-http-smoke/`, không xóa để thay bằng kết quả cloud. Phép so sánh này chưa xác định nguyên nhân lỗi giả lập.

## Bản dựng và triển khai

Image được dựng trong clone sạch tại đúng commit Lab ghim, sau `pnpm install --frozen-lockfile --offline`. `export-reproducibility.json` xác nhận runtime và manifest giống hệt export của checkout đang dùng dù checkout đó có metadata của Python editable install. Image được push rồi deploy bằng digest cố định; `revision.json` ghi digest Cloud Run thực sự chạy.

Project mới không có tài khoản Compute mặc định. Lần deploy đầu dùng các cờ của `cloud-run.sh` và thêm tài khoản riêng `mekoniq-lab-runtime@mekoniq.iam.gserviceaccount.com`, chỉ cấp quyền đọc secret `lab-access-key`. Khóa sinh ngẫu nhiên được gửi qua stdin vào Secret Manager; giá trị không nằm trong tham số, image hay bằng chứng. Các token phiên/reclaim trong kết quả đã được che. `deployment.json` chứa cấu hình dịch vụ, chỉ có tham chiếu secret theo tên.

Runtime chỉ chấp nhận host đã cấu hình. Dùng **đúng URL trong bảng**, kể cả khi CLI hoặc Console hiển thị thêm URL có số project. Không thay bằng URL khác.

Các lệnh và đầu ra triển khai nằm trong `deploy-command.json`, `deploy.log`, `host-update-command.json`, `host-update.log`; quyền và tài nguyên trong `provision.jsonl` và các log tương ứng. `checksums.json` ghi SHA-256 của 46 artifact; README và chính file checksum không nằm trong danh sách đó.

## Quan hệ với R2a và giới hạn

Qualification R2a gốc giữ `G-CLOUD1=blocked_external`, CL01 `not_run`, theo định dạng ngày 2026-11-13. Dòng lý do cố định “no Cloud Run deployment has been ordered” trong đó không mô tả trạng thái triển khai hiện tại. Guard `cloud-run` kiểm bản bổ sung này cùng đúng SHA-256 của `r2a-candidate-02/qualification.json`, source/Lab pin, định danh revision/image và artifact gốc; khi đạt, **G-CLOUD1 là `tested` qua bản bổ sung**, chưa được chấp nhận. Không sửa qualification gốc và không chuyển acceptance của candidate cũ sang bản mới. Guard có 24 test âm/dương, từ chối thiếu artifact, replay bị cắt, thiếu revision/origin và báo cáo mâu thuẫn với lỗi plant.

Chưa kiểm đổi khóa, restart/scale-to-zero, ngắt SSE do timeout 60 phút, nhiều người dùng hay thao tác UI trên build HTTPS mới. Run/session nằm trong RAM và có thể mất khi instance dừng. Kết quả không chứng minh robot thật, lực kẹp, an toàn người hoặc gate phần cứng; tham số plant vẫn `assumed`, `not_calibrated`.

## Chạy lại

Từ thư mục `source/`, dùng Node 24.22.2. Thư mục kết quả mới phải chưa tồn tại. Khóa đi qua stdin, không in ra terminal:

```sh
record=docs/implementation/evidence/cloud-run/mekoniq-2026-11-14
export CLOUD_RUN_URL=https://mekoniq-lab-runtime-ojykcqdkja-as.a.run.app
export EXPECTED_COMMIT=4f893ac6fb75dff414a3ee42a726defb7935c734
export EXPECTED_SCHEMA=9e6ebfffc4aef0f3df686316881b672d96ac892d7df023701b38c398d979bff4
export SOURCE_ROOT="$PWD" MOCK_PROJECT="$PWD/$record/mock-project.json"
export SMOKE_OUT="$(mktemp -d)/cl01"
gcloud secrets versions access latest --secret=lab-access-key --project=mekoniq --quiet | node "$record/smoke.mjs"
```

Lần chạy lại tạo bằng chứng mới; không ghi đè thư mục này. Việc deploy Cloud Run không cho phép push hai nhánh `main` hay chấp nhận bản ghi thay người duyệt.

## Các lần ghi và dọn run

`cl01-attempt-01` đạt (69 135 ms cho vòng gửi bước), nhưng producer ban đầu chưa archive run. `cl01-attempt-02` đã ghi con trỏ `through` độc lập, rồi bị từ chối tạo MuJoCo vì `MUJOCO_CAPACITY`; readiness xác nhận run cũ còn giữ slot. Hai lần này và hai phiên bản producer cũ được giữ nguyên.

Đã dọn phiên test cũ bằng tám lần ghép nối đúng khóa, kích hoạt chính sách loại phiên cũ nhất khi vượt mười phiên; readiness sau đó xác nhận `canStart:true` (`smoke-session-cleanup.json`). Không restart hay đổi revision dịch vụ. Producer cuối ghi thêm con trỏ kết thúc từ run view và archive từng run do chính nó tạo trong `finally`. `cl01-attempt-03` đạt cả năm ca; hai phản hồi archive đều thành công và nằm trong `summary.json`. Guard yêu cầu kết quả replay tới đúng con trỏ và cả hai run được dọn.

Kiểm lại bằng chứng đã lưu, không gọi GCP hay chạy engine:

```sh
LAB_CLOUD_EVIDENCE_DIR=docs/implementation/evidence/cloud-run/mekoniq-2026-11-14 \
LAB_SIMEXT_EVIDENCE_DIR=docs/implementation/evidence/sim-extension/r2a-candidate-02 \
pnpm test:acceptance -- cloud-run
```
