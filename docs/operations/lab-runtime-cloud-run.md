# Lab runtime trên Google Cloud Run

**Trạng thái: đã chuẩn bị, chưa từng chạy.** Không có project, image, secret hay dịch vụ nào được tạo; `deploy/lab-runtime/cloud-run.sh` mặc định chỉ in lệnh. Chỉ deploy khi người dùng ra lệnh và cho project (D60). Trước đó `G-CLOUD1` là `blocked_external` và không được đổi.

Runtime là tiến trình mà Lab (giao diện web) điều khiển qua HTTP. Image (`deploy/lab-runtime/`, D59) có các backend mock và cánh tay MuJoCo; không có Webots, IR-SIM, LinkForge hay công cụ thuật toán. Ví dụ dưới đây dùng `my-project`, `lab.example.com`, `lab-access-key`: thay bằng giá trị thật, và không dán khóa truy cập vào bất cứ đâu ngoài Secret Manager và trình quản lý mật khẩu.

## Chưa chứng minh: MuJoCo trên linux/amd64 thật

Cloud Run chạy linux/amd64. Cánh tay MuJoCo **chưa từng chạy trên phần cứng amd64 thật**. Trong image amd64 chạy giả lập trên máy phát triển (Mac arm64), kịch bản `MJ-BV01` dừng ở lần gắp cốc đầu tiên: engine báo trạng thái không ổn định (`PLANT_UNSTABLE`, gia tốc khớp sai, `BADQACC`), run kết thúc `needs_attention`, phục vụ 0. Nguyên nhân chưa biết: có thể do giả lập, có thể do engine trên x86-64. Các bài test Python của chính công cụ (39 test) vẫn qua trong image đó. Trên arm64 gốc, `MJ-BV01` hoàn tất (phục vụ 2).

Vì vậy: **việc đầu tiên sau khi deploy là chạy smoke `MJ-BV01` (ca CL01, mục "Kiểm tra sau deploy"). Cho đến khi nó qua trên chính dịch vụ đã deploy, runtime trên cloud chỉ được chứng minh cho các backend mock.** Các backend mock không dùng engine nên không bị ảnh hưởng. Nếu CL01 thất bại với `PLANT_UNSTABLE`, ghi lại nguyên văn kết quả, không sửa tham số để cho qua, và `G-CLOUD1` vẫn `blocked_external`.

## Chưa kiểm chứng: hành vi của Cloud Run

Các điều sau về Cloud Run **chưa được kiểm chứng ở đây** (chưa deploy lần nào); mỗi điều chỉ là điều tài liệu của Cloud Run được cho là nói, phải đối chiếu với trang tài liệu hiện hành khi deploy:

