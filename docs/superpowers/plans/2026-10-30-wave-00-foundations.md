# Wave 00 — workspace, contracts và giao dịch nền Implementation Plan

> Execution 2026-10-30: phần mềm đã hiện thực trên `feat/w00-w04-production-foundation`. Trạng thái từng task và giới hạn kiểm chứng nằm trong [task index](2026-10-30-plan-index.json) và [verification](../../implementation/verification.md). Gate A chưa được chấp nhận; checklist thiết kế gốc bên dưới không thay thế bằng chứng chạy thử.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo workspace build được cùng hợp đồng dữ liệu và transaction kernel dùng chung cho cloud/tablet.

**Architecture:** Tách domain thuần khỏi transport và database. Schema là nguồn hợp đồng; database giữ idempotency, sequence, journal, audit và outbox trong một transaction.

**Tech Stack:** Node.js 24, pnpm, TypeScript, Next.js Route Handlers/Vercel, Supabase PostgreSQL 17, SQLite, Vitest, JSON Schema.

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

**Entry:** Thiết kế đã duyệt; repository mới chỉ có tài liệu. Không cần tài khoản cloud hoặc robot.

**Exit:** Build/typecheck/lint đạt; contract fixtures cùng kết quả ở TS/Python; transaction tests chạy bằng SQLite và PostgreSQL thật.

**Đầu ra chạy được:** API dev có /health/live và /health/ready; công cụ test lưu một command rồi reopen database mà không tạo trùng.

### W00-T01: Workspace và API lifecycle chạy được

**Depends on:** Thiết kế đã duyệt

**Files:**

- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.mjs`, `.gitignore`, `.env.example`.
- Create: `pnpm-lock.yaml` bằng package manager sau khi chọn dependency versions tương thích Node.js 24; không sửa lockfile thủ công.
- Create: `apps/cloud-web/{package.json,next.config.ts,tsconfig.json,.env.local.example}`, `.github/workflows/ci.yml`.
- Create: `apps/cloud-web/src/app/{layout,page}.tsx`, `apps/cloud-web/src/app/health/{live,ready}/route.ts`, `apps/cloud-web/src/server/health.ts`.
- Create: `apps/cloud-web/src/app/v1/[...path]/route.ts`, `apps/cloud-web/src/server/{route-registry,request-context}.ts`, `tests/support/cloud-server.ts`.
- Create: `supabase/config.toml`, `supabase/seed.sql`, `scripts/{doctor,supabase-local}.mjs`, `vitest.config.ts`.
- Create: `scripts/test-runner.mjs`, `tsconfig.json`, `tests/fixtures/identity.json`.
- Test: `tests/integration/cloud-health.test.ts`.

**Interfaces:**

- Consumes: Node.js 24, Supabase CLI local (DB/Auth/Realtime/Storage/mail sink); scripts trong plan tổng §5.
- Produces: Test helper `startCloud({ databaseUrl, port:0 }): Promise<{url:string;close():Promise<void>}>` khởi chạy Next.js thật; HTTP GET `/health/live`, `/health/ready`; allowlisted `/v1/*` route registry.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { startCloud } from "../support/cloud-server";
test("database outage is not advertised as ready", async () => {
  const api = await startCloud({ databaseUrl: "postgres://invalid@127.0.0.1:1/test", port: 0 });
  try {
    expect((await fetch(api.url + "/health/live")).status).toBe(200);
    expect((await fetch(api.url + "/health/ready")).status).toBe(503);
  } finally { await api.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/cloud-health.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Tạo scripts/Next.js App Router và Supabase local trước; pin dependency/CLI/DB major tương thích, cloud SQL chuẩn PostgreSQL 17. Route Handlers dùng Node runtime, không cache health/auth/sync. Readiness DB probe có timeout; liveness không chờ DB. `startCloud` là helper chạy child process Next và đóng process/pool test, không custom HTTP listener trong Vercel Function.

```ts
export function readiness(databaseReachable: boolean) {
  return { status: databaseReachable ? 200 : 503,
    body: { ready: databaseReachable } };
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Route registry khai báo method/path/schema/body limit/permission/handler, mặc định deny cho nghiệp vụ chưa có auth; mỗi task đăng ký module thật, không catch-all success. Supabase CLI chạy không login/link hosted, cổng riêng không trùng trial; chỉ local DB được phép reset qua script test. Doctor kiểm Node, Docker/CLI, DB major, Python, Android SDK/JDK theo wave. `.env.local.example` tách public Supabase URL/publishable key với DB/admin/job secrets, không dùng `NEXT_PUBLIC_*` cho secret.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/cloud-health.test.ts`; kỳ vọng PASS. Next.js build/start thật với DB healthy rồi down: live 200, ready 503, không cache kết quả cũ; SIGTERM helper đóng child process. `pnpm dev:cloud` và `pnpm supabase:start` chạy không có tài khoản cloud; service Auth/Realtime/Storage local có health. Chạy `pnpm build`, `pnpm typecheck` và `pnpm lint`; chưa lấy local success làm bằng chứng deploy Vercel.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W00-T01.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "build: establish typed workspace and cloud lifecycle"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W00-T02: Schema wire và canonical signing bytes

**Depends on:** W00-T01

**Files:**

- Create: `packages/contracts/schemas/{command,journal,sync-ack,money,robot-command}.schema.json`.
- Create: `packages/contracts/src/{validate,canonical,index}.ts`, `packages/contracts/generated/`, `scripts/generate-contracts.mjs`.
- Create: `tests/fixtures/contracts/canonical.json`, `tests/contracts/test_schema_python.py`.
- Create: `requirements-dev.txt` với phiên bản chính xác của pytest, JSON Schema validator và thư viện canonicalization Python đã kiểm golden vectors.
- Test: `tests/contracts/wire.test.ts`.

**Interfaces:**

- Consumes: Wire fields và primitive types ở plan tổng §3.
- Produces: `validateEnvelope(value:unknown):CommandEnvelope`; `canonicalBytes(value:JsonValue):Uint8Array`; `hashPayload(value:JsonValue):string` SHA-256 hex; schema version `1`.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { canonicalBytes } from "../../packages/contracts/src/canonical";
test("field order does not change signed bytes", () => {
  expect(canonicalBytes({ b: "2", a: "1" })).toEqual(
    canonicalBytes({ a: "1", b: "2" }));
  expect(() => canonicalBytes({ amount: Number.NaN })).toThrow();
});
```

- [ ] **2. Chạy RED.** `pnpm test:contracts -- tests/contracts/wire.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Dùng canonicalization theo RFC 8785, từ chối non-JSON/NaN/Infinity, duplicate JSON keys ở parser ingress; chữ ký không nằm trong payload được hash. Money và sequence dùng decimal string để không mất precision JS.

```json
{
  "$id": "mekoniq.money.v1",
  "type": "object", "additionalProperties": false,
  "required": ["currency", "minor"],
  "properties": {
    "currency": { "type": "string", "pattern": "^[A-Z]{3}$" },
    "minor": { "type": "string", "pattern": "^-?(0|[1-9][0-9]*)$" }
  }
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Tạo typed TS từ schema, Python validator dùng cùng JSON fixture. Tạo venv riêng, install từ `requirements-dev.txt`, ghi Python version trong evidence và chạy `python3 -m pytest tests/contracts/test_schema_python.py -q`; không cài vào Python hệ thống. Envelope giới hạn 256 KiB, sync batch 100 entry/1 MiB; schema xác định ID, actorRef, kind, epoch, timestamps và scope bắt buộc. Key/signature ES256 được nối ở W01/W02; không tự viết thuật toán crypto.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:contracts -- tests/contracts/wire.test.ts`; kỳ vọng PASS. Test unknown field, invalid version, integer vượt JS-safe khi là number, scope thiếu, payload khác hash. `pnpm contracts:check` phải phát hiện generated drift; Python cùng fixture byte-for-byte. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W00-T02.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: define versioned cross-runtime wire contracts"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W00-T03: Money, quantity và kết quả domain thuần

**Depends on:** W00-T02

**Files:**

- Create: `packages/domain/src/shared/{money,quantity,decision,clock}.ts`, `packages/domain/package.json`.
- Test: `tests/unit/money.test.ts`.

**Interfaces:**

- Consumes: `Money {currency:string;minor:string}`, `JsonValue` từ contracts.
- Produces: `sumMoney(values:Money[]):Money`; `allocateMinor(total:string,weights:bigint[]):string[]`; `Decision` và `DomainEvent` ở plan tổng.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { allocateMinor } from "../../packages/domain/src/shared/money";
test("splitting preserves every minor unit", () => {
  const parts = allocateMinor("100001", [1n, 1n, 1n]);
  expect(parts.map(BigInt).reduce((a,b) => a+b, 0n)).toBe(100001n);
  expect(parts).toEqual(["33334", "33334", "33333"]);
});
```

- [ ] **2. Chạy RED.** `pnpm test:unit -- tests/unit/money.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Tính bằng BigInt; phân bổ floor trước, remainder theo phần dư lớn nhất rồi index ổn định. Không chia tiền âm trong API allocation; adjustment có sign riêng. Quantity là scaled integer/string và đơn vị, không binary float.

```ts
const sum = weights.reduce((a, b) => a + b, 0n);
if (sum <= 0n || weights.some(w => w < 0n) || BigInt(total) < 0n)
  throw new Error("INVALID_ALLOCATION");
const base = weights.map(w => BigInt(total) * w / sum);
let rest = BigInt(total) - base.reduce((a,b) => a+b, 0n);
const rank = weights.map((w,i) => ({i, r: BigInt(total)*w % sum}))
  .sort((a,b) => a.r === b.r ? a.i-b.i : a.r > b.r ? -1 : 1);
for (const {i} of rank) if (rest > 0n) { base[i] += 1n; rest -= 1n; }
return base.map(String);
```

- [ ] **4. Nối vào runtime và lưu trữ.** Mọi public amount serialize string; PostgreSQL NUMERIC(30,0), SQLite canonical text. Runtime reject quá 30 digits và currency khác trong cùng phép cộng. Clock truyền vào domain, không gọi Date.now trong reducer.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:unit -- tests/unit/money.test.ts`; kỳ vọng PASS. Property test sum conservation, zero weights, negative inputs, huge minor units và rounding boundary. Build domain cho browser target để bắt Node imports. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W00-T03.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: add exact money and deterministic domain primitives"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W00-T04: Transaction kernel và durable idempotency

**Depends on:** W00-T02, W00-T03

**Files:**

- Create: `packages/sync/src/{store,command-processor,commit-batch}.ts`, `packages/sync/src/storage/{sqlite,postgres}.ts`.
- Create: `packages/sync/migrations/sqlite/001_journal.sql`, `supabase/migrations/20261030000100_journal.sql`.
- Create: `tests/support/storage-cases.ts` (database lifecycle và command/batch fixtures cho SQLite/PostgreSQL).
- Create: `packages/domain/src/modules.ts` chứa module registry; handler test-only đăng ký qua dependency injection, không đi vào bundle production.
- Test: `tests/integration/atomic-command.test.ts`.

**Interfaces:**

- Consumes: `AtomicStore`, `CommitBatch`, `Decision`, `CommandResult` từ plan tổng §3; generated schemas.
- Produces: `openStore({driver,url}):Promise<AtomicStore>`; `processCommand(store,command,decide):Promise<CommandResult>`; version CAS và idempotency transaction.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { storageCases } from "../support/storage-cases";
for (const storage of storageCases) test(storage.name + " deduplicates after reopen", async () => {
  const first = await storage.open();
  const command = storage.command("op-1", { note: "A" });
  await first.commit(storage.batch(command));
  await first.close();
  const reopened = await storage.open();
  try {
    expect((await reopened.commit(storage.batch(command))).duplicate).toBe(true);
    expect(await reopened.journalCount()).toBe(1);
    await expect(reopened.commit(storage.batch(storage.command("op-1", {note:"B"}))))
      .rejects.toThrow("IDEMPOTENCY_CONFLICT");
  } finally { await reopened.close(); await storage.destroy(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/atomic-command.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Unique scope+operation ID/hash, producer epoch+sequence, aggregate CAS. Commit result, projection, audit, journal và outbox cùng transaction. Same hash trả result cũ; khác hash không sửa bản cũ. SQLite BEGIN IMMEDIATE/WAL/FULL; Postgres dùng transaction, row locks/unique constraints.

```sql
CREATE TABLE operation_receipt (
  organization_id TEXT NOT NULL, venue_id TEXT NOT NULL,
  operation_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY (organization_id, venue_id, operation_id)
);
-- Cùng transaction với projection, journal, audit và outbox.
CREATE UNIQUE INDEX journal_producer_sequence
  ON journal(device_id, device_epoch, producer_sequence);
```

- [ ] **4. Nối vào runtime và lưu trữ.** JS domain đọc snapshot và xây typed batch; native commit kiểm versions/owner/policy, không nhận SQL tùy ý. Cloud dùng `supabase/migrations` là nguồn SQL duy nhất; application role không BYPASSRLS, transaction pool Supavisor với pool nhỏ (baseline 1/instance), prepared statements tắt nếu driver yêu cầu. Scope dùng `SET LOCAL` trong transaction; không giữ session state qua request. `storageCases` dùng file SQLite và Supabase PostgreSQL thật riêng test; kiểm isolation qua chính role ứng dụng, không qua postgres/service-role.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/atomic-command.test.ts`; kỳ vọng PASS. Crash trước commit rollback; sau commit trước ACK dedup; 20 request cùng operationId chỉ một mutation; full disk không ACK; foreign keys ON. Không chỉ chạy in-memory store. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W00-T04.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: persist command journal atomically with receipts"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W00-T05: Test lab dùng runtime thật và fault injection

**Depends on:** W00-T01..W00-T04

**Files:**

- Create: `tests/support/{lab,faults,clock,actors}.ts`.
- Modify: `tests/support/storage-cases.ts` để nối crash hooks; giữ API fixture đã tạo ở W00-T04.
- Create: `tests/support/child-store.mjs`, `tests/fixtures/contracts/command-v1.json`.
- Create: `docs/implementation/test-lab.md`.
- Test: `tests/integration/crash-window.test.ts`.

**Interfaces:**

- Consumes: AtomicStore và CommandRouter.register/dispatch signatures trong plan tổng.
- Produces: `createLab()` và các method chuẩn ở plan tổng §4; `storageCases` fixtures; command registry cắm module thật, không trả success giả.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createLab } from "../support/lab";
test("kill after commit does not duplicate a business event", async () => {
  const lab = await createLab();
  try {
    await lab.fault("kill-after-local-commit");
    await lab.command("cashier", "Journal.RecordNote", {text:"persist"}, "op-1");
    await lab.restart("coordinator");
    await lab.command("cashier", "Journal.RecordNote", {text:"persist"}, "op-1");
    expect(await lab.count("NoteRecorded")).toBe(1);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/crash-window.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Lab khởi database/process thật; fault hooks xác định trước/sau COMMIT/ACK. `Journal.RecordNote` là test-only handler, không register ở production. Kill-after-commit trả transport unknown cho client nhưng không xóa store.

```ts
export type FaultPoint =
  | "before-local-commit" | "kill-after-local-commit"
  | "drop-local-ack" | "drop-cloud-ack" | "storage-full";
export class FaultSwitch {
  private armed = new Set<FaultPoint>();
  arm(point: FaultPoint) { this.armed.add(point); }
  consume(point: FaultPoint) {
    const active = this.armed.has(point);
    this.armed.delete(point);
    return active;
  }
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Lab command gọi cùng router/processor dùng production; partition chỉ đổi transport/reachability. Các fixture seed bypass auth chỉ trong test setup; runtime test luôn đi qua guard. Tạo hooks cho real Android test runner và robot adapter runners, không giả chúng bằng Node mocks.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/crash-window.test.ts`; kỳ vọng PASS. Kiểm lab không dùng network/cổng trial; cleanup process do lab tạo. CI lưu JUnit, logs và seed khi fault test fail. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W00-T05.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "test: establish durable multi-device fault lab"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

## Wave acceptance

- [ ] Lockfile, image digest và runtime versions được ghi lại; .env.example không chứa secret; CI chỉ dùng service test riêng.
- [ ] Test atomic commit, duplicate cùng hash, duplicate khác hash, sequence restart và storage failure đạt.
- [ ] Không có Node/DOM import trong packages/domain; contracts generated được kiểm tra drift.
