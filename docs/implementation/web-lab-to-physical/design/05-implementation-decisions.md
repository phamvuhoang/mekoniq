# Quyết định khi triển khai R2b/R3

**Hiện trạng sau N1, 16/11:** [kết quả mới](../post-n1-final-recording/status.md), [tái hiện](../post-n1-final-recording/reproduce.md) và [disposition](../post-n1-final-recording/dispositions.md) dùng Source `0d46403` / Lab `7c97b20`. Review giữ verdict lịch sử ở tuple/scope đã nêu; capture mới và bốn assertions mock chưa giải quyết, native/physical chưa nghiệm thu. Các snapshot/kế hoạch cũ bên dưới giữ ngày và identity riêng.

Snapshot ngày 15/11/2026: B06 đã qua review sau matrix 3+5 và sửa race report; B07a package/export và B07b UI/replay đã qua review sau các vòng sửa. B08, implementation B09 và import B00R2 đã qua review; code chuẩn bị L00–L05 đã review; B10 tooling đang triển khai; WEB05 container, hiệu năng và qualification cuối vẫn mở. Đây là các quyết định đã dùng hoặc đã lên lịch; trạng thái hoàn thành nằm ở [00](00-implementation-status.md). Danh sách được gom theo thứ tự thực hiện, gộp các dòng trùng của hai ledger.

**01. Worktree riêng cho hai repository.** Tạo hai Git worktree dưới `.worktrees/web-lab-to-physical/`, vì workspace gốc không phải repository và công cụ tạo worktree không nhận repo đích. Không đổi `.gitignore` của main.

Đánh đổi/rủi ro: Lệnh chạy nhầm repo có thể làm thay đổi nhánh không mong muốn; mọi lệnh Git phải chạy trong đúng source hoặc Lab.

**02. Trích task theo ID B/L.** Script skill chỉ hỗ trợ số; trích nguyên từng mục B/L của plan vào brief riêng, rồi ghi rõ mọi điều chỉnh sau đó.

Đánh đổi/rủi ro: Có thể bỏ sót dependency hoặc giá trị khi trích; brief và review phải đối chiếu đúng mục gốc.

**03. Tách commit ghi bằng chứng khỏi commit tài liệu.** Giữ cả commit tạo runtime và commit đưa evidence vào Git. Commit tài liệu ngoài closure không tự thay đổi runtime đã ghi.

Đánh đổi/rủi ro: Nhầm file trong closure là tài liệu vô hại sẽ làm pin sai; phải kiểm closure như quyết định 6.

**04. Thực thi theo yêu cầu mới.** Yêu cầu implement trên worktree đã thay phạm vi chỉ soạn tài liệu ban đầu. Qualification vẫn giữ `accepted:false` cho đến khi có reviewer sidecar đúng phạm vi.

Đánh đổi/rủi ro: Có thể đọc quá rộng quyền triển khai; phạm vi hiện tại không gồm push, deploy, chi phí hoặc điều khiển robot.

**05. Chuẩn bị Linux khi chưa có host được giao.** Hoàn thành code portable và tooling/handoff có thể kiểm tại đây; ghi native/physical chưa chạy. Bằng chứng Cloud Run R2a có sẵn được tham chiếu riêng.

Đánh đổi/rủi ro: Prepared có thể bị hiểu thành tested; trạng thái và case chưa chạy phải xuất hiện trong bàn giao.

**06. Ghim lại baseline B00.** Source ghi evidence `bb16724` và HEAD tài liệu `086121c` có closure khác do README nằm trong tool root. Export lại và pin Lab trên worktree.

Đánh đổi/rủi ro: Thêm một vòng export/pin; dùng lại closure cũ sẽ ghi sai identity dù solver không đổi.

**07. Đưa đăng ký schema Lab tối thiểu vào B01.** B01 xử lý cả schema/Ajv tương thích của Lab, theo chuỗi source commit → export sạch → import/sync/check → Lab commit.

Đánh đổi/rủi ro: Phạm vi task tăng sang repo thứ hai; cần review cả hai diff để tránh schema đã sinh nhưng consumer chưa hiểu.

**08. Thống nhất nghĩa bước thời gian.** `engine.timestepMs=2`, `substeps=10`, `scene.clock.tickMs=20`; kiểm tích chéo, giữ convention arm hiện có.

Đánh đổi/rủi ro: Đọc nhầm 20 ms thành substep sẽ làm world chạy nhanh gấp mười và sai metric.

**09. Chia B02 thành hai phần tuần tự.** B02a tạo worker thật và probe; B02b tích hợp compiler/provider/readiness/slot. Chỉ đóng B02 sau cả hai review.

Đánh đổi/rủi ro: Thêm handoff/export nhưng giúp review tập trung; không quảng cáo capability mobile khi chỉ worker đã có.

**10. Policy dừng riêng cho mobile.** Dùng policy có hash: giới hạn nghiêng π/4; sanity chiều cao từ z nghỉ trừ 0,6 bán kính bánh đến cộng 4 bán kính; tải tụt tương đối 0,10 m trong 5 tick. Giữ physics lock và Webots cũ.

Đánh đổi/rủi ro: Các ngưỡng là giả định thử nghiệm. Nếu không phù hợp phải tạo revision và ghi lại campaign, không diễn giải lại bằng chứng cũ.

**11. Ramp lệnh từ lệnh đã gửi.** Trace thật cho thấy ramp từ vận tốc đo gần 0 bị mắc dưới ngưỡng ma sát tĩnh, dừng NO_PROGRESS ở tick 493. Ramp mới dùng lệnh trước; arrival/stop vẫn đọc vận tốc thật.

Đánh đổi/rủi ro: Đổi hành vi điều khiển nên cần identity/version riêng; không được chỉnh physics để che lỗi controller.

**12. Nhập baseline R2a đã khóa ở B00R.** Sau B02b, nhập frozen source `4f893ac` và Lab `a6ec316` vào feature worktrees để có các sửa arm/gateway/recorder mới nhất khi đó.

Đánh đổi/rủi ro: Có thể phát sinh conflict hoặc hồi quy; giữ merge cô lập, kiểm các phần giao nhau và pin lại.

**13. Sửa phạm vi quản lý process của test.** Thay selector kill worker toàn máy bằng identity của process/run do test sở hữu; có sentinel chứng minh process ngoài phạm vi còn sống.

Đánh đổi/rủi ro: Sai scope vẫn có thể ảnh hưởng công việc khác. Review quyền sở hữu trước native suite; không biết PID từng bị kill trong lần lịch sử.

**14. Tạm hoãn native tests khi pipeline gốc còn chạy.** Dùng kiểm tra thuần/static trong lúc qualification gốc có selector toàn máy. Chỉ tiếp tục sau khi đọc progress xác nhận pipeline đã kết thúc. Việc hoãn đã được gỡ sau 07:40:25 ICT.

Đánh đổi/rủi ro: Chậm có bằng chứng engine; các kiểm tra hoãn phải đóng trước qualification, không tính not_run là pass.

**15. B03 commit sau bằng chứng bền vững.** Thứ tự mới là ACK → kiểm snapshot → ghi durable → commit logical tick. Snapshot hỏng hoặc ghi thất bại giữ tick cũ và lưu gap/unknown; không resend/respawn. Snapshot hợp lệ vượt cutoff được ghi trước khi stop monitor chặn xác nhận nghiệp vụ.

Đánh đổi/rủi ro: Horizon report khác kỳ vọng trung gian B02b; phải phân biệt tick đã commit và tick engine có thể đã tiến, giữ legacy path.

**16. Hash profile theo byte đã admission.** PhysicsEvidence dùng SHA-256 byte file của load/physics; policy metric có hash riêng. Digest canonical trong document và sceneDigest vẫn được kiểm độc lập.

Đánh đổi/rủi ro: Lẫn hai loại hash làm reader hoặc comparison từ chối nhầm hay nhận sai profile; contract/tests phải dùng cùng nghĩa.

**17. Quan sát vòng đời process qua Node 24.** Helper test dùng diagnostics_channel child_process của Node 24.22.2 để thấy spawn giữa hai lần polling. Mất bằng chứng sở hữu làm kiểm cleanup thất bại, không mở rộng quyền kill.

Đánh đổi/rủi ro: Channel còn experimental; đổi Node có thể phá quan sát. Cần regression và giới hạn local async spawn đã ghi trong B00R.

**18. Chia B04 thành source rồi Lab.** B04a tạo experiment/campaign/telemetry và pin; B04b mở preset/render/report/replay bằng browser thật. B04a và B04b đã hoàn tất implementation và qua review; qualification toàn bộ R2b vẫn chờ tuple cuối.

Đánh đổi/rủi ro: Thêm export/review và có thể cần sửa API giao nhau; không giảm tiêu chí UI hoặc chạy hai implementer cùng sửa runtime.

**19. Tách priming khỏi interval metric.** Raw tick 0 giữ 20 ms priming. Aggregate contact/duration dùng cửa sổ `(0,lastTick]`; tick-0-only không có interval metric. Initial pose vẫn có thể làm baseline/đo tilt.

Đánh đổi/rủi ro: Nếu consumer cộng thêm priming, thời lượng và impulse thừa 20 ms; window phải có convention và test biên.

**20. Giữ provenance khi so speed experiment.** Cơ khí ổn định được nhận diện bằng canonical fixture và các trường cơ khí đã kiểm. File physical model đã biên dịch chứa project inputs nên digest có thể đổi cùng projection/load ref. Không thay inputs cũ để ép hash bằng nhau.

Đánh đổi/rủi ro: So sánh có thể nhầm thay đổi provenance thành cơ khí hoặc bỏ qua thay đổi cơ khí thật; B08 phải chỉ cho phép field diff đã đăng ký.

**21. Lên lịch B00R2 trước R3 và qualification cuối.** Sau B09 sẽ nhập frozen source `11d25b4` và Lab `a744954`: guard Cloud Run, evidence production và walkthrough R2a. Đã thực hiện và qua review tại Source `d0f3074` / Lab `176bf34`; giữ riêng danh tính evidence R2a và runtime mới.

