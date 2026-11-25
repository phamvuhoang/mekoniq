# BV01 và native simulation — nghiên cứu ngày 06/11/2026

## Kết luận kỹ thuật

Tiếp tục kiến trúc source domain + Lab presentation, hoàn thiện một workflow coffee dùng chung giữa mock và native. Ưu tiên cup ownership, controller evidence và native execution trước khi mở rộng giao diện. Theo lựa chọn của người dùng, môi trường phát triển tham chiếu là **UTM + Ubuntu 24.04 ARM64 + Debian 12 ARM64 trên Mac**. Hai VM chạy độc lập trước; tích hợp bằng một coordinator ở Ubuntu và SSH chuyển tiếp Unix socket đến bridge ở Debian. Đây là transport cần kiểm chứng thêm, không phải khả năng remote sẵn có của adapter.

## Baseline đã đối chiếu

| Nguồn | Revision / phạm vi |
|---|---|
| source `feat/lab-digital-twin-v2` | `a89a077ed12648931a857333f899e3d6c1ea9719` |
| lab `feat/robot-lab` | `3a92e6579793aa47c30c0a3abd44942d95c679c3` |
| Runtime artifact | `fe49fcea31da67630fa50e6fe75418967092cee57ab9144959413a529129ce15` |
| Schema set | `8b398544fdeb8127da0697a086283f055126075696a573dd4e8be40b00d56881`, 29 schemas |
| Báo cáo đầu vào | `source/artifacts/digital-twin-status-2026-11-06.html`; còn là thay đổi chưa commit của yêu cầu trước |
| Bằng chứng sửa lỗi | [Review Plan 02/03](../reviews/2026-11-06-plan-02-03-remediation.md) |

Đợt nghiên cứu này đọc code và evidence, không chạy lại 1.059 tests trong báo cáo. Không dùng tổng heterogeneous tests làm mức sẵn sàng production. Không ghi đè artifact đang làm dở của source. Checkbox trong plan cũ là lịch sử thiết kế; trạng thái thực phải lấy từ evidence trên đúng revision.

## Những điểm đề xuất cần hiệu chỉnh theo code

Đường dẫn bảng dưới tính từ workspace chứa `source/` và `lab/`.

| Nhận định / hạng mục | Code hiện tại và phần thiếu | Quyết định |
|---|---|---|
| BV01 chưa có end-to-end | `source/packages/lab-runtime/src/v2/scenarios/coffee.ts` và `lab/tests/e2e/coffee-journey.spec.ts` đã chạy order, brew, handoff, delivery và recovery bằng mock | Giữ golden path; inject plant ports để dùng chung workflow |
| `plant.takeCup` chưa nối | Mock CoffeeDriver đã gọi; callback arm controller trong `v2/beverage/plant-session.ts` chưa gọi | Sửa đường controller và ledger idempotency; không viết lại mock |
| Chưa có UI fault | Lab đã có chọn/chèn lỗi tức thời | Bổ sung schedule có validation, checkpoint và replay; không xây graph editor |
| ARM03 đã có checker | `v2/arm/session.ts` sinh record controller; `v2/report.ts` và Lab `src/twin/arm/arm-view.ts` còn dùng shape mock | Thêm report extension tương thích và timeline theo cửa sổ evidence |
| LinuxCNC capability có thể dùng BV01 | CLI SIL chỉ có fixtures FD01/02/03/04/07; admission từ chối backend khác Gazebo | Thêm runner BV01 và admission dựa capability thật, không chỉ tên backend |
| Controller hoàn tất là đã gắp | Chương trình cup-pick/place chưa có gripper I/O; grip hiện null | SIM plant theo observed controller state + virtual I/O, có provenance modeled |
| Hai VM kết nối bằng adapter có sẵn | Gazebo worker là child process local; arm adapter là Unix socket local | Coordinator ở VM Ubuntu; bridge ở Debian qua SSH StreamLocal, không mở TCP controller |
| Một enum trạng thái là đủ | Implementation, kết quả chạy, fidelity và acceptance độc lập | Lưu các trục riêng; chỉ dựng nhãn UI từ evidence hợp lệ |

Các khoảng trống liên quan khác: domain gửi `start_job` kèm programRef nhưng bridge cần stage đúng chương trình; clocks của hai VM không cùng monotonic epoch; transfer evidence còn gắn `mock_amr`; collision world cần bỏ cup ở nozzle khi đã gắp và thêm cup ở tray khi nhả. Những việc này nằm trên đường găng BV01, không phải polish giao diện.

## Đối chiếu tài liệu chính thức

