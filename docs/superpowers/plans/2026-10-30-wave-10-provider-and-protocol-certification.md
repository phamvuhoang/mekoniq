# Wave 10 — nhà cung cấp thật và chuẩn robot mở rộng Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Biến connector/adapter contracts thành các tích hợp thật được kiểm chứng theo profile.

**Architecture:** Mỗi provider/firmware/version là một profile độc lập với test vectors và capability evidence. Tích hợp không đủ input ở trạng thái disabled/blocked_external, không giả success.

**Tech Stack:** Connector SDK, verified webhooks, provider sandbox, VDA 5050 schema, vendor SDK adapters.

**Spec:** [Production](../specs/2026-10-30-production-platform-design.md), [Continuity](../specs/2026-10-30-offline-continuity-design.md), [F01–F30](../../product/2026-10-30-capability-matrix.md).

## Global Constraints

- “Xây lại mã trong `source`; `trial` là nguồn tham khảo hành vi, không phải nhánh để sửa.”
- “Cloud là nền tảng trung tâm. Không lắp máy chủ riêng tại nhà hàng.”
- “Bản đầu dùng **coordinator cố định, không tự bầu leader khi timeout**.”
- “Tiền lưu số nguyên theo đơn vị tiền nhỏ nhất; VND là đồng. Không cộng tiền bằng float.”
- “Không tự phát lệnh di chuyển/thu tiền/in/xuất hóa đơn khi replay lịch sử.”
- “Cloud ACK là đã commit ở cloud; ACK LAN là coordinator đã commit.”
- Node.js 24 LTS; Supabase PostgreSQL 17; TypeScript strict; SQLite native trên Android; robot baseline ROS 2 Jazzy / Ubuntu 24.04 / Gazebo Harmonic.
- Next.js web/API trên Vercel; Supabase Auth/Realtime/Storage và profile Free bắt buộc; tablet HTML bundle + native Android. Tuân theo [stack và giới hạn Free](../specs/2026-10-30-vercel-supabase-free-stack.md); không thêm dịch vụ trả phí bắt buộc để khởi chạy.
- Đọc [plan tổng và hợp đồng dùng chung](2026-10-30-production-implementation-plan.md) trước task; mọi đường dẫn/command tính từ `source/`.
- Đây là kế hoạch, chưa có application files hoặc scripts bên dưới. Tạo chúng tại task sở hữu; không chạy lệnh triển khai/robot thật chỉ để kiểm tra tài liệu.
- Không đánh dấu PASS khi thiếu thiết bị/provider; ghi `blocked_external` cho đúng acceptance gate, tiếp tục task không phụ thuộc.

---

## Entry / exit

**Entry:** W09 core connector và W06 adapter harness đạt. Input gồm provider được chọn, merchant sandbox/credential, API version, robot firmware/schema trace.

**Exit:** Mỗi profile muốn quảng bá có sandbox/hardware evidence; e-invoice/payment/online channels không còn mock tại release profile.

**Đầu ra chạy được:** Nhận payment callback thật của sandbox, reconcile timeout; xuất/query invoice; đưa một mission chuẩn hóa tới VDA/vendor rig.

### W10-T01: Đăng ký profile và thu thập bằng chứng tích hợp

**Depends on:** W09-T03, W06-T01

**Files:**

- Create: `integrations/profiles/profile.schema.json`, `integrations/profiles/catalog.json`, `tests/support/provider-rig.ts`.
- Create: `docs/integrations/profile-onboarding.md`.
- Create: `integrations/core/src/profile.ts`.
- Test: `tests/contracts/provider-profile.test.ts`.

**Interfaces:**