- Khi không đặt thăm dò khởi động, Cloud Run dùng thăm dò TCP mặc định trên cổng container (https://cloud.google.com/run/docs/configuring/healthchecks).
- Một secret tham chiếu bằng `:latest` được phân giải khi instance khởi động, không theo thời gian thực (https://cloud.google.com/run/docs/configuring/services/secrets).
- Cloud Run cắt yêu cầu sau `--timeout`, tối đa 60 phút (https://cloud.google.com/run/docs/configuring/request-timeout); khi tắt instance nó gửi `SIGTERM` rồi chờ một thời gian có hạn (https://cloud.google.com/run/docs/container-contract).
- Cách tính tiền: theo thời gian xử lý yêu cầu khi `min-instances=0` và CPU chỉ cấp lúc có yêu cầu; độ chia nhỏ khi làm tròn; thời gian khởi động và tắt instance có thể cũng bị tính; một stream dài tính như yêu cầu đang hoạt động (https://cloud.google.com/run/pricing).
- Một dịch vụ có thể có nhiều hơn một dạng URL (https://cloud.google.com/run/docs/triggering/https-request). `LAB_PUBLIC_HOST` chỉ chứa một host, nên Lab phải dùng đúng URL mà script in ra (giá trị `status.url`); dạng URL khác nhận `HOST_FORBIDDEN`.
- Chính sách tổ chức có thể cấm `--allow-unauthenticated`, khi đó lệnh deploy bị từ chối (https://cloud.google.com/run/docs/authenticating/public). Script không đổi chính sách.

## 1. Điều kiện trước

- Một Google Cloud project có bật thanh toán (billing). Chấp nhận chi phí (mục 8) và vùng `GCP_REGION` (mặc định `asia-southeast1`).
- Đã đăng nhập `gcloud` với quyền tạo dịch vụ Cloud Run, secret, kho Artifact Registry và chạy Cloud Build.
- Bật API (một lần):

```sh
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com --project=my-project
gcloud artifacts repositories create lab --repository-format=docker --location=asia-southeast1 --project=my-project
```

- Origin của Lab: `LAB_ORIGIN`, chính xác dạng `scheme://host[:port]`, chữ thường, không đường dẫn, không dấu `*`, không dấu `/` cuối. `https` (hoặc `http` chỉ cho host loopback). Ví dụ `https://lab.example.com`. Script thoát mã 2 và nêu tên biến nếu sai.
- Khóa truy cập là secret trong Secret Manager, tạo bằng tay (mục 2). Script chỉ nhận **tên** secret.

## 2. Secret khóa truy cập (tạo tay)

Khóa ≥ 32 ký tự (runtime từ chối khởi động với `ACCESS_KEY_REQUIRED` / `ACCESS_KEY_TOO_SHORT`). Giá trị đi vào `gcloud` qua đầu vào chuẩn hoặc tệp, không bao giờ qua tham số dòng lệnh (tham số lộ trong `ps` và lịch sử shell):

```sh
umask 077
openssl rand -base64 48 | tr -d '\n' > lab-access-key.txt           # 64 ký tự
gcloud secrets create lab-access-key --replication-policy=automatic --data-file=lab-access-key.txt --project=my-project
# cất khóa vào trình quản lý mật khẩu, rồi xóa tệp:
rm -P lab-access-key.txt 2>/dev/null || shred -u lab-access-key.txt
# tài khoản dịch vụ chạy Cloud Run (mặc định PROJECT_NUMBER-compute@developer.gserviceaccount.com) phải đọc được secret:
gcloud secrets add-iam-policy-binding lab-access-key --member=serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com --role=roles/secretmanager.secretAccessor --project=my-project
```

Có thể thay tệp bằng đường ống để không tạo tệp: `openssl rand -base64 48 | tr -d '\n' | gcloud secrets create lab-access-key --replication-policy=automatic --data-file=- --project=my-project`. **Không để ký tự xuống dòng ở cuối** (giữ `tr -d '\n'`; dùng `printf '%s'`, không dùng `echo`): một dòng mới lưu vào secret trở thành một phần của khóa và Lab sẽ ghép nối sai. Khi đó khóa chỉ còn trong secret; lấy ra bằng `gcloud secrets versions access latest --secret=lab-access-key --project=my-project` và cất vào trình quản lý mật khẩu.

**Xoay khóa:** thêm phiên bản mới (`gcloud secrets versions add lab-access-key --data-file=lab-access-key-moi.txt --project=my-project`), rồi chạy lại script với `--execute`. Chạy lại là an toàn: dịch vụ đã tồn tại nên script giữ nguyên host đang dùng và chỉ deploy một lần (mục 4). Cần revision mới vì (theo tài liệu Cloud Run, cần kiểm tra khi deploy) `:latest` chỉ được phân giải khi instance khởi động. **Một instance đang chạy giữ khóa cũ cho đến khi nó bị thay, nên khóa cũ vẫn dùng được cho đến khi revision mới thực sự phục vụ.** Sau đó kiểm tra khóa mới ghép nối được, rồi vô hiệu hóa phiên bản cũ (`gcloud secrets versions disable N --secret=lab-access-key --project=my-project`). Instance bị thay nên run mất và các phiên có thể phải ghép nối lại bằng khóa mới.

## 3. Dựng và đẩy image

**Điều kiện trước.** Commit mà Lab ghim (trường `sourceCommit` trong `lab/config/source-runtime.lock.json`) phải chứa thư mục `deploy/lab-runtime/` và phần hỗ trợ khóa truy cập của gateway. Nếu commit đang ghim cũ hơn, phải ghim lại Lab vào một commit đủ mới **trước**, rồi mới dựng image. Image phải được dựng từ **một bản clone mới, đúng commit mà Lab đã ghim**, không phải commit khác: Lab từ chối runtime có commit khác với ghim bằng `RUNTIME_PIN_MISMATCH`. Mỗi commit source mới cần Lab ghim lại và image dựng lại.

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"      # Node 24.22.2, pnpm 10.32.1
COMMIT=<giá trị sourceCommit trong lab/config/source-runtime.lock.json>
git clone <địa chỉ repo source> lab-runtime-src && cd lab-runtime-src
git checkout "$COMMIT" && test "$(git rev-parse HEAD)" = "$COMMIT"
pnpm install --frozen-lockfile
IMAGE=asia-southeast1-docker.pkg.dev/my-project/lab/mekoniq-lab-runtime:${COMMIT:0:7}
```

**Cách A: dựng tại máy rồi đẩy.** `build.sh` chạy trong bản clone mới này (cây sạch, vừa cài đóng băng) nên là bản dựng từ đầu. Nó đóng gói `runtime.mjs` bằng bộ xuất `scripts/export-lab-runtime.mjs` và thư mục công cụ MuJoCo từ `git archive HEAD`:

```sh
deploy/lab-runtime/build.sh "$IMAGE" --platform linux/amd64
gcloud auth configure-docker asia-southeast1-docker.pkg.dev
docker push "$IMAGE"
```

**Cách B: dựng bằng Cloud Build. CHƯA TỪNG CHẠY THỬ.** Các lệnh dưới đây chép tay cách `build.sh` bày ngữ cảnh build; chưa ai chạy chúng, và phải giữ đồng bộ với `build.sh` mỗi khi `build.sh` hoặc `Dockerfile` đổi. Nếu cần chắc chắn, dùng cách A. Nếu dùng cách B, kiểm tra kết quả theo đoạn bên dưới. Ngữ cảnh build và nộp:

```sh
CTX=$(mktemp -d)
node scripts/export-lab-runtime.mjs "$CTX/export" >/dev/null
mkdir "$CTX/robotics"; cp "$CTX/export/runtime.mjs" "$CTX/runtime.mjs"; cp -R "$CTX/export/schemas" "$CTX/schemas"; rm -rf "$CTX/export"
git archive HEAD robotics/simulation-mujoco | tar -x -C "$CTX" --exclude 'robotics/simulation-mujoco/tests'
cp deploy/lab-runtime/Dockerfile "$CTX/Dockerfile"
printf '%s\n' '**/__pycache__' '**/*.pyc' '**/tests' '**/.git' '**/.env*' > "$CTX/.dockerignore"
cat > "$CTX/cloudbuild.yaml" <<'YAML'
steps:
- name: gcr.io/cloud-builders/docker
  args: ['build', '--build-arg', 'SOURCE_COMMIT=${_COMMIT}', '-t', '${_IMAGE}', '.']
images: ['${_IMAGE}']
YAML
gcloud builds submit "$CTX" --config="$CTX/cloudbuild.yaml" --substitutions=_COMMIT="$COMMIT",_IMAGE="$IMAGE" --project=my-project
```

**Kiểm tra image đã dựng** (cả hai cách): nhãn `org.opencontainers.image.revision` phải bằng `$COMMIT`. Cách A: `docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$IMAGE"`. Cách B: kéo image về (`docker pull "$IMAGE"`) và chạy lệnh trên. Sau khi deploy, `sourceCommit` của route health (mục 5) phải bằng `$COMMIT`; khác nhau thì Lab sẽ từ chối bằng `RUNTIME_PIN_MISMATCH`, và image phải dựng lại. Script `cloud-run.sh` không dựng và không đẩy gì.

## 4. Deploy

```sh
export GCP_PROJECT=my-project GCP_REGION=asia-southeast1 LAB_ORIGIN=https://lab.example.com ACCESS_KEY_SECRET=lab-access-key IMAGE   # IMAGE như mục 3; SERVICE tùy chọn, mặc định mekoniq-lab-runtime
deploy/lab-runtime/cloud-run.sh              # chạy thử: chỉ in lệnh, không gọi gcloud
deploy/lab-runtime/cloud-run.sh --execute    # chạy thật, theo lệnh của người dùng
```

Không có `--execute` script chỉ in, thoát 0, không gọi `gcloud` (kể cả để đọc project cấu hình) và chạy được cả trên máy không cài `gcloud`; nó in các lệnh của cả hai trường hợp bên dưới, có nhãn A và B. Với `--execute` nó in từng lệnh rồi chạy. Trước hết nó đọc URL dịch vụ (`gcloud run services describe ... --format=value(status.url)`); lần đọc thất bại được hiểu là dịch vụ chưa tồn tại (nếu lỗi thật là xác thực hay mạng, lần deploy sau đó cũng sẽ lỗi; đọc thông báo `gcloud` trên màn hình). `gcloud run deploy` luôn được gọi đúng một lần.

**Trường hợp A, dịch vụ đã tồn tại (chạy lại, xoay khóa, đổi image):** một lệnh `gcloud run deploy` mang theo host hiện tại làm `LAB_PUBLIC_HOST`, không có bước cập nhật. Dịch vụ đang chạy không bị đặt lại về host giữ chỗ.

**Trường hợp B, dịch vụ mới:**

1. `gcloud run deploy` với đúng các cờ `--execution-environment=gen2 --max-instances=1 --min-instances=0 --concurrency=20 --timeout=3600 --cpu=1 --memory=2Gi --allow-unauthenticated --set-secrets=MEKONIQ_LAB_ACCESS_KEY=<secret>:latest --set-env-vars=LAB_ALLOW_ORIGIN=<origin>,LAB_PUBLIC_HOST=<host>` (kèm `--project`, `--region`, `--image`); `<host>` là `pending.invalid`.
2. Đọc lại URL dịch vụ.
3. `gcloud run services update --update-env-vars=LAB_PUBLIC_HOST=<host của URL>`.

Host dịch vụ chỉ biết sau lần deploy đầu, nên dịch vụ mới chạy với host giữ chỗ `pending.invalid` và từ chối mọi yêu cầu bằng `HOST_FORBIDDEN` cho đến bước 3: đó là một khoảng thời gian đóng-khi-lỗi (không phục vụ ai, không mở nhầm). Vì vậy script không đặt thăm dò khởi động HTTP trên `/lab/v2/health` (nó sẽ không qua trong khoảng đó); xem mục "Chưa kiểm chứng" về thăm dò mặc định. Bước 3 tạo revision mới. Dùng `--update-env-vars` chứ không `--set-env-vars` để không xóa `LAB_ALLOW_ORIGIN`.

**Nếu bước 3 thất bại** (hoặc bước 2 không trả URL https hợp lệ): script thoát khác 0 (mã 4 khi lệnh cập nhật lỗi, mã 1 khi URL không hợp lệ) và in ra đúng lệnh cần chạy tay, đã điền sẵn project, vùng, tên dịch vụ và host. Dịch vụ vẫn ở host giữ chỗ (đóng-khi-lỗi) cho đến khi lệnh đó chạy xong. Cũng có thể chạy lại script với `--execute`: lúc này dịch vụ đã tồn tại nên script đi theo trường hợp A và giữ host đang có; nếu host đó vẫn là giữ chỗ, chạy lệnh cập nhật bằng tay.

Script không chứa, không in, không truyền khóa: nó chỉ tham chiếu secret theo tên bằng `--set-secrets`, và bỏ `MEKONIQ_LAB_ACCESS_KEY` khỏi môi trường trước khi gọi `gcloud`. Đừng đặt giá trị khóa vào `ACCESS_KEY_SECRET` (đó là tên, và tên được in ra).

## 5. Kiểm tra sau deploy (CL01)

1. **Health**, không cần phiên:

```sh
curl -s https://SERVICE_HOST/lab/v2/health
```

Phải thấy `sourceCommit` bằng commit Lab đã ghim, `schemaHash`, `features.bearer: true`, `deployment.bind: "public"`, và backend `mujoco_arm` đã cài. Trả `403 HOST_FORBIDDEN` nghĩa là bước 3 của mục 4 chưa xong, hoặc `LAB_PUBLIC_HOST` sai, hoặc đang dùng một URL khác với URL script in ra.

2. **Ghép nối bằng khóa**, khóa không đi qua tham số dòng lệnh:

```sh
read -rs KEY; printf '{"token":"%s"}' "$KEY" | curl -s -X POST -H 'Origin: https://lab.example.com' -H 'Content-Type: application/json' --data-binary @- https://SERVICE_HOST/lab/v2/sessions -o /dev/null -w '%{http_code}\n'; unset KEY
```

Mong đợi `201` (thân trả `sessionToken`; lệnh trên chỉ in mã trạng thái, đừng dán token vào nhật ký). Khóa sai: `401 PAIRING_INVALID`; quá 5 lần sai trong một phút: `429 PAIRING_RATE_LIMITED`. Sau đó mở Lab (origin `LAB_ORIGIN`), nối tới URL dịch vụ bằng khóa truy cập.

3. **Smoke `MJ-BV01`** từ Lab với backend `mujoco_arm`. Đạt khi run hoàn tất (hoàn tất ở tick 4800 trong image arm64) và phục vụ 2, các tham số nhà máy vẫn `not_calibrated`. Một run trong container không bao giờ là bằng chứng cho `G-MA1`/`G-MA2` (D50). Kiểm tra cả backend mock chạy được.
4. **Stream nối lại:** ngắt mạng của tab một lúc trong khi run đang chạy; Lab phải nối lại stream từ con trỏ (`Last-Event-ID`, `?after=N`) mà không mất sự kiện.
5. Ghi kết quả (đạt, hoặc nguyên văn lỗi) vào README của bản ghi; `G-CLOUD1` chỉ đổi khi người duyệt làm. Nếu bước 3 không qua, nói rõ rằng cloud chỉ được chứng minh cho backend mock.

## 6. Giới hạn bảo mật

- Dịch vụ **công khai** (`--allow-unauthenticated`) và chỉ được bảo vệ bằng **một khóa truy cập chung** (một người thuê, D55). Ai có khóa là có toàn quyền.
- Route health không cần phiên và cho thấy commit source, schema hash và danh mục backend. Nó không lộ origin hay host, và không có trường nào nói thẳng khóa có được đặt; tuy vậy `deployment.bind: "public"` ngụ ý có khóa, vì runtime chỉ bind công khai khi có khóa.
- Số lần ghép nối sai được đếm **cho cả runtime**, không theo địa chỉ: bất kỳ ai tới được URL đều có thể giữ cho việc ghép nối bị khóa (5 lần sai mỗi phút) dù họ không vào được; các phiên đang có vẫn hoạt động.
- Trình duyệt giữ token phiên trong session storage của tab.
- Với dùng nhiều người hoặc nhiều hơn một lần thử một người: đặt dịch vụ sau một proxy nhận biết danh tính (Identity-Aware Proxy) hoặc giới hạn ingress. **Script không thiết lập điều đó.**
- Khóa chỉ nằm trong Secret Manager; runtime xóa nó khỏi môi trường tiến trình ngay khi khởi động nên tiến trình worker con không thừa hưởng. Lỗi và nhật ký chỉ mang mã, không mang khóa.

## 7. Giới hạn vận hành

- **Một instance** (`max-instances=1`). Run nằm trong bộ nhớ và `/tmp` (D60): mất khi instance dừng hoặc bị thay (deploy mới, xoay khóa, cập nhật biến, thu về 0 khi không có yêu cầu).
- Với `--timeout=3600` (theo tài liệu Cloud Run, cần kiểm tra khi deploy: mục "Chưa kiểm chứng"), một yêu cầu bị cắt sau thời hạn đó, nên stream sự kiện kết thúc **tối đa mỗi 60 phút**; Lab nối lại từ con trỏ.
- Run chỉ tiến khi Lab gửi bước: đóng tab thì run đứng yên, và instance có thể co về 0 rồi mất run.
- Khi tắt, nền tảng được cho là gửi `SIGTERM` (cần kiểm tra khi deploy); Node là PID 1 và đóng gateway rồi thoát mã 0. Một bước có nhịp đang chạy hoàn tất các tick của nó trước (tối đa khoảng một giây). Run đang có vẫn mất.
- Phiên sống 1 giờ; tối đa 10 phiên cùng lúc.

## 8. Chi phí

**Không có giá nào ở đây:** ngày 2026-11-13 trang giá của Google không đọc được (tải `https://cloud.google.com/run/pricing` chỉ trả tiêu đề, bảng giá được dựng bằng JavaScript), nên không trích số. Người vận hành điền giá hiện hành từ trang đó, đúng nhóm vùng của `asia-southeast1`; giá Secret Manager, Artifact Registry và Cloud Build nằm ở các trang giá riêng của chúng.

Theo tài liệu giá của Cloud Run (cần kiểm tra khi deploy, xem mục "Chưa kiểm chứng"), với `min-instances=0` và CPU chỉ cấp khi có yêu cầu, tiền tính theo thời gian xử lý yêu cầu chứ không theo thời gian chờ; độ chia nhỏ khi làm tròn và việc thời gian khởi động hoặc tắt instance có bị tính hay không phải đọc ở trang giá. **Một stream sự kiện dài được coi là một yêu cầu đang hoạt động**, nên mở Lab với một run đang theo dõi có thể tính tiền suốt thời gian đó, tới 60 phút mỗi stream. Với script (1 vCPU, 2 GiB):

```
chi phí một giờ hoạt động của một instance
  = 3600 x (1 x giá_vCPU_giây + 2 x giá_GiB_giây)  +  số_yêu_cầu / 1.000.000 x giá_mỗi_triệu_yêu_cầu
(trừ phần miễn phí hằng tháng của Google; chưa gồm Secret Manager, Artifact Registry, Cloud Build, băng thông ra)
```

Lượng dùng cho một giờ: 3600 vCPU-giây, 7200 GiB-giây, cùng số yêu cầu (mỗi lần Lab gửi bước là một yêu cầu). Nhân với giá hiện hành để có con số. Đặt cảnh báo ngân sách (budget alert) trong project và xóa dịch vụ khi không dùng (mục 9).

## 9. Tắt dịch vụ

```sh
SERVICE=${SERVICE:-mekoniq-lab-runtime}                                    # cùng tên đã dùng với script
gcloud run services delete "$SERVICE" --region=asia-southeast1 --project=my-project
gcloud secrets delete lab-access-key --project=my-project
gcloud artifacts docker images delete "$IMAGE" --delete-tags --project=my-project   # hoặc xóa cả kho: gcloud artifacts repositories delete lab --location=asia-southeast1 --project=my-project
```

Cũng xem lại: nguồn do Cloud Build tải lên (bucket của Cloud Build trong project), khóa nằm trong trình quản lý mật khẩu, tệp khóa tạm còn sót, và ràng buộc IAM đã thêm cho secret (mất theo secret). Xóa dịch vụ làm mất mọi run đang có.

## 10. Không được suy ra

- Từ việc image chạy `MJ-BV01` trên arm64 hay test Python trong image amd64 qua, **không** suy ra cánh tay MuJoCo hoàn tất trên Cloud Run. Chỉ smoke CL01 trên dịch vụ đã deploy mới nói được điều đó; trước đó cloud chỉ được chứng minh cho backend mock.
- Một run trong container hay trên cloud không phải bằng chứng cho `G-MA1`/`G-MA2` (D50); mọi tham số plant vẫn `not_calibrated`.
- Script chạy thử đúng (test dùng `gcloud` giả) không có nghĩa là deploy thật đã thử: chưa lệnh `gcloud` thật nào được chạy, chưa cờ nào được Cloud Run xác nhận. Cách B của mục 3 (Cloud Build) cũng chưa từng chạy; cách A chỉ đã được chạy nguyên văn với `build.sh` trên cây làm việc, chưa trên bản clone mới theo mục 3.
- "Công khai + một khóa chung" không phải là kiểm soát truy cập cho nhiều người; nó cũng không ngăn người ngoài làm khóa ghép nối trong một phút.
- Đừng suy ra giá từ tài liệu này (mục 8), cũng không suy ra độ trễ hay thông lượng: chưa đo gì trên Cloud Run.
- `G-CLOUD1` giữ `blocked_external` cho tới khi người dùng ra lệnh deploy, CL01 được chạy và ghi lại, và người duyệt chấp nhận. Không ghi `accepted:true` ở đâu cả.

## 11. Tham chiếu

`deploy/lab-runtime/README.md` (image, build, đo đạc), `deploy/lab-runtime/cloud-run.sh`, `tests/unit/cloud-run-script.test.ts`, spec `docs/superpowers/specs/2026-11-12-realistic-arm-web-ui-design.md` (D50, D55, D59, D60, SX-49, CL01), `docs/operations/secrets.md`.
