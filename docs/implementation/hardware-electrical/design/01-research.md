# Nghiên cứu — từ R4 và Codebase Merge tới roadmap R5 trở đi

**Ngày:** 2026-11-25 · **Phạm vi:** đọc toàn bộ [discussions.md](discussions.md) (2.794 dòng, 11 chủ đề); đọc code và tài liệu trong `source/` và `lab/`; kiểm từng giải pháp trên nguồn gốc (clone repo tại commit ghi rõ, tài liệu hãng tải về và băm, API registry) và chạy probe trên máy phát triển. Không có thay đổi nào trong `source/`, `lab/`, `trial/`, `web/`.

Báo cáo thô của sáu nhánh nghiên cứu, bằng tiếng Anh, nằm trong [research/](research/); probe nằm trong [probes/](probes/); tài liệu hãng đã tải nằm trong [research/vendor-documents/](research/vendor-documents/) kèm `SHA256SUMS`. Tài liệu này là phần đã đối chiếu. Ký hiệu: **đã kiểm** nghĩa là đọc trực tiếp nguồn gốc hoặc chạy được hôm nay; mọi điều khác được ghi rõ là chưa kiểm.

## 1. Baseline từ repository

| Mục | Giá trị ngày 25/11, sau 08:30 |
|---|---|
| `source` | `main` = `origin/main` = `6285c490`, là merge commit của `r4/virtual-commissioning`; cây trùng `18c906e8`; sạch |
| `lab` | `main` = `origin/main` = `77dcce3`, merge commit; cây trùng `de4d0c3`; pin `0650ecbd`; sạch |
| Cloud Run | `GET /lab/v2/health` báo `sourceCommit` `0650ecbd`, schema hash `353b06e2…`, trùng pin của Lab |
| R4 | `r4-candidate-02` tại source `0650ecbd` / Lab `de4d0c3`: 55/56 case trong record; CLD03 đạt qua bản bổ sung Cloud Run; mọi record `accepted:false`, chưa có sidecar |
| Codebase Merge | Chưa task nào trong M0–M10 chạy: không có `source/apps/lab`, không có `scripts/repo-identity.mjs`, không có clone diễn tập. Điều kiện "R4 đã về `main`" của M7 vừa thỏa |
| Hướng người dùng đã chốt | Mac local và cloud là đích chạy; không chờ Linux hay phần cứng; web là demo; chưa có lịch phần cứng (19/11). Merge sau khi R4 về `main`; Lab ở `lab.mekoniq.app` (20/11) |

Hai repo đổi nhánh trong lúc đợt nghiên cứu đang chạy (một phiên khác merge R4 về `main` lúc 08:30). Cây không đổi byte, nên mọi trích dẫn dòng trong bộ này còn đúng.

**Cập nhật 18:05 ngày 25/11, sau khi tài liệu này được viết.** Bảng trên là trạng thái buổi sáng. Trong ngày Codebase Merge đã chạy tới bước push của M7: `source` `main` = `origin/main` = `c7df3381`, Lab nằm ở `source/apps/lab`, `robot/lab` là symlink, có `scripts/repo-identity.mjs`. Commit source tính theo đường dẫn là `c7df3381`, commit Lab là `dfa9c532`; pin, bản Lab công khai và Cloud Run vẫn `0650ecbd`. Lần gộp sửa 43 file phía source và 22 file phía Lab, thuộc năm loại: đường dẫn, định danh, cấu hình build, test và README. Không file nào dưới `robotics/` hay `packages/contracts/` đổi, nên tool closure, schema và catalog giữ nguyên. Trích dẫn dòng trong tài liệu này là của cây `6285c490`. Một chỗ đã lệch: đoạn băm schema của `scripts/export-lab-runtime.mjs` nay ở dòng 29–34, trước là 28–33. `v2/gateway.ts:294` không đổi.

## 2. Các cuộc trao đổi đã đọc

Mười một chủ đề, đều là câu trả lời của một trợ lý AI cho các bài viết và tài liệu người dùng gửi, theo thứ tự thời gian:

| # | Chủ đề | Đề xuất chính | Thời điểm so với R4 |
|---|---|---|---|
| 1 | Intrinsic Core và OMTS | Belief world, sai số nhận thức, behavior tree, machine tending, hợp đồng `WorkcellJob` | Trước R4; phần lớn đã thành R4.4 |
| 2 | `lidar_localization_ros2` | Không tích hợp; dựng khung benchmark định vị | Trước R4 |
| 3 | Asimov 1 | Manifest chế tạo; PoC nhập humanoid | Giữa R4 |
| 4 | NVIDIA SimReady | Thư viện tài sản; asset registry | Giữa R4 |
| 5 | LeKiwi, Ekumen, mujoco-robotics-lab | Teleop và ghi demonstration; oracle Pinocchio; imitation learning | Giữa R4 |
| 6 | Chiến lược sau R4 và merge | "Engineering & Lifecycle Platform"; roadmap R5–R7 | Sau thiết kế merge |
| 7 | BIM2Bot Lab | Facility Intelligence; nhánh R5-S; roadmap R5–R8 | Sau #6 |
| 8 | 3D Industrial HMI | Equipment Inspector, tag binding, cảnh báo trong 3D | Sau #7 |
| 9 | Vetaion | Manufacturing Intelligence; Configure-to-Quote | Sau #8 |
| 10 | Drive-Integrated I/O | Ba phương án HW-A/B/C; I/O Allocation Compiler; tám hợp đồng; R5-00…09 | Sau #9 |
| 11 | AI + QElectroTech | Nhánh R5-E; bộ sinh sơ đồ; AI soạn bản nháp | Cuối cùng |