Đánh đổi/rủi ro: Thêm merge/export/review và khả năng conflict recorder; tránh bám main đang thay đổi hoặc lấy cloud pass của pin R2a cho R2b.

**22. Bổ sung ca cốc rơi thật.** Giữ 18 ca gốc và bổ sung một ca engine thật để đủ MJ04; target campaign là 19. Tác động mô phỏng chỉ do registry server chọn, có lực/frame/tick/duration và receipt, không đặt lại pose hay sửa ledger để giả rơi.

Đánh đổi/rủi ro: Thêm một ca và bề mặt cần review. Probe map-x va thanh đỡ được giữ; ID mới dùng hướng của khay đã được kiểm trong campaign cuối 19/19. Review B04a đã đạt; đây vẫn chưa phải qualification được người có trách nhiệm chấp nhận.

**23. Ghi đủ cửa sổ quan sát sau phanh.** Chỉ experiment phanh có policy đăng ký để giữ cùng world thêm 5 tick quan sát thực, sau khi nghiệp vụ đã xác nhận hủy. Không hạ yêu cầu dừng liên tục của metric B03. Kết thúc physical run phải đợi cửa sổ này; bước lẻ, đọc report và reopen phải giữ ranh giới đó rõ ràng.

Đánh đổi/rủi ro: Thêm khác biệt giữa trạng thái nghiệp vụ và thời điểm đóng world; nếu báo terminal sớm, consumer có thể bỏ phần đuôi hoặc giữ slot không đúng. Cần kiểm mất ACK/fault giữa cửa sổ và không dispatch/xác nhận mới. Đã qua kiểm tra và review trong B04a.

**24. Hoàn thành tooling trước lần qualification cuối.** Sau B09 và baseline B00R2, hoàn thành các thay đổi runtime/schema R3, rồi triển khai và review tuần tự tooling B10/L06. Chỉ khi cả hai đã qua review mới chạy chuỗi qualification trên cùng source commit và Lab pin sạch. Record R3 tại đây chỉ được đóng các phần prepared thực sự đã kiểm.

Đánh đổi/rủi ro: Cần tách pha code/review khỏi pha recording/bàn giao; nếu sửa code sau recording thì phải ghi lại phần bị ảnh hưởng ở tuple mới. Cách này tránh chạy toàn bộ campaign rồi tự làm pin lỗi thời bằng tooling chưa xong. Đây là quyết định đã có trong ledger tổng, được bổ sung vào bản tổng hợp này.

**25. Đặt tên stress preset theo nguyên nhân thật.** Ca rơi hiện dùng một lực tác động được server đăng ký, không chứng minh cốc tự trượt chỉ vì vào cua. B04b có thể hiển thị lỗi từ bản ghi thật; B07 sẽ có lựa chọn stress live được admission rõ. Nếu dùng lại ca này, tên sẽ là “Cốc rơi do tác động”, kèm sự kiện tác động trong chi tiết.

Đánh đổi/rủi ro: Tên khác dự kiến ban đầu, nhưng tránh khiến người xem suy sai nguyên nhân hoặc độ ổn định phần cứng. Không bỏ trải nghiệm stress và không mở trường lực tùy ý cho trình duyệt. B04b đã hiển thị bản ghi lỗi thực; phần chọn stress live vẫn thuộc B07 và chưa triển khai.

**26. Hoàn thiện danh sách khác biệt tại nơi dùng comparison.** B04a có danh sách mô tả các input đổi theo speed experiment; chưa có comparator sử dụng nó. Các reference lồng trong navigation/scene được ghi đầy đủ trong báo cáo và artifact diff. B08 phải hoàn thiện whitelist theo từng trường và kiểm cả cặp hợp lệ lẫn thay đổi ngoài phạm vi trước khi mở so sánh.

Đánh đổi/rủi ro: Dùng ngay danh sách mô tả chưa đủ có thể từ chối nhầm cặp hợp lệ; nó không cho phép bỏ qua cả model/policy. Việc này tránh ghi lại 19 ca chỉ để mở rộng metadata chưa có consumer, đồng thời giữ nghĩa vụ kiểm tại B08 rõ ràng.

**27. Cancel khi đang pause vẫn phải chờ Source xác nhận dừng.** Với preset payload, UI gửi cancel cho run hiện tại, sau đó chỉ mở lại đồng hồ mô phỏng của chính run đó và tiến một số bước có giới hạn để quan sát trạng thái dừng. UI kiểm tra quyền writer và run/view epoch sau mỗi thao tác bất đồng bộ; nếu người dùng pause lần nữa, đổi run hoặc mất quyền thì dừng tiến clock. Kết quả chưa xác nhận phải được hiển thị là đang chờ.

Đánh đổi/rủi ro: Thao tác bất đồng bộ cũ có thể tác động nhầm run mới hoặc báo nhầm đã giải phóng engine. Cần kiểm thử paused cancel, ngắt giữa chừng, phản hồi cũ và luồng browser thật. Không thay controller, định nghĩa dừng, thêm đuôi campaign hoặc tự đặt trạng thái terminal ở trình duyệt.

**28. Preset payload bắt đầu ở tick 0.** Luồng tạo run cũ tự tiến 250 tick, tương đương 5 giây mô phỏng, trước khi người dùng điều khiển. Preset mới bỏ bước nhảy tự động này và hiển thị observation ban đầu đã commit. Người dùng bấm Play ở mặc định 1× hoặc chủ động chọn bước tiến; priming của engine và các preset cũ giữ nguyên.

Đánh đổi/rủi ro: Một số trạng thái UI có thể đang giả định run đã tiến tick. Cần kiểm tra create không gửi step, render ban đầu và luồng Play–dừng–replay trên provider thật. Đây là thay đổi điều khiển tại Lab, không thay thông số vật lý.

**29. Tìm lại hành lang chuyển động trong world chung.** Probe B05 phát hiện va chạm ở dock đã qua kiểm tra tầm với B01: link tay máy chạm chassis khi gắp và khay trên ở pose tiếp cận. Có thể đổi dock, waypoint hoặc vị trí tay máy trong fixture world mới, với frame và metadata đồng nhất; giữ nguyên hình học vendor, khay và các profile cũ. Không thu nhỏ proxy lòng bàn tay hoặc loại va chạm thật để vượt gate.

Đánh đổi/rủi ro: Đổi bố trí có thể chuyển va chạm sang giai đoạn khác hoặc gây lệch frame. Cần giữ từng probe, kiểm contact thực và đường quét, rồi khóa một cấu hình trước rig 10 lần. Endpoint có nghiệm IK chưa đủ để xác nhận toàn hành trình.

**30. Intent tạo/loại cốc có binding riêng trong world.** B05 bổ sung `worldInteractions` tùy chọn vào step, ghép một-một với placement và kiểm cup/prop/event/tick cùng vòng đời đã khai. Worker chỉ kiểm và thực thi thay đổi vật lý; Source quyết định custody. Intent được lưu trước lệnh; observed interaction được ghi sau ACK hợp lệ. B06 phải liên kết event journal thật, còn rig ghi rõ provenance mô phỏng trực tiếp.

Đánh đổi/rủi ro: Thêm một phần contract wire và evidence cần kiểm cả trường hợp thiếu, trùng, sai binding và dùng ở provider cũ. Field mới không cho phép di chuyển cốc khi handoff, và metadata không thay thế interaction record có hash/coverage.

**31. Admission và commit giữ ở phía Source.** World factory cung cấp evidence ports từ scene/config đã kiểm chứng. Tick tạm chỉ giúp callback gắn đúng thời gian quan sát; trạng thái công khai và business event bền vững chỉ được xuất sau commit thành công. Nếu commit lỗi, giữ trạng thái cũ cùng ACK/pending horizon, không gửi lại step hoặc phát confirmation dở dang.

Đánh đổi/rủi ro: Callback ghi journal ngay hoặc sửa view công khai có thể làm lọt trạng thái một phần. Cần stage event/observation và kiểm lỗi giữa commit; không xem việc chưa drain queue là có thể hoàn tác event đã lưu. Old-provider behavior và thứ tự ACK → append → commit giữ nguyên.

**32. So sánh quaternion có xét sai số biểu diễn và dấu.** Worker production gặp sai khác khoảng `6e-16` giữa quaternion free joint và kết quả đổi từ ma trận. Validator riêng của world dùng tolerance `1e-10`, xét `q` và `−q` cùng orientation, giữ kiểm finite/unit và nguyên dữ liệu raw. Lượt ACK bị từ chối và gap ban đầu vẫn được giữ.

Đánh đổi/rủi ro: Tolerance quá rộng hoặc cách đo góc thiếu ổn định có thể che sai pose. Cần test perturbation nhỏ, sai khác vượt ngưỡng và quaternion không hợp lệ; không đổi thông số vật lý hoặc nới kiểm identity/geometry.

**33. Source dùng đúng binding dock của world đã admission.** Dock khả thi có yaw `π/2`, khác default `0` của fixture Source cũ. World cung cấp metadata binding chỉ phía Source, được checkpoint cùng scene identity; goal dùng pose của base AMR, không dùng tâm khay. Reopen chỉ đọc dữ liệu đã checkpoint và giữ pose cuối thực sự quan sát.

Đánh đổi/rủi ro: Binding sai có thể khiến robot xoay vào hành lang va chạm hoặc thay goal sau restart. Cần kiểm pose/yaw đích và identity recovery; giữ nguyên các binding legacy. Các đường ghi trực tiếp qua Source/store cũng phải được chặn trong observation commit chưa thành công.

**34. Gate 10 lượt phải dùng đúng model production.** Rig trực tiếp đã đạt 10/10 nhưng chỉ có một cốc; worker production có hai slot cốc được cấp sẵn, làm thay đổi kích thước model dù slot thứ hai chưa hoạt động. Sau khi các xử lý Source và thông số vật lý ổn định, chạy lại cùng 10 offset vòi trên worker IPC và recorder thực tế, lưu identity cuối cùng, số substep thật, quota và kết quả đọc lại. Giữ rig trực tiếp là bằng chứng khả thi và giữ cả các lượt chẩn đoán thất bại.

