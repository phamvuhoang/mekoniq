# 01 — Components & Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Có engineering project hợp lệ, catalog có nguồn, resolver và API compile có kiểm quyền.

**Architecture:** Thêm schema độc lập bọc LabProjectV2; source resolve assembly và catalog content-addressed. Runtime v2 chỉ nhận engineering extension sau capability negotiation.

**Tech Stack:** Node 24.22.2, pnpm 10.32.1, TypeScript/Vitest, Python/pytest, Ubuntu 24.04, ROS Jazzy, Gazebo Harmonic, Nav2, MoveIt 2, ros2_control, Three.js/Playwright.

**Spec:** [Spec chính](../../specs/2026-11-06-physical-robot-lab/README.md), [chi tiết](../../specs/2026-11-06-physical-robot-lab/components-and-assembly.md).

## Global Constraints

- Node 24.22.2; pnpm 10.32.1; dependencies khóa theo lockfile, không nâng major để hoàn thành task.
- Business authority/contracts/adapters ở `source/`; presentation/project UX ở `lab/`.
- Không sửa `trial/`, không chạm robot hoặc cổng `1880`/`1884`; UI/runtime loopback `4175`/`4176`.
- Mỗi run khóa mode, seed, backend versions, model/world/recipe/profile revisions và clock domains.
- UI Việt/Nhật/Anh; mọi nhãn kết quả phải nêu provenance và không nâng simulation thành hardware evidence.
- Native test thiếu môi trường ghi `not_run` với blocker; test đã chạy sai assertion ghi `fail`.
- Không export dirty source; không ghi secrets, VM disk, SSH private key hoặc signing key vào Git.
- Không xóa dữ liệu host để provision VM; storage và RAM preflight phải đạt trước khi tải image lớn.
- Engineering profile không tự fallback sang mock, legacy hoặc hardware khi thiếu capability.
- Giữ toàn bộ chức năng và dữ liệu hiện hữu theo NR01–NR12; giới hạn MVP engineering không áp dụng cho các profile cũ.

---

## File map

| Trạng thái | Paths | Trách nhiệm |
|---|---|---|
| new | `source/packages/contracts/schemas/engineering-{project,component,bundle,project-archive,candidate}.schema.json`; `generated/engineering.ts` trong cùng package | Project/compile/ref/archive/candidate contracts canonical |
| modify | `source/scripts/generate-contracts.mjs`, `source/scripts/export-lab-runtime.mjs` | Generate và export contracts mới |
| new | `source/packages/lab-runtime/src/engineering/{contracts,catalog,assembly,bundle-store,gateway}.ts` | Validate, resolve, store, route |
| new | `source/robotics/catalog/{catalog.json,models,documents,components}/` | Catalog/model metadata versioned |
| modify | `source/packages/lab-runtime/src/v2/{gateway,capabilities,contracts,session,reclaim-store,scenario-runner}.ts`, `source/packages/contracts/schemas/lab-run-v2.schema.json` | Capability, optional ref, lockedInput và quyền bundle khi reclaim |
| new | `source/tests/support/engineering.ts`, `source/tests/fixtures/engineering/` | Fixture builder và model nhỏ có nguồn assumed |

### A01 — Schema, generation và fixture contract

**Interfaces:** Consumes `LabProjectV2` hiện hữu. Produces types trong spec và `validateEngineeringProject(input: unknown): { ok: boolean; problems: Problem[] }` ở engineering/contracts.ts. Fixture helper `engineeringFixture(name: string): { project: EngineeringProject; components: Record<string, ComponentRevision> }` chỉ nhận fixture IDs đã đăng ký, unknown ID throw. A01 cung cấp `valid`, `missing-inertia`, `cycle`, `voltage-mismatch`, `battery-offset`.

**Files:** create schemas/generated/contracts/helper/fixtures trong file map; modify generator/exporter. New tests `source/tests/contracts/engineering-contracts.test.ts`.

