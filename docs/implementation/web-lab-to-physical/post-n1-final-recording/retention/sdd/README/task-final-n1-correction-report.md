# N1 bounded correction report

Read the complete4502-byte new brief,22575-byte scoped review and controller dispositions. Authorized exception applies only to newly introduced shared-world cached-Pause replay interruption. Clean bases Sourcecb5c86cf9ee5db06cdacc38a2146f6f312b2c503/Labfded4b26638eb412f3285d5fe37d415108f58f19 confirmed. Previous57452-byte report digest verified unchanged. New raw root: `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r`. Existing Node24/pnpm10 dependencies and Python venvs are reused; no fresh install provenance.

Diagnosis: takeControls uses successful beforeExecute as the interrupt signal. Cached priority receipt lookup executes the required current-authority check, incorrectly setting that signal despite no new mutation. Proposed smallest repair separates the start-of-new-control callback from authority, marking before its first persistence so an uncertain begun control remains conservative. Navigation analogue is untouched. No production/browser/campaign/full-chain rerun is authorized here.

Check `n1-red`: own exit 1; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-red.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-red.log`, 4945 bytes, SHA256 `b978b458c83b315c1963951d25802e80728b51ddcf7652ce3de356328ed7df68`.

RED actual code: cached authorized Pause returned its original receipt but newbatch endedH1 insteadH50 (semantic N1 reproduction). Other denied/conflicting cases passed. The second-checkpoint uncertainty test initially expected paused but existing error path correctly reports needs_attention with ACTION_INTERRUPTED; corrected that mistaken assertion, not product behavior. Original RED log retains both outcomes. Narrow fix changes only private control-start notification, not receipt lookup/auth/conflict/durability semantics.

Check `n1-contracts`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-contracts.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-contracts.log`, 192 bytes, SHA256 `b01efc8275af27aef1593ccbccacf369a068c21bf75222530690ef4d51d5633c`.

Check `n1-green`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-green.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-green.log`, 2768 bytes, SHA256 `7c171bf8291c01196252737069ef2fcc01c240225d59ffa85dc5f4d51878dc9b`.

Check `n1-typecheck`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-typecheck.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-typecheck.log`, 232 bytes, SHA256 `a38cf93675b24c7612ead396f6cdc68f544441355db12bccc212ffe3f6e07db5`.

Check `n1-lint`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-lint.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-lint.log`, 0 bytes, SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

Check `n1-build`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-build.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-build.log`, 7365 bytes, SHA256 `ec39a8e42d1618d2e606efa80b9ac8439b5a0fc0207ec58066f838956628bf60`.

Check `n1-export`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-export.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-export.log`, 103299 bytes, SHA256 `ea5f9f2b47c75ce3b26973d8dc307622a9c12f94665b4b70ccb38c462cb24e2c`.

Check `n1-import`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-import.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-import.log`, 198 bytes, SHA256 `69d5dbd141d8149bf0c77238107ecbe3564783aab3b3b23f7e3cdb5cbb4ef0d3`.

Check `n1-sync`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-sync.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-sync.log`, 220 bytes, SHA256 `84731b62ae9a5141c2b86ed05a6c5786c87be631f44b35181ea6b2e089481837`.

Check `n1-check-source`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-check-source.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-check-source.log`, 295 bytes, SHA256 `5838995e022f0f3c6777db1207fbab2b09930e621f394dfb088b6ef30120d3fe`.

