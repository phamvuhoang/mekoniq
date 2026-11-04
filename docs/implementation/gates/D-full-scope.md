# Gate D — full accepted scope (inventory)

Verdict: **NOT COMPLETE**. Generated from `docs/superpowers/plans/2026-10-30-plan-index.json` by `node scripts/verify-completion.mjs --write`; do not edit by hand.
A row is accepted only when the index says `accepted`. `verified_local` means implemented and exercised locally; `blocked_external` means the software exists but a mandatory physical, provider, hosted or soak qualification is missing; `planned` means not started.

Tasks: 63 — blocked_external: 14, verified_local: 49. Gate A: not_accepted.

## Tasks that are not accepted

| Task | Status | What is missing |
|---|---|---|
| W00-T01 Workspace và API lifecycle chạy được | verified_local | Local evidence only; no external qualification recorded. |
| W00-T02 Schema wire và canonical signing bytes | verified_local | Local evidence only; no external qualification recorded. |
| W00-T03 Money, quantity và kết quả domain thuần | verified_local | Local evidence only; no external qualification recorded. |
| W00-T04 Transaction kernel và durable idempotency | verified_local | Local evidence only; no external qualification recorded. |
| W00-T05 Test lab dùng runtime thật và fault injection | verified_local | Local evidence only; no external qualification recorded. |
| W01-T01 Native SQLite bridge kiểm CAS và batch atomic | verified_local | Local evidence only; no external qualification recorded. |
| W01-T02 Keystore và identity của thiết bị | verified_local | Local evidence only; no external qualification recorded. |
| W01-T03 LAN listener, pairing và heartbeat domain runtime | verified_local | Local evidence only; no external qualification recorded. |
| W01-T04 UI trạng thái kết nối, outbox và role shell | verified_local | Local evidence only; no external qualification recorded. |
| W01-T05 Qualification vòng đời Android và hai thiết bị | blocked_external | Physical supported tablet/AP qualification and 24-hour soak; emulator/software evidence does not accept Gate A. |
| W02-T01 Identity, tenant isolation và phiên nhân viên | verified_local | Local evidence only; no external qualification recorded. |
| W02-T02 Enrollment và sổ ownership của venue/robot | verified_local | Local evidence only; no external qualification recorded. |
| W02-T03 Feature engine, dependency và cấu hình có version | verified_local | Local evidence only; no external qualification recorded. |
| W02-T04 Sync inbox/outbox, gaps và quarantine | verified_local | Local evidence only; no external qualification recorded. |
| W02-T05 Realtime hints, cloud relay và bounded jobs | verified_local | Local evidence only; no external qualification recorded. |
| W02-T06 Supabase Storage và profile Free có quota guards | verified_local | Local evidence only; no external qualification recorded. |
| W03-T01 Catalog phiên bản và giá snapshot cơ bản | verified_local | Local evidence only; no external qualification recorded. |
| W03-T02 Phiên bàn và vòng đời order có version | verified_local | Local evidence only; no external qualification recorded. |
| W03-T03 KDS theo trạm và allocation số lượng | verified_local | Local evidence only; no external qualification recorded. |
| W03-T04 Mission state machine và simulator adapter | verified_local | Local evidence only; no external qualification recorded. |
| W03-T05 Bill snapshot và cash receipt tối thiểu | verified_local | Local evidence only; no external qualification recorded. |
| W03-T06 Ghép UI và kiểm thử vertical slice nhiều tablet | verified_local | Local evidence only; no external qualification recorded. |
| W04-T01 Isolated capture và conflict workbench | verified_local | Local evidence only; no external qualification recorded. |
| W04-T02 Settlement grants độc quyền và tiền chưa rõ | verified_local | Local evidence only; no external qualification recorded. |
| W04-T03 Maintenance window, export và phiếu dự phòng | verified_local | Local evidence only; no external qualification recorded. |
| W04-T04 Import lịch sử idempotent và duyệt theo receipt | verified_local | Local evidence only; no external qualification recorded. |
| W04-T05 Handoff, restore và reconciliation của robot | verified_local | Local evidence only; no external qualification recorded. |
| W04-T06 Gate A: chạy toàn bộ bộ continuity | blocked_external | Physical supported tablet/AP qualification and 24-hour soak; emulator/software evidence does not accept Gate A. |
| W05-T01 Giá đầy đủ: modifier, thuế/phí và discount allocation | verified_local | Local evidence only; no external qualification recorded. |
| W05-T02 Chuyển/gộp bàn và amendment xuống bếp | verified_local | Local evidence only; no external qualification recorded. |
| W05-T03 Split/mixed tender/refund và bill ledger | verified_local | Local evidence only; no external qualification recorded. |
| W05-T04 Ca, sổ két và hàng đợi in | verified_local | Local evidence only; no external qualification recorded. |
| W05-T05 Guest QR, kiosk và support/guide/bussing | verified_local | Local evidence only; no external qualification recorded. |
| W05-T06 Báo cáo ca/doanh thu và UX end-to-end | verified_local | Local evidence only; no external qualification recorded. |
| W06-T01 Capability registry, map binding và traffic admission | verified_local | Local evidence only; no external qualification recorded. |
| W06-T02 Valetudo REST/MQTT transport và completion evidence | blocked_external | Supervised hardware proof on a physical Valetudo robot (named model + firmware, venue LAN): recorded fixtures, go_to_target behaviour, measured tolerances, STOP/cancel/AP loss/reboot/map reset without false arrival, and a release cleartext/TLS decision. Protocol-emulator and AVD results are integration_tested only; the valetudo profile is not hardware_validated. |
| W06-T03 ROS executor durable journal và native action ownership | verified_local | Local evidence only; no external qualification recorded. |
| W06-T04 Nav2 action bridge, localization và nhà hàng Gazebo | verified_local | Local evidence only; no external qualification recorded. |
| W06-T05 Commission S100/ZLTECH profiles và safety boundary | blocked_external | Supplier SDK/firmware/pinout and CAN/RS485 register maps for WHEELTEC S100 and ZLTECH; physical measurements (dimensions, mass, speeds, braking/turn, rated and tested payload, stop distances) on the named robot and firmware; supervised E-stop/bumper/cliff/independent-watchdog tests; a signed commissioning manifest from a real commissioning key and a signed venue acceptance. Schemas, validator and read-only CLI are verified locally with synthetic TEST-ONLY fixtures; both profiles stay integration_tested and non-dispatchable. |
| W06-T06 Import trial read-only và gate pilot B | blocked_external | Gate B pilot is BLOCKED (docs/implementation/gates/B-pilot.md): no approved robot model/firmware, no signed commissioning or venue acceptance, no physical hardware, no real-device O01/O10/O11 runs on a supported Android pair and venue LAN, and no real map reported by a robot to bind. Trial configuration import, the trial-service preset spec (dev-lab fixture venue, not an empty-venue enrollment) and the software-checkable pilot spec are verified locally. Shadow-mode telemetry ingestion is documented only (W11); the actual cutover is W11 after the deploy result is reviewed. |
| W07-T01 Recipe, đơn vị và tiêu hao khi chế biến | verified_local | Local evidence only; no external qualification recorded. |
| W07-T02 Nhà cung cấp, mua hàng, nhận/trả và giá vốn | verified_local | Local evidence only; no external qualification recorded. |
| W07-T03 Kiểm kê, hao hụt và lịch sử điều chỉnh | verified_local | Local evidence only; no external qualification recorded. |
| W07-T04 Lịch ca, chấm công và báo cáo vận hành | verified_local | Local evidence only; no external qualification recorded. |
| W08-T01 Promotion, voucher và giới hạn dùng | verified_local | Local evidence only; no external qualification recorded. |
| W08-T02 CRM, consent và loyalty ledger | verified_local | Local evidence only; no external qualification recorded. |
| W08-T03 Booking, waitlist và chuyển cọc vào bill | verified_local | Local evidence only; no external qualification recorded. |
| W08-T04 Buffet, combo, món cân và preset acceptance | verified_local | Local evidence only; no external qualification recorded. |
| W09-T01 Menu/config rollout theo chi nhánh | verified_local | Local evidence only; no external qualification recorded. |
| W09-T02 Báo cáo chuỗi và giới hạn dùng chung | verified_local | Local evidence only; no external qualification recorded. |
| W09-T03 Connector contract, online order ingress và effect receipts | verified_local | Local evidence only; no external qualification recorded. |
| W09-T04 Node-RED bridge và developer SDK | verified_local | Local evidence only; no external qualification recorded. |
| W10-T01 Đăng ký profile và thu thập bằng chứng tích hợp | verified_local | Local evidence only; no external qualification recorded. |
| W10-T02 Payment provider, VietQR và đối soát giao dịch thật | blocked_external | No payment provider is selected: needs the chosen provider's merchant sandbox, official create/query/refund API + version, webhook signature/timestamp/event-id rules and bank/payee binding, a recorded sandbox run attached as evidence, bank-app acceptance of the VietQR codes, and merchant acceptance. Provider-agnostic intents, verified-webhook reconciliation, unapplied funds, refunds and VietQR are verified locally against our own emulator only (rig.emulated). |
| W10-T03 Hóa đơn điện tử và xuất kế toán | blocked_external | No e-invoice provider is selected: needs the chosen provider's sandbox account, certificate handling, official issue/query/adjust/cancel schemas + version and uniqueness semantics, buyer-data rules, accountant/legal confirmation of tax rules, recorded sandbox vectors and an acceptance report. Provider-agnostic issue/query-before-reissue, adjust/cancel, venue recording, tablet screen and neutral accounting CSV are verified locally against our own emulator only. |
| W10-T04 Zalo/kênh bán/POS ngoài theo profile | blocked_external | No channel is chosen: needs the Zalo app registration or marketplace/POS partner agreement, official API + version, webhook signature and permission scopes, a sandbox account and callback trace, the concrete connector registered with its profile, and an acceptance report. Venue-acknowledgement, expiry, cancellation, registry and status rules are verified locally against the sandbox emulator only; external-POS-only routing and partial fulfilment are not implemented. |
| W10-T05 VDA 5050 adapter với version rõ ràng | blocked_external | No vendor vehicle or factsheet/trace, no official pinned schema files, no LAN MQTT broker/ACL and no native MQTT transport; the 2.0.0 field list was written by hand from the public specification. Needs the vendor's exact spec version + factsheet + recorded trace, a venue-LAN broker with per-vehicle ACLs and the executor transport, and supervised runs (navigation, cancel, reconnect, reboot, map change, E-stop) before anything above integration_tested. VDA 5050 3.x is not implemented. |
| W10-T06 SDK hãng và optional Open-RMF/MassRobotics boundaries | blocked_external | No vendor SDK/licence/firmware/hardware supplied: needs the vendor's official SDK and redistribution permission, the exact SDK + firmware version, a recorded trace and a supervised run through the common conformance suite (navigation, cancel, reboot, map, epoch), and alignment of the observation export to the official MassRobotics standard version. The exact-version profile/registry, coverage matrix, reconcile-or-unknown adapter and read-only observation export are verified locally with an emulated SDK. |
| W11-T01 Security qualification và dữ liệu nhạy cảm | verified_local | Local checks only. Still required before a production claim: hosted Vercel/Supabase environment separation and RLS/Storage/Realtime checks, key-rotation drill, network dependency + licence audit, signed-artifact verification (W11-T04), Android encryption profile on a physical device, Realtime/WebSocket flood and map-upload fuzz tests, and an independent penetration test. |
| W11-T02 Hiệu năng, observability và fault load | blocked_external | Local in-process measurements only (no tablet, radio, WebSocket, battery/thermal, robot mission traffic, 24 h soak or spike). Still needed: the same load profile on physical supported tablets over the venue Wi-Fi, a 24 h soak and spike, and hosted Supabase Free measurements (database baseline, Storage, egress, Realtime messages, cached egress, MAU) read from the provider with their source and time. Free capacity here is a projection from measured local bytes per order. |
| W11-T03 Backup, migration và restore khi client cũ offline | blocked_external | Local tooling and rehearsals only. Still needed: a restore drill on the real project measuring RPO <= 5 min / RTO <= 30 min, an independent encrypted backup target with key custody, platform-level Auth restore and login after restore, a real Storage object copy/restore, and native Android export/import with device epochs. Free functional use does not depend on these; production recovery acceptance does. |
| W11-T04 Release pipeline và deployment có rollback | blocked_external | Nothing was deployed: needs a Vercel plan allowing commercial use and project, a Supabase project (Free-compatible), production secrets, a signed release APK (keystore), a protected GitHub environment with RELEASE_DEPLOY_ENABLED, and the hosted Free functional/capacity and production recovery drill evidence the production manifest requires. Staging install from clean artifacts, bad-migration stop and old-app-still-syncs have not been run on a hosted staging. |
| W11-T05 UAT, cutover một nguồn điều khiển và đóng chương trình | blocked_external | Procedures and software guards only. Not performed: customer UAT per preset, the trial-service E2E on the exact hosted build and APK digest, the supervised cutover and first live shift with a named support owner, and every upstream external gate (Gate A device qualification, Gate B robot commissioning, selected providers, hosted Supabase Free and Vercel measurements, recovery drill, signed APK). The completion inventory (scripts/verify-completion.mjs) correctly reports the program as NOT COMPLETE. |

