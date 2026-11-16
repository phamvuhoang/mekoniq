# Consolidated correction I1–I4

Started 2026-11-16T09:49:08.031833

Read complete final review, controller dispositions and adopted affected contracts. Scope excludes M1–M4/native/inherited recorder work and external services; all historical evidence remains immutable. Starting Source 907087c4f2a4d6bc1348f50177c19143d956e9d9 (clean verified); Lab bfde031 pending own verification.

Raw output root: `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3`. Skill workflow: systematic debugging, TDD, verification. No helpers.

Check `i2-red`: own exit 1; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i2-red.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i2-red.log`, 31792 bytes, SHA256 `c319b015bf66550432d6047919daef917a898ddaeed817728ffbf19f84e1b30b`.

I2 diagnosis: all 18 deterministic expiry/revocation cases across cold factory/grant/closure/hold/persist and existing grant/closure/hold/persist returned 200 instead of 401. RED is semantic (no setup failures). Patch rechecks the same session after every await; persisted epoch advances in existing entry before rejection, with owner/readers unchanged. Cold handle closes on refusal; reservation finally releases. Lab starting clean bfde031 verified.

Check `i2-green`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i2-green.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i2-green.log`, 388 bytes, SHA256 `0a2651f0f6f77f43e8666ac220eb1a04fbacc20b04266adde3e79fc1e32e2dbf`.

Check `i3-red`: own exit 1; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i3-red.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i3-red.log`, 2467 bytes, SHA256 `d65808fdbd6173a572f060557e2b06a903cea9f4cfd86811c3534a2da92c568c`.

Check `i3-green`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i3-green.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i3-green.log`, 3460 bytes, SHA256 `2c7a055677c91932fc8876a04647c17c57c9cc8589fd2aefd61f11e6e0fb7b23`.

Check `i4-red`: own exit 1; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i4-red.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i4-red.log`, 3536 bytes, SHA256 `a90c38a0d8b2f6250ba6f354df8ff14c409c05c23e488e13bde2298737f70c3d`.

Check `i4-green`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i4-green.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i4-green.log`, 382 bytes, SHA256 `3dc9d17e492caa8442d21a1d1be8d09ce8651e9e2b5477f1bfcd6b85e2405e67`.

I3 root cause: nonexistent filter accepted alongside other Vitest filters and only aggregate result checking. Table now uses integration physics evidence and preserves generic cloud test in r2b-regression. R2b-only result callback checks exact normalized paths/common cwd, membership, duplicates and failed/skipped per-file outcomes after existing hash/summary validation. New public directory negatives reseal bytes/counters/inventory and assert upstream integrity succeeded. Existing qualification tests remain compatible (54/54).

I4 root cause: required wall window was incorrectly gated on accumulated draw-bearing RAF slices. Changed duration to active full-world wall time; separate rendered-event/source progression, gap and actual draw-call/activity correlation predicates. Actual draw cadence remains <=33ms, worker <=15ms, pause receipt <=500ms. Coherent 20ms draws/10ms RAF now valid; short/frozen/missing/gap negatives fail. Old 981/d4 run and checker results untouched. Producer sample timestamps now use performance.now at actual collection instead of RAF scheduled timestamp, so draw-event intervals correlate without timestamp inversion. 32/32 targeted reader checks pass.

I1 investigation: world runner lacks priority control API implemented by navigation2d runner, blocking gateway priority reservation path for shared cell; Lab waits for whole five-tick batch before Pause. World GET waits action queue; subsequent Lab get may have advanced again, causing repeated horizon mismatch. Proposed paired committed publication, received-only interpolation, same boundary-control semantics, 100-tick HTTP batches (unchanged tick/durability). Architecture disposition requested from root before implementation.

I1 first source RED attempt was INVALID_ACTION setup: existing paced batch maximum is 50; test incorrectly used 100 and waited on unreachable barrier. Explicit TERM sent only to owned pnpm24177/vitest24178, session collected separately. Corrected fixture/batching proposal to 50; root approved bounded publication/priority design with partial-prefix and non-step publication requirements. Initial development checks record HEAD/status/log but lack contemporaneous dirty-file hashes; not reconstructed. Future checks record before/after changed-file byte identities; final checks bind exact commits.

Check `i1-source-red`: own exit -15; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i1-source-red.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i1-source-red.log`, 88 bytes, SHA256 `0f673f9f4c98d1f5d4aed11ab04a7e918de174e5c2a030d058b309dcc2e66062`.

Check `i1-source-red-valid`: own exit 1; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i1-source-red-valid.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i1-source-red-valid.log`, 3893 bytes, SHA256 `933fd05dba36a9f10e5945d28a52b8018fac857ba1052dffa461b4e33e64b8d5`.

Check `i1-source-green`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i1-source-green.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i1-source-green.log`, 611 bytes, SHA256 `7bc0e9c937ae1439094e92840e6fa12788255cfe796118cf5e8b2f4d6c961928`.

Check `i1-lab-red`: own exit 1; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i1-lab-red.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i1-lab-red.log`, 1461 bytes, SHA256 `783af42e4c7fab11a8a92e17a93e7f18f113ed1a9d367e1293b360c6e230a596`.

Check `i1-buffer-red`: own exit 1; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i1-buffer-red.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i1-buffer-red.log`, 1623 bytes, SHA256 `979ad6baf592195f61316a35f6e3325b5b7268bbceaa1633c0aa81cbcae6e2fb`.

Check `i1-lab-green`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i1-lab-green.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i1-lab-green.log`, 255 bytes, SHA256 `8f5064bec6fa6d923aeffe0f0480552216bcf735412084eb97b16a0d6c569350`.

Check `i1-prefix-red`: own exit 1; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i1-prefix-red.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i1-prefix-red.log`, 2835 bytes, SHA256 `a7db0aa0e4aa40c33cacbf5eb618c309f711b79212d4095170e49af4836712ee`.

Check `i2-writable-red`: own exit 1; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i2-writable-red.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i2-writable-red.log`, 1763 bytes, SHA256 `c00f2bbcad3f5836151051f0fb9d40d8a3d7f374650d19c82814bed56caa081b`.

