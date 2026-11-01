# Vận hành thu ngân và bếp

Hướng dẫn ca làm việc trên tablet MEKONIQ cho thu ngân, bếp/quầy pha chế và quản lý. Tên nút trong ngoặc kép là chữ trên màn hình tiếng Việt (nút **EN** ở góc trên đổi sang tiếng Anh). Mọi số tiền là đồng (VND), số nguyên, không có số lẻ.

Nguyên tắc chung:

- Thông báo "Đã ghi nhận" nghĩa là bộ điều phối của nhà hàng đã lưu. Trạng thái "đã gửi", "không rõ", "đang chờ" **không phải là thành công**: không bấm lặp lại để "cho chắc", hãy làm theo mục đối soát bên dưới.
- Màn hình báo "Đã có bản mới hơn" khi thiết bị khác vừa sửa cùng bàn/hóa đơn. Bản nháp của bạn vẫn giữ; kiểm tra lại rồi gửi lại.
- Mất kết nối bộ điều phối: dải màu cam hiện ở đầu trang. Không lập/thu hóa đơn chung trên máy đang mất kết nối; chỉ ghi nhận riêng theo [quy trình bảo trì](maintenance-recovery.md). Quyền thu tiền hay điều khiển robot không tự chuyển sang máy khác khi hết giờ chờ.

## 1. Mở ca thu ngân

1. Vào **Thu ngân** hoặc **Ca và sổ két**, nhập "Tiền đầu ca" rồi bấm "Mở ca thu ngân". Mỗi thu ngân chỉ có một ca mở.
2. Tiền nộp thêm vào két hoặc chi ra (không phải bán hàng): nhập số tiền, chọn "Nộp thêm vào két"/"Chi ra khỏi két", ghi lý do, bấm "Ghi sổ két". Không chi quá số tiền đang có trong két.

## 2. Gọi món

- **Tại quầy (POS)**: màn **Bán hàng**, chọn bàn, chọn món (món có tùy chọn sẽ hỏi cỡ/topping), "Tính giá" để xem giá do máy chủ tính, rồi "Gửi bếp". Giá cuối cùng luôn do bộ điều phối tính; giỏ hàng được giữ đến khi nhà hàng xác nhận.
- **Khách gọi qua QR**: màn **Yêu cầu của khách**, ở thẻ bàn đang phục vụ bấm "Tạo link QR cho khách" và đưa link cho khách. Link chỉ dùng được cho đúng lượt ngồi đó; chuyển bàn, gộp bàn, đóng bàn hoặc đóng hóa đơn làm link cũ hết hiệu lực. Khách không thể giảm giá, thu tiền hay đóng hóa đơn.
- **Kiosk**: "Tạo mã kiosk" rồi nhập mã trên kiosk. Mã hết hiệu lực theo cùng quy tắc với QR.
- Yêu cầu "Gọi nhân viên"/"Yêu cầu thanh toán"/"Báo sự cố" của khách hiện ở **Yêu cầu của khách**. "Đã xử lý" chỉ đánh dấu yêu cầu, **không** lập hay thu hóa đơn.

## 3. Sửa món, chuyển và gộp bàn

- Hủy món: màn **Bán hàng**, phần "Bàn đang phục vụ", nhập "Số lượng hủy" và "Lý do", bấm "Hủy món".
  - Món chưa nấu: trạm bếp/quầy nhận phiếu **HỦY × n** và phải bấm "Đã nhận (ACK)".
  - Món đã nấu: bếp phải chọn "Dùng lại", "Bỏ đi" hoặc "Xử lý tay" (kèm ghi chú). Hệ thống không tự bỏ món; hóa đơn không đóng được khi còn món chờ bếp xử lý.
- Chuyển bàn / gộp bàn ở cùng thẻ bàn. Không chuyển/gộp được bàn đã lập hóa đơn.

## 4. Bếp và quầy pha chế

Màn **Bếp** chỉ hiện phiếu của trạm được phân công. "Nhận làm" khi bắt đầu, nhập "Số phần vừa xong" và bấm "Sẵn sàng" khi xong. Món đợt sau (course) ở trạng thái giữ cho đến khi thu ngân bấm "Gọi món đợt n". Phiếu hủy phải được ACK để thu ngân biết bếp đã nhận.

## 5. Hóa đơn: lập, tách, gộp, hủy