## Feature groups F01–F30

| ID | Requirement | Status | Blocking tasks |
|---|---|---|---|
| F01 | Identity/tenant/device | not_accepted | W02-T01:verified_local, W02-T02:verified_local, W11-T01:verified_local |
| F02 | Feature policy/presets | not_accepted | W02-T03:verified_local, W06-T06:blocked_external, W08-T04:verified_local, W11-T05:blocked_external |
| F03 | Menu/modifiers/price | not_accepted | W02-T06:verified_local, W03-T01:verified_local, W05-T01:verified_local |
| F04 | Bàn/phiên/chuyển/gộp | not_accepted | W03-T02:verified_local, W05-T02:verified_local |
| F05 | POS/QR/kiosk/robot ordering | not_accepted | W03-T06:verified_local, W05-T05:verified_local |
| F06 | Order/courses/amendments | not_accepted | W03-T02:verified_local, W05-T02:verified_local |
| F07 | KDS/bếp/bar | not_accepted | W03-T03:verified_local, W05-T02:verified_local |
| F08 | Delivery/bussing/multi-stop | not_accepted | W03-T04:verified_local, W05-T05:verified_local, W06-T06:blocked_external |
| F09 | Robot interoperability | not_accepted | W06-T01:verified_local, W06-T02:blocked_external, W06-T03:verified_local, W06-T04:verified_local, W06-T05:blocked_external, W10-T05:blocked_external, W10-T06:blocked_external |
| F10 | Bill/split/merge/tax | not_accepted | W03-T05:verified_local, W05-T01:verified_local, W05-T03:verified_local |
| F11 | Payment/manual/provider | not_accepted | W03-T05:verified_local, W05-T03:verified_local, W10-T02:blocked_external |
| F12 | Refund/void/reconciliation | not_accepted | W05-T03:verified_local, W04-T02:verified_local |
| F13 | Cash shift/cashbook | not_accepted | W03-T05:verified_local, W05-T04:verified_local |
| F14 | Printing/devices | not_accepted | W05-T04:verified_local, W11-T05:blocked_external |
| F15 | Guest support/guide | not_accepted | W05-T05:verified_local, W06-T01:verified_local |
| F16 | Reservations/waitlist/deposit | not_accepted | W08-T03:verified_local |
| F17 | Promotion/voucher | not_accepted | W08-T01:verified_local |
| F18 | CRM/loyalty | not_accepted | W08-T02:verified_local, W09-T02:verified_local |
| F19 | Inventory/recipes | not_accepted | W07-T01:verified_local, W07-T03:verified_local |
| F20 | Procurement | not_accepted | W07-T02:verified_local |
| F21 | Workforce | not_accepted | W02-T01:verified_local, W07-T04:verified_local |
| F22 | Reports | not_accepted | W05-T06:verified_local, W07-T04:verified_local, W09-T02:verified_local |
| F23 | Chain | not_accepted | W09-T01:verified_local, W09-T02:verified_local |
| F24 | Online/Zalo/delivery/POS | not_accepted | W09-T03:verified_local, W10-T04:blocked_external |
| F25 | E-invoice/accounting export | not_accepted | W10-T03:blocked_external |
| F26 | Buffet/combo/weighted models | not_accepted | W08-T04:verified_local |
| F27 | Node-RED/SDK | not_accepted | W09-T04:verified_local |
| F28 | Production operations | not_accepted | W00-T01:verified_local, W02-T05:verified_local, W02-T06:verified_local, W11-T01:verified_local, W11-T02:blocked_external, W11-T03:blocked_external, W11-T04:blocked_external, W11-T05:blocked_external |
| F29 | Offline/sync/partitions | not_accepted | W01-T01:verified_local, W01-T03:verified_local, W01-T05:blocked_external, W02-T04:verified_local, W02-T05:verified_local, W02-T06:verified_local, W04-T01:verified_local, W04-T02:verified_local, W04-T05:verified_local, W04-T06:blocked_external, W11-T02:blocked_external |
| F30 | Maintenance/import | not_accepted | W04-T03:verified_local, W04-T04:verified_local, W04-T06:blocked_external, W11-T03:blocked_external |