Đánh đổi/rủi ro: Tốn thêm 10 lượt cần thiết để tránh áp dụng kết quả của model khác cho fixture cuối. Chênh 10 mm theo Z đã được giải thích bằng gốc support frame; sai khác nhỏ XY/joint được ghi nhận, chưa quy riêng cho slot không hoạt động. Không yêu cầu thử thêm chỉ để tìm nguyên nhân sai số hoặc chạy toàn workflow served=2 ở B05; B06 vẫn chịu trách nhiệm bằng chứng custody.

**35. Prefix đang ghi chưa phải bản ghi đã kết thúc.** Recorder world phải giữ trạng thái chưa hoàn tất khi writer còn hoạt động, để crash sau một lệnh chưa có ACK không khiến reader độc lập hiểu nhầm prefix cũ là toàn bộ run. Dữ liệu đã commit vẫn đọc được; trạng thái đang ghi/chưa đủ khác với dữ liệu hỏng hoặc có gap. Giữ nguyên semantics mobile legacy.

Đánh đổi/rủi ro: Sửa sau khi đã khóa campaign cần ghi rõ phiên bản trước/sau. Có thể dùng lại 10 lượt vật lý nếu model, lệnh, physics và byte record không đổi, khác biệt chỉ ở lifecycle completion của manifest; phải thêm regression cho crash và đọc lại artifact bằng reader cuối. Nếu điều kiện đó không đúng, đánh giá lại gate bị ảnh hưởng thay vì âm thầm dùng bằng chứng cũ.

**36. Sửa error path của recorder phải có bằng chứng riêng.** Review B05 tìm thấy sai tick đã commit khi automatic flush thất bại và khả năng xuất lặp chunk sau lỗi dọn WAL. Cần regression đúng hai ranh giới này, giữ Source làm authority về commit horizon và bảo toàn prefix đã xuất khi đóng recorder.

Đánh đổi/rủi ro: Có thể dùng lại 10 lượt vật lý nếu inputs, lệnh, snapshots và serialization của lượt bình thường không đổi; phải có diff/hash và đọc lại bằng reader sau sửa. Giữ nguyên policy, campaign, inventory và audit cũ, bổ sung artifact R1 riêng. Đây là đánh giá mới cho hai lỗi recorder, không mở rộng ngầm quyền dùng lại bằng chứng từ sửa completion trước đó. Nếu normal record hoặc physics đổi thì đánh giá lại gate bị ảnh hưởng.

**37. Chọn nguồn custody bằng capability rõ ràng.** Luồng cũ chọn CupLedger khi snapshot tay máy là `null`; world thật vẫn cần giữ snapshot tay máy. B06 bổ sung mode evidence chỉ phía Source, yêu cầu ledger và correlated observations, không cho đi qua nhánh tạo receiver từ `st.trays`. Giữ hành vi cũ khi field vắng mặt. Producer MuJoCo arm/tray ghi `fidelity:modeled` và cùng provenance engine, với hai phép kiểm logic riêng.

Đánh đổi/rủi ro: Mode hoặc hai observer ID khác nhau chưa đủ chứng minh custody. Cần journal/command/epoch thật, cửa sổ dock/receipt đã admission, và chỉ ingest sau commit tick thành công. Test phải từ chối thiếu ledger/evidence, chặn fallback cũ, giữ read-only recovery và kiểm các port legacy. Không mô tả hai observer mô phỏng là hai cảm biến phần cứng độc lập.

**38. Khai báo biên planner riêng cho world mới.** Source preflight hoàn tất gắp/đặt/rút tay nhưng AMR không tìm được đường: dock tại x=0,35 m không đủ chỗ quay với footprint đầy đủ trong bản đồ bắt đầu ở 0. B06 được bổ sung origin/biên có tọa độ âm, giới hạn hữu hạn và provenance rõ, gắn vào identity scene/controller. Giữ nguyên bố trí và hình học vật lý; không bỏ kiểm biên hoặc thu nhỏ robot.

Đánh đổi/rủi ro: Biên ngầm có thể cho đi ra ngoài vùng đã khai hoặc làm render sai vị trí. Phải áp dụng nhất quán cho lattice, endpoints, swept footprint, goal và viewport, kiểm edge cases/legacy, rồi chứng minh đường đi/về bằng native Source. Biên mới dựa trên fixture sàn không có tường; rig B05 đi thẳng chưa chứng minh route này.

**39. Sửa fixture test thay vì thêm ngoại lệ authority.** Không dùng tên scenario `B05-RIG` để cho production bỏ qua correlated custody. Các test factory cũ được nâng lên API chặt với Source/pending-custody fixture tối thiểu, giữ các kiểm worker/slot/close/lifecycle; direct worker rig không đổi.

Đánh đổi/rủi ro: Một ngoại lệ tiện cho test có thể trở thành đường bypass nghiệp vụ. Production phải dựa trên capability/scenario/backend đã admission và evidence thật. Test seam vẫn được ghi đúng phạm vi; thêm factory chỉ quan sát cần có nhu cầu sản phẩm cụ thể, không chỉ để giữ type cast cũ.

**40. Controller cell phải dừng chính xác hơn cửa sổ dock.** Ngưỡng kết thúc đoạn dịch chuyển cũ 20 mm và yaw cuối 25 mrad có thể lớn hơn yêu cầu handoff. Policy riêng của world mới được dùng translation tolerance 4 mm, goal position 8 mm và goal yaw 16 mrad, có identity và diễn giải rõ áp dụng cho đoạn nào. Giữ các default legacy.

Đánh đổi/rủi ro: Tham số nhỏ hơn không tự chứng minh robot dừng đúng sau phanh. Cần test đo actual pose và native return/second pick; arrival hold 5 tick không thay cửa sổ dock 10 tick. Giữ ngưỡng vận tốc, receipt và freshness; không snap pose, tự retry hay chỉnh physics để vượt gate.

**41. Fault cell phải có tác động vật lý đã đăng ký.** B06 được thêm preset riêng cho dock trôi và cốc rơi, admission ở lúc tạo world từ cấu hình campaign phía Source. Preset cố định lực/frame/thời lượng/đích, dùng một lần và ghi intent/receipt có identity đầy đủ. World bình thường, provider cũ và input ngoài admission phải từ chối. Không mở trường lực tùy ý từ browser.

Đánh đổi/rủi ro: Chọn trigger sai có thể cho gripper mở trước khi thấy dock trôi, hoặc biến một thay đổi ledger thành “cốc rơi”. Test phải đo actual gripper/cup/AMR, tick tác động–vi phạm–dừng và tray-relative fall; giữ lực được clear sau bước, không retry khi mất ACK. Phân biệt owner nghiệp vụ được xác nhận gần nhất với physical lost/unknown. Giữ geometry/friction/placements và preset mobile cũ, lưu probe thất bại và khóa dose trước campaign.

**42. Bằng chứng sweep của world dài phải có đường đọc đầy đủ.** Báo cáo tay máy cũ giữ tối đa 4.096 interval; AMR chuyển động làm geometry đổi mỗi tick nên có thể hết chỗ trước khi hoàn tất hai cốc. Giữ giới hạn và kết quả truncation của luồng cũ. World mới được ghi context điều khiển do Source chọn vào đúng pending command và tính một báo cáo sweep riêng từ stream bền vững đã giới hạn dung lượng. Context gắn với scene/program/journal; không cho caller tự khai cặp va chạm được phép.

Đánh đổi/rủi ro: Thêm schema, reader và chi phí tính lại có thể lệch phép kiểm online. Cần test hơn 4.096 interval, đổi quyền contact tại ranh giới phase, context sai/thiếu và đối chiếu một native prefix. Báo cáo mới dùng actual joints, geometry/pose AMR đầy đủ và rules đã admission; gap, quota, thiếu dữ liệu hoặc sweep không chắc chắn không được pass. Giữ contact mọi substep làm bằng chứng riêng; không nới cap legacy hoặc thêm archive không giới hạn.

**43. Tách B07 thành hai bước triển khai và review.** B07a làm package/export, endpoint snapshot theo quyền owner, admission stress và reader Lab có giới hạn. B07b dùng các interface đã review để làm offline entry, cell UI/camera/story/catalogue, rồi kiểm browser, accessibility và performance thật. B07 chỉ hoàn tất khi cả hai đạt; giữ toàn bộ yêu cầu gốc và chỉ một implementer tại một thời điểm.

Đánh đổi/rủi ro: Thêm một lượt review/pin và có thể phải chỉnh API sau tích hợp. Đổi lại, phần đọc dữ liệu và quyền truy cập được kiểm trước khi UI dùng, còn bằng chứng performance không bị gộp vào việc exporter đã xong. Report B07a phải bàn giao chính xác format/limits/endpoint/selector; mọi sửa Source ở B07b vẫn có test, export và pin riêng.

**44. B06 phải chạy qua luồng khởi động runtime thông thường.** Campaign truyền world factory trực tiếp chưa chứng minh gateway có thể chạy cell. B06 bổ sung factory vào portable bootstrap và readiness riêng cho world, kiểm đúng fixture/project/closure/lock/policy/clock/capacity rồi tạo shared model thật để smoke. Không lấy readiness của arm tĩnh thay cho cell hoặc tự bật provider thiếu điều kiện.

Đánh đổi/rủi ro: Readiness có thể chiếm sai slot, cache scene khác hoặc quảng bá set không chạy được. Phải giữ chung engine slot tới khi worker đóng thật, kiểm abort/failure và input/capacity mỗi request. Một smoke create–step–close qua normal factory cùng các ca từ chối đủ kiểm đường nối; campaign đầy đủ vẫn giữ riêng, không cần lặp ba seed chỉ vì đổi dispatcher. UI vẫn thuộc B07.