1. **Thu ngân** → "Chuẩn bị hóa đơn" ở bàn. Hóa đơn chụp lại giá, giảm giá, phí dịch vụ và thuế tại thời điểm lập; đổi thực đơn sau đó không làm đổi hóa đơn.
2. Tách hóa đơn (chỉ khi chưa thu tiền): "Chia đều cho số người" + "Chia đều hóa đơn", hoặc nhập số phần cho từng món rồi "Tách theo món". Tổng các phần luôn bằng đúng hóa đơn gốc; hóa đơn gốc được giữ làm lịch sử.
3. Gộp hóa đơn chưa thu: tích các hóa đơn ở "Gộp các hóa đơn chưa thu tiền", bấm "Gộp hóa đơn đã chọn".
4. Hủy hóa đơn chưa thu tiền (quản lý): nhập lý do, "Hủy hóa đơn (chưa thu tiền)". Món quay về bàn để sửa. Hóa đơn đã thu tiền **không hủy**, chỉ hoàn tiền.

## 6. Thu tiền

- **Tiền mặt**: nhập "Khách đưa tiền mặt", bấm "Xác nhận đã thu tiền mặt". Tiền thối được tính và hiện trên dòng thanh toán. Cần có ca đang mở.
- **Máy POS thẻ (máy rời)**: nhập số tiền, đơn vị máy POS, mã cửa hàng (MID), mã giao dịch trên phiếu và kết quả trên máy, bấm "Ghi nhận giao dịch thẻ". Phí thẻ được ghi riêng, không trừ vào doanh thu.
- **Chuyển khoản**: chỉ quản lý xác nhận sau khi **thấy tiền vào tài khoản** (sao kê/app ngân hàng): nhập số tiền, ngân hàng, tài khoản nhận, mã giao dịch, lý do và tham chiếu chứng từ. Thông báo "đã chuyển khoản" của khách **không phải là tiền đã thu**.
- Một hóa đơn có thể thu bằng nhiều phương thức. Khách đưa dư được giữ là "tiền nhận dư" chờ hoàn, không mất.
- "Đóng hóa đơn" chỉ bật khi đã thu đủ.

### Thanh toán thẻ không rõ kết quả

Khi máy POS báo lỗi kết nối hoặc không in được phiếu, ghi kết quả "Không rõ (mất kết nối)" hoặc "Đang chờ". Hóa đơn bị khóa thu ("Giao dịch thẻ chưa rõ kết quả") để tránh thu hai lần.

1. **Không** quẹt lại thẻ cho cùng hóa đơn.
2. Kiểm tra trên máy POS/cổng ngân hàng bằng đúng mã giao dịch.
3. Ghi lại cùng mã giao dịch với kết quả thật: "Đã duyệt" (tiền vào hóa đơn) hoặc "Từ chối" (mở khóa để thu cách khác). Ghi lặp cùng mã không tạo thêm khoản thu.
4. Nếu chưa xác định được trong ca, báo quản lý; khoản này hiện trong báo cáo ở mục chưa rõ kết quả và không được tính là đã thu.

## 7. Hoàn tiền

Quản lý (quyền hoàn tiền) mở hóa đơn ở **Thu ngân**, tại dòng thanh toán nhập "Số tiền hoàn" và "Lý do hoàn tiền" (bắt buộc), với thẻ/chuyển khoản thêm "Tham chiếu hoàn". Bấm "Hoàn tiền".

- Không hoàn quá số đã nhận của khoản thanh toán đó. Hoàn một phần được.
- Hoàn tiền mặt lấy tiền từ két của ca đang mở và làm giảm tiền cần có trong két.
- Hoàn tiền không đổi món, bếp hay kho; hóa đơn đã đóng vẫn đóng. Hoàn tiền dư (khách đưa thừa) không tính là trả hàng.

## 8. In hóa đơn và đối soát in không rõ

Màn **Hàng đợi in**: "In hóa đơn" cho hóa đơn đã đóng. Máy in mô phỏng/kiểm thử được ghi rõ là chưa chứng minh in thật trên giấy.

Khi một lần in ở trạng thái "Không rõ kết quả" (máy in không phản hồi): hệ thống **không tự in lại**.

1. Kiểm tra máy in và khay giấy xem phiếu đã ra chưa.
2. Quản lý ghi "Lý do đối soát" và chọn "Đã in ra giấy" hoặc "Chưa in ra giấy".
3. Chỉ sau đó mới in lại bằng "Xác nhận in lại" kèm lý do; bản in lại có chữ **IN LẠI**. Doanh thu không bị ảnh hưởng bởi việc in.

## 9. Đóng ca và đối soát két