## Offline / maintenance cases O01–O22

| ID | Requirement | Status | Blocking tasks |
|---|---|---|---|
| O01 |  | not_accepted | W03-T06:verified_local, W04-T06:blocked_external, W06-T06:blocked_external |
| O02 |  | not_accepted | W00-T04:verified_local, W01-T01:verified_local, W03-T06:verified_local |
| O03 |  | not_accepted | W02-T04:verified_local |
| O04 |  | not_accepted | W04-T01:verified_local, W04-T06:blocked_external |
| O05 |  | not_accepted | W04-T01:verified_local |
| O06 |  | not_accepted | W04-T02:verified_local |
| O07 |  | not_accepted | W00-T05:verified_local, W01-T01:verified_local |
| O08 |  | not_accepted | W01-T01:verified_local, W01-T05:blocked_external, W04-T03:verified_local |
| O09 |  | not_accepted | W02-T04:verified_local |
| O10 |  | not_accepted | W04-T05:verified_local, W06-T03:verified_local |
| O11 |  | not_accepted | W04-T05:verified_local, W06-T02:blocked_external, W06-T03:verified_local |
| O12 |  | not_accepted | W02-T03:verified_local, W09-T01:verified_local |
| O13 |  | not_accepted | W04-T06:blocked_external, W11-T02:blocked_external |
| O14 |  | not_accepted | W04-T04:verified_local |
| O15 |  | not_accepted | W04-T04:verified_local |
| O16 |  | not_accepted | W04-T04:verified_local |
| O17 |  | not_accepted | W02-T05:verified_local, W04-T04:verified_local |
| O18 |  | not_accepted | W04-T04:verified_local |
| O19 |  | not_accepted | W02-T04:verified_local, W11-T03:blocked_external |
| O20 |  | not_accepted | W04-T05:verified_local, W06-T03:verified_local |
| O21 |  | not_accepted | W01-T03:verified_local, W01-T05:blocked_external |
| O22 |  | not_accepted | W04-T03:verified_local, W04-T05:verified_local, W11-T03:blocked_external |