**45. Sửa validator provenance không tự làm bằng chứng cũ thành bằng chứng code mới.** B06 phát hiện observation gắp đơn lẻ từ world có thể thiếu metadata mà validator vẫn nhận; factory thực tế đang phát đủ. Sửa guard sau khi lượt đang chạy kết thúc. Chỉ được dùng lại seed 7 hoàn tất cho bằng chứng phát triển nếu diff chỉ từ chối thêm input sai, không đổi hành vi input hợp lệ, và toàn bộ observation/pending được đối chiếu với predicate/correlation mới; giữ hash inputs và artifacts.

Đánh đổi/rủi ro: Gộp hai phiên bản có thể che thay đổi xác nhận custody hoặc giả bằng chứng freshness. Phải ghi rõ phiên bản đã chạy và phiên bản kiểm lại, patch/hash/audit riêng; không đổi receipt clock để chứng minh tuổi observation trong quá khứ. Thiếu record, có row sai, case chưa đủ hoặc diff rộng hơn thì chạy lại. Các ca còn lại dùng bản khóa mới; B10 vẫn ghi đủ trên cùng tuple sạch cuối. Đọc SQLite qua bản sao kiểm chứng để không tạo sidecar vào bản gốc.

**46. Controller world phải phanh và chờ dừng trước khi kết thúc đoạn thẳng.** Seed 7 của freeze-01 bị trôi quá đích 16,934 mm, không đạt ngưỡng 8 mm và không xác nhận giao. Trace cho thấy bước đi thẳng đã kết thúc khi còn cách 3,9225 mm nhưng xe vẫn chạy 0,1435 m/s. Policy world v2 được dùng design braking deceleration 0,25 m/s² để giảm tốc sớm hơn, giữ bound tăng/giảm lệnh 0,5 m/s². Mọi đoạn dịch chuyển phải đạt cả vị trí và vận tốc dừng thực trước khi chuyển bước.

Đánh đổi/rủi ro: Đây là tham số thiết kế controller, không phải chứng nhận phanh phần cứng; vẫn có thể sai với quán tính/tải hoặc gây dao động. Cần regression với lag và route/return/second pick thật, giữ physics và mọi ngưỡng acceptance. Không snap pose, retry command hay đặt arrival giả. Freeze-01 được giữ là lượt thăm dò bị ngắt; điều kiện dùng lại ở quyết định 45 không đạt. Cả ba seed và năm fault sẽ chạy trên bản khóa mới.

**47. Tick của sự kiện dừng phải đúng tick quan sát vi phạm.** World kiểm dock trước khi tăng tick nội bộ tay máy; gọi halt tại đó đang ghi tick trước. Sửa nhãn sự kiện theo snapshot thực gây vi phạm, giữ clock/generator và default legacy. Phân biệt tick tác động, quan sát vi phạm, public commit, lệnh phanh kế tiếp và lúc thấy dừng thật.

Đánh đổi/rủi ro: Đổi tick sai chỗ có thể làm generator chạy lệch hoặc khiến report tuyên bố dừng sớm hơn thực tế. Cần test timeline gripper/lệnh và ranh giới phase; metadata không phải bằng chứng dừng vật lý.

**48. Sửa kích thước checkpoint world trước khi ghi matrix dài.** Đo trên snapshot đã đóng ở tick 3.208 cho thấy checkpoint gần 12 MB: khoảng 10,38 MB collision history và 1,22 MB props history. Đường tick đang serialize toàn checkpoint ba lần và clone hai lần; riêng CPU đo được khoảng 239 ms, vượt ngân sách tick 20 ms trước cả I/O/physics. Chuyển phần sửa bounded state từ B07b vào B06, dừng đúng suite đang sở hữu và giữ prefix đã chạy.

Đánh đổi/rủi ro: Tách dữ liệu dẫn xuất khỏi checkpoint có thể làm thiếu recovery state hoặc sai report. Giữ toàn bộ world evidence bền vững, mọi sweep, state/counter/stats/firstFailure và authority custody; report/trace đọc đủ từ stream đã kiểm. Không giảm fsync, nới freshness, bỏ raw sample hay thay physics/controller để tăng tốc. Cần test tăng trưởng state, rollback/crash và report equivalence rồi chạy lại ba seed/năm fault trên freeze mới. B07b vẫn phải đo browser production 180 giây, IPC, pause và tốc độ thực; microbenchmark này chưa đóng performance gate.

**49. Cache nhỏ phải đi cùng report đọc đúng mốc commit.** World được dùng mode nội bộ `world_durable_v1`, giữ tối đa 16 mẫu lịch sử trong cache, không đổi default legacy. Report đầy đủ được dựng tạm từ stream bền vững và không ghi ngược vào checkpoint. Source phải chụp cùng một horizon, state, manifest và business journal/effects; chỉ chờ queue hiện tại rồi đọc qua nhiều await chưa đủ ngăn action mới chen vào.

Đánh đổi/rủi ro: Reader có thể lấy ACK chưa commit hoặc trộn manifest và tail của hai thời điểm. Capture phải được serialize cả ở Source lẫn recorder, kiểm đủ identity/bounds/contiguity và cắt tại public horizon. Không flush/finish/republish/repair khi đọc, không gọi prefix đầy đủ là toàn run hoàn tất. Giữ trạng thái active/terminal/gap/write-intent; thiếu hoặc hỏng dữ liệu không pass. Cần kiểm race, flush boundary, lỗi ghi, reopen và report equivalence; B07a dùng lại seam này khi export. Runtime/gateway thông thường cũng phải trả method, coverage và status của `worldSweep` từ cùng journal/horizon đã chụp; không chỉ helper campaign mới có kết quả này. ARM03 cũ vẫn lấy từ cache giới hạn trước khi dựng trace đầy đủ. Artifact report có địa chỉ theo hash để report ở hai horizon không ghi đè tham chiếu của nhau. Field mới dùng `streamFinalized` cho việc kết thúc bản ghi không gap; `prefixCovered` cho coverage tới horizon; outcome/served cho kết quả nghiệp vụ. Một stream đóng ở tick 40 có thể finalized nhưng chưa giao cốc nào, nên không dùng tên `runComplete` cho điều kiện recorder.

**50. Tiếp cận đích theo hướng cuối trước khi dừng tại dock.** Lượt freeze-03 vào vùng vị trí cho phép ở cuối đoạn thẳng, nhưng cú quay khoảng 2,416 rad sau đó làm tâm xe dịch 8,908 mm. Sai số cuối 10,473 mm khiến cốc thứ hai chưa được gắp. Policy world v3 được thêm điểm tiếp cận cách đích 0,20 m ngược hướng yaw đích, thực hiện phần quay lớn ở đó rồi dùng phản hồi pose thực để đi tới goal ban đầu. Giữ nguyên command/goal Source và các ngưỡng; waypoint nội bộ không phải arrival hay confirmation mới.

Đánh đổi/rủi ro: Điểm tiếp cận dock `[0,35; 0,2859136622]` gần arm/stand hơn, có thể không khả thi. Phải kiểm cả đoạn dịch chuyển nối thêm bằng full footprint/signed bounds/obstacles, rồi kiểm contact và sweep 3D bằng native probe trước campaign. Hàm xác nhận plan hiện kiểm turn và final pose, không tự kiểm mọi translation; không dựa riêng vào nó hoặc bản đồ 2D trống. Giữ hành vi khi robot đã nằm yên đúng dock, compatibility archive và guard hiện có; không thêm riêng gate angular retirement trong lần sửa này. Nếu probe không đạt, lưu kết quả và đánh giá lại. Freeze-03 thất bại được giữ; ba seed và năm fault phải chạy mới trên policy đã version/hash.

**51. Bản khóa phải giữ nội dung file chưa commit.** Patch của Git chỉ giữ file đã track; hash của file mới chưa đủ để tái dựng sau khi sửa. Các freeze tiếp theo phải lưu archive source đầy đủ hoặc dùng một commit chính xác, cùng Git base/locks/closure cho dependency không đổi. Freeze-03 đã bổ sung 29 file còn nguyên và khôi phục riêng 7 file, đều được đối chiếu byte/hash với bản khóa gốc.

Đánh đổi/rủi ro: Thêm một lượng nhỏ dữ liệu lưu trữ để giữ provenance có thể tái dựng. Không sửa bản khóa cũ, không nhận bản khôi phục chỉ tương đương về ý nghĩa và không gọi việc sao lưu source là một lần chạy physics mới.

**52. Chuyển thử nghiệm sang tiếp cận lùi có giới hạn.** Probe v3 va chạm chassis–bệ vòi ở tick 4.467; điểm tiếp cận phía trước cũng tự chồng lên thể tích bệ, nên đổi đường vòng chưa đủ. Policy world v4 được dùng điểm chuẩn bị cách goal 0,20 m theo hướng yaw đích, quay đúng hướng ở đó rồi lùi có phản hồi về goal ban đầu. Giữ nguyên command Source, hình học và mọi ngưỡng acceptance.

Đánh đổi/rủi ro: Điều khiển lùi phải tách hướng di chuyển khỏi yaw thân xe. Footprint bất đối xứng giữ đúng hướng thân, còn vùng phanh/vật cản và beam invalid phải theo hướng lùi; thiếu dữ liệu phía sau phải hold. Sensor fixture có FOV 2π/360 beam, nhưng LiDAR phẳng không chứng minh clearance với bệ thấp. Cần test các guard này và native probe kiểm mọi contact, pose/vận tốc/dwell tại dock trước campaign mới. Giữ probe v3 không an toàn và các archive cũ; không mở reverse lattice tổng quát hay suy ra khả năng robot thật đã được qualification.

**53. Giảm lệnh về zero có giới hạn trước khi báo đến nơi.** Probe lùi v4 đạt pose dock, nhưng nhánh arrival cũ đặt lệnh góc từ khoảng 0,213 rad/s về zero ngay một tick, vượt mức thay đổi 0,03 rad/s/tick. Sửa riêng v4: khi đạt cửa sổ pose/vận tốc/dwell thực, giữ goal và ramp lệnh về zero; chỉ phát arrival khi lệnh đã zero và cửa sổ thực vẫn đạt.

