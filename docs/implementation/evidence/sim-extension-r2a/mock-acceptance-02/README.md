# R-MOCK sau code review R2a

Guard `lab-v2-mock.acceptance.test.ts` đã đạt 41/41 trên source `4f893ac6fb75dff414a3ee42a726defb7935c734`, Lab `a6ec316fb3ac2f71afff25e6fa77e931f4439e00`, trước mọi thay đổi guard/tài liệu sau khi ghi. Đã đặt `LAB_V2_REQUIRE_LAB_FIXTURES=1`, `LAB_V2_REGRESSION_DIR` vào [regression mới](../regression-02/manifest.json) và `LAB_V2_MOCK_EVIDENCE` để ghi kết quả. Log và JSON gốc được giữ nguyên. Đây là kết quả kiểm thử, không phải chấp nhận của người duyệt.

Guard so sánh chính xác revision; chạy lại trên HEAD mới hoặc dùng regression mặc định lịch sử có thể báo `SOURCE_REVISION_STALE`. Không nới điều kiện đó để biến một bản ghi khác commit thành bằng chứng mới.