1. **ROS/Gazebo:** Jazzy + Harmonic trên Ubuntu 24.04 là cặp tương thích; giữ baseline này để giảm thay đổi so với repository, không gọi là bản mới nhất. [Gazebo ROS installation](https://gazebosim.org/docs/harmonic/ros_installation/).
2. **ARM64:** Harmonic liệt kê Ubuntu amd64 là nền tảng hỗ trợ chính thức, ARM ở mức best effort. Vì vậy VM ARM64 có gate package/rendering riêng và không thay thế kiểm thử artifact amd64. [Gazebo platforms](https://gazebosim.org/docs/harmonic/install/).
3. **LinuxCNC:** `linuxcnc-uspace` chạy simulation trên stock kernel; tài liệu liệt kê Debian Bookworm amd64/arm64. Điều đó không xác nhận mọi dependency QtVCP/PUMA của repo đã tương thích. [Getting LinuxCNC](https://linuxcnc.org/docs/html/getting-started/getting-linuxcnc.html), [downloads](https://linuxcnc.org/downloads/).
4. **UTM:** có QEMU và Apple virtualization backend, AppleScript tạo VM và CLI quản lý. Chọn QEMU aarch64 với hypervisor bật; kiểm API của bản cài thực thay vì giả định có `utmctl create`. [UTM scripting](https://docs.getutm.app/scripting/scripting/), [examples](https://docs.getutm.app/scripting/cheat-sheet/).
5. **Graphics:** UTM có driver tăng tốc phụ thuộc backend/guest; không suy ra Gazebo sensor renderer sẽ hoạt động chỉ vì desktop mở được. Ghi renderer và sensor samples khi smoke. [UTM Linux guest support](https://docs.getutm.app/guest-support/linux/).
6. **Transport:** OpenSSH hỗ trợ forward local Unix socket tới remote Unix socket. Đây là phương án giữ nguyên wire protocol và channel ACL, cần thử reconnect/lease/permission trên hai VM. [OpenSSH ssh(1)](https://man.openbsd.org/ssh.1), [sshd_config](https://man.openbsd.org/sshd_config).
7. **Virtual gripper I/O:** LinuxCNC có M62–65 output và M66 input; M66 không phù hợp cho phản hồi thời gian thực. Nếu dùng, chỉ mở tập mã/pin hữu hạn trong SIM profile sau test; arbiter hiện cấm M62–69. [LinuxCNC M codes](https://linuxcnc.org/docs/2.9/html/gcode/m-code.html).

Các trang upstream có thể thay đổi; execution phải lưu package versions, image checksum, UTM version và ngày resolve. `dependencies.lock.json` hiện là candidate amd64, không được đổi thành verified chỉ vì tải được package arm64.

## So sánh phương án triển khai

| Phương án | Lợi ích | Chi phí / hạn chế | Kết luận |
|---|---|---|---|
| Hai VM UTM ARM64 | Đúng lựa chọn người dùng; tách dependency Ubuntu và Debian; không mua robot | Disk/RAM; ARM graphics; thêm tunnel và clock domains | Tham chiếu phát triển |
| Một Linux amd64 host, ROS container + LinuxCNC host | Unix socket cùng kernel; thuận lợi packaging amd64 | Cần host khác; container cần Node/coordinator và ACL đúng | Fallback cho combined run khi Mac thiếu tài nguyên, không tự thuê máy |
| Hai máy Linux qua RPC mới | Có thể phân tán lâu dài | Auth, reconnect, versioning và attack surface lớn hơn | Chưa cần; thử SSH tunnel trước |
| Emulate amd64 trên M2 | Kiểm được vài package amd64 | Chậm, không đại diện latency/performance IPC | Không chọn cho native golden path |
| Chuyển Isaac / viết lại HMI | Không xử lý trực tiếp khoảng trống hiện tại | Migration lớn, chưa có bằng chứng cần thiết | Hoãn |

## Kiểm tra host thực tế

Ngày 06/11/2026: MacBook Pro M2 Pro, 10 cores, 16 GiB RAM, macOS 26.5. `df` báo khoảng **4,4 GiB khả dụng**; không thấy ổ ngoài; UTM chưa cài. Không đưa serial/UUID máy vào evidence. Chưa tải ISO, chưa cài UTM và chưa tạo/boot VM vì không đủ storage. Xem [preflight](../implementation/evidence/bv01-native-simulation/utm-host-preflight-2026-11-06.json).

Resource budget khởi điểm: Ubuntu 4 vCPU/8 GiB/64 GiB virtual disk, Debian 2 vCPU/4 GiB/32 GiB; chạy luân phiên trên host 16 GiB. Cần volume đủ khoảng 120 GiB free để có image/cache/snapshot reserve; đây là budget dự án, không phải yêu cầu tối thiểu của vendor. Nếu dùng SSD ngoài, vẫn cần khoảng 20 GiB trống trên ổ hệ thống cho macOS và swap. Không tự xóa dữ liệu người dùng để đạt budget.

Standalone runs không ghép thành combined BV01. Combined trên máy này là một thử nghiệm tài nguyên riêng: chỉ thử Ubuntu 6 GiB + Debian 3 GiB khi host còn headroom, không swap tăng kéo dài; nếu không đạt thì giữ gate blocked_external và chuyển sang host đủ RAM. Không giảm sensor rate/physics assertions để làm xanh test.

## Thứ tự và dự toán

Giữ ưu tiên 50/30/20 như định hướng, không dùng làm timesheet. Sprint 1 nhắm completion mock/evidence và chuẩn bị Linux; Sprint 2 nhắm standalone native rồi combined nếu đủ điều kiện. Chưa cam kết hai sprint hoàn tất R-SIM: virtual gripper, stage/start, transport và clocks là dependency thực. Re-estimate sau FD01 và controller smoke đầu tiên. UI readiness tối thiểu làm trước; editor schedule và các tính năng thương mại đi sau golden path.

Kết quả nghiên cứu được cụ thể hóa trong [spec](../specs/2026-11-06-bv01-native-simulation/README.md), [plans](../plans/2026-11-06-bv01-native-simulation/README.md) và [UTM runbook](../plans/2026-11-06-bv01-native-simulation/utm-runbook.md).