Đánh đổi/rủi ro: Các tick giảm lệnh có thể làm xe rời vùng cho phép. Phải kiểm lại mỗi tick, không latch thành công sớm hoặc reset progress/deadline, và giữ arrival một lần cùng command. Probe cũ vẫn chứng minh clearance/convergence, có ghi ngoại lệ ramp; chạy lại probe ngắn để kiểm cả đoạn zero cuối trước campaign. Không đổi các ngưỡng hoặc hành vi legacy.

**54. Tăng giới hạn manifest runtime có kiểm soát.** Export sạch của B06 có manifest compact 65.810 byte, vượt trần importer 65.536 byte vì closure hợp lệ đã lớn hơn. Source exporter và Lab importer chuyển sang cùng giới hạn 256 KiB. Giữ mọi đường dẫn/hash/schema/provenance và các giới hạn cấu trúc hiện có; không cắt danh sách file hay ghi chú để vừa trần cũ.

Đánh đổi/rủi ro: Ngân sách parse tối đa tăng từ 64 lên 256 KiB, vẫn hữu hạn. Exporter phải từ chối bản vượt trần; test kiểm hợp lệ trên trần cũ, đúng trần mới và thêm một byte, bảo toàn pin khi bị từ chối. Giữ export lỗi và ghi riêng commit sửa đóng gói; 73 input native không đổi nên không chạy lại physics chỉ vì giới hạn file manifest.

**55. Hai report cùng horizon phải xuất được cùng artifact.** Review B06 xác nhận hai lần materialize report có thể dùng chung file tạm, khiến một lần rename lỗi `ENOENT` và cả request report thất bại. Sửa publication để an toàn khi gọi đồng thời, giữ atomic write/fsync/hash và việc materialize ngoài hàng đợi action Source. Regression phải kiểm cả trace/props, cùng horizon, khác horizon và action vẫn tiến triển.

Đánh đổi/rủi ro: Sửa helper dùng chung có thể ảnh hưởng crash/recovery. Cần test durability/failure bị tác động và đọc lại artifact cũ qua bản sao kiểm chứng. Nếu chỉ đổi publication/file tạm, không đổi command/physics/authority/byte evidence hợp lệ, giữ matrix 3+5 với identity đã chạy và ghi riêng phiên bản kiểm sau sửa; không chạy lại physics chỉ vì race file. Nếu phạm vi lan sang tick/ACK hoặc hành vi vật lý, phải đánh giá lại bằng chứng.

**56. Bổ sung NOTICE theo hash, không sửa provenance của lần chạy.** Bundle B06 giữ model và mesh đã admission nhưng thiếu NOTICE. Exporter được bổ sung nguyên văn license/NOTICE từ record repository/vendor đã khóa khi toàn bộ mapping component/model/mesh liên quan khớp hash. Package ghi rõ nguồn commit, hash record/NOTICE và loại metadata bổ sung, không coi đó là input đã admission lúc chạy.

Đánh đổi/rủi ro: Một mesh trùng hash chưa đủ chứng minh provenance của cả model. Phải kiểm đủ mapping liên quan; thiếu, mơ hồ hoặc mismatch thì từ chối xuất asset đó, hoặc dùng proxy đã hỗ trợ và ghi rõ. Không lấy geometry từ fixture mới, không sửa bundle cũ hoặc tự tạo điều khoản license.

**57. Export dùng cùng snapshot đã chụp cho report.** B07a được thêm consumer/sink chỉ phía Source vào bước materialize trì hoãn của B06 để nhận record đã kiểm, gắn đúng cùng H/state/journal và immutable prefix. Không đọc lại manifest/journal đang đổi hoặc nhét toàn bộ raw record vào public RunReport.

Đánh đổi/rủi ro: Consumer có thể trộn horizon, giữ thêm bộ nhớ lớn hoặc làm lỗi export ảnh hưởng run. Handoff phải có giới hạn và ownership/immutability rõ; materialize ngoài hàng đợi action. Lỗi/abort chỉ hủy export, không flush/finish/repair hay hủy world/report khác. Test phải kiểm export đồng thời với step, hai export cùng H, loại H+1, abort/failure và reopen chỉ đọc.

**58. Giới hạn cả số lần export và vòng đời output.** Endpoint replay giữ tối đa hai phiên bản pending/retained mỗi run, hai tác vụ capture/export đang xử lý và tám phiên bản pending/retained toàn runtime, với tổng trần package lưu 200 MiB. Khi đầy trả 429; session khác vẫn nhận 404 trước khi biết trạng thái tài nguyên. Expiry/delete/archive/close chỉ dọn output thuộc exporter.

Đánh đổi/rủi ro: Giới hạn nhỏ có thể từ chối người xem hợp lệ khi chạy đồng thời. Chỉ đếm dung lượng lưu chưa đủ giới hạn memory/CPU giải nén, nên vẫn cần budget reader/capture. Abort chỉ trả lại slot sau khi công việc và cleanup thuộc nó kết thúc, không hủy phiên bản khác hoặc xóa evidence gốc. Cần test race/lifecycle; khóa dữ liệu giữa các process thuộc B09.

**59. Phân biệt tác động đã lên lịch với tác động worker đã áp dụng.** Ca B04 có receipt riêng `payload-perturbation.json`, đã được lưu trong inventory của lần chạy. B07a được đưa receipt đó vào package khi hash và run/boot/scene/profile/target đều khớp, tick không vượt horizon đã chụp. Đây là receipt của worker mô phỏng, không tự là event hay quyền xác nhận custody của Source.

Đánh đổi/rủi ro: Sidecar của ca khác hoặc xuất hiện ở tick tương lai có thể làm UI nói sai rằng lực đã được áp dụng. Thiếu hoặc mismatch phải hiện unavailable/từ chối; lịch tác động không thay receipt. Giữ artifact cũ, tạo package mới và sửa bộ đếm audit theo trường program/event thực; claim tại cursor vẫn phải đúng clock.

**60. Residue sau hard kill không được biến mất khỏi quota export.** Registry chỉ đếm bộ nhớ của process mới sẽ bỏ sót folder từ lần chạy bị kill. Trước khi nhận export mới, quét có giới hạn các namespace output/staging thuộc exporter và giữ scan/admission nhất quán. Entry không được theo dõi hoặc không đọc được có kích thước chưa biết: trả 429/cần phục hồi, không coi mặc định là một package 25 MiB.

Đánh đổi/rủi ro: Residue có thể chặn export hợp lệ tới khi operator xử lý. Đổi lại, restart không cho tích lũy output không giới hạn. Không follow symlink, xóa data chưa biết hoặc làm mất phiên bản hợp lệ đang được theo dõi. Cần kiểm fresh registry/crash residue, enumeration có giới hạn và cleanup/concurrency; không mở rộng thành dịch vụ GC hay thay khóa cross-process của B09.

**61. Gói replay web không tự bổ sung liên kết tới từng entry journal.** Package giữ nguyên Source business events, program/cup/command/interaction và clock để UI nối phase, đối tượng và tick. ID tham chiếu journal vẫn được giữ, nhưng không có bảng entryId/event-index để trình duyệt tra sâu; UI phải ghi rõ phần này chưa có. Producer sweep đã kiểm correlation từ journal gốc trong cùng snapshot.

Đánh đổi/rủi ro: Một UX tra cứu journal trong tương lai cần mapping đã lọc và package mới. Không tạo ID suy diễn hoặc dùng vị trí cốc thay bằng chứng custody; không sửa archive cũ để bổ sung chức năng chưa cần cho trải nghiệm hiện tại.

**62. Quota tải asset phải giữ tới khi response kết thúc.** Giới hạn package lưu và số export không chặn nhiều lượt tải cùng một file. Endpoint indexed asset được thêm trần bốn download đồng thời và 16 MiB byte mã hóa đã đặt chỗ toàn process, tính theo asset đã admission. Kiểm owner/version/index trước, đặt chỗ trước allocation; đầy trả 429, không xếp hàng vô hạn.

Đánh đổi/rủi ro: Người xem hợp lệ có thể bị từ chối tạm thời. Slot phải được giữ tới khi cả I/O thuộc request và response finish/close hoàn tất, kể cả client ngắt giữa chừng. Đây là giới hạn công việc/buffer mã hóa, không phải khẳng định tổng JS heap bằng 16 MiB. Browser nên đọc tuần tự và hiển thị đúng trạng thái; session khác vẫn nhận 404 trước thông tin quota.

**63. Kiểm shutdown công khai trong B09.** Review lại B07a đóng bốn finding, nhưng thấy thứ tự cũ của `g.close()` chờ HTTP server đóng trước khi gọi cleanup v2. Response còn giữ có thể làm cleanup mới chưa được gọi. Vì vậy claim hủy download khi shutdown hiện chỉ đúng với method v2 bên trong; chưa chứng minh cho API đóng gateway công khai.

Đánh đổi/rủi ro: Trước B09, graceful shutdown có thể phải chờ client đang hoạt động. B09 phải kiểm public close với response bị giữ và I/O chưa xong, ngừng admission, hủy/chờ đúng công việc sở hữu, đóng worker rồi mới trả khóa data root. Giữ quan sát này tới khi có regression và review, trước qualification runtime cuối; không sửa chung server ngoài phạm vi cần thiết hoặc dùng global kill.

**64. UI live đọc world qua một seam riêng, không lưu snapshot trong mọi receipt.** RunView hiện chỉ đủ vị trí phẳng và một phần state. Thêm full snapshot vào đó sẽ khiến tối đa 10.000 receipt action giữ thêm lịch sử world trong checkpoint, lặp lại vấn đề B06 vừa sửa. B07b được thêm capture/GET chỉ đọc theo owner, trả một observation tại cùng tick/revision đã commit, với run/boot/scene và trạng thái valid/stale/unknown rõ ràng.

Đánh đổi/rủi ro: Thêm API hiển thị và liên kết context có thể lệch tick hoặc tăng chi phí polling. Snapshot và worldControl phải cùng mốc commit; không lấy command H+1 đang pending hoặc program của bước kế tiếp. Chỉ giữ một projection control có giới hạn; archive cũ thiếu thì hiện unavailable. Metadata/asset phải khớp identity đã admission, không lấy fixture mới để đoán. Kiểm race/failure/reopen/quyền đọc và tăng trưởng checkpoint; không dựng full report mỗi frame hay thay quyền điều khiển.

