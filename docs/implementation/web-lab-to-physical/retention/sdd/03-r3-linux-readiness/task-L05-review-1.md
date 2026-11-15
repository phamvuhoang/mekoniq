# L05 independent spec and quality review

## Verdicts

- **Spec compliance: PASS for the task-scoped PHYS-PREP-01 prepared-document/code gate.** The required dossier schema/assessor, both arm preparation paths, conformance checklist, calibration procedure, refusal coverage and Source→Lab publication are present. No task-mandated defect was found.
- **Task quality: APPROVE within that preparation scope.** No Critical, Important or Minor findings. **Finding IDs: none.**
- **Native/physical qualification: NOT EXECUTED / NOT ESTABLISHED.** This approval does not select hardware, grant `live:true`, create arm admission authority, validate actual calibration, accept a candidate, or close G-HW, native, safety, signing or venue gates. The actual target remains undecided/incomplete.

This is an independent task-scoped review, not a whole-branch or final CI review.

## Reviewed identity and method

Reviewed the requirements in `task-L05-brief.md`, the complete 151-line implementer report, the supplied original-base Source and Lab packages, and the root handoff/recorded verification. Implementer explanations were treated as claims and compared with the actual additions. The packages were read in bounded passes without reconstructing Git diffs or rereading changed files.

| Repository | Original task base | Reviewed final HEAD |
| --- | --- | --- |
| Source | `7d8bededd7b0ca57984d6f0d000eaa74ddea839d` | `9fdf4f382c19d6dbbc3cf64c231561ced71e786d` |
| Lab | `2ccfbddb86282a9547368302f6121c7ee09acb71` | `b4a9d34f0881b05a76078a5d2b3ce2c189b654a6` |

Read-only `git rev-parse HEAD` matched both dispatched final identities. Independently hashing the supplied packages matched:

- Source, 48,802 bytes: `89500d50c9257ae420f570d340012b0564b5a102e277a9d769a5ab8ec63c5d41`.
- Lab, 3,615 bytes: `50547a12dfa5d3a70d2bebc703857dbd2f7c24e317bb481f9ff2e113df1b19d7`.

Focused outside-diff reads addressed two concrete risks: (1) whether the new runbook overstates the existing calibration evaluator's rejection/qualification behavior, by reading `packages/lab-runtime/src/engineering/calibration.ts`; (2) whether the new refusal/signature tests exercise the existing Python authority and whether their documented fresh environment omits a verifier dependency, by reading `tests/hardware/commissioning.py` and the imports/ES256 verifier in `robotics/agent/mekoniq_agent/protocol.py`. Those reads showed no conflicting new claim or alternate admission path. No suites were rerun, no helper agents were used, no cloud/container/native/hardware execution occurred, and no retained SQLite was opened. Only this review report was written.

## Spec assessment

| Requirement | Assessment and evidence |
| --- | --- |
| Valid undecided dossier, incomplete readiness, ordered requirements for both arms | Met. The closed version-1 schema permits undecided only with null branch/profile. `assessTargetDossier` adds `targetKind` to missing and returns xArm then custom requirements. A selected arm receives its matching branch; chassis receives no arm branch. See `packages/lab-runtime/src/commissioning/target-dossier.ts:19`, `tests/unit/physical-target-dossier.test.ts:7`. |
| Separate arm documents and existing chassis profile/authority scope | Met. Branch/profile combinations are constrained, including rejection of arm/chassis and simulation substitutions. The dossier assessor emits exactly the four requested result properties. It performs no I/O, crypto, manifest generation, live-capability or validation-rank assignment. See `packages/contracts/schemas/physical-target-dossier-v1.schema.json:257`, `packages/lab-runtime/src/commissioning/target-dossier.ts:19`, `tests/unit/physical-target-dossier.test.ts:43`. |
| Unknown identity and absent measured calibration/observer/signature cannot promote hardware | Met within the preparation/refusal scope. Null/known placeholder references stay incomplete; nonblank source/owner fields are required. Identity sources are vendor/measurement, calibration and latency sources measurement. The known synthetic xArm selector is specifically excluded as a physical serial. The security suite calls the unchanged Python commissioner and existing adapter constructors; complete arm documents are still rejected as chassis evidence. See `tests/security/physical-target-admission.test.ts:19`, `packages/lab-runtime/src/commissioning/target-dossier.ts:14`. |
| A signed simulation record cannot earn hardware validation | Met. The test creates an ephemeral P-256 key, signs the canonical record, and requires the authoritative result to remain `integration_tested` with illustrative-geometry/claim-exceeds-evidence reasons and without a signature-invalid reason. This distinguishes evidence refusal from accidental bad-signature refusal. See `tests/security/physical-target-admission.test.ts:40`. |
| Preserve active-motion refusal and existing signature authority | Met. No existing commissioner, verifier, hardware profile or adapter is modified. The new test executes the refusing entrypoint with explicit target/observer/test area and requires exit 2 / `VENDOR_INTERFACE_NOT_PROVIDED`. See `tests/security/physical-target-admission.test.ts:67`. |
| Both branch comparison, source/measurement/owner references, no operational defaults | Met. The actual template is blank and undecided; the document compares host, controller, tool, safety, latency and maintenance for both paths, leaves selection to the user, and calls for a separate physical-driver/admission task. No guessed register, pinout, speed or force values are supplied. See `docs/operations/physical-target-selection.md:9`, `docs/operations/physical-target-selection.md:48`. |
| Adapter conformance plan | Met. Covers command IDs/idempotency, persistent intent, one ACK, owner lease, boot/control epoch, deadlines, fresh actual feedback, disconnect/lost-ACK uncertainty, local stop and manual recovery. It distinguishes portable doubles from physical qualification and observes the atomic-fencing limitation. See `docs/operations/arm-commissioning-preparation.md:20`. |
| Measured calibration with distinct tuning/validation and ≥3 independent trials per condition | Met as an execution procedure. Includes actual instruments/raw digests, model/config/tool revisions, SI/raw conversions, frames, clock mapping/uncertainty, frozen tuning, held-out trials and operational limits before motion. The procedure explicitly requires manual condition coverage, independence and timing/frame review beyond evaluator checks. See `docs/operations/arm-commissioning-preparation.md:37`. |
| Source authority and no Lab hardware path | Met. The only Lab patch is the clean runtime pin plus generated provenance headers. New documentation retains Source/coordinator→agent/gateway→vendor/controller and explicitly bars Lab physical credentials/routes/toggles. See `docs/operations/arm-commissioning-preparation.md:12`, `docs/operations/physical-target-selection.md:72`. |
| Focused validation, commit and clean re-pin | Met by recorded evidence. Source and Lab final subjects and pin are consistent; the supplied Lab diff points to the reviewed Source commit. Root's recorded audit verifies clean export/import, schema/closure bytes and own-exit receipts. |