Check `i2-prefix-green`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i2-prefix-green.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i2-prefix-green.log`, 451 bytes, SHA256 `686fa986a1148ffed1b9ce24545dbf62064aa6737fac437fd35c6056b87e9380`.

Check `lab-typecheck-dev`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-typecheck-dev.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-typecheck-dev.log`, 122 bytes, SHA256 `b78fdb43e4fadead7db30a196fdaa214d80de2ea9a3bf53245a231b6ba98d881`.

Check `source-typecheck-dev`: own exit 2; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-typecheck-dev.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-typecheck-dev.log`, 878 bytes, SHA256 `4bf0839422fb358ad0f4ae7141a0647abe987eb5c68810f59c2979b3a465aa9b`.

Check `source-final-contracts`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-final-contracts.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-final-contracts.log`, 192 bytes, SHA256 `b01efc8275af27aef1593ccbccacf369a068c21bf75222530690ef4d51d5633c`.

Check `source-final-typecheck`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-final-typecheck.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-final-typecheck.log`, 232 bytes, SHA256 `a38cf93675b24c7612ead396f6cdc68f544441355db12bccc212ffe3f6e07db5`.

Check `lab-final-unit`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-final-unit.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-final-unit.log`, 289 bytes, SHA256 `e58df86b1ef65dccc984734b14de42595b4b30d710bcb081af7ab70031a4f9ab`.

Check `source-final-lint`: own exit 1; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-final-lint.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-final-lint.log`, 407131 bytes, SHA256 `395b3df6f9e1094a2655e10bd4d5f2e8a00ee5323c68820971f74cf078ae61d8`.

Check `source-final-affected`: own exit 1; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-final-affected.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-final-affected.log`, 9243 bytes, SHA256 `52fe65154df62911372accfe9be159cf5af640d8375a1ac4c3286c922cfe902f`.

Check `i4-frozen-window-red`: own exit 1; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i4-frozen-window-red.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i4-frozen-window-red.log`, 3228 bytes, SHA256 `ab7863e0395e58f1efec87283260e1d444df6f482883acd273d18b1d3f17a3bb`.

Check `i4-progress-green`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i4-progress-green.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/i4-progress-green.log`, 496 bytes, SHA256 `8b1400d83439dcc26d27f901457b70f887fcc0e63c69d5227c4844fbce02d95a`.

Check `source-final-lint-authored`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-final-lint-authored.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-final-lint-authored.log`, 0 bytes, SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

Check `prepare-retained`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/prepare-retained.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/prepare-retained.log`, 237 bytes, SHA256 `904a79a0ecf3a7fa1a01e5445ee52b8224ab70841155c83be504534c1b58aa2a`.

Check `source-build`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-build.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-build.log`, 7359 bytes, SHA256 `bbe7ff7b99d622ff8fef4626f001d9b6cadc6e4e103d2f30c447e831b4b64162`.

Check `source-final-replay`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-final-replay.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-final-replay.log`, 2049 bytes, SHA256 `b7ecfed5c8c304414b8eb3724bc7208ae457ebb8e6917db3ee6a212e9ffbcd16`.

Check `lab-final-affected`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-final-affected.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-final-affected.log`, 255 bytes, SHA256 `c7ae0b2936e8625c44f72132e3fc35002a45fafcdab0effa0b88e89ea83e049c`.

Check `lab-final-typecheck`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-final-typecheck.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-final-typecheck.log`, 122 bytes, SHA256 `b78fdb43e4fadead7db30a196fdaa214d80de2ea9a3bf53245a231b6ba98d881`.

Check `source-export`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-export.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-export.log`, 103307 bytes, SHA256 `babf1a35b258624be8b6bf4d74732b9fedf4c6617a00d0f48e5095220a989d47`.

Check `lab-import`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-import.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-import.log`, 198 bytes, SHA256 `96d363cf7e1a989048d735483b895b209205c3f76b2f95669d432f3140f73c83`.

Check `lab-sync`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-sync.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-sync.log`, 220 bytes, SHA256 `84731b62ae9a5141c2b86ed05a6c5786c87be631f44b35181ea6b2e089481837`.

Check `lab-pin`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-pin.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-pin.log`, 295 bytes, SHA256 `925fa49ce47faea09494371c75f14ac5721debf7c7b2975438f0439fb16d3bec`.

Check `lab-build`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-build.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-build.log`, 1605 bytes, SHA256 `6e6e0272d1399abc7ed8312ef53bd880aba2a1d9dfcdf02ce7f4e2f405920e49`.

Final-byte development verification: original Source affected run had 215 passed/2 failed/1 skipped and an import failure due solely to RETAINED_INPUTS_NOT_CONFIGURED. Preparing the exact public three-entry manifest (SHA30351aae...) into a new owned directory enabled all31 replay/golden tests across5 actual files to pass; originals never opened as writable engines. Source build passes. Original pnpm lint retains2336 metadata errors/28warnings under .superpowers; authored-tree ESLint with explicit .superpowers/** ignore passes (no historical metadata edits). Lab full suite610passed/1skipped, then30 affected pause/buffer tests after final UI edits and typecheck pass. The affected invocation included a nonexistent twin3d.test.ts selector: it executed exactly the2 existing requested files,30 tests; no renderer-file coverage is claimed. This is not the closed I3 qualification row.

Source committed89e2fd68178647bcafa484f4dfdfcb37b801fc14 (tree88ff069b8d84e5e97146bbd16e3132524646b728), real exporter/import/sync/check:source passed. Lab committed96e7aca (full identity follows build). No generated contract bytes changed. Late UI priority tests cover409 fallback with new identity/revision and unknown network failure without retry. Paired publication runs inside the mutation queue after original evidence append/commit/drain, and refreshes non-step/reclaim/unknown boundaries. Physics20ms and durable checkpoint writes unchanged. Physical payload campaign is running at clean new Source, retaining all raw output in owned payload-campaign directory; no timing capture concurrent.

Check `production-replay-browser`: own exit 1; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/production-replay-browser.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/production-replay-browser.log`, 753 bytes, SHA256 `5ee3523e58488a72c069751de87f04693250eb3bdb2b3f75c3f614d6f5fc648e`.