**65. Đo nguyên nhân trước tối ưu, rồi khóa bản đo production cuối.** Thăm dò 10 giây có RAF p95 16,8 ms (chưa phải khoảng cách giữa các lần vẽ thật) và worker+IPC p95 4,69 ms, nhưng toàn luồng chỉ đạt khoảng 0,56×. B07b được đo ngắn các stage thật và sửa các chi phí có bằng chứng; thay đổi lớn về persistence/recovery phải có số đo và phương án cụ thể. Giữ ACK, durability, freshness, collision, physics, mẫu và clock.

Đánh đổi/rủi ro: Instrumentation có thể làm chậm hoặc nhầm ACK worker với tick Source đã commit. Đo cuối dùng UI production và bundle export sạch không sửa byte; preload do task sở hữu chỉ quan sát đúng Python child/request/ACK của lượt đó, giữ nguyên I/O/backpressure/error và giới hạn log/buffer. Ghi riêng worker wire latency, Source commit/upper bound quan sát qua browser, HTTP, tốc độ thực, frame và pause ACK/UI. Thăm dò Source modules qua tsx vẫn là diagnostic; không gọi đó là performance của bundle hoặc coi 0,56× là đạt 1×. Bản 180 giây phải khóa sau các sửa liên quan và giữ mọi kết quả không đạt.

**66. Giữ một frame cũ nhất quán trong lúc chờ response mới.** Mỗi revision vẫn xóa lịch sử/interpolation cũ. UI được giữ đúng một frame Source/world đã commit, cùng H/revision, tối đa 500 ms khi action kế tiếp của cùng run/boot/scene đang trả về. Frame giữ mốc và tuổi gốc; không nhận thêm telemetry/context mới hoặc extrapolate. Controls dùng revision authority hiện tại.

Đánh đổi/rủi ro: Người xem có thể thấy hình trễ tới 500 ms. Cần freshness rõ ràng; đổi run/boot/scene/replay phải xóa ngay, trạng thái physical unknown/failure không được che bằng hình cũ mang nhãn current-valid. Đây không phải nối lịch sử qua revision. Test phải kiểm hết hạn, identity, fault và cô lập context; số đo phải tách nhịp vẽ thật khỏi RAF và nhịp nhận pose.

**67. ZIP replay giữ byte lưu gốc đã kiểm.** Browser round-trip tại H7 tìm thấy lỗi: ZIP dùng `readAsset()` trả byte giải nén trong khi manifest giữ size/hash của byte nén. Import từ chối `REPLAY_ASSET_SIZE` là đúng. Reader Source được thêm `readStoredAsset(path)`, dùng cùng cơ chế đọc tuần tự có giới hạn và kiểm đủ hash/kích thước nén lẫn giải nén; API cũ giữ nguyên nghĩa.

Đánh đổi/rủi ro: Thêm nhánh đọc có thể làm sai lifecycle hoặc bỏ qua kiểm. Phải giữ admission đường dẫn, abort/close cả sau digest, byte thuộc caller và không cache thêm toàn package; không recompress, tạo parser mới hoặc đi vòng reader. Cần test gzip/identity/tamper/path/abort, kiểm entry ZIP theo hash và nhập lại gói H7 thật trên production build mới. Giữ lượt import lỗi, commit/export/sync/pin trước đo cuối; chưa coi nút Save hoạt động là bằng chứng package nhập lại được.

**68. Đo trọn lượt export lớn và phần nghẽn sau pause.** Lượt production 185 giây đã đo được thời gian phản hồi pause, nhưng export còn pending khi harness hủy. Sau pause, GET Source/world display chờ khoảng 4,15 giây, nằm ngoài thống kê event loop của cửa sổ active. Giữ kết quả đúng phạm vi; chưa gọi đó là export lớn hoàn tất. B07b được đo riêng một lượt export hoàn chỉnh trên bản sao kiểm chứng của run đã chụp, tìm stage serialize/compress/reconstruct gây nghẽn.

Đánh đổi/rủi ro: Profiling và ghi lại tăng thời gian; thêm yield có thể tạo race capture/cancel. Ưu tiên sửa async/yield nhỏ qua dữ liệu immutable đã chụp, ngoài queue authority; giữ ACK/durability/physics/budget và kiểm cùng horizon/lifecycle. Không mở SQLite gốc, chạy lại B06 hoặc tự thiết kế lại persistence. Nếu sửa runtime/UI, cần pin/bản khóa và phép đo dài mới, giữ lượt cũ. Bộ đếm geometry có trong scene không chứng minh mọi vật thể nằm trong camera; AMR đã rời khung Cell trong ảnh cuối phải được ghi rõ.

**69. Chỉ đổi proof owner trên bản sao dùng để đo.** Secret reclaim của browser không được lưu, còn run giữ proofHash. Để đo export hoàn chỉnh, task được thay riêng proof của `reclaim.json` trong bản sao đã kiểm chứng bằng secret mới dùng cục bộ. Phải đối chiếu byte trước, lưu hash trước/sau của ngoại lệ auth và giữ secret khỏi log/commit.

Đánh đổi/rủi ro: Bản sao này dùng auth fixture, không chứng minh production reclaim hoặc quyền truy cập thật. Mọi đường dẫn/runtime phải ở bản sao, bind localhost; không symlink/tham chiếu về bản gốc, không mở SQLite gốc hoặc sửa checkpoint/evidence/run ID/provenance vật lý để vượt admission. Bằng chứng từ đây chỉ phục vụ export/performance cùng dữ liệu đã chụp.

**70. Chia nhỏ công việc report/export theo nguyên nhân đã đo.** Profile export hoàn chỉnh H4610 mất khoảng 5,4 giây, GET chờ tới 2,08 giây. Phần kiểm world sweep đồng bộ chiếm khoảng 1,83 giây CPU được lấy mẫu; serialize/compress cũng góp phần. Dùng một core generator cho cả API sweep đồng bộ cũ và nhánh async mới, yield mỗi 32 record kể cả bước kiểm trước; chỉ materialize report trì hoãn dùng nhánh async. Export nén async tuần tự và yield giữa chunk/asset đã kiểm.

Đánh đổi/rủi ro: Yield tạo cơ hội interleave/cancel nên có thể lộ race hoặc đổi output. Giữ dữ liệu chụp cùng H/journal/admission, mọi kiểm/callback/thứ tự/đếm/failure, byte/hash nén và giải nén; không đổi fsync/ACK/physics. Test phải so sync/async và byte output, kiểm action tiến triển mà report không lấy H+1, abort/cleanup/publication. Đo lại export hoàn chỉnh và request đi cùng; code đổi thì cần export/pin/bản khóa và 185 giây mới. Các lượt cũ giữ nguyên, số CPU inclusive không được cộng như các stage độc lập.

**71. Kiểm tập trung cho sửa live/replay và controls, giữ đúng phiên bản số đo.** Review B07b tìm hai lỗi UI: live world còn được vẽ khi vào report replay, và frame giữ lại chi phối trạng thái controls. Vòng sửa1 chỉ đổi các ranh giới này, giữ Source/pin, physics và nhịp draw/step/worker thông thường. Dùng regression xác định thứ tự, cùng browser native cho Pause/Resume và cả hai đường report replay H7 trên build mới; không chạy thêm185giây ở vòng sửa hẹp này.

Đánh đổi/rủi ro: Thời gian phản hồi UI mới chưa được đo dài tới B10. Vì vậy số đo cũ chỉ thuộc Source `e07685d` / Lab `89b4a38`, không gắn ACK/UI latency hoặc performance sang commit mới. B10 phải đo trực tiếp tuple cuối sau mọi sửa; performance acceptance/D0 vẫn mở. Nếu diff chạm nhịp chạy/vẽ, Source hoặc cách đo ngoài phạm vi trên thì đánh giá lại, không dùng quyết định này để bỏ kiểm liên quan.

**72. Live frame phải khớp cả revision sau thời gian giữ lại.** Vòng sửa1 thấy predicate cũ chỉ so run/tick: sau500ms, world ở revision11 có thể vẫn gắn vào context revision12 nếu Pause giữ nguyên tick. Bổ sung so đúng `sourceRevision` với revision của view được chọn, cùng các guard run/boot/scene/availability. Trong thời gian giữ được phép dùng cặp cũ nhất quán; hết hạn thì geometry unavailable cho tới observation khớp.

Đánh đổi/rủi ro: Response chậm hoặc thiếu revision có thể tạm làm mất hình; đổi lại không gắn context mới lên hình cũ vô thời hạn. Test phải kiểm cùng tick/khác revision, hết hạn và response đến muộn. Đây là predicate trong findings I1/I2, không đổi nhịp chạy/vẽ hay Source; phạm vi đo ở quyết định71 giữ nguyên.

**73. Sửa admission study bằng kiểm nội dung, giữ riêng identity producer và validator.** Review B08 chứng minh profile ma sát đã đổi từ 0,6 thành 0,99, tính lại đủ hash nhưng giữ tên baseline, vẫn được nhận là input tương đương. Vòng sửa1 phải kiểm nội dung profile vật lý đã đăng ký, empty-load/model binding và population; regression cần tính lại đủ seal để thực sự tới bước kiểm ngữ nghĩa. Giữ bản ghi X01 thật ở Source `709a797`, kiểm lại bằng consumer mới và ghi identity validator/export/pin riêng.

Đánh đổi/rủi ro: Consumer mới có thể từ chối dữ liệu hợp lệ hoặc ảnh hưởng helper admission dùng chung. Cần đọc lại X01 thật, test mutant nhất quán và review độc lập. Không chạy lại native chỉ để chứng minh bộ kiểm offline; nếu sửa producer/compiler/controller/physics/measurement hoặc UI thì phải xem lại phạm vi kiểm tương ứng. Không sửa byte hoặc gắn commit mới vào bản ghi cũ; B10 vẫn ghi tuple cuối sau mọi thay đổi.