Check `n1-lab-build`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-lab-build.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-lab-build.log`, 1605 bytes, SHA256 `b622abe24da9eedd37c8e9ecf6a88ef0122ef5e74894d9a5a561d669c34d01af`.

## Settled correction and observed scope

The Source implementation changes only the private `takeControls` / `execute` new-control notification: authorization still runs for cached priority receipts, and only a newly validated/authorized action marks the batch as interrupted immediately before first persistence. Thus an uncertain first or final checkpoint remains conservative. Stored receipt bytes and conflict-before-authority ordering are preserved. No public API, schema, physics, durability policy, reader, threshold or UI change. Six new world regressions cover authorized cached Pause replay after Resume, expired-session denial, stale-writer denial, conflicting payload, and uncertain first/final checkpoint. The new batch must complete all 50 actual world steps and retain its own receipt, while successful old replay returns its original JSON bytes.

`n1-green` executed 90 passing tests in five complete files: world-runner 36, mujoco-world-authority 10, lab-run-writer 9, lab-reclaim-authorization 18 and lab-run-controls 17. This includes existing fresh Pause/Cancel, denied controls and lifecycle coverage. Its navigation test `lab-run-controls.test.ts:142` explicitly observes the inherited IR-SIM behavior: an authorized cached control yields a later two-tick batch at H0 while unpaused. That behavior remains unchanged/out of N1 scope, per controller disposition. Therefore navigation is not wholly unobserved, and this report does not claim platform-wide replay behavior was repaired.

All six pre-commit check receipts have matching before/after dirty-file byte hashes. The GREEN, contracts, typecheck, authored lint and Source build ran on exactly the two files then committed, without intervening edits. Authored lint uses `--ignore-pattern .superpowers/**`; this is not a claim that the earlier raw `pnpm lint` metadata failure disappeared. Focused tests and independent type/lint/build work overlapped; these are functional checks, not timing/isolation evidence. Own exit receipts for both parent commands are settled. No production capture/browser/payload campaign/full-chain command was launched.

Source normal commit `0d4640324d7fdb2f169ed9078db2208aae61b589` changes two files (+30/-3) from `cb5c86cf9ee5db06cdacc38a2146f6f312b2c503`. Public export/import/sync/check:source succeeded. Lab normal commit `7c97b20` changes only runtime lock and two generated provenance headers (+4/-4) from `fded4b26638eb412f3285d5fe37d415108f58f19`; generated schema bodies are unchanged. No hand-edited generated bytes, no amend.

Check `n1-identity-check`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-identity-check.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/n1-identity-check.log`, 1587 bytes, SHA256 `280611573091657816e4dd64f2bfea66c20e02fd4f4a78aa92116266d47c305a`.

## Final clean freeze and evidence boundary

source: HEAD `0d4640324d7fdb2f169ed9078db2208aae61b589`, tree `4ffba2273ba527ec06969cc34d02d44ca9414a2e`, tracked/untracked git status empty.

lab: HEAD `7c97b202143dd156d8e7751dfa2bbf198d17f9b9`, tree `fe1b269b07a31033671c79b406244b32a446c96c`, tracked/untracked git status empty.

Exact review ranges: Source `cb5c86cf9ee5db06cdacc38a2146f6f312b2c503..0d4640324d7fdb2f169ed9078db2208aae61b589`; Lab `fded4b26638eb412f3285d5fe37d415108f58f19..7c97b202143dd156d8e7751dfa2bbf198d17f9b9`.

Runtime artifact `73ca9b369160468b27af5c4308fcd0910640cae365e2b151000c5885aa77d508`; schema `0d4ae124258123d27a21b67a8441dee13d703fd5ab7596ad298bcab9233a31e5`; portable `30dc0de3e034b14593ae3629a1f247724392d950578913cacc1dd2e9ca9bc69b`; native `79018e0a2601d8a27d3739751910bb392c86c2857cc39ad5fb451a977de78634`. Production build `1f968cd60d7cdeee17b706a0c43a9cb4b2eb8b78e5b82caaa49e5cb8824d37b0`, 200 files; Lab build includes brand verification and tsc.

Checker fingerprints (unchanged):

- `scripts/browser-capture-clock.mjs`: 10803 bytes, SHA256 `bdc77a4d9f629d4a81dfd6d222a329d43a899d7697af47348f3ef4c1944aa0be`.
- `scripts/sim-extension-r2b.mjs`: 7239 bytes, SHA256 `cd570b4bf4574c3b61bf5f82c643cf38058da3b4895a43e9cae7debbdd18b702`.
- `scripts/r2b-readback.mjs`: 8301 bytes, SHA256 `c9e7b1c2c19c5322d4fdb7f78227a552062045afecbd0f660f8712f44ea7205d`.
- `scripts/irsim-qualification.mjs`: 18820 bytes, SHA256 `5557be51feb18490e850ed439b959a0eb2a817d0be870f4cbcc9579db32a5dd0`.

Four-file checker-set SHA256 `e90053d6d0dfdcb64475af48bff26d0cab0a69a50f2595cd48c77d4f4bf7feb4` identifies exactly the listed files, not the full R3 transitive checker graph. Full identity: `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/subject-identity.json`, 43496 bytes, SHA256 `70709f44da923918030e97a6c1752a06686d2a0d94cdcab94fb8c09addbaab76`.

Exact check commands (each receipt preserves cwd, environment, before/after heads/status/dirty-file hashes, timestamps, own exit, full log bytes/hash):

- `n1-build`: `perl -e 'alarm 600; exec @ARGV' pnpm build`; own exit 0.
- `n1-check-source`: `perl -e 'alarm 120; exec @ARGV' pnpm check:source`; own exit 0.
- `n1-contracts`: `perl -e 'alarm 120; exec @ARGV' pnpm contracts:check`; own exit 0.
- `n1-export`: `perl -e 'alarm 180; exec @ARGV' node scripts/export-lab-runtime.mjs /var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/runtime-export`; own exit 0.
- `n1-green`: `perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/world-runner.test.ts tests/security/mujoco-world-authority.test.ts tests/security/lab-run-writer.test.ts tests/security/lab-reclaim-authorization.test.ts tests/security/lab-run-controls.test.ts`; own exit 0.
- `n1-identity-check`: `perl -e 'alarm 120; exec @ARGV' pnpm exec tsx .superpowers/sdd/README/final-n1-correction/identity.mjs /var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/subject-identity.json`; own exit 0.
- `n1-import`: `perl -e 'alarm 180; exec @ARGV' node scripts/import-runtime.mjs /var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/runtime-export`; own exit 0.
- `n1-lab-build`: `perl -e 'alarm 180; exec @ARGV' pnpm build`; own exit 0.
- `n1-lint`: `perl -e 'alarm 180; exec @ARGV' pnpm exec eslint . --ignore-pattern '.superpowers/**'`; own exit 0.
- `n1-red`: `perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/unit/world-runner.test.ts -t 'stored Pause replay|newly begun priority'`; own exit 1.
- `n1-sync`: `perl -e 'alarm 120; exec @ARGV' node scripts/sync-engineering-contracts.mjs`; own exit 0.
- `n1-typecheck`: `perl -e 'alarm 180; exec @ARGV' pnpm typecheck`; own exit 0.

Settlement verified all 12 receipt/log bindings, exact committed bytes against GREEN hashes, both clean Git statuses, unchanged frozen prior correction report (57452 bytes), prior C inventory (726024 bytes), and scoped review (22575 bytes). `settlement-processes.txt` retains a complete process snapshot: no N1 test/build/runtime/worker process remains. Pre-existing unrelated browser/MCP processes were observed and left untouched; this is not a machine-wide quiet claim. Ports 4175/4176 have no listeners (lsof exit 1, empty output); no N1 production server or browser was started. All owned command sessions have settled and no cleanup signal was needed. The original scoped probe was only read and remains untouched.

New-subject production capture, browser/replay evidence, physical simulation campaign/row, qualification chain and archives: **not_run**, as expressly required by the N1 brief. Root will record them once after the same reviewer's N1 follow-up. Earlier cb5/fded evidence remains historical: it cannot be attributed to 0d46403/7c97b20. Its achieved 0.499020× at selected 1× does not establish real-time 1× throughput. This handoff does not close native/hardware, calibration, service/container/HTTPS, human acceptance or the four deferred Minors. No navigation repair, unrelated edits, helper/reviewer, provision, external service, push, merge, deploy, hardware action or SDD cleanup occurred.

N1 code/test/freeze work is complete and ready for the bounded follow-up review; approval and final recording remain root-owned. No concrete blocker remains within this correction scope.

Settlement artifact: `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/settlement.json`, 10719 bytes, SHA256 `d4ee6e45825f771be8a03f0d23a5949b1338f7c0f220d13f4dffabd0bacbff73`. New inventory: `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-n1-7cw84h_r/artifact-index.json`, 21725 bytes, SHA256 `1ace45e52c62bca303159a8cff9b30dc6f9633d002acae20e8e39d7cadfdecb2`; 88 files / 3535886 bytes excluding the inventory itself. Metadata helpers and this report reside separately in D and are excluded from the raw-root inventory.
