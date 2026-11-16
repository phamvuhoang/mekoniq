# Launch, replay and reproduce exact evidence

Launching needs sibling `workspace/{source,lab}` repositories. The four-repository `workspace/{source,lab,web,trial}` layout was used only for the workspace-wide documentation-link and ordinary-clone checks; web/trial are not required to launch the Lab. [Source producer](https://github.com/phamvuhoang/mekoniq/tree/0d4640324d7fdb2f169ed9078db2208aae61b589) and [Lab producer](https://github.com/phamvuhoang/mekoniq-lab/tree/7c97b202143dd156d8e7751dfa2bbf198d17f9b9) are distinct from later publication heads. The Lab pin is Source 0d/runtime 73ca9b. A documentation commit needs no runtime re-export. Remote GitHub access/hosting is not implied by local link/reachability checks.

From Lab with Node 24.22.2, pnpm 10.32.1, matching locked Python 3.11 environments and the installed pinned runtime:

```sh
pnpm check:source
pnpm lab:mujoco -- --mujoco-mobile
```

Open `http://127.0.0.1:4175`, pair with the one-use terminal code, choose **Coffee delivery · simulated physical cell** (`mujoco-cell`), wait for readiness and create a run. Scenario/fault changes create a new run. Play/Pause/Resume operate on observed Source state; selected 1× is a pacing request and current measured throughput is 0.366×. Lab never controls a physical robot.

For saved data, export the replay ZIP, keep it unchanged, extract into a new folder and open **Explore recordings** at `/#replay`. Import the complete folder, verify run/horizon and move the tick cursor. Missing world samples remain unavailable; final fault/KPI values do not appear at earlier cursors. The current long capture ends H3454/served 1; separate nominal headless cases are not a live two-cup demonstration. The same-build replay tests deny all `/lab` traffic and cover locales, responsive layouts and accessible interaction at their recorded scope.

A production UI can serve replay without a runtime:

```sh
pnpm build
pnpm exec vite preview --host 127.0.0.1 --port 4175 --strictPort
# http://127.0.0.1:4175/#replay
```

The actual production tests used the same Vite preview/config through its owned API. This CLI guide is not another recorded browser run. `node scripts/build-offline.mjs --out <new-directory>` creates an **offline mock** package for the matching OS/ISA, started by `./start`; it is separate from a MuJoCo/ROS/LinuxCNC worker host or a fresh-host installation qualification.

Use the [raw index](../../evidence/web-lab-to-physical/post-n1-final-recording/index.json) to select a tree and its complete member indices. Verify each archive/index SHA-256 before safe extraction with the retained `record-archive.py` helper. Its extraction rejects absolute, traversal, duplicate, undeclared and nonregular members; dependency symlinks are descriptors and are never followed/materialized. A multi-part tree preserves the full original relative paths in each part: safely extract every listed part to its own new directory, then combine the disjoint files and declared directories at one empty root. The tree-retention record identifies all parts, the exact assembled layout and every original file hash/mode. Verify the **complete** reassembled inventory before a public reader. No status, raw path or content is rewritten.

No current R2a or R2b qualification candidate was produced after the genuine upstream refusals. There is no current R2b `qualification.json`/full input tree to extract or read. Any emitted refusal-directory bytes are not a candidate. Payload, cell, study and web records remain independent archived trees with their own actual reader scope. The old Source 981 full R2b tree is a separately identified historical record at its own exact reader, never a substitute for a current candidate. Original and extracted outcomes have separate own receipts in the index; a timeout or different first assertion remains its actual outcome.

At a clean exact Source 0d checkout with matching lock dependencies, use the public readers:

```sh
node scripts/lab-mujoco.mjs verify --input <reassembled-payload>
node scripts/lab-mujoco.mjs verify --input <reassembled-cell>
node scripts/verify-r3.mjs <reassembled-r3-profile>
```

Future-only R2b reader example: use these entry points only after a separately authorized normal recorder has produced a real complete candidate and its exact matching reader is checked out. They were not run on an absent current candidate. For the old Source 981 candidate, use its unchanged historical guide/reader, not Source 0d:

```sh
node --input-type=module -e "import {verifyR2bDirectory} from './scripts/r2b-readback.mjs'; const p=await verifyR2bDirectory(process.argv[1]); console.log(JSON.stringify(p)); process.exit(p.length?1:0)" <reassembled-r2b>
LAB_SIMEXT_EVIDENCE_DIR=<reassembled-r2b> pnpm test:acceptance -- sim-extension
```

The full R3 checker must be `6f464a9b4968f9270435a393539a16c42dbbfa4c9890a45cea62a7d8894392c3`. Strict reader checks use exact clean producer/checker checkouts; ordinary publication-head pin/contract/license/closure checks are a different boundary. Historical 89/cb5 captures use their exact historical reader commits. The old L01/874 reproduction remains [unchanged in its prior guide](../reproduce-final-recording.md).

Every campaign/whole-recorder reproduction must use fresh outputs, clean pinned producers, its required worker/GUI/service prerequisites and both historical selectors:

```sh
export MEKONIQ_RETAINED_INPUTS=<verified-prepared-corpus>/inputs.json
export MEKONIQ_RETAINED_INPUTS_SHA256=30351aae82c52171d3744d07446fc13341850da7eda155976de586493498a56f
```

Prepare that corpus using the public retained-input tool and the unchanged historical archive/index referenced by the new inventory. Do not open original authority/retained SQLite engines. Official IR-SIM/R1 Playwright defaults used a fresh isolated Lab. Surviving output was copied/indexed after each whole recorder, but the two internal R1 journey failure attachments were already absent after sequential default reuse. The exact gap has unknown original bytes/hash; later copies do not prove those missing files survived. Data-only legacy acceptance staging is an exact-code reader layout, not a clean producer or a repaired external result. A skipped suite is `not_run`; a prerequisite refusal must not create a fake candidate. No service borrowing, host setup, native/hardware or deployment action is authorized by these reproduction instructions.