Hai nhận xét về cách dùng các cuộc trao đổi này:

- Chúng tự nhận nhiều lần là "chưa chạy thử", "đề xuất kiến trúc, không phải khả năng đã chứng minh". Bộ này coi mọi con số trong đó là giả thuyết cho tới khi kiểm.
- Cụm "roadmap chúng ta vừa thống nhất" là lời của trợ lý. Không có quyết định nào của người dùng được ghi trong file. Sáu phiên bản roadmap chồng nhau được hợp nhất ở [roadmap §2](02-roadmap.md#2-sáu-phiên-bản-roadmap-trong-các-cuộc-trao-đổi).

## 3. Phát hiện từ code

Các cuộc trao đổi viết như thể "nền tảng phần cứng" phải dựng từ đầu. Đọc code cho thấy điều ngược lại.

| Phát hiện | Nguồn | Hệ quả |
|---|---|---|
| Có catalog linh kiện với 13 `ComponentRevision`, mỗi cái có cổng `mount`/`power`/`data` (dải điện áp, dòng liên tục, giao thức, `pinoutRevision`), tài liệu có digest và blob, model actuator/sensor. 28 blob, 7,6 MB | `source/robotics/catalog/` | Hồ sơ thiết bị là tầng tiếp theo, không phải hệ mới |
| `resolveAssembly` kiểm hướng nguồn, giao dải điện áp, ngân sách dòng, khớp giao thức, cổng dùng lại; sinh BOM có `missingPriceLineIds`, `incompleteTotal` và trường `requiredAccessories` đang rỗng | `engineering/assembly.ts:90-112`, `:262-275` | Kiểm điện ở mức cổng đã có; R5 thêm mức chân. Giắc và dây vào đúng trường rỗng |
| Báo giá chỉ hợp lệ khi dẫn tới tài liệu linh kiện đã khai; thiếu giá là "chưa biết", không bao giờ là 0. Catalog hiện có **0 báo giá** | `engineering/catalog.ts` | Mọi so sánh chi phí hôm nay sẽ cho "chưa so được"; đó là kết quả đúng |
| Nguồn `manufacturer`/`measured` phải dẫn tới tài liệu đã khai đúng digest, nếu không là `PROVENANCE_UNRESOLVED` | `catalog.ts` | Quy tắc truy nguồn dùng lại nguyên vẹn |
| Năm schema bị đóng băng theo hash bởi baseline R2a: `engineering-component`, `lab-project-v2`, `lab-fault-schedule`, `arm-cell-scene-v1`, `arm-scene-3d-v1`, cùng 25 file fixture xArm và lock MuJoCo | `scripts/native-sim/r2a-arm-baseline.json` | `Port`, `ComponentRevision` và world chữ nhật không sửa được; mọi thứ mới là file schema anh em |
| `schemaHash` là hash của **mọi** file trong thư mục schema; thêm một file là đổi hash, đổi `portableToolsDigest`, đổi closure native; gateway từ chối client lệch hash | `scripts/export-lab-runtime.mjs:28-33`, `v2/gateway.ts:294` | Mỗi task thêm schema kéo theo re-pin; bản web công khai lệch runtime cho tới lần deploy |
| Type sinh ra chỉ gồm file có tên trong các bảng cứng của `generate-contracts.mjs` | `scripts/generate-contracts.mjs` | Schema mới phải được thêm vào bảng, nếu không sẽ không có type |
| Ứng viên motor trong repo là Oriental Motor BLV-R (chỉ có trang hãng, `license: unreviewed`). Worksheet tính tải cho 35 kg, bánh 0,10 m, 0,8 m/s, 0,5 m/s²: 1,2 N·m liên tục và 2,4 N·m đỉnh mỗi bánh ở 76 vòng/phút | `robotics/catalog/selection.md` | Khoảng 10 W cơ mỗi bánh. Cuộc trao đổi #10 giả định 150–200 W và lấy drive EtherCAT 200 W làm ví dụ |
| Hồ sơ commissioning cho chassis ZLTECH và WHEELTEC S100 đã có schema, validator Python và test; mọi giá trị hãng `null`, `blocked_external`. Tài liệu ghi: không điền từ trí nhớ hay từ web | `robotics/hardware/profiles/`, `docs/operations/robot-commissioning.md` | Cùng kỷ luật áp dụng cho hồ sơ thiết bị của R5 |
| Đã có `EngineeringCandidate` và `LabDeploymentCandidate` (có `readiness[]`, danh sách file, checksums) và `PhysicalTargetDossierV1` | `packages/contracts/schemas/` | Gói ứng viên phần cứng theo đúng mẫu đó |
| Mức trưởng thành của nhóm `drive` đọc `sources` của fixture drive; cả bảy nguồn của `serve-drive-nominal-v1` đang `assumed` | `engineering/maturity.ts`, `fixtures/drive-v1/` | Hồ sơ có nguồn hãng tự nâng mức, không cần cơ chế mới |
| Drive ảo đã có `quick_stop`, `fault` chốt, `onDisable: coast\|brake`, `trip(EXTERNAL_TRIP)`; báo cáo lỗi đã có `ticksToRest` và `baseTravelM`. Controller chưa bao giờ phát `quickStop` | `mujoco_worker/drive_model.py`, `control-evidence-v1`, `diff-drive-base.ts` | Hành vi dừng là ánh xạ cộng metric, không phải máy trạng thái mới |
| `FaultOracleV1` cố định đúng 8 lỗi, `FaultReportV1` đúng 6 invariant | `control-evidence-v1` | Lỗi I/O và dừng cần oracle và báo cáo riêng |
| Scene điều hướng đã nhận vật cản đa giác; bộ lập đường `grid-diff-v1` nhận biết footprint; kiểm chồng lấn chỉ đúng với đa giác lồi | `navigation-scene-v1`, `v2/navigation2d/` | R6 không cần engine mới, cần tách lồi |
| Trang Lắp ráp của Lab đã có chọn linh kiện, nối cổng, vấn đề, compile, BOM, ước lượng drive/năng lượng/ổn định | `lab/src/ui/assembly-page.ts`, `lab/src/cost/`, `lab/src/estimates/` | Giao diện R5 là một phần mới của trang này |
| Platform có 15 migration; domain có `fleet` (admission, map-binding, mission, reservations…), `inventory` và `procurement` của **nhà hàng**; không có khái niệm robot là tài sản theo serial, hợp đồng thuê hay tiền cọc | `packages/domain/src/`, `supabase/migrations/` | Vòng đời tài sản là phần mới thật sự, và chưa có đối tượng thật để gắn vào |

Bản đồ code do agent lập bị dừng giữa chừng vì giới hạn sử dụng; phần hợp đồng đã xong và nằm ở [research/code-map-runtime-partial.md](research/code-map-runtime-partial.md). Các phần còn lại (engineering, catalog, điều hướng, control, worker, recorder, Lab) tôi đọc trực tiếp.

## 4. Nguồn ngoài đã kiểm

### 4.1 Drive, I/O và an toàn

Bốn ứng viên, đọc từ tài liệu gốc đã tải và băm:

| | Oriental Motor BLV-R + BLVD-KRD | ZLTECH ZLAC8015D | Leadshine ELD3-EC70xx | Leadshine 2ELD2-CAN |
|---|---|---|---|---|
| Loại | Motor BLDC có hộp số + driver một trục | Driver hai kênh cho bánh hub servo | Drive servo DC một trục | Drive hai trục |
| Nguồn, công suất | 24–48 VDC; 60/100/200 W | 24–48 VDC; 15 A định mức mỗi kênh | 24–70 VDC + nguồn logic 24 V riêng; 50–750 W | 24–70 VDC; 2×20 hoặc 2×30 A |
| Bus | Modbus RTU và CANopen; máy trạng thái CiA 402; chế độ pp, pv, hm, tq; **không có csv/csp** | CANopen (CiA 301 + 402) và Modbus RTU | EtherCAT CoE; có csp, csv, cst | CANopen CiA 301/402; pp, pv, pt, hm |
| DI trực tiếp | 4, 12–30 VDC; xuất xưởng là ID-SEL0, ID-SEL1, STOP, FREE; gán lại được | **2**, mức 5 V; chức năng gán qua bus và **mất sau mỗi lần cấp nguồn** | 6, 12–24 VDC; ba chân mặc định là giới hạn và home, hai chân là probe | 4 mỗi trục |
| DO trực tiếp | 2, tối đa **10 mA** | 2 | 3, chung một chân chung | 2 mỗi trục, dưới 80 mA |
| Ngắt mô-men | Có, hai kênh và đầu ra giám sát; manual ghi được TÜV SÜD chứng nhận theo IEC 61800-5-2, IEC 61508, ISO 13849-1:2023; mức SIL/PL và số chứng chỉ **không có** trong manual | **Không có**; manual yêu cầu tự dựng mạch dừng khẩn bên ngoài | Hai kênh; manual ghi "SIL3" nhưng chứng chỉ duy nhất công bố là EMC | Có chứng chỉ công bố nêu đúng model: SGS-TÜV Saar, SIL 3, PL e Cat. 3 |
| File mô tả | Không thấy EDS trong ba manual | Không có trên trang tải | ESI có, đã băm | EDS có, 545 đối tượng, đã băm |
| So với tải 10 W | Bản 60 W đúng cỡ, dư khoảng 6 lần | Quá cỡ; chấp nhận được như hàng phổ thông rẻ | Bản 200 W quá cỡ 20 lần | Quá cỡ khoảng 40 lần |
| Giá | Driver 499 USD (giá web Mỹ); motor và giá châu Á chưa kiểm | Không tìm thấy | Giá trên trang hãng là số giữ chỗ | Chưa kiểm |

Những điểm các cuộc trao đổi nói đúng, sai hoặc thiếu:

- **Đúng:** STO là dừng loại 0, xe trôi theo quán tính. Chứng chỉ của 2ELD2 ghi trạng thái an toàn là ngắt mô-men "theo IEC 60204-1 stop category 0"; tài liệu của Schneider ghi drive "coasts to a stop" và STO "nhằm ngăn khởi động ngoài ý muốn, không phải để dừng motor"; manual của Oriental Motor ghi phanh motor chỉ để giữ, không để hãm.
- **Đúng có điều kiện:** thông số của ELD3-EC7005BH. Nhưng manual tự mâu thuẫn (một mục ghi 8 DI và 48 VDC, bảng chân và trang web ghi 6 DI và 24–70 VDC), và không rõ nó lái được motor hub của hãng khác.
- **Sai về cỡ:** tải trong repo là 10 W mỗi bánh, không phải 150–200 W.
- **Thiếu:** với driver ZLAC8015D mà hướng "hai hub servo và driver hai kênh" dựa vào, phương án HW-A (I/O trên drive) **không khả thi**: hai DI mức 5 V, không có đường ngắt mô-men.
- **Thiếu:** "tương thích CiA 402" không cho biết chân nào hiện ở đâu trên bus. Ở Leadshine, 60FDh bit 4–17 là DI1–DI14 và 60FEh:01 bit 16–21 là DO; ở Oriental Motor, 60FDh bit 3 là trạng thái đường ngắt mô-men và 60FEh:01 lái "đầu vào từ xa", không phải chân. Chính CiA cũng cảnh báo có hãng chỉ làm một phần mà vẫn tuyên bố tuân thủ. Mặc định của lựa chọn quick stop (605Ah) cũng khác nhau giữa các hãng.
- **Đã thử:** ESI và EDS đọc được bằng thư viện chuẩn của Python. Chúng chứa từ điển đối tượng và ánh xạ PDO; không chứa số chân, mức điện áp hay dòng.

Tiêu chuẩn: trang iso.org và webstore ANSI trả 403 cho mọi lần truy cập, nên **phiên bản hiện hành của ISO 13482, ISO 3691-4, ISO 12100 và UL 3300 chưa kiểm được**. Lần cuối thấy được, ISO 13482 phiên bản 2 (robot dịch vụ, gồm cả thương mại) ở giai đoạn FDIS; công bố hay chưa thì chưa rõ. ISO 13849-1:2023 được chính hai tài liệu hãng dẫn. Tiêu chuẩn sản phẩm gần nhất cho robot giao món trong nhà là ISO 13482; ISO 3691-4 là cho xe công nghiệp không người lái và chỉ hữu ích như tham chiếu phương pháp thử. Quy định riêng của Việt Nam chưa kiểm.

### 4.2 Tài liệu điện và công cụ vẽ

- **QElectroTech.** Mọi khẳng định của cuộc trao đổi #11 là thật, kiểm trong clone tại `ec35bab`: phiên bản `0.200.1`, CLI headless (`--export-pdf`, `--export-bom`, `--export-wiring`, `--export-nets`, `--query`…), API scripting JavaScript với 166 hàm, máy chủ MCP `qet_mcp.py` với 42 công cụ và 449 test, `.qetz`. Nhưng tất cả mới 1,5–5,5 tháng tuổi và **chỉ có trong bản nightly chưa phát hành**; bản ổn định 0.100 (25/01/2026) không có thứ nào. Xuất không màn hình cần `QT_QPA_PLATFORM=offscreen`; README của MCP ghi bộ test "chưa được thử trên Windows hay macOS". Chưa ai trong đợt này chạy QET. Chi phí thật của một bộ sinh `.qet` là đặt ký hiệu, tự vẽ ký hiệu (bộ ký hiệu của QET có điều khoản riêng, gồm cấm dùng làm dữ liệu huấn luyện) và định danh đầu dây; ước lượng 14–26 ngày của cuộc trao đổi là lạc quan.
- **WireViz** 0.4.1 (07/2024), GPL-3.0, còn sống nhưng chậm. Cần Graphviz; máy phát triển không có `dot`. Probe: một bó ba dây sinh hai lần cho SVG, HTML và BOM trùng byte. WireViz gộp chiều dài theo tiết diện và màu, nên danh sách dây từ–đến phải do MEKONIQ sinh.
- **elkjs** 0.12.1, EPL-2.0, 1,6 MB, chạy tất định trong Node với cổng và đi dây vuông góc.
- **KiCad** 10: có `kicad-cli sch erc` và xuất netlist/BOM/PDF; image chính thức chỉ có amd64, 812 MB. Hợp khi MEKONIQ tự thiết kế PCB, không hợp cho khoang điện.
- **AI vẽ sơ đồ.** Không tìm thấy bài đăng mà cuộc trao đổi dẫn. Ba công trình công bố tìm được có cùng một mẫu: mô hình viết mô tả ngữ nghĩa, công cụ tất định giữ hình học và kiểm tra. Đó đúng là cách chia mà bộ này chọn (R5-D11).
- **Bảng dòng cho phép theo tiết diện.** IEC 60204-1 bảng 6 là trích dẫn đúng nhưng giá trị không lấy được từ nguồn miễn phí. Chính sách đấu dây là `assumed` cho tới khi ghim được bảng.

### 4.3 Không gian, BIM và mặt bằng

- **BIM2Bot Lab** là thật (MIT, clone tại `63d0df9`, 22/11/2026): 12.002 dòng JSX, không test, không CI, dùng web-ifc 0.0.35 của năm 2022 nạp từ CDN. Các tính năng cuộc trao đổi liệt kê đều có, với giới hạn: cửa là hộp song song trục, robot hình tròn, bề rộng thông thủy là `OverallWidth − 0,08 m` cố định, ô lưới nhớ id nội bộ của file chứ không nhớ GlobalId, bộ mô phỏng đội xe cho robot kẹt "đi xuyên" sau 6 giây, và khi không tìm được sàn thì coi cả tầng là sàn. Lấy ý tưởng: phần tử gây cản gần nhất làm lời giải thích, nhãn bước trên mỗi dữ kiện suy ra, checklist readiness. Không lấy code.
- **web-ifc** 0.0.81 (MPL-2.0) và **IfcOpenShell** 0.9.0.post1 (LGPL-3.0, wheel cho macOS arm64 và manylinux x86-64; cài 165 MB) đọc cùng số liệu trên file mẫu KIT: IFC4, mét, hai tầng, 7 không gian, 5 cửa. web-ifc mất 181 ms, IfcOpenShell 3,9 s nhưng cho thêm quan hệ cửa–lỗ mở–tường và dữ liệu khuôn. Lát cắt ở một độ cao là sai: cửa sổ mở bao ở 1,0 m, đầu cửa đóng bao ở 2,2 m; phải dùng dải cao.
- **Fixture:** một file IFC 8,9 KB tự sinh, hai lần sinh trùng byte. File mẫu có giấy phép rõ: IfcOpenHouse (CC0), buildingSMART Simple-Scene (CC BY 4.0), KIT FZK-Haus. Không commit Duplex.
- **Kiểm khoảng hở:** probe 60 dòng cho đúng dạng câu giải thích cần có, hai lần chạy trùng kết quả.
- **Chuẩn mượn khái niệm:** thông điệp bản đồ tòa nhà của Open-RMF (Apache-2.0); VDA 5050 đã lên 3.0.0, định dạng mặt bằng LIF 1.0.0 là hướng dẫn riêng của VDMA; Nav2 map YAML và bộ lọc costmap.
- **Không có BIM:** đường rẻ nhất là dựng tay cộng vẽ lại trên ảnh có tỉ lệ hai điểm, kèm đo thước vài cửa và lối quan trọng. RoomPlan của Apple xuất được JSON có tường, cửa, vật thể kèm kích thước, nhưng cần ứng dụng iOS riêng. `ezdxf` 1.4.5 là MIT.

### 4.4 Chế tạo, vòng đời và cho thuê

- **Vetaion:** vòng pre-seed 5,7 triệu euro ngày 19/11/2026 được xác nhận từ ba nguồn. Trang chủ của chính họ ghi dây "được chế tạo bằng máy rồi **đấu tay**". Bài học đúng là đường ống dữ liệu từ file thiết kế tới hướng dẫn chế tạo và biên bản thử, không phải robot.
- **Dựng hay dùng sẵn:** InvenTree 1.7.4 (MIT) đã có gần hết danh sách R6 của các cuộc trao đổi: BOM có linh kiện thay thế, đơn chế tạo, hàng tồn theo serial, "lắp trong", mẫu test và kết quả test, báo giá theo bậc. Nó thiếu: MBOM riêng, hợp đồng thuê và tiền cọc, giới hạn và dụng cụ đo trên kết quả test, hash cấu hình. Nó cần máy chủ chạy liên tục, không hợp Vercel. Odoo Community thiếu đúng Rental, PLM và Quality (chỉ có ở bản Enterprise).
- **Giá thuê robot giao món:** Mỹ 279–519 USD mỗi tháng (7,2–13,4 triệu đồng), Nhật 30.000–100.000 yên, Malaysia 1.500–3.000 ringgit. **Không tìm thấy giá công khai nào bằng đồng Việt Nam.** Tỷ lệ tiền thuê trên giá mua ở Mỹ khoảng 2,8 % mỗi tháng; mô hình trong tài liệu gốc thu 8 %. Nghĩa là biên lợi nhuận đến từ giá vốn thấp chứ không từ giá thuê cao, và một nhà nhập khẩu có thể chào cùng giá với robot có thương hiệu. Lương tối thiểu vùng I là 5,31 triệu đồng mỗi tháng.

Kiểm lại bằng số mô hình cho thuê một robot ([probes/raas_sanity.py](probes/raas_sanity.py), đơn vị triệu đồng, 60 tháng, mọi tham số ngoài hai dòng đầu là giả định của tôi để xem độ nhạy):

| Kịch bản | Tháng thu | Đóng góp | Giá trị hiện tại (15 %/năm) | Hoàn vốn |
|---|---|---|---|---|
| Tài liệu gốc: vốn 100, thuê 8, 58 tháng thu, chi khác 69 | 58 | 295,0 | 184,1 | tháng 15 |
| Vốn 100, thuê 8, hợp đồng 12 tháng, trống 3 tháng | 45 | 197,9 | 116,9 | tháng 20 |
| Vốn 100, thuê 5, hợp đồng 12 tháng, trống 3 tháng | 45 | 58,2 | 15,3 | tháng 37 |
| Vốn 100, thuê 8, hợp đồng 6 tháng, trống 3 tháng | 36 | 134,5 | 68,4 | tháng 24 |
| Vốn 30, thuê 5, hợp đồng 12 tháng, trống 3 tháng | 45 | 128,2 | 85,3 | tháng 9 |
| Vốn 30, thuê 3, hợp đồng 6 tháng, trống 3 tháng, dịch vụ 1,5 | 35 | −20,2 | −22,6 | không |

Phép trừ 464 − 169 = 295 của tài liệu gốc đúng, nhưng chỉ riêng chi phí vốn đã lấy đi hơn một phần ba. Hai biến chi phối là giá vốn và tỷ lệ thời gian có hợp đồng. Hệ quả cho roadmap: thứ đáng làm trước là hạ và **kiểm** giá vốn (R5) và kiểm nhu cầu bằng gói đánh giá có trả phí (R6), không phải phần mềm quản lý hợp đồng thuê. Kế hoạch GTM ngày 14/11 cũng đã ghi mô hình cho thuê chỉ mở khi có số thật về vốn, tỷ lệ hỏng, thời gian dừng và giá trị còn lại.

### 4.5 Physical AI và oracle động lực học

- **Pinocchio làm oracle: chạy được hôm nay trên Mac.** `pin` 4.1.0 và `mujoco` 3.17.0 trên Python 3.11.15, dữ liệu của fixture xArm 6, 20 cấu hình ngẫu nhiên: sai lệch vị trí TCP 2e-16 m, Jacobian 9e-16, mô-men trọng lực 1,4e-14 N·m, ma trận khối lượng 1,8e-15. Phải căn: thứ tự khớp kẹp (ánh xạ theo tên), armature (không có trong URDF; thiếu thì lệch đúng 0,100), quy ước Jacobian (`LOCAL_WORLD_ALIGNED`), thứ tự quaternion. Hai bên cùng lấy số từ fixture, nên oracle bắt lỗi của engine và của compiler, không bắt được khối lượng sai. Chưa chạy trên đầu ra của compiler thật và chưa chạy trên Linux.
- **LeRobot** 0.7.0 đòi Python ≥ 3.12 và luôn kéo torch (139 MB trên macOS arm64, 539 MB trên Linux x86-64); định dạng dataset v3.0. Không vào được venv 3.11 của worker.
- **Ekumen lekiwi** ghim `lerobot==0.4.0`; LeRobot 0.7 đã đổi giao thức dây (thông điệp nhiều phần), nên host mô phỏng của Ekumen không phục vụ được client hiện tại. Tên lệnh trong README sai đúng như cuộc trao đổi nói. Model của họ nạp được trên MuJoCo 3.17.0 nhưng mất cấu hình nón ma sát elliptic khi ghép.
- **Render offscreen** bằng `mujoco.Renderer` chạy không cần cửa sổ trên Mac: 3,3–3,7 ms mỗi khung ở cả 320×240 và 640×480. Đường render không GPU trên Cloud Run chưa kiểm.
- **Kết quả âm đáng học** của mujoco-robotics-lab được xác nhận nguyên văn: policy huấn luyện sạch, suy luận 37 Hz, đạt 3/12 lượt và bỏ qua câu lệnh.

### 4.6 Tài sản mô phỏng và các stack nặng

- **SimReady:** 2.919 gói, 518 GB, CC BY 4.0, không khóa truy cập; đã kiểm. Phần "cấu hình vật lý cho MuJoCo" là lớp ghi đè USD, **không phải MJCF**; không gói nào có XML. Gói tủ bếp mà cuộc trao đổi chọn làm PoC nặng 268 MB, trong đó 245 MB là texture lưu hai lần. Chuyển một cốc giấy sang MJCF cần MuJoCo 4.0.1 cùng `mujoco-usd` (mới ra 06/11/2026, thử nghiệm), ba bước vá tay, và kết quả mất ma sát (1,0 thay vì 0,7), quán tính bị tính lại, collision là một bao lồi đặc.
- **MuJoCo 4.0.1 đã phát hành.** Lane nâng engine của R4 vì thế có đối tượng cụ thể.
- **Nguồn MJCF sẵn:** Google Scanned Objects bản MJCF (1.030 vật, CC BY 4.0) đọc được thẳng bằng engine đang ghim; RoboCasa (MIT và CC BY 4.0) có nội thất bếp có khớp nhưng cần tải 10 GB.
- **Asimov-1:** giấy phép đúng như cuộc trao đổi nói (CERN-OHL-S-2.0, GPL-2.0). Hai model nạp được trên 3.17.0; bản 25 bậc tự do không khai actuator nào, bản 27 chỉ khai hai motor kẹp. Manifest chế tạo có đúng 167 mục, mỗi mục bốn trường, sinh từ cây thư mục và có bước kiểm lệch trong CI; nó kiểm tên file, không kiểm nội dung. Thiếu so với một BOM mua hàng: số lượng, revision, hash file, vật liệu, nhà cung cấp, giá.
- **Intrinsic Core:** không đổi so với lần kiểm 19/11: Ubuntu 26.04 x86-64, tối thiểu 32 GiB, không có đường ARM hay macOS, bốn bài hướng dẫn vẫn "Coming Soon", không có adapter xArm.
- **Isaac Sim** cần GPU RTX và không chạy trên macOS. **`lidar_localization_ros2`**: bảng số của cuộc trao đổi khớp tài liệu tác giả, kể cả ca khôi phục sai 128 m.

## 5. Các hướng đã cân nhắc

### 5.1 Hướng tổng thể

| Hướng | Đánh giá |
|---|---|
| A. Làm đúng "R5 gộp" của các cuộc trao đổi: phần cứng, điện, không gian, chẩn đoán 3D, QElectroTech, AI soạn thảo | Bốn nhánh trong một release; hai nhánh chưa có ước lượng; trộn việc xếp lịch được với việc phải chờ. Loại |
| B. Chỉ làm hợp đồng và validator, không giao diện, không mô phỏng | Rẻ nhất, nhưng không tạo ra thứ để trao đổi với Hoàng Anh hay để trình cho nhà đầu tư. Là mức cắt tối thiểu (R5.1–R5.2) |
| **C. R5 tập trung phần cứng và điện trên nền engineering sẵn có; R6 là mặt bằng; phần chế tạo và AI theo điều kiện** | Chọn. Mỗi release nhỏ hơn R4, có đầu ra dùng được, và không phần nào chờ phần cứng |
| D. Làm mặt bằng trước phần cứng | Hợp lý nếu gói đánh giá có trả phí sắp bán. Vì hai nhánh gần như không chung code, C cho phép chạy song song thay vì phải chọn |

### 5.2 Từng chủ đề

| Chủ đề | Phương án đã xem | Chọn | Lý do |
|---|---|---|---|
| Nơi đặt hồ sơ thiết bị | Sửa `ComponentRevision`; hệ profile riêng; tài liệu anh em trong catalog | Tài liệu anh em | Schema linh kiện bị đóng băng; catalog đã có truy nguồn và blob |
| Thiết bị thuần điện | Thêm vào assembly cơ khí; danh sách riêng trong thiết kế điện | Danh sách riêng | Giữ `assemblyDigest` và mọi golden; không đụng ba compiler |
| Nhập hồ sơ từ EDS/ESI | Sinh hồ sơ tự động; gõ tay; gõ tay cộng kiểm chéo | Gõ tay cộng kiểm chéo | File mô tả không có chân và thông số điện; kiểm chéo bắt lỗi gõ mà không thêm bước duyệt bản nháp |
| Thuật toán phân bổ | Tham lam; quay lui; ghép cặp cực đại | Ghép cặp cực đại (Kuhn) | Tất định, đủ nhỏ, và phân biệt được "không có cách nào" với "cách này không được" |
| Tài liệu đấu dây | QElectroTech; KiCad; WireViz; file của riêng mình | CSV và Markdown của riêng mình, cộng YAML cho WireViz | Người đấu dây cần bảng; hình bó dây là tùy chọn; QET chưa phát hành phần tự động |
| Sơ đồ trong Lab | elkjs; cột cố định | Cột cố định | Không thêm dependency cho hình tổng quan; elkjs là đường nâng cấp đã thử |
| AI soạn thảo | Khung chat trong sản phẩm; máy chủ MCP của QET; agent sửa JSON ngoài sản phẩm | Agent ngoài sản phẩm | Độ tin cậy đến từ validator; ba công trình công bố đều chia theo cách này |
| Hành vi dừng | Máy trạng thái an toàn mới; ánh xạ vào cơ chế R4 | Ánh xạ | `quick_stop`, `trip`, `onDisable` và metric quãng đường đã có |
| I/O ảo | Mọi tín hiệu; chỉ tín hiệu đổi hành vi | Bumper và trạng thái E-stop | Đèn, còi, dock không đổi kết quả mô phỏng nào |
| Chẩn đoán 3D | HMI có tag sống từ runtime; panel trên evidence của run | Panel trên evidence | Không mở kênh dữ liệu mới; đúng với "web là bề mặt demo" |
| Bộ nhập IFC | web-ifc trong trình duyệt; IfcOpenShell trong worker của runtime; IfcOpenShell trong tool venv | Tool venv | 165 MB và LGPL không vào image; quán nhỏ hiếm khi có IFC |
| Kiểm khoảng hở | shapely trong Python; lưới và bộ lập đường TS sẵn có | TS sẵn có | Chạy được ở runtime và cloud không thêm dependency |
| Sổ chế tạo | InvenTree ngay; model riêng; CSV và Git | CSV và Git, có điều kiện chuyển | Dưới năm chiếc không đáng vận hành thêm một máy chủ |

## 6. Điều chỉnh có chủ ý so với các cuộc trao đổi

| Cuộc trao đổi đề xuất | Bộ này làm | Vì sao |
|---|---|---|
| Tám hợp đồng mới cho phần cứng | Sáu file schema; `IOPoint` và `DriveCapability` nằm trong hồ sơ thiết bị; `WiringManifest` là netlist của bundle; `DeviceConformanceReport` để lane bàn thử | Mỗi file schema là một lần đổi `schemaHash` và một lần re-pin |
| `safetyRated` là boolean | Tuyên bố an toàn là câu nguyên văn kèm tài liệu, vị trí trích và chứng chỉ nêu đúng model | Cùng một hãng có dòng có chứng chỉ và dòng chỉ ghi trong manual |
| Mức hồ sơ `candidate → documented` do người nâng | Hàm thuần của tài liệu và nguồn | Cùng nguyên tắc với mức trưởng thành của model ở R4 |
| Vendor Profile Importer | Kiểm chéo với bản tóm tắt EDS/ESI | Xem §5.2 |
| HW-A là "ứng viên ưu tiên" với drive EtherCAT 200 W có STO | Ba phương án theo cấu trúc, thiết bị lấy từ tài liệu đã đọc; phương án đúng cỡ là BLV-R 60 W | Tải thật là 10 W mỗi bánh; driver hai kênh phổ thông không làm được HW-A |
| Drive I/O Virtual Plant cho mọi tín hiệu | Hai điểm DI và ba lỗi; phần còn lại chỉ ở tầng phân bổ | R5-D27 |
| IO08 "E-Stop/STO trong mô phỏng" là một ca test | Một campaign 16 run so bốn kiểu dừng trên khay ba cốc, có câu gợi ý và bài đo đề xuất | Đây là kết quả ảnh hưởng trực tiếp tới việc chọn phanh và drive |
| Bộ sinh QElectroTech và AI soạn bản nháp nằm trong R5 | Lane L-QET; AI nằm ngoài sản phẩm | §4.2 |
| Spatial Intelligence là nhánh của R5 | R6 riêng, chạy song song được | Một release, một câu hỏi |
| Manufacturing & Lifecycle là R6, ưu tiên P0 | R7, và chỉ R7.1 xếp lịch được | Chưa có robot nào để gắn serial; InvenTree đã có phần lớn tính năng |
| Fleet simulation, thang máy, nhiều tầng | Một bảng so 1 và 2 robot bằng IR-SIM sẵn có; phần còn lại là lane | Bộ mô phỏng của BIM2Bot không đủ tin để port |
| Equipment Registry và Live Tag Binding là hợp đồng mới | Suy từ id trục và id thiết bị đã có | Không thêm hợp đồng khi một quy ước đặt tên đủ |
| LeKiwi làm nền tảng tham chiếu | Lát cắt trên worker xArm 6 sẵn có | Giao thức của Ekumen đóng băng ở LeRobot 0.4.0 |
| Số task nối tiếp và gate `G-R5-SW` | Task E00–E21, chín gate theo đợt | Bàn giao từng phần cần gate theo đợt |

## 7. Câu hỏi mở chuyển thành việc kiểm

| Câu hỏi | Kiểm ở đâu |
|---|---|
| Thêm `deviceProfiles` vào `catalog.json` và file mới dưới `robotics/catalog` có làm đổi golden hay closure nào ngoài dự kiến không? | E01 |
| Các compiler và recorder hiện có có đọc trọn thư mục catalog theo cách bị file mới làm hỏng không? | E01 |
| Run khảo sát của `MJ-TRAY01` đạt tốc độ hành trình ổn định ở tick nào, và 0,8 m/s có đạt được trên drive giả định không? | E13 |
| Vật cản thấp hơn mặt phẳng LiDAR có tạo tiếp xúc sạch, lặp lại trùng bit trên `MJ-IO01` không? | E14 (spike) |
| Mẫu của `pv` (ramp do drive tạo) có biểu diễn đủ bằng `accelerationLimit` của control profile không, hay cần trường mới trong drive model? | E11 |
| Phép chiếu từ mô hình không gian sang world đóng băng có giữ được mọi màn hình cũ của Lab không? | S00 của R6 |
| Đầu ra của tool nhập IFC có trùng giữa arm64 và x86-64 không? | Chỉ khi cần chạy tool trên CI |

## 8. Không kiểm được

- Phiên bản hiện hành của ISO 13482, ISO 3691-4, ISO 12100, IEC 60204-1 và UL 3300: các trang nguồn từ chối truy cập.
- Mức SIL/PL và số chứng chỉ của đường ngắt mô-men trên BLVD-KRD; khả năng ELD3 lái motor hub của hãng khác; giá ZLAC8015D và giá châu Á của BLV-R.
- Giá thuê robot giao món tại Việt Nam; thuế giá trị gia tăng trên tiền thuê; quy định riêng của Việt Nam về an toàn robot dịch vụ.
- QElectroTech chưa được chạy; xuất PDF không màn hình và độ ổn định theo byte chưa được chứng minh.
- Bài viết gốc về "HMI 3D bằng file HTML" mà cuộc trao đổi #8 dựa vào: không ai mở được, kể cả đợt này.
- Render không GPU trên Cloud Run; mọi probe Python trên Linux x86-64.
- Bản đồ đầy đủ của Lab và của phần platform do agent lập: bị dừng vì giới hạn sử dụng; phần cần cho plan đã được đọc trực tiếp, phần còn lại do E00 và S00 đọc lại.