- Consumes: Tên provider được người dùng lựa chọn, official docs URL/version, sandbox merchant/credentials, callback rules.
- Produces: `IntegrationProfile` discriminated schema, `loadEnabledProfiles`; named profile adapters chỉ activate sau evidence.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { profileEligible } from "../../integrations/core/src/profile";
test("a placeholder sandbox connector is not production eligible", () => {
  expect(profileEligible({mode:"simulation",schemaValidated:true,
    sandboxEvidence:null,productionEvidence:null})).toBe(false);
});
```

- [ ] **2. Chạy RED.** `pnpm test:contracts -- tests/contracts/provider-profile.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Task input gate thực tế: người triển khai lấy tài liệu chính thức của provider được chọn, ghi request/result/status/error/signature/idempotency/query mapping vào profile. Không đoán API, endpoint hoặc merchant; chưa có input thì không bật profile.

```ts
export function profileEligible(p:{mode:string;schemaValidated:boolean;
  sandboxEvidence:string|null;productionEvidence:string|null}) {
  return p.mode==="production" && p.schemaValidated &&
    p.sandboxEvidence!==null && p.productionEvidence!==null;
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Catalog JSON trạng thái draft/contract_tested/sandbox_verified/production_approved với adapter entrypoint. Env refs cho credentials; fixtures redacted có provenance/hash. ProviderRig replays authentic recorded vectors và counts live requests.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:contracts -- tests/contracts/provider-profile.test.ts`; kỳ vọng PASS. Missing docs/version/signature schema reject; fake profile cannot release. Thiết kế supports multiple providers nhưng mỗi provider cần thực hiện T02/T03/T04 cho chính profile đó. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W10-T01.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: register verifiable external integration profiles"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W10-T02: Payment provider, VietQR và đối soát giao dịch thật

**Depends on:** W10-T01, W05-T03

**Files:**

- Create: `integrations/payments/src/{provider-adapter,verified-webhook,reconciliation,vietqr}.ts`.
- Create: `tests/providers/payment-provider.test.ts`, `docs/integrations/payment-acceptance.md`.
- Test: `tests/providers/payment-provider.test.ts`.

**Interfaces:**

