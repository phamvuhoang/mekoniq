### Finding verdicts

1. **Confirmed prefix after a failed append — UNADDRESSED for a failed chunk flush.** The duplicate-gap case is fixed at `packages/lab-runtime/src/v2/control/bench-runner.ts:205` and covered by `tests/integration/mujoco-bench.test.ts:148`. When the failed append tries to flush several buffered ticks, line 199 records only the current tick. Line 232 then rejects that gap because it begins beyond the next durable tick. One focused recorder experiment used a 5,200-byte quota and ten-tick chunks, flushed tick 0, buffered ticks 1–9, and hit the quota during tick 10. After the normal gap/finish sequence, the persisted manifest contained one verified chunk ending at tick 0, the original terminal reason TRACE_QUOTA_EXCEEDED, and one gap [10,10]. Reading through the last confirmed tick 9 returned TRACE_MANIFEST_INVALID and zero valid samples. Preserve the verified chunk and represent the missing buffered ticks as unavailable. For this reproduction the missing buffered range is [1,10]. A read through tick 9 should return ten verified samples for tick 0, 90 null samples for ticks 1–9 and explicit terminal/gap/tail issues. Reading through tick 10 should additionally return ten null samples for tick 10. The original terminal reason should survive. Include this failure mode alongside the malformed-ACK case.
2. **Actual chunk read size — ADDRESSED.** `packages/lab-runtime/src/v2/control/bench-runner.ts:239` passes the entry's validated byte count into the bounded file reader and then checks exact length and hash. `tests/integration/mujoco-bench.test.ts:79` checks that a file larger than the declaration is refused and the adjacent chunk remains readable.
3. **Single-provider envelope validation — ADDRESSED.** `packages/lab-runtime/src/v2/control/bench-runner.ts:41` derives every represented axis and mode from the bench registry and line 56 uses that complete list. `packages/lab-runtime/src/v2/control/drive-io.ts:80` rejects an unregistered axis. `tests/integration/mujoco-bench.test.ts:339` exercises arm-only and wheel-only hosts with correct and incompatible sealed envelopes.

### New breakage in the fix diff

None identified. Finding 1 is residual behavior under the original confirmed-prefix requirement.

### Out-of-scope observations

None.

### Verdict

**Quality gate — Needs fixes.** Two findings are addressed. The confirmed-prefix finding remains open on chunk-flush failure. Reviewed the implementer's reported RED/GREEN selections. Ran one isolated recorder experiment and no suites.

### Isolated reproduction

Run from the source checkout with Node 24.22.2 using pnpm exec tsx. The experiment writes its trace under the host temporary directory.

```ts
import { openBenchTrace, readBenchTrace } from './packages/lab-runtime/src/v2/control/bench-runner.ts';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'r4-quota-prefix-'));
const identity = {runId: 'r', axisIds: ['xarm-1/J3'], plantModelDigest: 'a'.repeat(64),
  driveModelDigest: 'b'.repeat(64), controlProfileDigest: 'c'.repeat(64)};
const rec = await openBenchTrace(dir, identity, { maxBytes: 5200, chunkTicks: 10 });
const row = (tick: number) => [{ axisId: identity.axisIds[0], dtS: 0.002,
  samples: Array.from({ length: 10 }, (_, j) => {
    const i = tick * 10 + j;
    return { target: Math.cos(i), actual: Math.sin(i), torqueNm: Math.sqrt(i), feedback: null, saturated: false };
  })
}];
await rec.append(0, row(0));
await rec.flush();
let confirmed = 0;
try {
  for (let tick = 1; tick < 80; tick++) {
    await rec.append(tick, row(tick));
    confirmed = tick;
  }
} catch {
  await rec.gap(confirmed + 1, confirmed + 1, 'STEP_ACK_LOST');
  await rec.finish('TRACE_QUOTA_EXCEEDED').catch(() => {});
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  const read = await readBenchTrace(dir, identity, confirmed);
  console.log(confirmed, manifest.coverage, manifest.gaps, read.issues, read.traces[0].samples.filter(Boolean).length);
}
```