- [ ] Chụp baseline NR01–NR12 theo [compatibility](../../specs/2026-11-06-physical-robot-lab/compatibility.md): commits/pin, scenario IDs/revisions, backend sets, formats và UI journeys. Tạo `lab/docs/implementation/evidence/physical-robot-lab/compatibility.json` với baseline results thực và candidate pending; không sửa evidence lịch sử. File này commit riêng trong lab khi có kết quả.
- [ ] Viết schema tests và fixtures tối giản đầy đủ liên kết. Ví dụ trong test mới (import helper/module tương ứng):
  ```ts
  import { expect, test } from 'vitest';
  import { validateEngineeringProject } from '../../packages/lab-runtime/src/engineering/contracts';
  import { engineeringFixture } from '../support/engineering';
  test('rejects authority and invalid scalar input', () => {
    const { project } = engineeringFixture('valid');
    expect(validateEngineeringProject(project).ok).toBe(true);
    expect(validateEngineeringProject({ ...project, operator: 'admin' }).ok).toBe(false);
    expect(validateEngineeringProject({ ...project, revision: NaN }).ok).toBe(false);
  });
  ```
- [ ] Run RED từ source: `pnpm exec vitest run tests/contracts/engineering-contracts.test.ts`; expected missing new module trước implementation.
- [ ] Implement JSON Schema strict additionalProperties, finite/range checks, discriminated joints, SI units, digest pattern và unique IDs. Dùng AJV pattern hiện hữu:
  ```ts
  const ok = validate(input);
  return { ok, problems: ok ? [] : schemaProblems(validate.errors) };
  ```
  `schemaProblems` là helper private mới trong contracts.ts, nhận AJV ErrorObject[]/null, trả Problem[] với blocking=true. Generate EngineeringCompileInput/EngineeringRef/EngineeringArchive/EngineeringCandidate cùng types cũ; tách schema draft hợp lệ cấu trúc khỏi runnable validation. Kiểm documentType trước schemaVersion; không nhầm engineering schema 1 với project v1. Archive/candidate có allowlist, checksum và explicit missing data; không credentials/proof. Export schema closure/hash; không đổi nghĩa v2.
- [ ] Run GREEN command trên + `pnpm contracts:generate`, `pnpm contracts:check`, `pnpm test:contracts`. Cover fixed/continuous/bounded joints và invalid quaternion.
- [ ] Commit source files của A01: `feat: define engineering project and component contracts`.

### A02 — Catalog nguồn hãng và reference configuration

**Interfaces:** Consumes ComponentRevision, ModelRef. Produces `loadCatalog(root: string): Promise<{components: Record<string, ComponentRevision>; problems: Problem[]}>` ở catalog.ts và declarative actuator/sensor/process schemas đi kèm engineering-component schema. Không fetch vendor URLs lúc load.

**Files:** create catalog tree; new `source/scripts/import-engineering-vendor.mjs`; modify engineering/catalog.ts và component schema; new `source/tests/unit/engineering-catalog.test.ts`; fixture catalog `source/tests/fixtures/engineering/catalog/`.

- [ ] Viết test nguồn/price/license, hash mismatch và missing dependency. Fixture candidate có SKU null, document digest thật của file fixture; zero giá không là default:
  ```ts
  import { expect, test } from 'vitest';
  import { loadCatalog } from '../../packages/lab-runtime/src/engineering/catalog';
  test('missing vendor blob blocks runnable model', async () => {
    const result = await loadCatalog('tests/fixtures/engineering/catalog/missing-blob');
    expect(result.problems.some(p => p.code === 'BLOB_UNAVAILABLE' && p.blocking)).toBe(true);
  });
  ```
- [ ] Run RED: `pnpm exec vitest run tests/unit/engineering-catalog.test.ts`.
- [ ] Import vendor description ở exact commit, record SHA/license/source per file; tạo reference AMR/cup/jaw và selection worksheet `source/robotics/catalog/selection.md` theo spec. Catalog importer chỉ nhận manifest URLs allowlist và checksum; không chạy vendor scripts. Critical check:
  ```ts
  if (sha256(bytes) !== declaredDigest) {
    problems.push({ code: 'BLOB_HASH_MISMATCH', path, blocking: true, detail: declaredDigest });
  }
  ```
  `sha256(bytes: Uint8Array): string` là private helper dùng node:crypto; `path` chỉ là path nội bộ đã normalize. Bổ sung referenced model/document closure, license và provenance checks.
- [ ] Run GREEN; assert cùng family khác SKU không merge; candidate thiếu torque/price vẫn hiển thị thiếu. Record arm vendor compatibility chưa chạy bằng status not_run.
- [ ] Commit: `feat: add sourced engineering component catalog`.