Correction to preceding generated-byte statement: both generated shared contract header provenance lines changed to89e2fd6 and were omitted from the initial Lab staging list. The production tuple check correctly refused96e7aca with these two dirty generated headers before launching preview/browser. Original failed receipt retained; no metrics or screenshots were produced. Added those normal sync outputs in a separate follow-up commit (no amend), and rebuild required at the settled tuple. No generated content was patched manually.

Check `lab-build-settled`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-build-settled.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-build-settled.log`, 1605 bytes, SHA256 `765f0545d5efa741341044ad50d521ffde73206da2656da05badde9cea7022c8`.

Check `production-replay-settled`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/production-replay-settled.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/production-replay-settled.log`, 701 bytes, SHA256 `40337a2e4912049506eb210a9cde51c7ea8a00cfcc8468c44485c4f77657d337`.

Check `final-identity`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/final-identity.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/final-identity.log`, 1586 bytes, SHA256 `d4bb009d5f3fc7b0feec8e0010bb8d87d7068bd0bc858b0a80e7fe0d7ca2c4f2`.

Check `subject-identity-check`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/subject-identity-check.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/subject-identity-check.log`, 1586 bytes, SHA256 `d4bb009d5f3fc7b0feec8e0010bb8d87d7068bd0bc858b0a80e7fe0d7ca2c4f2`.

Check `source-settled-guards`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-settled-guards.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-settled-guards.log`, 3843 bytes, SHA256 `8befb397460e1e70d2d9f35339e9fced422408fed9fe6d8469455329fb35952f`.

Exact-commit guard run at Source89e2fd6:149 passed across8 actual files, including world runner30, reclaim18, writer9, authority10, clock24, coherent membership4 and older policy54. The optional r2b-browser-evidence.test.ts filter in that argv does not exist and contributed no coverage; earlier actual r2b-browser-readback tests remain in i4-progress-green34. Only8 executed files are claimed. Production replay/story completed5/5 with0skips/failures and clean unchanged build identity, includingVI/JA/EN ×390/1024/1440, no serious/critical axe violations, keyboard/reduced-motion/2D, offline import and terminal freeze. Inspected actual world-VI-390.png, world-JA-1024.png, world-EN-1440.png and world-reduced-2d-keyboard.png: responsive scene/panel, clear read-only/not-calibrated status, locale text and terminal issues visible; 2D labels overlap near coffee pickup as inherited, not changed or closed as new layout work. This is static fixture proof, not live-route or arbitrary-device proof.

Subject identity file is subject-identity.json (full200-file production inventory). First final-identity.json output used the runner receipt's same name and was overwritten by that receipt; its compact identity remained in the log. New noncolliding read-only identity capture preserves the complete inventory. No historical evidence was touched.

Check `production-closed-browser`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/production-closed-browser.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/production-closed-browser.log`, 411 bytes, SHA256 `687f44a8511c1ba74b588b9d95fd885b09da2c688aa2326ddb622e22ab446cb0`.

Frozen identity (before timed capture):

```json
{
  "source": {
    "head": "89e2fd68178647bcafa484f4dfdfcb37b801fc14",
    "tree": "88ff069b8d84e5e97146bbd16e3132524646b728",
    "status": ""
  },
  "lab": {
    "head": "a1558f7075cb1ef2fd86692e451220065423f2e6",
    "tree": "7e45249b39974e83d8c544124de9d6feddbbc1f4",
    "status": ""
  },
  "lock": {
    "dirty": false,
    "packageVersion": "0.1.0",
    "toolchain": {
      "node": "v24.22.2"
    },
    "sourceCommit": "89e2fd68178647bcafa484f4dfdfcb37b801fc14",
    "schemaHash": "0d4ae124258123d27a21b67a8441dee13d703fd5ab7596ad298bcab9233a31e5",
    "protocolMajor": 2,
    "protocolMajors": [
      1,
      2
    ],
    "nodeMajor": 24,
    "artifactSha256": "3e16de4a7e458b090d216cd47c7b00131c570ed1e04a7a65ecbf5ebd0432ea7a",
    "entrypoint": "runtime.mjs",
    "portableToolsDigest": "30dc0de3e034b14593ae3629a1f247724392d950578913cacc1dd2e9ca9bc69b"
  },
  "closures": {
    "portable": "30dc0de3e034b14593ae3629a1f247724392d950578913cacc1dd2e9ca9bc69b",
    "native": "79018e0a2601d8a27d3739751910bb392c86c2857cc39ad5fb451a977de78634"
  },
  "checker": {
    "scripts/browser-capture-clock.mjs": {
      "bytes": 9523,
      "sha256": "a895124f8a49959dc2b4ada39795a6af6b9be0439944a88bc91d4cf6162bf428"
    },
    "scripts/sim-extension-r2b.mjs": {
      "bytes": 7239,
      "sha256": "cd570b4bf4574c3b61bf5f82c643cf38058da3b4895a43e9cae7debbdd18b702"
    },
    "scripts/r2b-readback.mjs": {
      "bytes": 8301,
      "sha256": "c9e7b1c2c19c5322d4fdb7f78227a552062045afecbd0f660f8712f44ea7205d"
    },
    "scripts/irsim-qualification.mjs": {
      "bytes": 18820,
      "sha256": "5557be51feb18490e850ed439b959a0eb2a817d0be870f4cbcc9579db32a5dd0"
    }
  },
  "checkerSetSha256": "815a9405ca184cf8c317dd55b12eff71e7ad7537941226c0cf22c84f3f6306ce"
}
```