## Quality assessment and strengths

The implementation has a narrow, reviewable authority boundary. The assessor validates document structure and reference completeness, leaves authenticating those references to later review, and has no runtime consumer that can turn its `prepared` result into admission. The schema closes nested objects and keeps dossier profile IDs separate from executable profiles. Versioning is additive; existing runtime/control/physics behavior is untouched by this task.

Tests cover observable outcomes rather than only searching text: valid undecided and selected documents, missing identity/prerequisites, source-kind constraints, malformed/authority-bearing inputs, profile separation, input non-mutation, real commissioner refusals, adapter admission refusals, a valid signed simulation record and the active-motion CLI refusal. The synthetic fixture/key status is explicit. Wrong-schema dossier refusals are correctly limited to proving separation from the chassis authority; they are not represented as an implemented arm commissioner.

The runbooks give a recipient concrete missing evidence, owners, execution prerequisites and fault cases while preserving unresolved native and hardware work. Their calibration description agrees with the focused evaluator read: configurable minimum count and absent-condition/independence/timing checks are not silently promoted into physical proof. The documented manual checks are appropriate for this preparation-only task.

The report preserves failed setup/check attempts, corrects the initially omitted VDA filename, and limits its final claims to the relevant later receipts. It distinguishes precommit tested bytes from clean final identities and synthetic/portable checks from actual qualification. These are useful evidence boundaries rather than a claim of full CI or authenticated native execution.

## Findings

- **Critical:** none.
- **Important:** none.
- **Minor:** none.

No fixes are requested for L05. Deliberately open external gates and previously deferred whole-branch work are not being reclassified as task defects or completed qualification.

## Verification and limits

The recorded final relevant validation is 67 TypeScript tests across four actual requested files, 25 existing Python authority tests, Source/Lab typechecks, contracts check, changed-file eslint, template assessment and clean export/import/sync/pin. Root independently audited the 25 own-exit receipts, final Source bytes, 58 schemas, all 226 native and 238 portable closure files, clean pin/export and preservation of prior indexed evidence. I did not rerun or broaden those checks. This review independently verified package hashes/HEAD identities and inspected behavior in the supplied patches; the deeper retained-byte/receipt audit is attributed to root, not represented as my execution.

**Cannot verify from the diff or portable evidence:** authenticity or availability of any actual vendor/measurement/owner/signature reference; assigned host/runtime installation and trust; physical device identity/driver semantics; actual measured latency/calibration/trial independence; controller-side atomic fencing; local-stop/safety behavior; native xArm/LinuxCNC cases; human acceptance or venue readiness. Full lint/build/CI, broad acceptance/browser/golden regression and whole-branch review are also not established here. The inherited full-lint/B10 and earlier task limitations remain open.

**Gate disposition:** PHYS-PREP-01 preparation passes this independent task review. Actual native/physical commissioning remains unexecuted and unaccepted; no permission or hardware qualification follows from this report.