### A03 — Assembly resolver và BOM

**Interfaces:** `resolveAssembly(project: EngineeringProject, components: Record<string, ComponentRevision>): { problems: Problem[]; resolved: ResolvedAssembly | null }`. New type `ResolvedAssembly` trong engineering bundle schema gồm `assemblyDigest`, `links: Link[]`, `joints: Joint[]` (IDs globally namespaced), `entityBindings`, `ports`, `models`, `placements`, `assumptions: SourceRef[]`, `bom` với nullable SKU/price. Output không chứa derived duplicate wheel parameters; controller binding trỏ joint/component params explicit.

Trong cùng module thêm `prepareEngineeringCompileInput(project: EngineeringProject, resolved: ResolvedAssembly, recipes: CoffeeRecipe[]): EngineeringCompileInput`. Hàm validate và băm project, sinh immutable runtimeProjection/assets từ assembly, giữ toàn bộ semantic world/entity/speed/recipe/fault inputs theo spec; reject mismatch/thiếu recipe hoặc fixture geometry. Không trả một mutable runtimeProject cho UI sửa độc lập.

**Files:** create engineering/assembly.ts, new `source/tests/unit/engineering-assembly.test.ts`; extend bundle schema, A01 fixtures; new `source/packages/lab-runtime/src/engineering/inertia.ts` và `source/tests/unit/engineering-inertia.test.ts`.

- [ ] Viết tests V02/V03, trong đó cycle phải chặn trước compile:
  ```ts
  import { expect, test } from 'vitest';
  import { resolveAssembly } from '../../packages/lab-runtime/src/engineering/assembly';
  import { engineeringFixture } from '../support/engineering';
  test('cycle has no resolved model', () => {
    const f = engineeringFixture('cycle');
    const r = resolveAssembly(f.project, f.components);
    expect(r.resolved).toBeNull();
    expect(r.problems.map(p => p.code)).toContain('ASSEMBLY_CYCLE');
  });
  ```
- [ ] Run RED: `pnpm exec vitest run tests/unit/engineering-assembly.test.ts tests/unit/engineering-inertia.test.ts`.
- [ ] Implement topological graph resolve, transformed mounts, entity coverage, initial overlap, voltage/current/protocol and payload/moment checks. In inertia.ts export `combineInertia(links: Link[], poses: Pose[]): { massKg: number; comM: Vec3; inertiaKgM2: Link['inertiaKgM2'] }`. Core:
  ```text
  M = sum(m_i); C = sum(m_i * c_i) / M
  I = sum(R_i * I_i * transpose(R_i)
          + m_i * (dot(d_i,d_i) * identity3 - outer(d_i,d_i)))
  d_i = c_i - C
  ```
  Check eigenvalues/triangle constraints; no arbitrary epsilon to hide invalid inertia. Return all actionable problems; never return runnable resolved result with blocking problems.
- [ ] Run GREEN + contracts check; battery-offset analytical fixture verifies COM shift, known tensor and units. BOM unknown price stays null and incompleteTotal=true.
- [ ] Trong engineering-assembly.test.ts thêm V17 projection tests: custom point/obstacle IDs, empty world draft, handoff yaw, speed limit, recipeRefs/faultSchedule. Với fixture đã resolve và recipes của fixture, assert:
  ```ts
  const input = prepareEngineeringCompileInput(project, resolved, recipes);
  expect(input.runtimeProjection.project.world).toEqual(project.runtimeProject.world);
  expect(input.runtimeProjection.project.entities.map(e => [e.id, e.speedLimitMps]))
    .toEqual(project.runtimeProject.entities.map(e => [e.id, e.speedLimitMps]));
  expect(input.projectDigest).toBe(hashJson(project));
  ```
  Import hashJson hiện hữu; asset refs được sinh lại phải resolve đủ trong input.runtimeProjection.assets. Empty/incomplete draft được lưu nhưng không trả compile input runnable nếu thiếu geometry/binding; không tự dùng restaurant fixture.
- [ ] Commit: `feat: resolve and validate physical assemblies`.

### A04 — Immutable bundle store và guarded gateway

