# MEKONIQ — offline nhiều thiết bị, phục hồi mạng và nhập bù bảo trì

Ngày: 2026-10-30. Trạng thái: **thiết kế đề xuất, chưa triển khai/kiểm thử trong source**.

Spec này là phần đầu cần hiện thực cùng nền tảng trong [thiết kế production](2026-10-30-production-platform-design.md). Yêu cầu đã xác nhận: cloud, không máy chủ riêng; nhiều POS/KDS/robot phối hợp khi mất WAN; lưu dữ liệu từng máy khi LAN mất; nhập lại dữ liệu của giai đoạn bảo trì toàn bộ.

## 1. Nguyên tắc không được vi phạm

1. Giao dịch đã ghi nhận không bị mất chỉ vì mất ACK hoặc đổi cấu hình/cloud.
2. Một robot, bill hoặc phiên bàn dùng chung không có hai bên tự coi mình là chủ ghi.
3. Không suy diễn “không nhận phản hồi” là “chưa thực hiện”.
4. Không tự phát lệnh di chuyển/thu tiền/in/xuất hóa đơn khi replay lịch sử.
5. Dữ liệu nhập muộn giữ thời điểm phát sinh, thời điểm nhập và nguồn chứng cứ riêng.
6. Ghi nhận cục bộ, nhà hàng đã nhận xử lý và cloud đã đồng bộ là ba mức khác nhau, thể hiện rõ trên UI.
7. Khi các thiết bị không có đường liên lạc, không thể hứa trạng thái dùng chung tức thời. Cho phép ghi độc lập theo phạm vi và đối soát sau, không che xung đột.

## 2. Các thành phần cục bộ

### 2.1 Ứng dụng Android trên mỗi tablet

- Bundle UI và danh mục/cấu hình được lưu trước để khởi động không cần tải cloud.
- SQLite giữ projection được phép xem, journal, inbox, outbox, attachment manifest và các cursor đã xác nhận.
- Native plugin thực hiện transaction và cấp sequence. Không dùng localStorage cho sổ giao dịch.
- Keystore giữ device key. Dữ liệu nhạy cảm có mã hóa theo hồ sơ triển khai; khóa không nằm trong JS bundle.
- UI gọi domain package chung qua application service; native layer sở hữu durability/network lifecycle.
- Phiên làm việc được cache có phạm vi và thời hạn offline. Thiết bị mới chưa enroll không tự gia nhập nhà hàng khi mạng bị mất.

