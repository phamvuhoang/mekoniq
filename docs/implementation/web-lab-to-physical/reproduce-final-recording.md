# Reproduce the recorded boundaries

Use the [final status](final-recording-status.md), [archive inventory](../evidence/web-lab-to-physical/final-recording/index.json), complete [recording report](retention/sdd/README/task-final-recording-report.md) and original own receipts together. Passing a retained-data guard does not run a new campaign or authenticate a host.

## Normal checkout layout and publication

The documented layout is `workspace/{source,lab,web,trial}`, four independent repositories. Run Git inside the named repository. The final normal-clone audit checks local links/fragments and exact local Git objects and commit ancestry from shipped branch heads in this layout; it does not check GitHub permissions or live hosting. In particular, the GTM marketing-site link climbs four levels from `source/docs/gtm/2026-11-14-web-simulation/` to sibling `web/index.html`.

Publication HEADs contain documentation and retained evidence. They are distinct from measured producer Source `981e234b1a0da8c72d220445daaf780b3bf65ae4` and Lab `d4c30329b5abe104a94e1ea050f7e4bee7fa0ec6`. The Lab pin remains Source 981/runtime 8eb111; documentation publication does not retag an execution or cause a new runtime export. Ordinary installed-pin/portable-byte checks may pass at publication HEAD; strict `productionBuildIdentity` additionally requires clean trees and Source HEAD equal to the pin.

Exact code references, verified as local Git objects reachable from the shipped branch heads by the final link audit:

- [Source producer](https://github.com/phamvuhoang/mekoniq/tree/981e234b1a0da8c72d220445daaf780b3bf65ae4), [full checker bootstrap](https://github.com/phamvuhoang/mekoniq/blob/981e234b1a0da8c72d220445daaf780b3bf65ae4/scripts/native-checker-bootstrap.mjs).
- [Lab producer](https://github.com/phamvuhoang/mekoniq-lab/tree/d4c30329b5abe104a94e1ea050f7e4bee7fa0ec6), [production recorder](https://github.com/phamvuhoang/mekoniq-lab/blob/d4c30329b5abe104a94e1ea050f7e4bee7fa0ec6/scripts/measure-cell-production.ts).
- [Historical L01 checker](https://github.com/phamvuhoang/mekoniq/tree/874d05aedfbf573496994fd73016f19ef19e6932).
- Frozen full-net review bases: [Source11d25b4](https://github.com/phamvuhoang/mekoniq/tree/11d25b47a18adafb88ac21adc249499109996bc5), [Laba744954](https://github.com/phamvuhoang/mekoniq-lab/tree/a7449541e118d01f65af0ad1466e0c963a173f3c).

The root performs one final whole-branch review after this handoff. No merge, push, deployment, provisioning, outreach, spending or hardware motion is part of these instructions.

## Extract retained bytes safely

Each archive has a complete `.members.json` index, original member bytes/SHA256/modes and archive bytes/SHA256. Original absolute paths remain provenance; the publication inventory maps them to the portable archive. Do not edit embedded paths, timestamps, outcomes or hashes. The tested extraction helper rejects traversal, duplicate/unlisted members and links, checks every regular byte and restores recorded modes. Dependency symlinks are descriptors and are not materialized. Tar owner/time metadata is neutral; original file mtime values remain in the index.

```sh
python3 docs/implementation/web-lab-to-physical/retention/tools/record-archive.py \
  extract /path/to/record.tar.gz /path/to/record.members.json \
  /new/owned/extracted-record /new/owned/extract-receipt.json
```

All output/receipt paths must be new. Keep archives/extraction outside any measured window. Never open an original retained SQLite database with an engine. Public readers that need SQLite verify/copy first and use their own temporary copy. The four named [privacy exclusions](../evidence/web-lab-to-physical/final-recording/privacy-exclusions.json) remain outside Git; marked derivatives retain only the required task context. Original receipt logSha256 values still name the excluded original logs. Public verification claims cover indexed public members only.

## Current R3, IR-SIM, payload and cell readback

Use a separate exact clean Source 981 checkout with its frozen dependencies. The full checker graph is `2d911a9d0028b12d0b6360b49170d77bbbe95b8ca2feed7cf5771ac3bef07ffe`; the smaller L00 CLI digest is a different boundary. Node24.22.2/pnpm10.32.1 and Python3.11 are the recorded toolchain. Existing local dependencies were explicitly reused here; no fresh-host installation or installed Linux trust was qualified.

```sh
node scripts/verify-r3.mjs /new/owned/extracted-r3-profile
node scripts/native-handoff.mjs verify --input /new/owned/extracted-handoff
node scripts/lab-irsim.mjs verify --input /new/owned/extracted-irsim/campaign
LAB_IRSIM_EVIDENCE_DIR=/new/owned/extracted-irsim \
  pnpm test:acceptance -- linkforge-irsim
node scripts/lab-mujoco.mjs verify --input /new/owned/extracted-payload-campaign
node scripts/lab-mujoco.mjs verify --input /new/owned/extracted-cell-campaign
```

R3 prepared scopes return preparation consistency only: nativeReady:false, image:null, native/physical not_run, accepted:false/not_calibrated. Only PUMA's subject selects the native closure; other subject native fields remain null. Source identity snapshots separately retain the unchanged native closure. The Source-only19payload/8 cell campaigns retain their true Source 981 binding; they were not relabeled with a newer Lab commit.

The first extraction-readback batch reproduced85zero and four historical nonzero outcomes across89 public invocations. The nonzero historical subjects are the deliberate corrupt/missing/wrong-subject records and the original PUMA hidden-leaf preparation failure. Historical repaired/replacement subjects remain separate. Current web capture readback still returns invalid with `CAPTURE_ACTIVE_DRAWING_DURATION`; do not modify it into a pass.

## R1/R1.1 and partial R2a legacy layout

Keep the original external-layout guard failures. In a NEW exact Source 981/Lab d4 sibling reader pair, first verify the clean checker identity, then stage only verified copies of real upstream directories into these absent paths:

```text
source/docs/implementation/evidence/linkforge-irsim/irsim/
source/docs/implementation/evidence/sim-extension/r1/
source/docs/implementation/evidence/sim-extension/r11/
```

The complete copy manifests in retained metadata bind every original→staged member. `r1` and `r11` here are actual carried candidate directory names, not invented candidate IDs. Code stays at exact Git bytes, while staged evidence makes the Source checkout data-only untracked. Run the unchanged COMPLETE guard with the actual selected external/extracted candidate:

```sh
LAB_SIMEXT_EVIDENCE_DIR=/new/owned/extracted-candidate \
  pnpm test:acceptance -- sim-extension
```

This is fixture-layout public readback, not a clean producer run or a general path-portability repair. A genuine R93 partial R2a retains skipped suites/not_run and fails tested-gate/screenshot assertions even with correct staging. Supplemental suites never replace its immutable fields.

## Reassemble the full R2b record

The full R2b directory is split into four archives to keep each Git blob bounded. The [assembly descriptor](../evidence/web-lab-to-physical/final-recording/archive-receipts/r2b-split-assembly.json) lists every original relative file path, byte count, SHA256, mode and directory, as well as the exact component destinations. Restore all four components before any public readback:

```text
/new/owned/r2b/                    ← 981-d4-r2b-outer
  qualification.json
  inputs/
    physics/                      ← 981-d4-r2b-physics
    cell/                         ← 981-d4-r2b-cell
    web/                          ← 981-d4-r2b-web
    r2a/                          (carried by outer)
    semantic-study.json           (carried by outer)
  suites/                         (carried by outer)
```

The raw archives are no longer in the tree; [raw.REMOVED.md](../evidence/web-lab-to-physical/final-recording/raw.REMOVED.md) gives the commit and command to restore them. From Source, with the published raw archives available at `/path/to/final-recording/raw`, use the same safe extraction helper for each new destination:

```sh
python3 docs/implementation/web-lab-to-physical/retention/tools/record-archive.py extract \
  /path/to/final-recording/raw/981-d4-r2b-outer.tar.gz \
  /path/to/final-recording/raw/981-d4-r2b-outer.members.json \
  /new/owned/r2b /new/owned/r2b-outer-extract.json
python3 docs/implementation/web-lab-to-physical/retention/tools/record-archive.py extract \
  /path/to/final-recording/raw/981-d4-r2b-physics.tar.gz \
  /path/to/final-recording/raw/981-d4-r2b-physics.members.json \
  /new/owned/r2b/inputs/physics /new/owned/r2b-physics-extract.json
python3 docs/implementation/web-lab-to-physical/retention/tools/record-archive.py extract \
  /path/to/final-recording/raw/981-d4-r2b-cell.tar.gz \
  /path/to/final-recording/raw/981-d4-r2b-cell.members.json \
  /new/owned/r2b/inputs/cell /new/owned/r2b-cell-extract.json
python3 docs/implementation/web-lab-to-physical/retention/tools/record-archive.py extract \
  /path/to/final-recording/raw/981-d4-r2b-web.tar.gz \
  /path/to/final-recording/raw/981-d4-r2b-web.members.json \
  /new/owned/r2b/inputs/web /new/owned/r2b-web-extract.json
```

Each helper verifies the archive/member index and all extracted regular bytes and modes, refusing existing output directories or unexpected links. Check the complete restored layout against the assembly descriptor before running the public reader. The recorded reassembly already compared every original/restored relative path, byte, hash, mode and directory, then checked that the original directory remained unchanged. Original mtimes remain indexed; neutral extraction timestamps are intentional. Embedded raw paths, statuses and qualification fields stay unchanged.

Full R2b readback uses the public asynchronous directory reader, also used by acceptance:

```sh
node --input-type=module -e 'import {verifyR2bDirectory} from "./scripts/r2b-readback.mjs"; const issues=await verifyR2bDirectory(process.argv[1]); console.log(JSON.stringify(issues)); process.exit(issues.length?1:0)' /new/owned/extracted-r2b
LAB_SIMEXT_EVIDENCE_DIR=/new/owned/extracted-r2b \
  pnpm test:acceptance -- sim-extension
```

The actual extracted standalone reader returned the same 40 issues. The complete extracted guard returned 10 passed / 2 failed, with its integrity case timing out at the unchanged 45000 ms limit after 46.19 seconds; the original guard instead reached its issue-array assertion. These are distinct failures. No timeout override or retry was used. Retain nonzero outcomes and actual case/gate reasons. Missing Docker/current image means WEB05 not_run; incomplete genuine R2a produces REG04/R2A_GATE_NOT_TESTED. Missing owned cloud services is not permission to borrow a receipt. WEB06/HTTPS and native/hardware acceptance remain independent.

## Historical retained regression corpus

The `historical-retained-inputs` archive contains125files:82 cell-run members,41 payload-run members, one historical expected-export manifest and the digest-bound catalog. After safe extraction, the public preparation command creates a new verified copy without opening original databases:

```sh
node scripts/prepare-retained-inputs.mjs \
  /new/owned/corpus/inputs.json \
  30351aae82c52171d3744d07446fc13341850da7eda155976de586493498a56f \
  /new/owned/corpus-copy
export MEKONIQ_RETAINED_INPUTS=/new/owned/corpus-copy/inputs.json
export MEKONIQ_RETAINED_INPUTS_SHA256=30351aae82c52171d3744d07446fc13341850da7eda155976de586493498a56f
```

Both selectors are required. The final extracted-corpus preparation reproduced that exact digest here; there is no hidden workstation fallback. This corpus is historical regression input, not current Linux/native execution.

## Exact historical L01 refusal reproduction

Use an isolated clean Source checkout at `874d05aedfbf573496994fd73016f19ef19e6932`, tree `6a59ef54f7861d12b1901d88da63394df6b5a830`, with its matching lock dependencies. Public checkedCheckerIdentity must yield full graph `f0052cf8449b7c978d432ead1c65a9ebfda784db166933ada3e9c6bba9f0557f`. The old handoff's subject is Source 4f893ac/Laba6ec316/runtime 55dd3585, not Source 981. Run against fresh verified extracted copies:

```sh
node scripts/native-handoff.mjs verify --input /new/owned/l01/handoff
node scripts/native-sim/mujoco-probe.mjs --verify /new/owned/l01/native-not-run
```

Actual outcomes remain handoff own 0/prepared:true/nativeReady:false and probe own 1/NATIVE_CAMPAIGN_NOT_PASSED/missingobserver. The smaller historical CLI graph `1ffa5a770189a26128cf8a1e6bbb546b946dd73fe9d20750af58bc256eff5ff3` differs from the full probe checker. Publication HEAD or a compatibility-looking subset is not that checker. The original incorrect positional handoff invocation remains a separate failed receipt; the documented `--input` command is the actual correction.

## Re-run a new production measurement

Use NEW clean sibling checkouts of Source 981/Lab d4, frozen lock dependencies, the matching clean exported runtime, declared pinned Python3.11 environments and a fresh build. Do not reuse the data-only legacy reader stage. Missing prerequisites must refuse; no fallback, private data import, external service borrowing or hardware action is allowed.

```sh
# Lab at the exact measured commit, after importing the matching clean export:
pnpm check:source
pnpm build
# Source at the exact measured commit; new output outside both checkouts:
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' \
  caffeinate -dims perl -e 'alarm 1200; exec @ARGV' \
  pnpm exec tsx ../lab/scripts/measure-cell-production.ts \
  --exported-runtime --out /new/owned/production-measurement
```

The actual prior command used5000ms warmup and185000ms active capture, without diagnostic/target overrides. Serialize competing browser/engine/build/archive work. Record the new own exit, cleanup, actual draw/worker/HTTP/clock observations and browser artifact binding; unchanged targets are33/15/500 ms. The prior185s result achieved0.47188883×, failed display/pause and public drawing-duration validity. A new run cannot inherit a previous pass, claim full two-cup live completion or infer internal commit timestamps from Source receipts.

The separate exact-entrypoint production browser command `--verify-browser --exported-runtime` and the required strict replay/story files have their own same-build bindings; they are not performance measurements. Four minutes is a guided replay narrative, not a promised full 1× live mission.
