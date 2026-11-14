# Lab runtime trên Google Cloud Run

**Trạng thái ngày 2026-11-14: đã deploy vào `mekoniq / asia-southeast1`; CL01 qua HTTP đạt.** Người dùng đã cho phép triển khai theo D60. Dịch vụ `mekoniq-lab-runtime-00002-9lx` chạy image amd64 của source `4f893ac`, cùng pin Lab. URL chuẩn: `https://mekoniq-lab-runtime-ojykcqdkja-as.a.run.app`. [Bản ghi CL01](../implementation/evidence/cloud-run/mekoniq-2026-11-14/README.md) giữ lệnh, digest, health và kết quả gốc; chưa được người duyệt chấp nhận. Qualification R2a gốc giữ `G-CLOUD1=blocked_external`; guard `cloud-run` mới xác nhận G-CLOUD1 `tested` bằng bản bổ sung gắn với đúng SHA-256 của qualification, không sửa dữ liệu gốc.

Runtime là tiến trình mà Lab (giao diện web) điều khiển qua HTTP. Image (`deploy/lab-runtime/`, D59) có các backend mock và cánh tay MuJoCo; không có Webots, IR-SIM, LinkForge hay công cụ thuật toán. Các lệnh bên dưới dùng project `mekoniq`, origin `https://mekoniq-lab.vercel.app` và tên secret `lab-access-key`. Cấu hình không chứa bí mật nằm trong `deploy/lab-runtime/mekoniq.env.example`; giá trị khóa chỉ lưu trong Secret Manager và trình quản lý mật khẩu.

## MuJoCo trên x86-64 thật và dưới giả lập

Trên Cloud Run Linux x86-64, `MJ-BV01` đã hoàn tất ở tick 4800, phục vụ 2 và giữ `not_calibrated`. Vòng gửi bước HTTP mất 71 313 ms (khoảng 71,3 giây); số này gồm mạng và xử lý, không phải thời gian CPU riêng mỗi tick hay phép đo nhịp 1×. Health, khóa sai/đúng, mock FD01 và SSE nối lại đều đạt trong cùng lần kiểm.

Cùng image amd64 dưới giả lập trên Mac arm64 vẫn gặp `PLANT_UNSTABLE`/`BADQACC` ở tick 1585, kết thúc `needs_attention`, phục vụ 0. Kết quả này được giữ nguyên bên cạnh kết quả Cloud Run; chưa xác định nguyên nhân khác biệt. Các test Python trong image không thay cho smoke đầy đủ của scenario.

Hai nhánh main đã được push theo lệnh người dùng ngày 2026-11-14; Vercel production đã READY cho source `d1a2522` và Lab `a744954`. Lab production ghim runtime `4f893ac`, khớp dịch vụ Cloud Run. [Kiểm tự động trên Lab production](../implementation/evidence/production/r2a-2026-11-14/README.md) bằng Chrome đã đạt: ghép nối, mô hình xArm, `MJ-BV01` hoàn tất và phục vụ 2; run thử được archive sau kiểm. UI ghi 4810 tick (bước đầu 250, sau đó nhóm 20), khớp baseline UI trước deploy; CL01 HTTP ghi 4800 với nhóm 50. Kiểm tay Chrome, Firefox, Safari cho luồng HTTPS tới runtime cục bộ vẫn `not_run`.

## Hành vi nền tảng đã đối chiếu tài liệu, chưa kiểm trên dịch vụ

Đã đọc tài liệu Google ngày 2026-11-14. CL01 đã kiểm health, xác thực, mock, MuJoCo và stream nối lại; các hành vi lifecycle, xoay khóa và timeout dài bên dưới chưa được thử riêng:

- Cloud Run hỗ trợ Linux x86_64; image nhiều kiến trúc phải có `linux/amd64`. Trước khi dừng instance, nền tảng gửi SIGTERM rồi cho 10 giây trước SIGKILL. Dữ liệu filesystem không tồn tại sau khi instance dừng. [Container contract](https://docs.cloud.google.com/run/docs/container-contract).
- Dịch vụ mới chưa cấu hình startup probe dùng TCP probe mặc định. [Health checks](https://docs.cloud.google.com/run/docs/configuring/healthchecks).
- Secret qua biến môi trường được đọc lúc instance khởi động. Google khuyên ghim phiên bản; script hiện dùng `latest` theo D60, nên phải kiểm khóa mới sau khi xoay. [Secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets).
- Timeout tối đa 3600 giây; timeout đóng kết nối nhưng không tự dừng xử lý trong container. Client cần nối lại và không được giả định vẫn gặp instance cũ. [Request timeout](https://docs.cloud.google.com/run/docs/configuring/request-timeout).
- Script dùng `--allow-unauthenticated`; chính sách tổ chức có thể hạn chế việc cấp quyền cho `allUsers`. Google cũng có cơ chế tắt kiểm IAM invoker; script này chưa dùng cơ chế đó và không tự đổi chính sách tổ chức. [Public access](https://docs.cloud.google.com/run/docs/authenticating/public).
- Dùng đúng URL từ `status.url`, vì `LAB_PUBLIC_HOST` chỉ chấp nhận host đã cấu hình. Các URL khác bị runtime từ chối bằng `HOST_FORBIDDEN`.

## 1. Điều kiện trước

Project `mekoniq` hiện đã có API, kho `lab`, secret `lab-access-key` và dịch vụ; các lệnh tạo bên dưới phục vụ lần thiết lập mới, không cần chạy lại trên tài nguyên đã có.

- Một Google Cloud project có bật thanh toán (billing). Chấp nhận chi phí (mục 8) và vùng `GCP_REGION` (mặc định `asia-southeast1`).
- Đã đăng nhập `gcloud` với quyền tạo dịch vụ Cloud Run, secret, kho Artifact Registry và chạy Cloud Build.
- Bật API (một lần):

```sh
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com --project=mekoniq
gcloud artifacts repositories create lab --repository-format=docker --location=asia-southeast1 --project=mekoniq
```

- Origin của Lab: `LAB_ORIGIN`, chính xác dạng `scheme://host[:port]`, chữ thường, không đường dẫn, không dấu `*`, không dấu `/` cuối. `https` (hoặc `http` chỉ cho host loopback). Ví dụ `https://mekoniq-lab.vercel.app`. Script thoát mã 2 và nêu tên biến nếu sai.
- Khóa truy cập là secret trong Secret Manager, tạo bằng tay (mục 2). Script chỉ nhận **tên** secret.

## 2. Secret khóa truy cập (tạo tay)

Khóa ≥ 32 ký tự (runtime từ chối khởi động với `ACCESS_KEY_REQUIRED` / `ACCESS_KEY_TOO_SHORT`). Giá trị đi vào `gcloud` qua đầu vào chuẩn hoặc tệp, không bao giờ qua tham số dòng lệnh (tham số lộ trong `ps` và lịch sử shell):

```sh
umask 077
openssl rand -base64 48 | tr -d '\n' > lab-access-key.txt           # 64 ký tự
gcloud secrets create lab-access-key --replication-policy=automatic --data-file=lab-access-key.txt --project=mekoniq
# cất khóa vào trình quản lý mật khẩu, rồi xóa tệp:
rm -P lab-access-key.txt 2>/dev/null || shred -u lab-access-key.txt
# tài khoản dịch vụ chạy Cloud Run (mặc định PROJECT_NUMBER-compute@developer.gserviceaccount.com) phải đọc được secret:
gcloud secrets add-iam-policy-binding lab-access-key --member=serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com --role=roles/secretmanager.secretAccessor --project=mekoniq
```

Có thể thay tệp bằng đường ống để không tạo tệp: `openssl rand -base64 48 | tr -d '\n' | gcloud secrets create lab-access-key --replication-policy=automatic --data-file=- --project=mekoniq`. **Không để ký tự xuống dòng ở cuối** (giữ `tr -d '\n'`; dùng `printf '%s'`, không dùng `echo`): một dòng mới lưu vào secret trở thành một phần của khóa và Lab sẽ ghép nối sai. Khi đó khóa chỉ còn trong secret; lấy ra bằng `gcloud secrets versions access latest --secret=lab-access-key --project=mekoniq` và cất vào trình quản lý mật khẩu.

**Xoay khóa:** thêm phiên bản mới (`gcloud secrets versions add lab-access-key --data-file=lab-access-key-moi.txt --project=mekoniq`), rồi chạy lại script với `--execute`. Chạy lại là an toàn: dịch vụ đã tồn tại nên script giữ nguyên host đang dùng và chỉ deploy một lần (mục 4). Cần revision mới vì (theo tài liệu Google đã đối chiếu; vẫn kiểm revision thực tế khi deploy) `:latest` chỉ được phân giải khi instance khởi động. **Giả định chưa kiểm, phải kiểm khi deploy:** chạy lại `gcloud run deploy` với cấu hình không đổi tạo ra một revision mới, và revision đó đọc phiên bản secret mới. Nếu không có revision mới, khóa cũ vẫn là khóa đang dùng; vì vậy đừng vô hiệu hóa phiên bản cũ trước khi khóa mới ghép nối được. **Một instance đang chạy giữ khóa cũ cho đến khi nó bị thay, nên khóa cũ vẫn dùng được cho đến khi revision mới thực sự phục vụ.** Sau đó kiểm tra khóa mới ghép nối được, rồi vô hiệu hóa phiên bản cũ (`gcloud secrets versions disable N --secret=lab-access-key --project=mekoniq`). Instance bị thay nên run mất và các phiên có thể phải ghép nối lại bằng khóa mới.

## 3. Dựng và đẩy image

**Điều kiện trước.** Commit mà Lab ghim (trường `sourceCommit` trong `lab/config/source-runtime.lock.json`) phải chứa thư mục `deploy/lab-runtime/` và phần hỗ trợ khóa truy cập của gateway. Nếu commit đang ghim cũ hơn, phải ghim lại Lab vào một commit đủ mới **trước**, rồi mới dựng image. Image phải được dựng từ **một bản clone mới, đúng commit mà Lab đã ghim**, không phải commit khác: Lab từ chối runtime có commit khác với ghim bằng `RUNTIME_PIN_MISMATCH`. Khi source thay đổi runtime, schema hoặc portable tool, phải ghim lại Lab và dựng lại image; commit chỉ cập nhật tài liệu, bằng chứng hoặc artifact trình bày không đổi runtime đang ghim.

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"      # Node 24.22.2, pnpm 10.32.1
COMMIT=<giá trị sourceCommit trong lab/config/source-runtime.lock.json>
git clone <địa chỉ repo source> lab-runtime-src && cd lab-runtime-src
git checkout "$COMMIT" && test "$(git rev-parse HEAD)" = "$COMMIT"
pnpm install --frozen-lockfile
IMAGE=asia-southeast1-docker.pkg.dev/mekoniq/lab/mekoniq-lab-runtime:${COMMIT:0:7}
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
gcloud builds submit "$CTX" --config="$CTX/cloudbuild.yaml" --substitutions=_COMMIT="$COMMIT",_IMAGE="$IMAGE" --project=mekoniq
```

**Kiểm tra image đã dựng** (cả hai cách): nhãn `org.opencontainers.image.revision` phải bằng `$COMMIT`. Cách A: `docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$IMAGE"`. Cách B: kéo image về (`docker pull "$IMAGE"`) và chạy lệnh trên. Sau khi deploy, `sourceCommit` của route health (mục 5) phải bằng `$COMMIT`; khác nhau thì Lab sẽ từ chối bằng `RUNTIME_PIN_MISMATCH`, và image phải dựng lại. Script `cloud-run.sh` không dựng và không đẩy gì.

## 4. Deploy

Lần triển khai đã ghi dùng digest cố định và tài khoản riêng `mekoniq-lab-runtime@mekoniq.iam.gserviceaccount.com`, chỉ được đọc secret `lab-access-key`. Project mới chưa có tài khoản Compute mặc định nên dùng trực tiếp lệnh `gcloud run deploy` với các cờ của script và thêm `--service-account=…`; xem `deploy-command.json` trong bản ghi CL01. Script chưa có tham số chọn service account. Khi triển khai lại, giữ nguyên và kiểm tra `serviceAccountName` này; khi tạo một dịch vụ mới cần chỉ rõ tài khoản phù hợp.

```sh
export GCP_PROJECT=mekoniq GCP_REGION=asia-southeast1 LAB_ORIGIN=https://mekoniq-lab.vercel.app ACCESS_KEY_SECRET=lab-access-key IMAGE   # IMAGE như mục 3; SERVICE tùy chọn, mặc định mekoniq-lab-runtime
deploy/lab-runtime/cloud-run.sh              # chạy thử: chỉ in lệnh, không gọi gcloud
deploy/lab-runtime/cloud-run.sh --execute    # chạy thật, theo lệnh của người dùng
```

Không có `--execute` script chỉ in, thoát 0, không gọi `gcloud` (kể cả để đọc project cấu hình) và chạy được cả trên máy không cài `gcloud`; nó in các lệnh của cả hai trường hợp bên dưới, có nhãn A và B. Với `--execute` nó in từng lệnh rồi chạy. Trước hết nó đọc URL dịch vụ (`gcloud run services describe ... --format=value(status.url)`); lần đọc thất bại được hiểu là dịch vụ chưa tồn tại, kể cả khi lỗi thật là xác thực, quyền hay mạng. Khi đó script đi theo trường hợp B; lần deploy sau đó có thể lỗi, nhưng cũng có thể qua (ví dụ lỗi mạng chỉ thoáng qua). Nếu dịch vụ thật ra đã tồn tại và lần deploy đó qua, dịch vụ chạy với host giữ chỗ (đóng-khi-lỗi, từ chối mọi yêu cầu) cho đến khi host được đặt lại (bước 3, hoặc lệnh mà script in ra khi bước 3 lỗi). Đọc thông báo `gcloud` trên màn hình trước khi tiếp tục. `gcloud run deploy` luôn được gọi đúng một lần.

**Trường hợp A, dịch vụ đã tồn tại (chạy lại, xoay khóa, đổi image):** một lệnh `gcloud run deploy` mang theo host hiện tại làm `LAB_PUBLIC_HOST`, không có bước cập nhật. Dịch vụ đang chạy không bị đặt lại về host giữ chỗ.

**Trường hợp B, dịch vụ mới:**

1. `gcloud run deploy` với đúng các cờ `--execution-environment=gen2 --max-instances=1 --min-instances=0 --concurrency=20 --timeout=3600 --cpu=1 --memory=2Gi --allow-unauthenticated --set-secrets=MEKONIQ_LAB_ACCESS_KEY=<secret>:latest --set-env-vars=LAB_ALLOW_ORIGIN=<origin>,LAB_PUBLIC_HOST=<host>` (kèm `--project`, `--region`, `--image`); `<host>` là `pending.invalid`.
2. Đọc lại URL dịch vụ.
3. `gcloud run services update --update-env-vars=LAB_PUBLIC_HOST=<host của URL>`.

Host dịch vụ chỉ biết sau lần deploy đầu, nên dịch vụ mới chạy với host giữ chỗ `pending.invalid` và từ chối mọi yêu cầu bằng `HOST_FORBIDDEN` cho đến bước 3: đó là một khoảng thời gian đóng-khi-lỗi (không phục vụ ai, không mở nhầm). Vì vậy script không đặt thăm dò khởi động HTTP trên `/lab/v2/health` (nó sẽ không qua trong khoảng đó); xem mục "Hành vi nền tảng đã đối chiếu tài liệu, chưa kiểm trên dịch vụ" về thăm dò mặc định. Bước 3 tạo revision mới. Dùng `--update-env-vars` chứ không `--set-env-vars` để không xóa `LAB_ALLOW_ORIGIN`.

**Nếu bước 3 thất bại** (hoặc bước 2 không trả URL https hợp lệ, kể cả khi lệnh đọc URL lỗi): script thoát khác 0 (mã 4 khi lệnh cập nhật lỗi, mã 1 khi URL không hợp lệ) và in ra đúng lệnh cần chạy tay, đã điền sẵn project, vùng, tên dịch vụ và host. Dịch vụ vẫn ở host giữ chỗ (đóng-khi-lỗi) cho đến khi lệnh đó chạy xong. Cũng có thể chạy lại script với `--execute`: dịch vụ đã tồn tại nên script đi theo trường hợp A, lấy host thật từ `status.url` và đưa vào lệnh deploy. Một lần chạy lại thành công sẽ sửa host giữ chỗ; lệnh cập nhật bằng tay là lựa chọn khác.

Script không chứa, không in, không truyền khóa: nó chỉ tham chiếu secret theo tên bằng `--set-secrets`, và bỏ `MEKONIQ_LAB_ACCESS_KEY` khỏi môi trường trước khi gọi `gcloud`. Đừng đặt giá trị khóa vào `ACCESS_KEY_SECRET` (đó là tên, và tên được in ra).

## 5. Kiểm tra sau deploy (CL01)

1. **Health**, không cần phiên:

```sh
curl -s https://SERVICE_HOST/lab/v2/health
```

Phải thấy `sourceCommit` bằng commit Lab đã ghim, `schemaHash`, `features.bearer: true`, `deployment.bind: "public"`, và backend `mujoco_arm` đã cài. Trả `403 HOST_FORBIDDEN` nghĩa là bước 3 của mục 4 chưa xong, hoặc `LAB_PUBLIC_HOST` sai, hoặc đang dùng một URL khác với URL script in ra.

2. **Ghép nối bằng khóa**, khóa không đi qua tham số dòng lệnh:

```sh
read -rs KEY; printf '{"token":"%s"}' "$KEY" | curl -s -X POST -H 'Origin: https://mekoniq-lab.vercel.app' -H 'Content-Type: application/json' --data-binary @- https://SERVICE_HOST/lab/v2/sessions -o /dev/null -w '%{http_code}\n'; unset KEY
```

Mong đợi `201` (thân trả `sessionToken`; lệnh trên chỉ in mã trạng thái, đừng dán token vào nhật ký). Khóa sai: `401 PAIRING_INVALID`; quá 5 lần sai trong một phút: `429 PAIRING_RATE_LIMITED`. Sau đó mở Lab (origin `LAB_ORIGIN`), nối tới URL dịch vụ bằng khóa truy cập.

3. **Smoke `MJ-BV01`** từ Lab với backend `mujoco_arm`. Đạt khi run hoàn tất (hoàn tất ở tick 4800 trong image arm64) và phục vụ 2, các tham số nhà máy vẫn `not_calibrated`. Một run trong container không bao giờ là bằng chứng cho `G-MA1`/`G-MA2` (D50). Kiểm tra cả backend mock chạy được.
4. **Stream nối lại:** ngắt mạng của tab một lúc trong khi run đang chạy; Lab phải nối lại stream từ con trỏ (`Last-Event-ID`, `?after=N`) mà không mất sự kiện.
5. Lưu một bản ghi CL01 riêng gồm định danh dịch vụ, image, health và kết quả từng bước (đạt, hoặc nguyên văn lỗi). Recorder/guard R2a hiện cố định `G-CLOUD1=blocked_external`; không sửa tay `qualification.json` để đổi gate. Dùng guard `cloud-run` với `LAB_CLOUD_EVIDENCE_DIR` trỏ tới bản bổ sung và `LAB_SIMEXT_EVIDENCE_DIR` trỏ tới R2a gốc; guard kiểm các artifact, pin, revision, kết quả và con trỏ stream kết thúc. Trạng thái `tested` và sự chấp nhận của người duyệt là hai việc riêng. Nếu bước 3 không qua, chỉ backend mock có bằng chứng chạy trên dịch vụ.

## 6. Giới hạn bảo mật

- Dịch vụ **công khai** (`--allow-unauthenticated`) và chỉ được bảo vệ bằng **một khóa truy cập chung** (một người thuê, D55). Ai có khóa là có toàn quyền.
- Route health không cần phiên và cho thấy commit source, schema hash và danh mục backend. Nó không lộ origin hay host, và không có trường nào nói thẳng khóa có được đặt; tuy vậy `deployment.bind: "public"` ngụ ý có khóa, vì runtime chỉ bind công khai khi có khóa. `reason` của backend `mujoco_arm` chỉ mang mã và câu cố định, không bao giờ mang nội dung ngoại lệ hay đường dẫn (chi tiết đầy đủ đi vào stderr của runtime, tức nhật ký Cloud Run); `reason` của Webots và IR-SIM giữ như trước.
- Số lần ghép nối sai được đếm **cho cả runtime**, không theo địa chỉ: bất kỳ ai tới được URL đều có thể giữ cho việc ghép nối bị khóa (5 lần sai mỗi phút) dù họ không vào được; các phiên đang có vẫn hoạt động.
- Trình duyệt giữ token phiên trong session storage của tab.
- Với dùng nhiều người hoặc nhiều hơn một lần thử một người: đặt dịch vụ sau một proxy nhận biết danh tính (Identity-Aware Proxy) hoặc giới hạn ingress. **Script không thiết lập điều đó.**
- Khóa chỉ nằm trong Secret Manager; runtime xóa nó khỏi môi trường tiến trình ngay khi khởi động nên tiến trình worker con không thừa hưởng. Lỗi và nhật ký chỉ mang mã, không mang khóa.

## 7. Giới hạn vận hành

- **Một instance** (`max-instances=1`). Run nằm trong bộ nhớ và `/tmp` (D60): mất khi instance dừng hoặc bị thay (deploy mới, xoay khóa, cập nhật biến, thu về 0 khi không có yêu cầu).
- Với `--timeout=3600` (theo tài liệu Cloud Run, cần kiểm tra khi deploy: mục "Hành vi nền tảng đã đối chiếu tài liệu, chưa kiểm trên dịch vụ"), một yêu cầu bị cắt sau thời hạn đó, nên stream sự kiện kết thúc **tối đa mỗi 60 phút**; Lab nối lại từ con trỏ.
- Một run tay máy hoàn tất vẫn có thể giữ slot MuJoCo cho tới khi được archive/đóng. Producer CL01 tự archive run do nó tạo trong `finally`; trong UI, “Chạy lại cùng đầu vào” tự lưu báo cáo và archive run cũ trước khi tạo run mới. Ngắt kết nối chỉ quên thông tin đăng nhập ở tab, không archive run. `MUJOCO_CAPACITY` là hết slot, không phải lỗi vật lý.
- Run chỉ tiến khi Lab gửi bước: đóng tab thì run đứng yên, và instance có thể co về 0 rồi mất run.
- Khi tắt, nền tảng được cho là gửi `SIGTERM` (chưa kiểm trên dịch vụ thực tế); Node là PID 1 và đóng gateway rồi thoát mã 0. Một bước có nhịp đang chạy hoàn tất các tick của nó trước (tối đa khoảng một giây). Run đang có vẫn mất.
- Phiên sống 1 giờ; tối đa 10 phiên cùng lúc. Khi có khóa, một lần ghép nối đúng khóa lúc đã đủ 10 phiên sẽ kết thúc phiên cũ nhất (run của phiên đó được xử lý như run của phiên hết hạn: lần kiểm readiness hoặc tạo run kế tiếp đóng nó và chờ worker dừng, và có thể lấy lại bằng bằng chứng reclaim); ghép nối sai không kết thúc phiên nào.

## 8. Chi phí

Giá tham khảo ngày 2026-11-14: Singapore `asia-southeast1` thuộc [Tier 2](https://docs.cloud.google.com/run/docs/locations). Theo [bảng giá Cloud Run](https://cloud.google.com/run/pricing), tính theo request: 0,0000336 USD/vCPU-giây, 0,0000035 USD/GiB-giây và 0,40 USD/triệu request. Với 1 vCPU và 2 GiB, một giờ instance hoạt động tốn `3600 × (0,0000336 + 2 × 0,0000035) = 0,14616 USD`, trước miễn phí và chiết khấu.

Cloud Run tính cả khởi động, tắt có xử lý SIGTERM và thời gian có ít nhất một request đang xử lý; làm tròn 100 ms. Vì stream SSE là một request đang mở, giữ tab theo dõi có thể tiếp tục phát sinh chi phí dù không gửi bước. `min-instances=0` không làm thời gian đó miễn phí. Chưa gồm Artifact Registry, Secret Manager, Cloud Build nếu dùng và lưu lượng ra; đây không phải hóa đơn dự báo tổng. Free tier được cộng theo billing account. Xem lại giá và đặt ngân sách phù hợp trước khi vận hành lâu dài.

## 9. Tắt dịch vụ

```sh
SERVICE=${SERVICE:-mekoniq-lab-runtime}                                    # cùng tên đã dùng với script
gcloud run services delete "$SERVICE" --region=asia-southeast1 --project=mekoniq
gcloud secrets delete lab-access-key --project=mekoniq
gcloud artifacts docker images delete "$IMAGE" --delete-tags --project=mekoniq   # hoặc xóa cả kho: gcloud artifacts repositories delete lab --location=asia-southeast1 --project=mekoniq
```

Cũng xem lại: nguồn do Cloud Build tải lên (bucket của Cloud Build trong project), khóa nằm trong trình quản lý mật khẩu, tệp khóa tạm còn sót, và ràng buộc IAM đã thêm cho secret (mất theo secret). Xóa dịch vụ làm mất mọi run đang có.

## 10. Không được suy ra

- Từ một lần CL01 đạt không suy ra độ ổn định dài hạn, lifecycle, nhiều người dùng hay mọi cấu hình x86-64 đều đạt. Kết quả áp dụng cho image và revision đã ghi; image amd64 dưới giả lập vẫn thất bại như mô tả ở trên.
- Một run trong container hay trên cloud không phải bằng chứng cho `G-MA1`/`G-MA2` (D50); mọi tham số plant vẫn `not_calibrated`.
- Cách A đã chạy từ clone sạch tại `4f893ac`, frozen lockfile; runtime trong image khớp byte-for-byte với artifact Lab ghim. Các cờ triển khai đã được Cloud Run chấp nhận trong lệnh trực tiếp có thêm service account. Cách B (Cloud Build), gọi toàn bộ script `--execute`, xoay secret và nhánh triển khai lại vẫn chưa được thử thực tế.
- "Công khai + một khóa chung" không phải là kiểm soát truy cập cho nhiều người; nó cũng không ngăn người ngoài làm khóa ghép nối trong một phút.
- Mục 8 là ước tính tài nguyên theo giá đã đọc, không phải tổng hóa đơn; chưa đo độ trễ hay thông lượng trên Cloud Run.
- Qualification R2a hiện giữ `G-CLOUD1=blocked_external` theo ruling ngày 2026-11-13; guard qualification gốc chưa nhận CL01. Guard `cloud-run` riêng kiểm bản bổ sung và xác nhận G-CLOUD1 `tested` khi toàn bộ điều kiện đạt; không sửa bản ghi R2a đã tạo. Chỉ người duyệt có quyền chấp nhận bằng sidecar; không ghi `accepted:true` trong qualification.

## 11. Tham chiếu

`deploy/lab-runtime/README.md` (image, build, đo đạc), `deploy/lab-runtime/cloud-run.sh`, `tests/unit/cloud-run-script.test.ts`, spec `docs/superpowers/specs/2026-11-12-realistic-arm-web-ui-design.md` (D50, D55, D59, D60, SX-49, CL01), `docs/operations/secrets.md`.