**74. Tách ID phiên công khai khỏi token, chuyển writer có epoch.** B09 thêm ID nhận diện phiên độc lập với bearer/cookie và operation `grant_read`/`transfer` do writer hiện tại xác nhận. Người nhận phải là phiên đang hoạt động; không mở danh sách phiên. Quyền xem chỉ áp dụng cho run được cấp. Transfer tăng epoch; client cũ chỉ được bỏ header epoch khi vẫn là writer gốc ở epoch 0. Sau transfer, mọi lệnh writer phải có epoch hiện tại. Không tự chuyển quyền khi disconnect, hết hạn hoặc reclaim.

Đánh đổi/rủi ro: ID không được trùng secret; kiểm quyền ở đầu HTTP rồi chạy muộn có thể tạo lệnh cũ sau transfer. Cần tuyến tính hóa kiểm quyền và thao tác thực, kiểm hai phiên HTTP thật, hàng đợi/transfer, hết hạn và reclaim. Người chỉ xem không được archive/delete hoặc lấy quyền chạy; quyền housekeeping của proof owner cũ vẫn được giữ trong phạm vi riêng. Origin/CSRF, private404 và header CORS vẫn phải đúng. Đây chỉ là quyền mô phỏng, không mở đường tới hardware.

**75. Cold reclaim đọc checkpoint trước khi tạo worker tay máy.** Kiểm Mac MuJoCo thật cho thấy public close đã đóng child, nhưng reclaim arm-only cũ lại gọi factory tạo world trước khi `holdForReclaim` chạy. B09 thêm lựa chọn `reclaimOnly` do gateway đặt, chỉ nhận checkpoint đã kiểm identity và dùng retained/frozen ports ngay từ đầu. Không tạo world, khởi tạo observation mới hoặc đổi bundle/boot để phục vụ đọc lại. Đường reopen trực tiếp cũ ngoài reclaim giữ hành vi hiện tại.

Đánh đổi/rủi ro: Recovery riêng có thể làm thiếu report hoặc vô tình đổi lifecycle cũ. Thiếu checkpoint/state cần thiết phải bị từ chối; dữ liệu còn thiếu ghi unknown/unavailable, không thay bằng chuyển động/contact giả. Kiểm actual arm cold/repeated reclaim, từ chối thiếu checkpoint, worker PID đã đóng và regression world/mobile liên quan. Giữ log lỗi ban đầu; không sửa bản ghi lịch sử.

**76. Review implementation trước, giữ WEB05 mở khi Docker không đáp ứng.** Các lần kiểm chưa lấy được metadata server hợp lệ; hai client có timeout thực, lần đầu của controller phải dọn process sở hữu sau khi timeout dự kiến không hoạt động; chỉ các client do task tạo bị dừng, không reset daemon/container/volume. B09 được review code và export/pin sạch, rồi tiếp tục phần chuẩn bị portable. Image mới vẫn `null`/chưa build; không đồng nhất artifact export với image container.

Đánh đổi/rủi ro: Lỗi chỉ có trong image, quyền volume hoặc lifecycle container còn có thể tồn tại. Chuyển kiểm actual arm/mobile/cell, hai container cùng volume, crash/committed chunks và replay sang qualification cuối B10 khi Docker đáp ứng; nếu vẫn thiếu thì bàn giao gate `not_run`/`blocked_environment`. Kiểm Mac worker/process và compiler không thay thế WEB05. L00 giữ image R2b unresolved và `nativeReady:false`, tách khỏi image R2a lịch sử. Không hạ ngưỡng acceptance hoặc tự sửa hạ tầng ngoài task.

**77. Kiểm import lịch sử bằng Git object và review riêng code thay đổi.** B00R2 nhập hàng nghìn file từ đúng upstream đã khóa. Giữ full diff, kiểm đủ path/mode/blob và các bản ghi/xóa kế thừa; review trực tiếp code platform, guide JS/Python/CSS/verifier, README, guard, pin và mọi conflict hoặc path lệch. Không loại code chỉ vì nó nằm trong thư mục artifacts/docs.

Đánh đổi/rủi ro: Không đọc lại thủ công từng tick lịch sử có thể không phát hiện lại lỗi ngữ nghĩa cũ. Kiểm blob và manifest/guard chỉ chứng minh nội dung kế thừa và binding, không nghiệm thu R2b hoặc chấp thuận của con người. Mọi blob không khớp, phần feature đụng cùng path và evidence mới đều phải lộ rõ cho reviewer; review cuối vẫn kiểm toàn bộ thay đổi feature và bằng chứng mới.

[Bản chụp nguyên văn ledger](05-implementation-decisions-ledger.json) giữ đủ 89 dòng quyết định, kể cả các dòng trùng giữa ledger tổng và ledger mobility. Khi bàn giao cuối cần cập nhật cả danh sách này và snapshot theo các quyết định phát sinh sau đó; không xóa ledger tạm trước khi lưu đầy đủ bản được version trong source/docs.


**78. Phân biệt image OCI và cài trực tiếp bằng native apt.** Gói L00 hỗ trợ hai loại provenance do profile đã khóa quy định. OCI cần đúng manifest/config của một platform; native apt cần distro, kiến trúc, package và nguồn package được khóa cùng inventory khớp. Thiếu dữ liệu vẫn chưa đủ điều kiện chạy. Không bắt ROS/LinuxCNC phải có một image không tồn tại.

Đánh đổi/rủi ro: đổi nhãn loại cài đặt có thể che thiếu bằng chứng image. Vì vậy handoff MuJoCo R2a theo image và image R2b hiện tại vẫn bị ràng buộc OCI; image `null` không thể được nâng thành ready bằng inventory của ROS/CNC. Giữ API native apt cũ; thêm ca từ chối lẫn profile/mode, thiếu lock và image R2b chưa build. Kiểm tính nhất quán không phải xác thực host, qualification hay cấp phép hardware.


**79. Kiểm nội dung model theo đúng loại tài liệu.** Root phát hiện handoff L00 ban đầu mới kiểm hash/identity; subagent xác nhận dữ liệu không tương thích vẫn có thể được ghi prepared. Claim hoàn thành đã được rút lại, bản ghi cũ được giữ riêng và task tiếp tục trước review đầu. Bổ sung kiểm tĩnh bằng validator Lab/ROS hiện có và adapter nhỏ theo model DH/TCP PUMA đã khóa, để chuẩn bị cả hai nhánh.

Đánh đổi/rủi ro: nhiều định dạng làm admission phức tạp hơn. Mỗi loại phải có discriminator rõ, kiểm schema/ID/ref/frame/unit và các quan hệ joint/limit/inertia áp dụng; test âm phải reseal đủ để tới đúng kiểm semantic. Không tự chuyển đổi model chưa rõ hoặc tạo thông số vận hành. L03/L04 vẫn phải kiểm native URDF/plugin/controller/trace thực; parser tĩnh không thay bằng chứng đó.


**80. Kiểm riêng provenance model gốc và world ghép.** Scene shared-world hiện tại tái dùng model mobile từ baseline và gắn vào Lab world/project bên ngoài. L00 được dùng adapter có phạm vi rõ: kiểm physical model ↔ navigation model theo input gốc; kiểm riêng outer project/world/frame/model và phép ghép được hỗ trợ. Không áp dụng máy móc quy tắc equality của scene standalone, không sửa fixture/evidence cũ.

Đánh đổi/rủi ro: adapter quá rộng có thể chấp nhận nhầm world/model. Phải liệt kê từng khác biệt có chủ ý, giữ validator standalone, từ chối adaptation ngoài phạm vi và dùng test đã reseal đủ cho input model, outer identity, geometry/frame. Report phải chỉ ra chính sách tạo scene và các binding thực đã kiểm; hash hay nhãn profile riêng lẻ không đủ.


**81. Adapter arm-only R2a thuộc task probe L01.** L00 chỉ đóng phần prepared cho các loại tài liệu đã hỗ trợ rõ; arm-only lịch sử vẫn unsupported. L01 bổ sung adapter dùng đúng file/model của R2a trước khi probe chấp nhận gói. Runtime cũ `55dd3585…` đã được tìm và kiểm hash ở cache Lab, thuộc Source `4f893ac`; chỉ sao chép dữ liệu đã kiểm từ vị trí gốc chỉ đọc.

Đánh đổi/rủi ro: L01 có thêm bước tích hợp schema/validator và phải giữ các kiểm admission hiện tại. Đổi lại, logic riêng của baseline arm-only nằm cùng task chạy đúng image đó. Không dùng world mới hoặc rebuild HEAD để thay baseline; cache runtime không thay image manifest/config, closure audit hay bằng chứng native.


**82. Ghi rõ phạm vi bad-state và recipe trong probe R2a.** Gateway cũ không có API chèn bad-state. Dùng WorkerSession và MuJoCo thật của baseline qua harness fault có hash riêng, giữ raw input/state/warning và kiểm worker fail, không step thành công sau lỗi, dừng có giới hạn. Case này không tự chứng minh custody/served của Source. Worker-loss qua runtime không đổi phải kiểm riêng no false serve, không gửi lại hoặc respawn. Recipe M00 lấy nguyên văn từ tài liệu đã khóa; recipe và profile amd64 mới thuộc observer, không giả là file của image cũ.

Đánh đổi/rủi ro: kiểm bad-state ở component không chứng minh toàn bộ đường truyền lỗi tới Source. Manifest/reader phải yêu cầu đủ từng scope, không nhận unit log thay native evidence và không quảng bá full-runtime bad-state hoặc gate phần cứng từ phép kiểm hẹp này. Giữ nguyên baseline và công khai instrumentation giúp chuẩn bị probe thực thi mà không sửa image lịch sử.


**83. Adapter native R2b thuộc tooling B10.** L01 giữ campaign theo đúng image R2a cũ. B10 phải thêm và review đường thực thi payload/cell cho tuple R2b riêng, cùng bước tích hợp image/campaign/reader. Không chỉ để một nhãn not_run thay code chạy; không ghép image cũ với worker hoặc campaign mới.