Android service chỉ được chạy theo loại và quyền hệ điều hành cho phép; phải test foreground, màn hình khóa, Doze và người dùng chủ động stop app. Không hứa service không bao giờ bị Android dừng. [Android background/foreground services](https://developer.android.com/develop/background-work/services/fgs).

Trong profile đầu, tablet coordinator chạy app foreground/kiosk và cắm nguồn trong ca. Domain runtime phải phát health riêng; native network service không trả ACK thành công nếu runtime bị suspend. Các máy khác chuyển isolated khi coordinator không thực sự xử lý được, dù cổng mạng của nó vẫn mở.

### 2.2 Dịch vụ LAN trên một tablet có sẵn

Tablet được provision làm `venueCoordinator`. Dịch vụ nhận command của các app đã pair, lưu transaction và đẩy event cho POS/KDS/executor. Đây là chức năng phần mềm trong app, không yêu cầu một máy chủ/phần cứng riêng.

Kết nối LAN dùng TLS và device identity. Discover qua mDNS; fallback dùng endpoint đã pair/DHCP reservation. Phải kiểm tra router không bật client isolation giữa các thiết bị vận hành. Wi-Fi khách có thể ở mạng khác.

Coordinator cố định giúp chỉ có một nơi tuần tự hóa nghiệp vụ dùng chung. Không bầu coordinator khác chỉ vì timeout. Khi coordinator bị tách mạng, các thiết bị không tới được nó vào chế độ isolated; chúng vẫn ghi dữ liệu nhưng không nhận quyền điều khiển chung.

### 2.3 Robot executor

Executor là process trên onboard computer hoặc native service trên tablet đã chỉ định cho robot. Nó giữ command journal, mission/stop hiện tại, native goal ID, map revision, control epoch và trạng thái đã xác nhận.

Chỉ executor phát lệnh tới robot. Cloud, POS và Node-RED gửi intent tới owner, không tự mở một đường điều khiển song song. Executor giả lập phục vụ CI; executor thật có capability và giới hạn offline theo phần cứng/giao thức.

## 3. Ma trận chế độ vận hành

| Tình trạng | POS/thu ngân | Bếp/bar | Robot | Cloud/khách online |
|---|---|---|---|---|
| WAN và LAN tốt | Các app gửi coordinator; kết quả sync cloud | Ticket realtime, xác nhận theo lượng | Nhiệm vụ mới qua coordinator/executor | Nhận intent rồi chỉ xác nhận nhà hàng đã nhận khi có ACK thực |
| WAN mất, LAN tốt | Đủ nghiệp vụ nội bộ theo policy đã cache; cash và các xác nhận thủ công cho phép | Tiếp tục nhận/đổi trạng thái qua LAN | Giao/thu dọn/nhiệm vụ mới nếu adapter có LAN/offline capability | Báo mất liên lạc; order từ xa chờ hoặc bị từ chối theo cấu hình, không giả vờ đã vào bếp |
| LAN mất nhưng một số máy còn WAN | App thử relay cloud tới cùng coordinator; nếu không tới được thì isolated | Chỉ realtime nếu relay tới owner thành công | Không chuyển owner tự động; executor giữ quyền cũ | Cloud relay, không tạo chủ ghi mới |
| Cả WAN/LAN mất | Ghi ticket riêng và sự kiện tại máy; giới hạn bill chung; xem dữ liệu cache có thời điểm | Ghi tiến độ ticket đã nhận; ticket mới chuyển bằng con người nếu cần | Tiếp tục đoạn đã được cấp phép hoặc dừng/chờ theo profile; xác nhận tại màn robot được lưu cục bộ | Không đồng bộ; không kỳ vọng browser chưa cache khởi động được |
| Coordinator/app chính hỏng | Thiết bị còn lại vào isolated; quy trình handoff có kiểm soát | Giữ journal và tiến độ cục bộ | Không nhận lệnh của coordinator mới khi epoch chưa được chuyển hợp lệ | Hiển thị sự cố và dữ liệu tại mốc sync cuối |
| Bảo trì cloud | Như WAN mất | Như WAN mất | Như WAN mất | Tạm dừng tích hợp phụ thuộc cloud |
| Bảo trì tất cả app hoặc mất nguồn toàn bộ | Phiếu/sổ giấy hoặc thiết bị dự phòng độc lập | Phiếu bếp thủ công | Ngừng nhận nhiệm vụ mới, xử lý tải hiện tại trước bảo trì | Sau phục hồi nhập bù và đối soát |

“Đủ nghiệp vụ nội bộ” không bao gồm xác minh ngân hàng, giao dịch thẻ online, xuất hóa đơn điện tử, kênh giao hàng hay tiêu điểm chung chuỗi khi dịch vụ liên quan không tới được. Có thể ghi nhận bằng chứng thanh toán ngoài để đối soát, nhưng không giả lập xác nhận của provider.

Khách QR qua trang cloud không được mặc định offline như app staff đã cài. Nếu cần QR cho khách mới khi WAN mất, provision thêm URL/menu bundle HTTPS nội bộ trên tablet coordinator và hướng dẫn nối Wi-Fi; tên miền/chứng thư/DNS nội bộ phải được nghiệm thu. Bản mặc định staff nhập order thay khi khách không tới được trang. Đây là giới hạn kênh khách, không làm dừng POS/KDS/robot qua LAN.

## 4. Quyền ghi và chống hai chủ điều khiển

### 4.1 Dữ liệu dùng chung tại nhà hàng

Coordinator có `venueEpoch` được lưu trên cloud và các thiết bị khi provision/handoff. Trong epoch này, các operation ảnh hưởng table session, bill chung, fulfillment và fleet phải đi qua coordinator.

Cloud quản trị giữ catalog/config master nhưng mọi thay đổi vận hành trực tiếp gửi tới coordinator. Catalog revision mới chỉ có hiệu lực khi được áp dụng cục bộ; bill/order cũ tiếp tục dùng snapshot. Khi mạng mất không có “cloud ghi order một kiểu, tablet ghi cùng order kiểu khác”.

Mỗi command có `expectedAggregateVersion`. Coordinator kiểm tra trong cùng transaction với mutation và ghi result theo operation ID. Hai tablet sửa/hủy/tách cùng bill đồng thời sẽ có một kết quả thành công và một conflict rõ ràng.

### 4.2 Ghi độc lập khi không tới được coordinator

- Thiết bị tạo `isolatedTicket` với ID namespace của mình, giữ bảng giá/policy version, bàn ghi chú, món và nguồn. Đây là phiếu độc lập, chưa tự gắn vào phiên bàn chung.
- Có thể hoàn tất một giao dịch mới hoàn toàn thuộc thiết bị, như takeaway/cash, trong quyền offline đã cấp. Receipt có mã duy nhất của thiết bị và đánh dấu chờ đồng bộ.
- Không tự sửa/đóng một bill chung đang mở trên snapshot cũ. Với bill đã chuẩn bị trước sự cố, có thể đóng offline nếu thiết bị đang giữ **settlement grant** độc quyền cho bill immutable đó.
- Khách trả thêm tiền ở ngoài luồng được ghi `payment_observation`, không tự settled một bill không có quyền. Sự kiện giữ tiền thực tế và chờ quản lý phân bổ/đối soát; không xóa đi vì conflict.
- Ghi tiến độ KDS, xác nhận đã giao tại màn robot theo ticket/stop đã nhận; giữ version để phân biệt sự kiện hợp lệ, muộn hoặc trùng.
- Không tiêu voucher/điểm dùng chung hoặc trừ hạn mức chung một cách chắc chắn khi không có quyền đã phân bổ. Cho phép capture order/ghi chú; việc kiểm tra kho cuối cùng có thể phải xử lý thiếu hàng bằng con người.

Nếu hai thiết bị phục vụ cùng bàn khi bị chia cắt, cả hai phiếu đều được giữ. Khi phục hồi, quản lý ghép với table session, xác nhận phiếu trùng hay hai lượt thật; không gộp bằng tên bàn hoặc timestamp một cách tự động.

### 4.3 Settlement grant

Coordinator khóa một snapshot bill, ủy quyền đúng một device thu một khoản tối đa bằng số còn phải thu với tập phương thức được phép. Grant chứa bill/version, amount/currency, issuer epoch, device, nonce và chữ ký.

Trong khi grant chưa trả/đối soát, các thiết bị khác không thể thu cùng phần dư hoặc sửa bill đó. Grant hết thời gian không đồng nghĩa tiền chưa thu; ownership vẫn bị khóa cho đến reconciliation. Thiết bị dùng SQLite transaction để ghi receipt và số tiền đã sử dụng; không vượt hạn mức kể cả bấm lặp/crash.

Nếu có nghiệp vụ mới cho bàn đang giữ grant, mở phần order/bill bổ sung có liên kết thay vì sửa snapshot. Các phương thức phụ thuộc Internet chỉ được ghi quan sát hoặc pending, không đổi thành captured.

Bill còn payment intent bên ngoài ở trạng thái unknown không được cấp grant thu lại cùng khoản tiền cho tới khi đối soát hoặc có xử lý ngoại lệ được quản lý duyệt. Callback đến muộn vẫn được giữ như sự kiện tiền thực tế; nếu trả thừa phải mở khoản chưa phân bổ/refund, không xóa một giao dịch để tổng trông có vẻ đúng.

### 4.4 Robot và vùng dùng chung

Executor lưu `controlEpoch` và chủ điều khiển hiện tại, chỉ chấp nhận command đúng quyền. Mất lease/heartbeat chỉ kích hoạt hành vi dừng/giữ theo profile, **không tự cấp quyền cho tablet khác**.

Khi LAN mất, robot không tự nhận nhiệm vụ mới cần phối hợp nhiều robot. Đoạn đang thực thi chỉ được tiếp tục nếu được ủy quyền và profile safety/traffic cho phép; nếu không, hủy goal/giữ an toàn theo khả năng đã thử. Không bảo đảm STOP qua mạng khi mạng đã mất; hành vi dựa vào executor/điều khiển onboard độc lập.

Resource reservation chưa có chứng cứ đã giải phóng giữ trạng thái occupied/unknown. Phục hồi mạng phải đối soát vị trí/tải/native goal trước khi đưa robot về available. Không phát lại tất cả mission trong outbox chỉ vì kết nối đã lên.

### 4.5 Chuyển coordinator

Handoff bình thường: ngừng nhận command chung mới, sync journal/cursor, bàn giao open aggregates và grant, thu hồi owner cũ, chuyển epoch ở executor, rồi mở owner mới. Intent chưa xử lý giữ nguyên operation ID.

Nếu owner cũ mất hoàn toàn: xác minh owner không thể tiếp tục phát lệnh, phục hồi journal từ cloud và các tablet còn giữ, đối soát bill/robot/grant chưa rõ. Nếu chưa chứng minh fencing và state, tiếp tục isolated/manual thay vì tự failover. Đây là giới hạn chủ đích của bản đầu; high availability tự động chỉ thêm khi có thiết kế consensus và kiểm thử riêng.

## 5. Hợp đồng journal và đồng bộ

### 5.1 Journal envelope

Mỗi entry gồm:

- `schemaVersion`, `entryId`, `operationId`, `organizationId`, `venueId`.
- `deviceId`, `deviceEpoch`, `sequence`, `coordinatorEpoch` nếu đã được nhận chung.
- `aggregateType`, `aggregateId`, `expectedVersion`, `resultingVersion` nếu có.
- `kind`: `intent`, `accepted_fact`, `observation` hoặc `historical_import`.
- `occurredAt`, `recordedAt`, timezone/businessDate, cờ clock confidence.
- Payload canonical, content hash, actor/grant reference, signature và attachment references nếu cần.

Device sequence cấp trong transaction; không reset về 0 khi restart. Cài lại app tạo device epoch mới, không chiếm lại identity/journal cũ chỉ bằng tên thiết bị. Số bill/receipt hiển thị bao gồm series nhà hàng/thiết bị; không dùng một counter toàn cầu cần Internet.

### 5.2 Commit trên thiết bị

1. Validate actor/grant/policy và quyền aggregate trong chế độ mạng hiện tại.
2. Trong một SQLite transaction: cấp sequence, lưu dữ liệu, journal và outbox.
3. Chỉ sau commit mới hiển thị “đã lưu trên thiết bị”.
4. Nếu coordinator nhận và commit: hiển thị “nhà hàng đã nhận”. Nếu cloud commit và trả receipt: “đã đồng bộ cloud”.

Không xóa outbox khi chỉ mở được TCP hoặc nhận HTTP 202. ACK phải chỉ rõ entries đã commit, kết quả và cursor liên tục. Outbox chưa ACK tồn tại qua restart/app update.

### 5.3 Đồng bộ khi kết nối trở lại

1. Handshake identity/epoch/schema và trao đổi watermark từng producer.
2. Gửi batch giới hạn theo sequence; bên nhận lưu inbox/raw journal bền vững và kiểm chữ ký/hash.
3. Dedupe bằng `(deviceId, deviceEpoch, sequence)` và `operationId`. Cùng ID khác hash vào quarantine, không ghi đè.
4. Gap trong sequence tạo yêu cầu lấy bổ sung; ACK cursor chỉ đi tới sequence liên tục, không nhảy qua gap.
5. Accepted facts áp dụng đúng aggregate version; observations/isolated tickets chạy workflow import/reconciliation, không biến thành command hiện tại.
6. Lưu domain mutation + audit + xử lý inbox trong transaction; gửi result sau commit. Client lưu receipt/cursor bền vững rồi mới bỏ outbox đã nhận.
7. Kéo projection/config mới và conflict list; UI giữ draft người dùng đang sửa, yêu cầu resolve khi version đổi.
8. Đối soát command/native goal và payment unknown trước khi mở lại thao tác tương ứng.

Cloud ACK là đã commit ở cloud; ACK LAN là coordinator đã commit. UI và backup không coi hai mức này như nhau. Raw facts từ thiết bị khác trong lúc partition được giữ nguyên nguồn, không bị coordinator ký lại như thể chính nó đã tiếp nhận từ đầu.

### 5.4 Quy tắc hợp nhất

| Loại dữ liệu | Quy tắc |
|---|---|
| Catalog/config | Cloud phát hành version; áp dụng nguyên tử tại venue, không sửa lịch sử |
| Order/ticket mới | ID duy nhất; giữ snapshot; nếu đụng phiên bàn thì chờ liên kết được phê duyệt |
| Thêm món vào order chung | Intent theo version; không tự rebase qua bill đã đóng hoặc món đã hủy |
| KDS/handoff | Chuyển trạng thái có quantity/version; trùng là no-op, mâu thuẫn là conflict |
| Cash/payment/refund | Append-only ledger + source reference; không LWW; tiền quan sát chưa phân bổ nằm riêng |
| Kho | Movement có source ID; trừ một lần; kiểm kê tạo adjustment có phê duyệt |
| Loyalty/voucher | Ledger và quyền/hạn mức; không cấp lại hạn mức chưa thu hồi khi partition |
| Mission/robot | Owner/epoch/goal ID; sync lịch sử không tạo command mới |
| Ghi chú | Append có author; sửa có version; có thể chọn merge ở cấp UI |
| Bản ghi xóa/ngừng dùng | Tombstone/version và dependency guard, không hard-delete dữ liệu còn được journal tham chiếu |

Không dùng timestamp để quyết định tiền nào thắng; clock skew chỉ ảnh hưởng hiển thị/kiểm tra thời điểm, không đánh số thứ tự nghiệp vụ.

## 6. Danh tính, quyền offline và lưu trữ

Credential offline chỉ dành cho thiết bị đã enroll và nhân viên đã được cấp quyền. Đề xuất ban đầu quyền vận hành offline tối đa 24 giờ sau xác thực/refresh hợp lệ; con số này là cấu hình sản phẩm cần nghiệm thu. Các thao tác nhạy cảm như thay tài khoản nhận tiền, đổi owner, refund ngoài hạn mức cần quyền riêng.

Hết quyền offline không xóa dữ liệu và không cấm ghi sổ sự kiện đã xảy ra: thiết bị chuyển capture-only, các bản ghi đó cần quản lý xác minh khi sync. Revocation trên cloud chưa tới thiết bị phải được hiển thị như pending; không tuyên bố có hiệu lực tức thì khi hoàn toàn offline.

SQLite phải xử lý storage full/corruption rõ ràng. Nếu transaction không commit, không báo đã nhận. Attachment lớn có upload/hash riêng; ledger giữ trạng thái thiếu attachment để bổ sung, không mất chứng từ tiền vì ảnh lỗi.

Cloud không backup được dữ liệu chưa upload. Coordinator có thể nhân bản journal sang tablet khác trong LAN; mỗi tablet giữ intent/fact do mình tạo tới khi nhận durable cloud ACK và qua thời hạn giữ cấu hình. Đề xuất giữ tối thiểu 30 ngày sau sync trên thiết bị, không coi đây là thời hạn lưu trữ tài chính/pháp lý cuối cùng.

Trước reset/gỡ app: kiểm tra số entry chưa sync, xuất encrypted journal qua native file flow và xác minh hash. Không cho nút reset thông thường xóa sổ chưa đồng bộ. Mất/hỏng tất cả thiết bị trước khi sync vẫn có thể mất dữ liệu; biện pháp là replica/export, không phải lời hứa “cloud tự phục hồi”.

## 7. Bảo trì và nhập bù

### 7.1 Maintenance window

Một maintenance window có ID, venue scope, thời gian dự kiến/thực tế, người phụ trách, mode (`cloud_only`, `rolling_devices`, `full_shutdown`), checkpoint và trạng thái.

Trước planned full shutdown:

1. Ngừng nhận nhiệm vụ mới, xử lý khay/tải, xác nhận robot tại vị trí bảo trì phù hợp.
2. Sync/export journal; liệt kê thiết bị chưa tới được, bill mở, settlement grant và payment unknown.
3. Phát hành series phiếu dự phòng duy nhất và bản menu/giá áp dụng trong gián đoạn.
4. Chốt snapshot/checkpoint và xác minh backup có thể đọc/restore.
5. Bảo trì. Nếu chỉ cloud bảo trì, app/LAN tiếp tục chạy bình thường và không cần nhập lại thủ công các journal đã ghi được.

Sự cố ngoài kế hoạch có thể không có checkpoint; phục hồi phải inventory tất cả nguồn dữ liệu thay vì giả định snapshot cuối có đủ.

### 7.2 Ghi nhận khi toàn bộ app không dùng được

Sử dụng phiếu giấy đánh số trước hoặc thiết bị dự phòng độc lập. Mẫu tối thiểu: venue, series/số phiếu, ngày/giờ phát sinh, bàn hoặc loại phục vụ, món/quantity/giá, discount/thuế/phí đã áp dụng, tổng, payment method/amount/reference, tiền đã trả lại/refund nếu có, trạng thái chế biến/giao, nhân viên và ghi chú.

Không đặt requirement “nhập vào chính app đang bảo trì”. Hệ thống sẽ cung cấp mẫu PDF/CSV và màn nhập lại sau phục hồi. Khi không biết chính xác thời gian hoặc tham chiếu ngân hàng, ghi “chưa xác minh”; không bịa dữ liệu để qua validation.

### 7.3 Quy trình nhập bù

`draft → validated → reviewed → applied`, hoặc `rejected`. Batch có maintenanceWindowId hoặc incident reference, file hash, schema version, người nhập và người duyệt.

1. Upload CSV/JSON chuẩn hoặc nhập theo form; ảnh phiếu là attachment hỗ trợ, không dùng OCR chưa kiểm chứng làm số tiền chính thức.
2. Dry-run: kiểm trường/đơn vị/tổng/phương thức, đánh dấu thiếu chứng từ, trùng source key, trùng payment reference, order/bill có thể liên quan.
3. Preview so sánh số phiếu, tiền mặt, chuyển khoản quan sát, doanh thu/giảm giá/hoàn tiền và ảnh hưởng kho. Không có side effect ở dry-run.
4. Quản lý đối soát với tiền thực tế, terminal/ngân hàng khi có thể và journal từ thiết bị vừa phục hồi. Batch cần quyền `continuity.import.approve`, có audit; hỗ trợ phân tách người nhập/duyệt theo cấu hình.
5. Apply theo transaction từng receipt hoàn chỉnh; batch lớn có checkpoint và trạng thái từng dòng. Retry chỉ xử lý dòng chưa applied, không tạo hai lần tiền/kho.
6. Tạo chứng từ lịch sử và ledger theo đúng nguồn; nối với dữ liệu cũ bằng cross-reference. Giữ `occurredAt` gốc và `importedAt` hiện tại.
7. Xuất biên bản đối soát; conflict còn lại có người phụ trách, không đánh dấu batch hoàn tất khi bị bỏ qua âm thầm.

Idempotency key nghiệp vụ của bản nhập là `(venueId, sourceType, sourceSeries, sourceNumber)`; file hash chỉ hỗ trợ phát hiện file lặp. Cùng source key đổi nội dung tạo conflict/amendment, không coi là phiếu mới. Receipt của thiết bị nhập qua export giữ ID gốc, không được tạo namespace khác để né dedup.

### 7.4 Nhập sự kiện khác với thực hiện lệnh

- “Đã giao trong thời gian bảo trì” tạo historical fulfillment fact; không tạo ticket nấu mới hoặc mission robot.
- “Đã thu tiền mặt” tạo receipt lịch sử; chuyển khoản/thẻ chưa xác minh tạo observation/pending reconciliation. Không gọi capture của provider.
- “Đã phát hành hóa đơn ngoài” lưu external reference; không gọi phát hành lần hai.
- Món đã chế biến điều chỉnh kho theo recipe snapshot và quy tắc được duyệt. Nếu không biết recipe tại thời điểm đó, tạo exception chờ adjustment, không dùng công thức mới âm thầm.
- Công việc còn chưa làm sau bảo trì được người có quyền chuyển thành **command mới riêng**, có liên kết chứng từ nhập. Import không tự suy đoán cần giao lại món.
- Dòng sai sau apply được điều chỉnh bằng chứng từ đảo/amendment; không sửa lịch sử tiền đã được duyệt.

### 7.5 Khôi phục và mở lại vận hành

Trước khi mở ca: migrate schema tương thích, ingest journal của từng thiết bị, khớp các cursor với checkpoint, thu hồi/đối soát grant, hoàn tất conflict quan trọng, kiểm tra số tiền và native goal/robot pose. Nếu một thiết bị chưa trở lại, báo rõ dữ liệu còn thiếu và giữ khóa aggregate nó đang có quyền xử lý.

Báo cáo cho phép xem theo ngày phát sinh và ngày nhập. Ngày/ca đã chốt có adjustment được truy vết thay vì tự thay số liệu lịch sử mà không thông báo.

## 8. API/hợp đồng cần hiện thực

| Hợp đồng | Nhiệm vụ |
|---|---|
| Device enrollment / pairing | Cấp identity/scope, key rotation và endpoint coordinator |
| Command submission / result | ID, payload hash, expected version; trả result bền vững |
| Sync handshake / push / pull / ACK | Version, epochs, producer cursor, gap, commit receipt |
| Projection subscription | Theo role/venue/table; resume cursor hoặc snapshot khi hết retention |
| Coordinator handoff | Checkpoint, fencing và danh sách resource chưa rõ |
| Settlement grant issue / use / reconcile | Ủy quyền thu bill immutable và khóa phần dư |
| Continuity capture / conflict resolution | Isolated tickets, observations, liên kết và điều chỉnh có quyền |
| Maintenance window / export | Checkpoint, mã phiếu dự phòng, inventory nguồn |
| Import validate / preview / approve / apply | Không side effect trước approve/apply; idempotency theo phiếu |

JSON Schema là nguồn hợp đồng chung; type codegen cho TS/Python không tự thay schema đã phát hành. Android/native bridge cũng phải validate payload. Client cũ chỉ được sync những schema có adapter rõ ràng; dữ liệu không hiểu phải lưu nguyên vẹn để xử lý, không drop.

## 9. Kịch bản nghiệm thu bắt buộc

| ID | Kịch bản | Kết quả bắt buộc |
|---|---|---|
| O01 | Cắt WAN khi hai POS gửi món, KDS đang cập nhật và robot đang giao | LAN tiếp tục; một order/quantity mỗi operation; không mất ACK state |
| O02 | Mất ACK sau SQLite commit | Retry trả kết quả cũ; không tạo thêm phiếu/tiền |
| O03 | Mất ACK sau cloud commit | Outbox gửi lại không tạo bản ghi mới |
| O04 | Chia LAN thành hai nhóm, một nhóm giữ coordinator | Nhóm có owner chạy shared mode; nhóm kia capture/isolated, không bầu owner mới |
| O05 | Hai máy ghi cùng bàn khi LAN mất | Hai nguồn được giữ, conflict/linking workflow; không tự bỏ một phiếu |
| O06 | Thu bill theo settlement grant rồi mất mạng tới lúc grant quá hạn | Không cấp khoản thu đó cho máy thứ hai; sync một receipt hợp lệ |
| O07 | Tắt app/khởi động tablet giữa transaction | Chỉ có transaction hoàn chỉnh hoặc chưa commit; sequence không tái sử dụng |
| O08 | Tablet bị đầy storage | Không ACK giả; hiển thị không lưu được; quy trình ghi tay |
| O09 | Clock lệch và batch đến sai thứ tự/thiếu sequence | Gap được phát hiện; không dùng timestamp ghi đè tiền |
| O10 | Robot đã nhận goal nhưng executor chết trước khi lưu phản hồi | Reconcile native goal; không chạy lại mù quáng |
| O11 | WAN/LAN phục hồi khi có lệnh di chuyển cũ chưa ACK | Quarantine/reconcile trước dispatch mới; không replay lệnh hết hạn |
| O12 | Người dùng tắt module trên cloud khi venue offline | Venue hiển thị revision đang dùng; cloud báo pending; drain đúng khi revision tới |
| O13 | Bảo trì cloud, thiết bị chạy 24 giờ rồi sync | Đủ nhật ký, ledger khớp; auth/grant expiry hoạt động đúng giới hạn |
| O14 | Nhập CSV bảo trì hai lần, lần hai đổi thứ tự dòng/tên file | Không ghi tiền/kho hai lần; dedup theo phiếu, không theo tên file |
| O15 | Sửa giá/tổng của phiếu đã nhập rồi nhập lại | Conflict/amendment có phê duyệt, không ghi đè bản gốc |
| O16 | Journal từ tablet quay lại sau khi quản lý đã nhập phiếu giấy tương ứng | Phát hiện/liên kết source reference; không nhân đôi doanh thu |
| O17 | Nhập hóa đơn đã giao/thu tiền/xuất ngoài | Không có robot command, KDS ticket mới, payment capture hay e-invoice issue |
| O18 | Import batch bị kill giữa chừng | Resume đúng dòng chưa áp dụng; report thể hiện partial state |
| O19 | Cập nhật schema khi còn client offline cũ | Ingest được version hỗ trợ hoặc quarantine bảo toàn; không mất dữ liệu |
| O20 | Handoff coordinator khi robot/grant trạng thái unknown | Từ chối mở control mới cho resource chưa được fence/reconcile |
| O21 | Android suspend/stop foreground service | Các máy chuyển đúng chế độ, không tiếp tục hiển thị “đã nhận” khi owner vắng |
| O22 | Export rồi restore thiết bị/cloud từ backup cũ | Replay từ journal có ID gốc, khôi phục gaps, không reset idempotency để chạy lại side effect |

Các test này phải chạy với SQLite/PostgreSQL thật và Android nhiều thiết bị/emulator phù hợp, không chỉ unit mock. Các tình huống robot có thêm emulator protocol/Gazebo và commissioning hardware. Chưa có kết quả đạt cho các ca O01–O22 tại thời điểm viết tài liệu.