Production build SHA256`4af6e228e45f0e76f1606d5d6a368509fc4b583b77352260b43c1d2221da3573`,200files in subject-identity.json. Native closure is separately observed; the Lab pin has no nativeClosureHash. Reused local dependencies do not establish fresh-host install provenance.

## Consolidated implementation mapping (pending live measurement)

- I1 Source paths: scenario-runner.ts and world-display.ts expose one cloned immutable paired RunView/observation after durable ticks and controls, shared-world-only priority pause/cancel using existing execution-time authority callbacks, bounded attached control queue and correct curtailed step receipt. No change to20ms ticks, worker ACK admission, checkpoint fsync/evidence order or Source custody. World-specific held-tick/paired publication/replay/auth-denial/late-control/close/reclaim tests execute in world-runner; existing gateway ownership and world-authority tests remain. Lab world-playback.ts uses32samples/150ms display lag, received endpoints only,500ms expiry and identity/gap reset; workspace consumes paired context at40ms poll, batches50paced ticks (existing schema cap), submits pause against admitted in-flight revision, accepts only definite409 fallback and never retries unknown cell mutation. Twin3d installs scene+interpolated poses in one draw; no inferred custody. Retained same-H older geometry stays explicitly paired with its old context for existing500ms freshness window; interpolation clears on revision, unknown clears world entirely. Unit checks cover causal pair vs independent laterGET, immediate priority pause, late/unknown, and buffer bounds. Initial invalid100 setup attempt stays failed and separate from valid50semantic RED.
- I2 gateway.ts revalidates exact session identity/expiry after every reclaim await. Rejected cold handles close; entry owner/readers remain. Completed hold sets existing readOnly safety state; persisted epoch advances monotonically before rejection (root's explicit consistency ruling), so old owner can reconcile but never resume/move.18 deterministic boundary expiry/revoke cases and the existing writable-owner HTTP regression passed.
- I3 sim-extension-r2b.mjs corrects physical selector and keeps cloud payload in requiredr2b-regression; record-sim-extension-r2b.mjs preflights real selectors. Opt-in callback in shared qualification core checks every actual normalized Vitest file identity and outcome. Tests reseal public-reader evidence and first establish integrity gates succeeded, then prove missing/substituted/duplicate/failed/skipped refusal. Older R1/R1.1/R2a policy checks pass. Full qualification remains unavailable; exact physical row result follows.
- I4 browser-capture-clock.mjs gates active full-world wall duration independent of draw-bearing RAF slices. Real draw intervalp95, workerp95, final-step receipt bound and500ms source/draw gaps remain independent unchanged gates. Strict stream coherence checks sample/event drawcalls, monotonic horizon and continuously advancing horizon, and final paused actual-prefix proof with exact worker coverage. Production observer records expectedRevision; recorder correlates actualGL drawcalls/collection timestamps and captures route cameras while full active window runs. Historical981/d4 remains failed under its original identity (300.2ms draw/2797.283ms pause); no retroactive pass.

Same-build closed production entry passed1test/27.7s through normal exported runtime, including start tick0, selected1×, real paired world, pause/resume, explicit newrun, report replay unavailable state and offline realH7 export. Cleanup.json completedtrue, observer end complete. Inspected live-VI-390.png, live-JA-1024.png, live-EN-1440.png and report-replay-fetched-cursor0-unavailable.png: live controls/status/locales visible; report-only replay has empty world plus explicit exact-world-unavailable message, not stale live geometry. Existing report long identifiers are clipped in panel; this is not expanded into inherited layout cleanup.

## Retained limitations and deferred findings

M1 negative-zero native normalization, M2 PUMA oversized traces, M3 untouched native/world negative-fixture precision and M4 inherited malformed JUnit are all deferred nonblocking exactly under final-review-controller-dispositions.md; no native/oracle/recorder cleanup added. Touched I3 negatives are coherent semantic checks, not a claim to fixM3. Own Vitest/Playwright JSON and process receipts, not inherited malformedXML, support these results.

Cannot-verify1: no owned-service fullCI, completeR2a/R2b, Docker image/container or assignedHTTPS evidence; broad cross-release recording remains a post-scoped-review dependency. Cannot-verify2: all6R3 profiles prepared only, including absent arm64 adapter/native command-TF-UUID correlation/xArm restart-planning-G2/PUMA clocks-cartesian-terminal trust/DEP-SEC; software tests do not close these. Cannot-verify3: hardware selection, calibration, installed-host trust and human acceptance unresolved; no motion/signature. Cannot-verify4: new actual production timing/route proof follows; static screenshots do not prove arbitrary browsers/devices, old narrow-table visual, forced recorder boot/escalation, old pendingURL or stripe cause. Cannot-verify5: old extracted timeout remains distinct failed assertion and has not been retconned by equal pass counts. Cannot-verify6: old archive/Git/readback/clone audits authenticate only their original tuples; fresh-host installation/all-host provenance and4private original exclusions/opaque descriptors remain; no SDD cleanup. Cannot-verify7: GTM draft hypotheses remain unvalidated; no outreach/spend/analytics/deploy/acceptance. No service/container was provisioned or borrowed; no merge/push/deploy/native/hardware performed.

Execution overlap disclosure: payload campaign ran continuously from its recorded start; both strict replay/story(no liveworker) and closed-production-browser(realworker) ran while payload was active. No pause/serialization was used. These are functional assertion/identity results, not performance observations. The timed185000ms capture will have no parallel campaign/browser/build/hash work. Root asked for clarification; no rerun/cancellation to conceal overlap. Browser intervals: {"production-replay-settled": {"start": "2026-11-16T10:14:35.919655", "end": "2026-11-16T10:14:55.201778", "exit": 0}, "production-closed-browser": {"start": "2026-11-16T10:15:53.720838", "end": "2026-11-16T10:16:25.609267", "exit": 0}}.

Check `payload-campaign`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/payload-campaign.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/payload-campaign.log`, 380 bytes, SHA256 `8905a586d3873a62782fc84653b1f9aba8e928ca05e788aec1d2f9da8481f1c7`.

Check `mj-evidence`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/mj-evidence.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/mj-evidence.log`, 126 bytes, SHA256 `9c5a99dbe326382449fb9936e71aadeb742753cf2e9f5473115ff5b3af9946b3`.

Check `mj-row-readback`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/mj-row-readback.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/mj-row-readback.log`, 332 bytes, SHA256 `24ebe8f02821de06aa65d5235d7613079e2392bc2fc63002480c1d64082f9e42`.

Check `production-capture`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/production-capture.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/production-capture.log`, 5956 bytes, SHA256 `73d378214816b8fa646aa9e1e9c22a15ebe40a65ec1655d9f2fe3b864dd878d9`.

Check `capture-readback`: own exit 1; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/capture-readback.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/capture-readback.log`, 390 bytes, SHA256 `92c33c40ff30df00009fd7003fddfc744a82b24507e2553911195a59ac8ba786`.

Check `cadence-red`: own exit 1; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/cadence-red.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/cadence-red.log`, 1373 bytes, SHA256 `ba04c84849c9c9d631475fcdc431105a6c2f90405f666075a4a1587d1e361d2a`.

Check `cadence-green`: own exit 1; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/cadence-green.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/cadence-green.log`, 876 bytes, SHA256 `38a07e69591f09ae990f0f1d55bf6ceb45ceadb7ce139b6f0e35aee543d32842`.

First changed-subject capture89e2fd6/a1558f7: producerexit0, correctedreaderexit1. Raw identity{"actual-cell-production.json": {"bytes": 22634077, "sha256": "987d1c27c90c9c08aca9fcdf18378950f743d6f0f09a92aed3f986d83d796b34"}, "assessment.json": {"bytes": 475, "sha256": "b69258b70a0b755b1d58291b7f577fed0101495165cf8f62b6a17cd815206116"}}. Actual drawp95=51.4ms (FAIL),workerp95=4.756416ms,laststepreceipt62.784912ms,UI87.747803ms,active184976ms,achieved0.5850776×. Reader issues CAPTURE_RENDER_STREAM, CAPTURE_STREAM_GAP, CAPTURE_RENDER_PROGRESSION, CAPTURE_DRAW_ACTIVITY_CORRELATION. All old/newfailed raw bytes retained.

Diagnosis:1004of1093draw gaps>33ms do not crossrevision;756sameH. Only1087published viewer horizons for5414activeworker ticks. refreshWorld updated the model/buffer but paced paint→liveRender preserved canvas without updating viewer context; only5tick telemetry cadence updatedlf. This is fixed by immediatepaired3D update. Independent deterministic alternating1/2tick per40ms polling RED proves last-pair rate estimator stalls continuously movingpath(4==4); changed onlyWorldPlayback to150ms received-wall timeline interpolation, cap32/gap500/sim-hole1s retained. GenericSampleBuffer unchanged. Both meaningfulRED failures are retained and GREEN result follows. Two largest526.6/593.2ms draw gaps around132s coincide with435/467ms actualworker gaps and viewer telemetrylag, not a demonstrated durabilitypolicy defect; no persistence change. Root decision pending for quantized clockties: actual0ms renderintervals and4GLallocation mismatches at exactequal sampledtime require count ordering proof, never fabricated timestamps or relaxedlatency/gaplimits.

Check `paired-canvas-red`: own exit 1; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/paired-canvas-red.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/paired-canvas-red.log`, 878 bytes, SHA256 `1b705b340e904868e07802880b5914dbdb5ab2283b7e7910a53928572e86fbde`.

Check `cadence-green-corrected`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/cadence-green-corrected.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/cadence-green-corrected.log`, 255 bytes, SHA256 `07a5a4ae7b034a5b856c8736df0ccc004dcd55dae1b5262ffdecff2f6c3c9583`.

Check `ordered-clock-red`: own exit 1; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/ordered-clock-red.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/ordered-clock-red.log`, 4148 bytes, SHA256 `4168edad58d2ca1acb8280d3f2c01e9dc9995bb1f36abee8fe338f5ab9bdbe3b`.

Check `ordered-clock-green`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/ordered-clock-green.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/ordered-clock-green.log`, 496 bytes, SHA256 `b01caed225b93696d36c205e8f9ed37a4ce0548c728f4a157de47a459da57b07`.

Check `lab-cadence-final`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-cadence-final.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-cadence-final.log`, 255 bytes, SHA256 `c48217ecadb010f3ac668053fa0851d7664dfa725a74123212d2f1912465627f`.

Check `lab-ordered-typecheck`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-ordered-typecheck.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-ordered-typecheck.log`, 122 bytes, SHA256 `b78fdb43e4fadead7db30a196fdaa214d80de2ea9a3bf53245a231b6ba98d881`.

Check `ordered-final-tests`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/ordered-final-tests.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/ordered-final-tests.log`, 554 bytes, SHA256 `869b92c3b7382738d2d0be3e6dfde8fa808bcac6c4da15b4f9bd1c864c816168`.

Check `ordered-typecheck`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/ordered-typecheck.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/ordered-typecheck.log`, 232 bytes, SHA256 `a38cf93675b24c7612ead396f6cdc68f544441355db12bccc212ffe3f6e07db5`.

Check `ordered-lint`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/ordered-lint.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/ordered-lint.log`, 0 bytes, SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

Check `ordered-burst-final`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/ordered-burst-final.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/ordered-burst-final.log`, 342 bytes, SHA256 `60115c420ca0c42d9be7a93f31837a4b41f6984ad2476e21a809aa28c72da2c3`.

Check `lab-unit-ordered`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-unit-ordered.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-unit-ordered.log`, 289 bytes, SHA256 `cc7aabc3b6d7ee89543efa6d26c7f81e10595082a03bcd24f35487412d3b1ca0`.

Check `source-build-ordered`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-build-ordered.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-build-ordered.log`, 7357 bytes, SHA256 `01e60d91553d05df445577db383442016327778b1f431d3b62ee3c29fec4e163`.

Root's complete follow-up ruling read: final-correction-cadence-and-ordering-ruling.md6040B/SHA76b36b26ca97c7b20dfd90c215759796b3ccbd41c939f1e14c67d4551af69207. Root independently audited actual tied sample6057/6058 and239equal-time pairs; retain root-final-correction-quantized-boundary-observation.json3274B/SHAcd53537f9243a5b78533403cb04667bc777b862fce37e88b007da58eff3a6a02. Old capture has no samplecounter markers and is NOT retrofitted.

Initial cadence-red contained one valid buffer-jitter RED and one invalid canvas expectation because fixture was2D. Initial cadence-green stillfailed canvas for that setup reason. The fixture was explicitly set3D, pre-fix paired-canvas-red failed0calls, then restored fix passed31tests. Final dedicated buffer guards reject backward receipt/source admission without extendingfreshness; duplicate same-H observations do not trigger newpaired3Dpaint. New received-wall timeline passes48coveringworld/genericbuffer/workspace tests; genericbuffer bytes unchanged.

Ordered-capture semanticRED reproduces timestamp-tie callallocation refusal. Version1renderOrdering has capturestart/end renderer counters, eachsamplecursor, tailGLcalls; proof incomplete/malformed fails withoutfallback. Eventcounts consecutive/unique, cursors monotonic/inrange, wall/run/H constraints and per-allocationGLsums/tail/total mandatory. Equal timestamps form one cadencegroup in producer andreader; rawrendercounts remain. Negative tests cover missing/reordered/duplicate/count/calls/tail/gap/version/future/window corruption. A coherent600ms gap keeps counter/callintegrity valid but failsstreamgap. Burst test uses23150actualrender events within producerlimit but distinct200ms cadence, refuses performance despitezero-delta majority.51checks passedbefore narrowing burst fixture to recorderlimit, then exactchanged burst test retained separately. All targets andlegacystrict behavior unchanged.

Inspected first changed capture's three actual routePNGs: Overview shows wholefloor/table/cell atH233, Follow-AMR and explicit phase-follow show rack/arm/cup as delivery startsH2121/H2212. Selectionbuttons and measured~0.6× are visible. Their visual scope is tied to the failed89/a155capture; they do not establish performancepass or finalchangedbuild. Newcapturemust provide finalrouteproof.

Check `source-export-ordered`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-export-ordered.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/source-export-ordered.log`, 103315 bytes, SHA256 `811d958fc6c06b36014fa782333fd300868d199fde4bf90c0d02332f23e9bbc5`.

Check `lab-import-ordered`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-import-ordered.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-import-ordered.log`, 198 bytes, SHA256 `98a15d97e186de545b1f2202e4058d99b6dfa3fd7c1b7752a2587a8507fc83d4`.

Check `lab-sync-ordered`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-sync-ordered.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-sync-ordered.log`, 220 bytes, SHA256 `84731b62ae9a5141c2b86ed05a6c5786c87be631f44b35181ea6b2e089481837`.

Check `lab-pin-ordered`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-pin-ordered.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-pin-ordered.log`, 295 bytes, SHA256 `113ddf3f6450d3efa3e6b7c462cc1e4f38defe7d277295c0eebfb45485bd9cdb`.

Check `lab-build-ordered`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-build-ordered.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/lab-build-ordered.log`, 1605 bytes, SHA256 `e54f9ba25bb4a17d5c0f64dbd6b414f13b980e3584625d9cd65070fe1ee896ea`.

Check `subject-identity-ordered-check`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/subject-identity-ordered-check.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/subject-identity-ordered-check.log`, 1587 bytes, SHA256 `f159140def798c0626d4a616627e1de47b590ee668d7dfb4ec98d37f3d895d98`.

Check `production-capture-ordered`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/production-capture-ordered.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/production-capture-ordered.log`, 5950 bytes, SHA256 `56c8940b4ce5168f7b3c0a39a0fe35d5b5f1ae1c3d1cbdcd4195fa0953886193`.

Check `capture-ordered-readback`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/capture-ordered-readback.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/capture-ordered-readback.log`, 293 bytes, SHA256 `f875141a6e3e9934368f083a12d46338bbaa8769b6f2f1cbc547663db7dcb03c`.

## Settled final subject and successful actual production observation

{
  "source": {
    "head": "cb5c86cf9ee5db06cdacc38a2146f6f312b2c503",
    "tree": "b6796a8b53ffb3eec4e055011f0b2f81aa6877ee",
    "status": ""
  },
  "lab": {
    "head": "fded4b26638eb412f3285d5fe37d415108f58f19",
    "tree": "e62eff604b5685f5a57bfdc9b0e31794294200be",
    "status": ""
  },
  "lock": {
    "dirty": false,
    "packageVersion": "0.1.0",
    "toolchain": {
      "node": "v24.22.2"
    },
    "sourceCommit": "cb5c86cf9ee5db06cdacc38a2146f6f312b2c503",
    "schemaHash": "0d4ae124258123d27a21b67a8441dee13d703fd5ab7596ad298bcab9233a31e5",
    "protocolMajor": 2,
    "protocolMajors": [
      1,
      2
    ],
    "nodeMajor": 24,
    "artifactSha256": "edd67efcd4094a93d95c5368e3bfe1294f6578a016a0241580d3697e2c373b14",
    "entrypoint": "runtime.mjs",
    "portableToolsDigest": "30dc0de3e034b14593ae3629a1f247724392d950578913cacc1dd2e9ca9bc69b"
  },
  "closures": {
    "portable": "30dc0de3e034b14593ae3629a1f247724392d950578913cacc1dd2e9ca9bc69b",
    "native": "79018e0a2601d8a27d3739751910bb392c86c2857cc39ad5fb451a977de78634"
  },
  "checker": {
    "scripts/browser-capture-clock.mjs": {
      "bytes": 10803,
      "sha256": "bdc77a4d9f629d4a81dfd6d222a329d43a899d7697af47348f3ef4c1944aa0be"
    },
    "scripts/sim-extension-r2b.mjs": {
      "bytes": 7239,
      "sha256": "cd570b4bf4574c3b61bf5f82c643cf38058da3b4895a43e9cae7debbdd18b702"
    },
    "scripts/r2b-readback.mjs": {
      "bytes": 8301,
      "sha256": "c9e7b1c2c19c5322d4fdb7f78227a552062045afecbd0f660f8712f44ea7205d"
    },
    "scripts/irsim-qualification.mjs": {
      "bytes": 18820,
      "sha256": "5557be51feb18490e850ed439b959a0eb2a817d0be870f4cbcc9579db32a5dd0"
    }
  },
  "checkerSetSha256": "e90053d6d0dfdcb64475af48bff26d0cab0a69a50f2595cd48c77d4f4bf7feb4"
}

Build SHA256`c3824f5ae8670e47361124e9e1fb2377a9b6dc7b6402cdbbe409572aaf5db274`(200files); exact inventory subject-identity-ordered.json. Immutable previous89/a155fail remains as recorded; no amend/relabel.

Full normal exported-runtime rund8cc956b-1629-4f3b-86b7-6d457a0d6fae at5000warmup/185000requestedactive: {"valid": true, "meetsTargets": true, "metrics": {"renderIntervalP95Ms": 17.799999713897705, "workerP95Ms": 4.868333, "lastStepReceiptMs": 60.883544921875, "pauseAckUiMs": 61.522216796875, "activeCellMs": 184974.19999980927, "fullCellDrawingMs": 175509.69999456406, "fullCellDrawingFrames": 10515}, "issues": []}. Achieved rate0.4990200137730367× is separate from selected1×; this is smooth received-sample rendering and responsive pause, not demonstrated real-time physics throughput. Reader counts distinct browserclockgroups;20320rawrenders/19182intervals, noobservererrors, allmetricsvalid. Raw refs {"actual-cell-production.json": {"bytes": 28643348, "sha256": "1a27b144bd7281e4fd0ee697f97bd549083ae608f1b59edf745c8f73872f86a9"}, "assessment.json": {"bytes": 355, "sha256": "fd6725c8491b53b766f86a6c86c9b853a7fd064f1b07b5f270ec3bd472418119"}, "subject-identity-ordered.json": {"bytes": 43496, "sha256": "5b5702206979ea543c657d69cc2f39fb71b1f099f60bd908bfca31b39b4cfe78"}}.

Inspected finalroute-overview.png,route-follow-amr.png,route-phase-follow.png: fullfloor/table/cell atH177, explicitFollowAMR aroundH2127, explicitphasefollow atH2220 duringDeliveringcoffee. Both bodypositions/orientation and framingchange alongroute; no automaticcamera mode is invented. Screenshot visible measured~0.6× attheseinstants is distinct from whole-window0.499×. Fullviewport1440×900 and datasets/routecamera observations retained. Liveexportoverlap finalpausedH4804 remainsstable before/afterexport; finalcurtailed50tick request committed4actualticks from4800to4804 with all actualworkercoverage. Cleanup completedtrue and owned session collected. Newtuple browsers and fullphysical row are stillrunning/next, not yetclaimed.

Check `final-closed-browser`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/final-closed-browser.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/final-closed-browser.log`, 411 bytes, SHA256 `e66b9bd9d0840f68282912f4591652c355d948f0cf51f3969cddb69783318a14`.

Check `final-replay-browser`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/final-replay-browser.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/final-replay-browser.log`, 705 bytes, SHA256 `1e2ede2139c2819558c54eefae34b77b5793e05838b1cab965a2b1a5413572c1`.

Finalsame-build closedbrowser1test/43.6s and strictreplay/story5tests/0skips/0failures passed sequentially aftercapture; both own sessions collected and cleanupcomplete. Finalphysicalcampaign then started separately (no browser overlap). Inspected finalclosed liveVI390/JA1024/EN1440 and finalreplayEN390 screenshots, alongside finalroutePNGs. Usercontrols/currentpausedH22, locale layouts and explicitnotcalibrated state remain visible; automated9locale/layout matrix andaxe scopes passed. Existingidentifier panelclipping/2Dlabel overlap observations remain unexpanded, with no broad visual claim.

Self-review of full Source907087c..cb5c86c and Labbfde031..fded4b2:14Sourcefiles and11Labfiles limited toI1–I4 changes/generatedprovenance. Both ranges diff--check clean; both trackedtreesclean. No historical evidence/candidate/archive/statusfiles changed and no `.superpowers` cleanup performed. Complete binary-capable patches retained in metadata source-final-range.patch/lab-final-range.patch for root's scopedreview; all intermediatecommits and failures retained. Scope exclusions and cannotverify dispositions above remain open.

Check `final-payload-campaign`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/final-payload-campaign.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/final-payload-campaign.log`, 380 bytes, SHA256 `8905a586d3873a62782fc84653b1f9aba8e928ca05e788aec1d2f9da8481f1c7`.

Check `final-mj-evidence`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/final-mj-evidence.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/final-mj-evidence.log`, 132 bytes, SHA256 `431d04ca5e87547c52552f2dfd42a9000efe27179fca88203e954a64ee4e6859`.

Final payload campaign completed all 19 cases at Source cb5c86c with zero issues/missing artifacts. Worker-kill, ACK-loss and cup-fall were all detected with no false serving. This is real local MuJoCo simulation, not physical robot/native hardware evidence. The final evidence-row mutation/readback test is consuming this exact newly produced directory, not the earlier 89e2fd6 campaign. Actual selected-case manifest/trace/report/input/bundle/run artifacts and all fault receipts are retained.

Successful capture ordering detail: start renderer count 788, end 21108, exactly 20320 raw events; 49 trailing actual GL calls. The 10515 draw-pose samples contain 10251 distinct body-pose maps. This supports actual changing rendered geometry within the received-only interpolation contract; the new draw result was not obtained by repainting a frozen horizon. Final requested 50-tick step committed exactly 4 ticks, 4800→4804, correlated with the final priority pause and every actual worker tick. All old failed capture/checker outputs remain unchanged.

Check `final-mj-row-readback`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/final-mj-row-readback.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/final-mj-row-readback.log`, 332 bytes, SHA256 `7e6f72c3e074432916bb5b860997fa929704ff3a889cdc3dfe63a0a25a769e4d`.

Check `final-settled-identity-check`: own exit 0; complete receipt `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/final-settled-identity-check.json`; log `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/final-settled-identity-check.log`, 1587 bytes, SHA256 `f159140def798c0626d4a616627e1de47b590ee668d7dfb4ec98d37f3d895d98`.

## Final handoff — correction complete, scoped review pending

I1–I4 are implemented and the required correction evidence is complete. This is ready for the one scoped re-review; it is not full release qualification or human acceptance.

Final commits are Source `cb5c86cf9ee5db06cdacc38a2146f6f312b2c503` and Lab `fded4b26638eb412f3285d5fe37d415108f58f19`. Source intermediate `89e2fd6` and Lab intermediate `96e7aca`/`a1558f7` remain in history. No commits were amended. Final settled identities exactly equal the frozen pre-capture identity, including all 200 production build files. Both tracked worktrees are clean.

| Evidence | Actual result and scope |
| --- | --- |
| Source checks | Contract check passed; final applicable typecheck, authored-tree lint, build and covering checks passed. Original broad lint failure in ignored historical `.superpowers` metadata is retained. |
| Authority/runtime guards | 149 passed on the runtime implementation commit; later Source changes were limited to the ordered reader, its tests and prospective documentation. |
| Final reader coverage | 51 passed, then the changed burst fixture alone passed after narrowing it to the recorder's event limit. Filtered tests in that focused invocation are not additional passes. |
| Lab | Final full suite 614 passed, 1 skipped; typecheck, normal pin check and production build passed. |
| Final production capture | Reader `valid:true`, `meetsTargets:true`, no issues; active 184974.2 ms, draw p95 17.8 ms, worker p95 4.868333 ms, last-step receipt 60.883545 ms, pause UI 61.522217 ms. |
| Final browser/replay | Same-build closed live test 1 passed, strict replay/story 5 passed; VI/JA/EN and 390/1024/1440 scopes retained. |
| Final physical simulation | Fresh 19/19-case MuJoCo campaign, no issues/missing artifacts; corrected physical row 34 passed, 0 failed, 0 skipped, exact two-file membership readback passed. |

Achieved simulation throughput is **0.499020× at selected 1×**. Smooth display interpolation and responsive Pause do not establish real-time physics throughput. Native/Linux/container/HTTPS/full owned-service CI, hardware/calibration/physical acceptance, all four deferred Minors and the other named cannot-verify items remain at the explicit dispositions above. Historical failures, including old 981/d4 and first correction 89/a155, remain failures with their original bytes and checker attribution.

The final physical row's executed JSON is `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/final-mj-evidence-result.json` — 10673 bytes, SHA256 `a9857e8122c86988928f53220df06eec165d733ddc596a887b4072f90327c827`. Its exact-file assessment is `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/final-mj-row-assessment.json` — 426 bytes, SHA256 `91cb4740f357b2c8a903fe5cb663941410a28fa9d368ca751bf915169e90d380`. The fresh campaign is `final-payload-campaign/`; its case sidecars identify the final Source commit. All raw campaign, browser, draw/worker/action correlation, replay export and screenshot files are retained in the artifact index below.

Process settlement: all 19 final campaign worker PIDs are absent; no matching owned runtime/worker/browser/test process remains; ports 4175/4176 have no listener. Capture and closed-browser cleanup report `completed:true`; replay preview reports `listening:false` with its closure timestamp (a different schema, not a missing completed flag). All own exec sessions, including the final inventory session, have now been collected. No retained evidence directory was deleted, and no unrelated process or service was stopped.

Settlement record: `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/final-settlement.json` — 8693 bytes, SHA256 `6e5370add637ad518ca79a80bd6d8d692043a36224bc767fe49bf120baba9224`. It validates all 75 command-receipt log byte lengths and SHA256 values, retaining successful checks, semantic REDs, setup failures and diagnostics separately. Initial development receipts that lacked contemporaneous dirty-file hashes remain explicitly limited; no retrospective binding was invented.

Complete owned artifact inventory: `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/artifact-index.json` — 726024 bytes, SHA256 `fcde7b16de072f66ec6214664fa213940ecedba4800a2a519051780895eca12a`. It indexes 3512 files totaling 501064898 bytes (excluding the index itself). Metadata scripts, full fix-range patches, this append-only report, controller rulings and root's independent clock-boundary audit live under `D/final-correction-907-bfde/` or the named `D` paths and must also be retained by the controller. The output root is `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3`.

No helper/reviewer was spawned. No external service was provisioned or borrowed; no deploy, merge, push, hardware motion, acceptance signature, main/trial/web change or SDD cleanup occurred. Root retains the active overall task for the single scoped re-review and required final recording/retention.

Controller audit received at handoff: `D/root-final-correction-payload-row-audit.json`, 439203 bytes, SHA256 `bc5e4a06910cd10e2b9d010309e05d02e293886a77dccc8c56e95f77990829d0`, independently verified all 19 final cases, 1360 artifact references/111450055 bytes, exact final subject, physical row 34/34 and browser identity/result hashes. Retain it with the other controller audits. No further execution is pending from this implementer.