## Stack requirements S01–S07

| ID | Requirement | Status | Blocking tasks |
|---|---|---|---|
| S01 | Next.js web/API on Vercel; Supabase CLI local development | not_accepted | W00-T01:verified_local, W11-T04:blocked_external |
| S02 | Supabase PostgreSQL/Auth, transaction pool and RLS | not_accepted | W00-T04:verified_local, W02-T01:verified_local, W11-T01:verified_local |
| S03 | Supabase Realtime hints, durable pull and bounded jobs | not_accepted | W02-T04:verified_local, W02-T05:verified_local |
| S04 | Supabase Storage and mandatory Free functional/capacity profile | not_accepted | W02-T06:verified_local, W11-T02:blocked_external, W11-T04:blocked_external |
| S05 | HTML tablet bundle with native LAN/SQLite offline continuity | not_accepted | W01-T04:verified_local, W03-T06:verified_local, W04-T06:blocked_external |
| S06 | Free backup and independent measured production recovery gate | not_accepted | W11-T03:blocked_external, W11-T04:blocked_external |
| S07 | Trial-service and full product on same Next.js/APK release | not_accepted | W02-T03:verified_local, W06-T06:blocked_external, W11-T05:blocked_external |

## Reading this honestly

- Nothing is `accepted` yet because acceptance needs evidence this repository cannot produce alone: physical tablets and a venue network (Gate A), a supervised robot and signed commissioning (Gate B), real providers, hosted Supabase/Vercel measurements and a recovery drill (Gate D/production).
- `trial-service` parity is implemented and tested locally on the same build as the full product; the first live shift and customer UAT are procedures in `docs/operations/{cutover,first-shift,post-release}.md`, not results.
- Index reviewRepair status: implemented_scoped_verified_full_regression_blocked.