**Interfaces:** A04 produces `compileEngineeringProject(project: EngineeringProject, sessionId: string): Promise<BundleReceipt>` in engineering/gateway.ts using A03's prepareEngineeringCompileInput + compiler port `compileResolved(input: EngineeringCompileInput, outDir: string): Promise<{sceneDigest: string; files: {path: string; sha256: string}[]}>`. B02 implements production compiler port; A04 tests inject test compiler, so native runnable remains false until B02/B01 ready. Store method `authorizeBundle(sessionId: string, digest: string): Promise<boolean>` resolves both current compile ownership and proof-reclaimed run grants. Persist run→bundle closure association before acknowledging creation, not only a session-keyed memory map.

**Files:** create engineering/bundle-store.ts/gateway.ts; modify v2 gateway/capabilities/contracts/session/reclaim-store/scenario-runner + run schema; new `source/tests/integration/engineering-gateway.test.ts`, `source/tests/security/engineering-bundle.test.ts`. Reuse session/CSRF fixtures from source tests/support/lab-v2.ts. Gateway readiness extension được hoàn tất với provider resolver ở B03.

- [ ] Test compile/read/create-run roundtrip, wrong owner/hash, unknown catalog, timeout/partial publish, old runtime extension reject. Behavioral assertions:
  ```ts
  expect(compileReceipt.state).toBe('compiled');
  if (compileReceipt.state !== 'compiled') throw new Error('EXPECTED_COMPILED_FIXTURE');
  expect(compileReceipt.runnable).toBe(false); // injected test compiler has no native qualification
  expect(await store.authorizeBundle('different-session', compileReceipt.bundleDigest)).toBe(false);
  expect(createRunWithMismatchedProject.status).toBe(409);
  ```
  Test variables are HTTP responses/store instance arranged in the new integration fixture; actual gateway must be launched with temporary data root and test session.
- [ ] Test missing catalog/inertia với resolver trả null: receipt state blocked, ba output digests null, projectDigest khớp input; không tạo EngineeringRef hoặc publish partial bundle. Compile thành công nhưng thiếu native chỉ trả compiled/runnable:false. Roundtrip HTTP dùng `/lab/v2` qua proxy hiện hữu và cookie Path=/lab/v2; kiểm compile/readiness/manifest/blob giữ cùng pairing, không thêm prefix `/api`.
- [ ] Run RED: `pnpm exec vitest run tests/integration/engineering-gateway.test.ts tests/security/engineering-bundle.test.ts`.
- [ ] Implement routes exactly as spec, body/blob/instance/time limits, atomic publish, digest permissions, capability negotiation and immutable run snapshot. Admission:
  ```ts
  if (!capabilities.includes('engineering_bundle_v1')) throw new Error('ENGINEERING_CAPABILITY_REQUIRED');
  if (request.engineeringRef.projectDigest !== receipt.projectDigest) throw new Error('ENGINEERING_IDENTITY_MISMATCH');
  ```
  Map typed errors to HTTP 400/403/409/503; derive runtime project from authorized bundle, reject supplied project khác projection. No client-selected endpoint/plugin. Persist engineeringRef + EngineeringProject + runtimeProjection in lockedInput, checkpoints và reclaim record; retained blob closure survives archive/session expiry. Reclaim proof grants new session access to only that run's bundle, never control/resume; retain original proof exclusion from exports.
- [ ] V19 gateway tests: create → edit unrelated draft → restart gateway → pair new session → reclaim proof → GET manifest/blob + report, assert original digests/input and view_reconcile; wrong proof/session remains 403/404. Fresh reset request dùng locked engineeringRef sau reclaim creates a different run ID with same project/bundle/seed; does not auto start. Missing/corrupt closure blocks reset, does not discard old evidence. Test named `engineering-gateway.test.ts` dùng actual gateway/temp directory với injected physics port, chỉ claim portable recovery.
- [ ] Run GREEN + existing `tests/integration/lab-v2-contracts.test.ts`, `tests/integration/lab-v2-recovery.test.ts`, contracts check; test budget exhaustion leaves no published incomplete bundle.
- [ ] Commit: `feat: admit immutable engineering bundles through lab gateway`.

**Exit:** G0 contract/assembly/security portion complete with receipts and blockers. A04 API does not claim physics compiler/native execution before B02/B03.