1. Đếm tiền trong két. Màn **Ca và sổ két** hiện "Tiền mặt cần có trong két" = đầu ca + tiền mặt khách đưa + nộp thêm − chi ra − hoàn tiền mặt − tiền thối.
2. Nhập "Tiền mặt đếm được", bấm "Đóng ca và đối soát".
3. Có chênh lệch: thu ngân không tự đóng được. Quản lý (không phải chính thu ngân của ca) đếm lại, nhập "Lý do chênh lệch" và duyệt.
4. Báo cáo ca còn liệt kê theo từng phương thức (tiền mặt, thẻ, chuyển khoản): số lần thu, số tiền, hoàn tiền và giao dịch ghi nhận sau khi đóng ca (ví dụ máy POS xác nhận muộn). Giao dịch thẻ/chuyển khoản thuộc ca đang mở của người ghi nhận; giao dịch không thuộc ca nào được liệt kê riêng là "Không thuộc ca nào" để quản lý kiểm tra.
5. Ca đã đóng không sửa được. Sai sót phát hiện sau đó: quản lý ghi "Ghi điều chỉnh sau đóng ca" với lý do; điều chỉnh hiện riêng bên cạnh ca, không thay số đã chốt.

## 10. Báo cáo cuối ngày

Màn **Báo cáo** (quản lý/chủ; thu ngân không có quyền xem):

1. Chọn "Ngày kinh doanh" và bấm "Xem báo cáo". Ngày tính theo **múi giờ nhà hàng** (ví dụ 01:30 sáng giờ Việt Nam thuộc ngày hôm đó, dù giờ UTC còn là ngày hôm trước).
2. Đọc dòng trạng thái trước khi đọc số:
   - "Số liệu trên máy này lúc …": số liệu hiện tại.
   - "Có thao tác chưa rõ kết quả hoặc chưa đồng bộ" / "Lâu chưa nhận dữ liệu mới": số liệu có thể thiếu; đối soát rồi làm mới. Báo cáo cloud chuyển sang trạng thái này khi quá 15 phút không nhận dữ liệu từ nhà hàng.
   - "Mất kết nối bộ điều phối": số liệu đã tải trước đó, có thể thiếu giao dịch của máy khác.
   - "Chưa có dữ liệu đồng bộ": không có số nào được hiện. Đây **không phải** doanh thu bằng 0.
3. Doanh thu: gộp, giảm giá, trả hàng/hoàn tiền, thuần (= gộp − giảm giá − trả hàng), phí dịch vụ, thuế; thanh toán theo từng phương thức, tiền thối, phí thẻ, tiền nhận dư; số lượng món (đếm theo order, hóa đơn tách/gộp không bị đếm hai lần).
   - Nếu báo "Chưa cấu hình múi giờ nhà hàng", ngày đang tạm tính theo UTC: quản lý cấu hình múi giờ trong Bố trí nhà hàng trước khi chốt số.
   - Nếu báo "giao dịch có thời điểm không hợp lệ", các giao dịch đó không được tính vào ngày nào; báo kỹ thuật kiểm tra.
4. "Đối soát sổ cái" tính theo **hóa đơn đóng trong ngày**: thanh toán và hoàn tiền được ghép theo hóa đơn, dù phát sinh ngày nào (khách trả 23:50, đóng hóa đơn 00:10 thì tính cho ngày đóng). Mục "Thanh toán theo phương thức" là dòng tiền theo ngày phát sinh giao dịch. Phải thu và đã thu phải khớp. Nếu "Chưa khớp", kiểm tra thanh toán chưa rõ, phiếu nhập lịch sử hoặc điều chỉnh trễ. **Báo cáo không bao giờ sửa sổ cái**; sửa bằng nghiệp vụ (đối soát thanh toán, hoàn tiền, điều chỉnh có lý do).
5. Phiếu nhập lại sau sự cố (nhập lịch sử) được tính vào **ngày phát sinh gốc**, hiện ở "Điều chỉnh ghi nhận trễ" với cả thời điểm phát sinh và thời điểm ghi nhận.
6. "Xuất CSV" tải file mở được bằng Excel/Google Sheets (có BOM UTF-8 để hiện đúng tiếng Việt); nội dung giống công thức (bắt đầu bằng = + − @) được thêm dấu ' để không chạy như công thức.
7. Báo cáo trên cloud (`GET /v1/reports/sales|shifts|robot-kpi?venueId=…&businessDate=YYYY-MM-DD[&format=csv]`) đọc dữ liệu đã đồng bộ và cũng ghi trạng thái hiện tại/chậm/chưa đồng bộ kèm thời điểm áp dụng.
8. "Hiệu suất robot" với robot mô phỏng được ghi rõ là mô phỏng, không phải robot thật.