- Consumes: Selected payment profile mapping; Connector port; amount/currency/merchant binding.
- Produces: `PaymentProvider.createIntent/query/refund/verifyWebhook`; external fact forwarded owner bill; VietQR display does not imply paid.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createProviderRig } from "../support/provider-rig";
test("provider callback for a different amount cannot settle the bill", async () => {
  const rig = await createProviderRig("payment");
  try {
    await rig.deliverFixture("signed-amount-mismatch");
    expect(await rig.settledCount()).toBe(0);
    expect(await rig.unappliedFundsCount()).toBe(1);
  } finally { await rig.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:providers -- tests/providers/payment-provider.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Verify raw signature/timestamp/event uniqueness then query authoritative provider state theo mapped API. Match merchant/payee/currency/order ref. Late transfer over cash => overpayment/unapplied, never delete real payment.

```ts
export function matchesPayment(expected:{merchant:string;currency:string;amount:string},
  actual:{merchant:string;currency:string;amount:string}) {
  return expected.merchant===actual.merchant && expected.currency===actual.currency &&
    expected.amount===actual.amount;
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** ProviderAdapter methods implemented from selected profile docs; fixture invalid amount is correctly signed provider sandbox event or redacted authenticity replay. Sandbox mode cannot mark real bills captured. QR offline transfer remains claim/manual verified until evidence.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:providers -- tests/providers/payment-provider.test.ts`; kỳ vọng PASS. Webhook before response, double callback, refund timeout, provider 429, wrong signature/payee, offline cashier conflict and query-after-unknown. Capture/refund sandbox evidence; real production activation requires merchant acceptance. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W10-T02.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: reconcile verified payment provider transactions"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W10-T03: Hóa đơn điện tử và xuất kế toán

**Depends on:** W10-T01, W05-T03, W04-T04

**Files:**

- Create: `integrations/einvoice/src/{provider-adapter,issue-query,amendment}.ts`, `integrations/accounting/src/export.ts`.
- Create: `apps/tablet-web/src/screens/Invoices.ts`, `docs/integrations/einvoice-acceptance.md`.
- Test: `tests/providers/einvoice-provider.test.ts`.

**Interfaces:**

- Consumes: Chosen invoice provider issue/query/reference schemas, bill/tax snapshot; local legal configuration confirmed externally.
- Produces: `InvoiceProvider.issue/query/amend/cancel` theo provider support; export mapped accounting lines; explicit unverified/not-issued.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createProviderRig } from "../support/provider-rig";
test("issue timeout is queried before any second issue request", async () => {
  const rig = await createProviderRig("einvoice");
  try {
    await rig.fault("issue-response-lost");
    await rig.issue("bill-1");
    await rig.reconcile("bill-1");
    expect(await rig.callCount("issue")).toBe(1);
    expect(await rig.callCount("query")).toBeGreaterThan(0);
  } finally { await rig.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:providers -- tests/providers/einvoice-provider.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Durable request identity follows provider uniqueness/reference. Mark issued only provider returns code/status verified; historical externally-issued record link not issue. Adjustment/cancel use provider status machine not delete.

```ts
export function nextInvoiceAction(status:string) {
  return status==="unknown" ? "query" : status==="draft" ? "issue" : "none";
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Invoice UI provider failure/resolution, customer tax data validation per provider, accounting export schema mapped version and escaped CSV. No claim accounting general ledger/payroll implemented. Secret/certificate from managed store.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:providers -- tests/providers/einvoice-provider.test.ts`; kỳ vọng PASS. Lost response, duplicate issue key, amended existing invoice, historical import externally issued, refund requires proper amendment link, valid tax totals fixtures. Provider/legal acceptance external gate recorded. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W10-T03.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: integrate auditable invoice issuance and accounting export"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W10-T04: Zalo/kênh bán/POS ngoài theo profile

**Depends on:** W10-T01, W09-T03, W09-T04

**Files:**

- Create: `integrations/channels/src/{zalo,delivery,pos-external}.ts`, `apps/cloud-web/src/components/guest/MiniAppBridge.tsx`.
- Create: `tests/providers/channel-provider.test.ts`, `docs/integrations/channel-acceptance.md`.
- Test: `tests/providers/channel-provider.test.ts`.

**Interfaces:**

- Consumes: App registration/sandbox and documented profile scopes; external order/fulfillment IDs.
- Produces: Concrete ChannelConnector adapters for configured Zalo/partner/POS; unsupported channel remains unregistered.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createProviderRig } from "../support/provider-rig";
test("remote platform cannot report restaurant acceptance without venue ACK", async () => {
  const rig = await createProviderRig("channel");
  try {
    await rig.partitionVenue();
    await rig.deliverFixture("new-order");
    expect(await rig.callCount("confirmRestaurantAccepted")).toBe(0);
  } finally { await rig.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:providers -- tests/providers/channel-provider.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Use provider authentication/permission/approval flows and documented status transitions. Normalize modifiers, notes, source totals for comparison, no blind pricing overwrite. Separate external cancellation/restaurant reject/fulfillment update.

```ts
export function channelStatus(venueAck:boolean, expired:boolean) {
  return expired ? "rejected" : venueAck ? "accepted" : "awaiting_restaurant";
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Zalo Mini App bundle/SDK build only when real app registration supplied; APIs under scoped connector credentials. External POS-only venue routes fulfillment without forcing internal billing. Duplicate external records tied to journal source.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:providers -- tests/providers/channel-provider.test.ts`; kỳ vọng PASS. Partner replay/signed invalid event, cancellation after load, venue offline expiry, SDK permissions and actual sandbox callback. Execute per chosen provider; missing account not fake-green. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W10-T04.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: connect verified restaurant sales channels"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W10-T05: VDA 5050 adapter với version rõ ràng

**Depends on:** W06-T01, W06-T03

**Files:**

- Create: `packages/robot-adapters/src/vda5050/{adapter,orders,state,instant-actions,connection}.ts`.
- Create: `tests/fixtures/vda5050/`, `docs/integrations/vda5050-support.md`.
- Create: `tests/support/vda-rig.ts`.
- Test: `tests/adapters/vda5050-conformance.test.ts`.

**Interfaces:**

- Consumes: Official pinned VDA 5050 version/schema và robot factsheet/trace; RobotAdapter contract.
- Produces: `Vda5050Adapter`; support manifest exact version/action subset; broker/ACL/offline capability.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createVdaRig } from "../support/vda-rig";
test("state for an older order update cannot complete the current mission", async () => {
  const rig = await createVdaRig({version:"3.0.0"});
  try {
    await rig.startOrder({orderId:"o-1",orderUpdateId:2});
    await rig.state({orderId:"o-1",orderUpdateId:1,lastNodeId:"table-1"});
    expect(rig.completedEvents()).toHaveLength(0);
  } finally { await rig.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:adapters -- tests/adapters/vda5050-conformance.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Map order/node/edge/action/state references theo official schema chosen in profile; VDA3 default research baseline, legacy requires separate profile/conformance. No claim full standard merely from valid JSON.

```ts
export function currentOrderState(expected:{id:string;update:number},
  state:{orderId:string;orderUpdateId:number}) {
  return expected.id===state.orderId && expected.update===state.orderUpdateId;
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Commands no retained, connection/factsheet diagnostics, action failure/cancel and error resolution per version. Offline only with reachable LAN broker on existing device/vendor controller; cloud-only broker profile offline=false.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:adapters -- tests/adapters/vda5050-conformance.test.ts`; kỳ vọng PASS. Schema validation official vectors, order updates, instant action cancel, duplicate/out-of-order state, broker reconnect/retained old state, namespace/manufacturer/serial isolation. Vendor emulator and real robot acceptance separate. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W10-T05.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: adapt validated vda5050 profiles to restaurant missions"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W10-T06: SDK hãng và optional Open-RMF/MassRobotics boundaries

**Depends on:** W06-T01, W10-T01

**Files:**

- Create: `packages/robot-adapters/src/vendor/{sdk-adapter,profile}.ts`.
- Create: `integrations/robot-observation/src/massrobotics.ts`, `docs/integrations/rmf-boundary.md`.
- Test: `tests/adapters/vendor-profile.test.ts`.

**Interfaces:**

- Consumes: Vendor official SDK/licensing/API docs and hardware; common RobotAdapter tests.
- Produces: `VendorSdkAdapter` per configured SDK; observation exporter; documented optional RMF ownership mapping, not implicit new control path.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { massRoboticsObservationCapabilities } from "../../integrations/robot-observation/src/massrobotics";
test("observation-only interoperability never advertises motion capability", () => {
  const capabilities = massRoboticsObservationCapabilities();
  expect(capabilities.commandMotion).toBe(false);
  expect(capabilities.observePose).toBe(true);
});
```

- [ ] **2. Chạy RED.** `pnpm test:adapters -- tests/adapters/vendor-profile.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** SDK-specific adapter translates only supported operations; native command identity and reconcile strategy documented. If SDK cannot query ambiguous execution, return unknown/needs_attention. MassRobotics telemetry is read-only; RMF full integration requires separate approved use case, not required dependency.

```ts
export function massRoboticsObservationCapabilities() {
  return {commandMotion:false, observePose:true};
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Selected SDK adapter must run same conformance suite navigation/cancel/reboot/map/epoch; register by exact version. Keep coverage matrix supported/unsupported/untested explicit; no generic advertised compatibility.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:adapters -- tests/adapters/vendor-profile.test.ts`; kỳ vọng PASS. Recorded trace replay then supervised actual firmware run; vendor permission/licensing review before redistributing SDK. Optional RMF doc proves sole dispatcher ownership so future integration cannot bypass it. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W10-T06.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: qualify vendor adapters and read-only robot interoperability"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

## Wave acceptance

- [ ] Không đưa secrets vào repo; chỉ env reference/merchant ID và hash tài liệu.
- [ ] Conformance protocol, sandbox và production/hardware acceptance là các trạng thái riêng.
- [ ] Nếu chưa có nhà cung cấp/robot được chọn, ghi task blocked_external; phần generic đã xong không được gắn nhãn tích hợp xong.