Đánh đổi/rủi ro: B10 có thêm việc tích hợp và có thể kéo dài mốc tooling. Khi chưa có host/image, chỉ kiểm protocol và để lượt native not_run; hồ sơ cuối phải chỉ rõ nếu đường thực thi còn thiếu, không gọi đó là Linux-ready.

**84. Quan sát wire worker bằng preload có danh tính riêng.** Gateway cũ không có hook trace wire. Preload observer được phép ghi request, ACK và PID/spawn/exit thực, giữ nguyên cách gọi/giá trị trả về/event/write của tiến trình. Case ghi là subject giữ nguyên byte, có instrumentation; không gọi là chạy không can thiệp. Chỉ dừng worker do task sở hữu.

Đánh đổi/rủi ro: tracing có overhead hoặc bỏ sót import binding. Giới hạn dung lượng, không ghi secret/env, giữ raw trace và kiểm forwarding/ownership; thiếu, tràn hoặc chưa hoàn chỉnh thì không được kết luận no-resend. Không thay command/ACK hoặc lấp khoảng trống bằng suy luận từ HTTP.


**85. Dùng đúng model canonical của handoff cho FD01 native.** L02 dùng project/scene/physical model `serve-3d-v1` không đổi byte, rồi tạo mapping/artifact Gazebo riêng. Thay ví dụ command với `fd01.project.json` cũ bằng canonical project; fixture cũ và đường non-native/legacy vẫn giữ nguyên. `requestedProfile` Webots của nguồn là provenance, profile engineering thực thi được ràng buộc riêng.

Đánh đổi/rủi ro: native adapter mới chỉ hỗ trợ subject canonical này; không suy ra hỗ trợ mọi project hoặc model của fixture tham chiếu cũ. Subject khác cần mapping/readback và qualification riêng. Các ca FD01, fault, clock/bag và xác nhận nghiệp vụ Source vẫn bắt buộc; không hạ readiness package/plugin hoặc coi kiểm portable là chạy native.

**86. Role riêng cho artifact mapping native xArm.** Thêm `refs.nativeMapping` optional, đúng hai ref cho expanded URDF đã capture và record mapping/readback. Giữ model canonical đơn nhất và tool/engine thuộc closure bất biến. Kiểm path/hash/identity/giới hạn cùng nội dung joint/tool/plugin và nguồn producer; không dùng artifact sinh ra để bù thành phần closure còn thiếu.

Đánh đổi/rủi ro: role mới có thể làm lẫn input, tooling và kết quả quan sát hoặc nhận mapping giả. Cần test sai nội dung đã reseal, sai role/profile/evidence kind và review độc lập. Không đủ artifact thì vẫn thiếu prerequisite; model khớp không thay chứng minh host/package, motion hay contact.

**87. Chọn model 1305 bằng selector mô phỏng cố định.** Upstream dùng trường `robot_sn` để chọn biến thể model; `model1300=false` chưa đủ. Profile giữ `syntheticSimModelSelector=XI13050520BB00`, chỉ làm input mô phỏng để chọn xArm6/1305/HT_BR2; không là serial của máy thật. Giá trị do server khóa và phải khớp expanded URDF được đọc lại.

Đánh đổi/rủi ro: decoder thay đổi hoặc selector sai có thể chọn geometry/limits khác; cần pin byte nguồn, kiểm biến thể và đọc artifact độc lập. Không dùng giá trị tổng hợp làm danh tính hoặc bằng chứng commissioning. [Parser upstream đã khóa](https://raw.githubusercontent.com/xArm-Developer/xarm_ros2/d837f2e17f7f36043103b367fca3af8172626245/xarm_description/urdf/common/common.link.xacro).

**88. Theo dõi riêng code chuẩn bị và qualification native của L03.** Bốn lỗi mapping/CLI đi vào vòng sửa. Finding về X1/X2/X3 chưa chạy giữ nguyên là yêu cầu native còn thiếu; không đóng bằng test portable hoặc tài liệu. Sau khi code chuẩn bị qua review, tiếp tục L04/L05/tooling, còn gate native L03 vẫn incomplete/not_run cho tới khi có host phù hợp được giao.

Đánh đổi/rủi ro: lỗi tích hợp Linux/contact vẫn có thể xuất hiện khi chạy thật. Handoff và L06 phải giữ rõ scope: từ chối mở lại run cũ không là kiểm controller restart; trajectory trực tiếp không chứng minh planning/collision; chưa quan sát G2 không là kết luận unsupported. Các thiếu sót chuẩn bị có thể sửa tại đây vẫn phải được nêu và xử lý riêng.

**89. Đưa script và packaging LinuxCNC vào native closure.** Bổ sung hai thư mục `integrations/arm-controller/scripts` và `packaging` vào danh mục code/resource bất biến được export và kiểm hash. Bộ thu trace, launcher, inventory, installer/trust và lock candidate phải được ràng buộc cùng handoff; SHA do trace tự khai không thay được closure. Trace và inventory quan sát sinh ra khi chạy vẫn là bằng chứng riêng.

Đánh đổi/rủi ro: digest native thay đổi nên cần commit/export/pin mới và record chuẩn bị mới ở tuple cuối. Giữ nguyên mọi artifact cũ, cách gọi checker lịch sử, kiểm symlink và cache. Có đủ file không có nghĩa package đã được cài hoặc native/physical đã được kiểm; lock còn unresolved vẫn giữ gate chưa sẵn sàng.

**90. Deadline riêng cho từng ca cell R2b hiện tại.** Registry cho phép 6.000 giây mỗi ca; helper probe lịch sử giới hạn 30 phút. Adapter R2b có chính sách riêng tối đa 6.100.000 ms mỗi process (6.000 giây + 100 giây điều phối), giữ nguyên giới hạn và profile R2a. Kiểm giới hạn nguyên, hữu hạn, dương; giữ output/receipt khi timeout, abort hoặc chạm giới hạn output; cleanup chỉ process/container thuộc lượt của mình. CLI chạy từng ca không được làm giảm coverage của qualification đầy đủ (3 nominal + 5 fault). Kiểm cả timeout tầng ngoài.

Đánh đổi/rủi ro: budget lớn hơn có thể giữ host lâu hoặc che process bị treo; cần test timeout/abort/ownership ngắn, giới hạn hữu hạn và báo incomplete đúng. Tái dùng cơ chế process khi phù hợp, tránh chép nguyên logic. Code mới đổi closure và cần export/pin/review; không chạy test chờ 100 phút hoặc suy native pass từ kiểm portable.

**91. Gắn package campaign sinh từ build bằng OCI config.** Giữ nguyên schema và guard L00: manifest sinh ra không được giả làm engine/tool thuộc closure nguồn. Build sạch đặt label cho SHA256 manifest package và bundle trong config image. Adapter đọc config thô đã đối chiếu platform/config digest, rồi so với inspect thật và hash file trong container. Manifest package ràng buộc observer, input graph, Source/runtime/schema/portable/profile/campaign; sai tuple hoặc byte phải bị từ chối.

Đánh đổi/rủi ro: label tự khai có thể bị hiểu nhầm là provenance hoặc bằng chứng đã chạy. Cần so artifact thật, kiểm các ca sai đã reseal, giữ giới hạn path/symlink/size/secret và phân biệt config digest với manifest digest. Companion là metadata của package được sinh ra, không bù file closure thiếu hoặc bỏ qua nativeReady. Chưa có image/host thì vẫn not_run; test config/inspect tổng hợp không đóng native gate.

**92. Đường OCI local không cần push registry.** Build R2b chuẩn bị một lần xuất OCI và nạp qua Docker exporter, trên driver local hỗ trợ Buildx/BuildKit từ 0.13. So config digest giữa hai output, kiểm descriptor/blob/platform, rồi đối chiếu config ID, rootfs diff IDs, kiến trúc và label từ inspect thật. Có thể thiếu RepoDigests nếu association local đã được kiểm; không được gọi đó là quan sát registry manifest. RepoDigest xung đột vẫn bị từ chối.

Đánh đổi/rủi ro: khác biệt exporter/daemon hoặc metadata giả có thể làm sai provenance. Giữ L00 kiểm hash platform/config, giới hạn path/size/symlink và test sai đã reseal; không đổi builder/context không thuộc task hoặc dùng remote/push. Kiểm build/load thật vẫn not_run. [Docker exporters](https://docs.docker.com/build/exporters/) và [OCI/Docker exporter](https://docs.docker.com/build/exporters/oci-docker/) là nguồn đã kiểm ngày 15/11/2026; tài liệu không thay bằng chứng chạy trên host.


**93. Giữ rõ chuỗi qualification chưa hoàn tất khi Docker bị chặn.** Sau khi R1/R1.1 ở tuple hiện tại thực sự đạt, dùng tùy chọn có sẵn `R2a --skip-suites` để ghi hồ sơ mới mà không dò lại Docker đang không phản hồi. Mọi suite bị bỏ qua vẫn `not_run`. Chạy riêng từng suite R2a không cần container theo đúng bảng và môi trường hiện có, giữ receipt/kết quả gốc làm bằng chứng bổ sung; không chèn lại trạng thái vào candidate đã ghi. R2b vẫn chạy phạm vi full với hồ sơ R2a chưa đầy đủ đó và các input physics/cell/study/web thực tế. Giữ kết quả guard thực: `REG04=failed` với `R2A_GATE_NOT_TESTED`, còn `WEB05=not_run` nếu chưa có image. Không dùng `--blocked` vốn dành cho spike M00 thất bại, giảm case hoặc sửa ngưỡng để có trạng thái tốt hơn.

Đánh đổi/rủi ro: hồ sơ R2a ghi nhận ít coverage hơn các lượt cục bộ bổ sung và qualification toàn chuỗi vẫn chưa đạt. Cần chạy lại chuỗi đầy đủ cùng container của đúng tuple khi prerequisite hoạt động; các lượt bổ sung chỉ chứng minh phạm vi đã chạy. Cách ghi này cho phép tiếp tục kiểm chứng web và vật lý trên máy hiện tại mà không che phần phụ thuộc còn thiếu hoặc ảnh hưởng dịch vụ khác.
