// Test-only ownership: absolute bundle directories AND ancestry from this test process,
// never a host-wide executable/module selector. Keep detached worker groups and the
// identities of all descendants so reparented Webots/controllers still count as leaks.
import { execFileSync, type ChildProcess } from 'node:child_process';
import { channel } from 'node:diagnostics_channel';
import { resolve, sep } from 'node:path';
import type { ScenarioRun } from '../../packages/lab-runtime/src/v2/scenario-runner';

export interface ProcessRow { pid: number; ppid: number; pgid: number; started: string; command: string }
export function processTable(): ProcessRow[] {
  return execFileSync('ps', ['-wwaxo', 'pid=,ppid=,pgid=,stat=,lstart=,command='], { encoding: 'utf8' }).split('\n').flatMap(line => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.*)$/.exec(line);
    return m && !m[4]!.startsWith('Z') ? [{ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), started: m[5]!, command: m[6]! }] : [];
  });
}
const under = (path: string, directory: string) => path === directory || path.startsWith(directory + sep);
const identity = (p: ProcessRow) => `${p.pid}:${p.started}`;
// One test-only listener sees every local asynchronous spawn, including workers
// whose entire lifetime falls between process-table samples. Exact argv limits
// notification to registered bundle directories; this grants no signal authority.
interface SpawnObserver { onSpawn(child: ChildProcess): void; onError(): void }
const spawnObservers = new Set<WeakRef<SpawnObserver>>();
const observers = () => [...spawnObservers].flatMap(ref => { const observer = ref.deref(); if (observer) return [observer]; spawnObservers.delete(ref); return []; });
channel('child_process').subscribe(message => {
  if (!observers().length) return;
  try {
    const child = (message as { process: ChildProcess }).process;
    child.once('spawn', () => {
      for (const observer of observers()) { try { observer.onSpawn(child); } catch { observer.onError(); } }
    });
  } catch { for (const observer of observers()) observer.onError(); }
});
export class OwnedProcesses {
  private directories = new Set<string>();
  private known = new Map<string, { row: ProcessRow; bundle: string }>();
  private groups = new Map<number, { leader: string; bundle: string }>();
  private uncertainty: string | undefined;
  private births = new Map<ChildProcess, { bundle: string; captured: boolean }>();
  // The diagnostics event is experimental: this helper intentionally supports the
  // repository's exact Node pin, and the generic lifetime tests prove delivery.
  private readonly spawnObserver: SpawnObserver = { onSpawn: child => this.observeSpawn(child), onError: () => { this.uncertainty ??= 'spawn lifecycle callback failed'; } };
  constructor(private readonly snapshot = processTable) {
    if (process.versions.node !== '24.22.2') throw new Error('OWNED_PROCESS_OBSERVATION_UNSUPPORTED_NODE');
    spawnObservers.add(new WeakRef(this.spawnObserver));
  }
  private observeSpawn(child: ChildProcess) {
    const index = child.spawnargs.indexOf('--bundle-root'), bundle = child.spawnargs[index + 1];
    if (index < 0 || !bundle || ![...this.directories].some(d => under(bundle, d))) return;
    const birth = { bundle, captured: false }; this.births.set(child, birth);
    const sample = () => { try { this.capture(); } catch { this.uncertainty ??= `spawn observation failed: ${child.pid}`; } };
    sample();
    child.once('exit', () => {
      sample();
      if (!birth.captured) this.uncertainty ??= `root exited without a PID/start sample: ${child.pid}`;
      this.births.delete(child);
    });
  }
  private assertCertain() {
    const pending = [...this.births.keys()].find(child => !this.births.get(child)!.captured);
    const reason = this.uncertainty ?? (pending ? `root has no PID/start sample: ${pending.pid}` : undefined);
    if (reason) throw new Error(`OWNED_PROCESS_OBSERVATION_UNCERTAIN: ${reason}`);
  }
  addDirectory(directory: string) { this.directories.add(resolve(directory)); }
  capture(): ProcessRow[] {
    const rows = this.snapshot(), byPid = new Map(rows.map(p => [p.pid, p]));
    const owned = new Map<number, { row: ProcessRow; bundle: string }>();
    const descendant = (p: ProcessRow) => {
      const seen = new Set<number>();
      while (!seen.has(p.pid)) { seen.add(p.pid); if (p.ppid === process.pid) return true; const parent = byPid.get(p.ppid); if (!parent) break; p = parent; }
      return false;
    };
    for (const p of rows) {
      const old = this.known.get(identity(p)); if (old) owned.set(p.pid, { row: p, bundle: old.bundle });
      const bundle = /(?:^| )--bundle-root (.+?)(?= --[a-z-]+(?: |$)|$)/.exec(p.command)?.[1];
      if (bundle && [...this.directories].some(d => under(bundle, d)) && descendant(p)) {
        // Lifecycle events cover roots created in this Node process only. An
        // external creator cannot be certified by some other sampled root.
        if (p.ppid !== process.pid) this.uncertainty ??= `root created outside observed Node process: ${p.pid}`;
        owned.set(p.pid, { row: p, bundle });
        if (p.pgid === p.pid) this.groups.set(p.pgid, { leader: identity(p), bundle });
      }
    }
    for (const [pgid, group] of this.groups) {
      const leader = byPid.get(pgid);
      // Reuse proves this is a different group. Otherwise a newly seen orphan
      // without a known survivor is uncertain cleanup, never signal authority.
      if (leader && identity(leader) !== group.leader) { this.groups.delete(pgid); continue; }
      if (![...owned.values()].some(p => p.row.pgid === pgid)) {
        if (rows.some(p => p.pgid === pgid)) this.uncertainty ??= `unobserved orphan in remembered group: ${pgid}`;
        else this.groups.delete(pgid);
        continue;
      }
      for (const p of rows) if (p.pgid === pgid) owned.set(p.pid, { row: p, bundle: group.bundle });
    }
    let changed = true;
    while (changed) { changed = false; for (const p of rows) { const parent = owned.get(p.ppid); if (parent && !owned.has(p.pid)) { owned.set(p.pid, { row: p, bundle: parent.bundle }); changed = true; } } }
    this.known = new Map([...owned.values()].map(p => [identity(p.row), p]));
    for (const [child, birth] of this.births) if ([...owned.values()].some(p => p.row.pid === child.pid && p.bundle === birth.bundle)) birth.captured = true;
    return [...owned.values()].map(p => p.row).sort((a, b) => a.pid - b.pid);
  }
  processes() { const rows = this.capture(); this.assertCertain(); return rows; }
  /** Sampling supplements spawn lifecycle observation; missing root identities
   * or uncertain orphan ownership fail verification instead of certifying cleanup. */
  async observe<T>(operation: () => Promise<T>): Promise<T> {
    this.capture(); let samplingError: unknown;
    const timer = setInterval(() => { try { this.capture(); } catch (e) { samplingError ??= e; } }, 50); timer.unref();
    let result: T;
    try { result = await operation(); }
    finally { clearInterval(timer); this.capture(); }
    if (samplingError) throw samplingError;
    this.assertCertain();
    return result;
  }
  kill(directory: string, command: RegExp, signal: NodeJS.Signals = 'SIGKILL'): ProcessRow[] {
    this.capture(); const target = resolve(directory);
    const candidates = [...this.known.values()].filter(p => under(p.bundle, target) && command.test(p.row.command));
    const killed: ProcessRow[] = [];
    for (const { row } of candidates) {
      // Revalidate the captured PID identity immediately before signalling; never
      // turn a stale observation into a kill of a newly allocated process.
      const current = this.snapshot().find(p => p.pid === row.pid);
      if (!current || identity(current) !== identity(row) || current.command !== row.command) continue;
      console.log('owned process fault', JSON.stringify({ directory: target, pid: current.pid, ppid: current.ppid, pgid: current.pgid, started: current.started, runId: /(?:^| )--run-id (\S+)/.exec(current.command)?.[1], signal }));
      try { process.kill(row.pid, signal); killed.push(current); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e; }
    }
    return killed;
  }
  /** Capture a healthy run's complete tree before close or an injected worker loss.
   * Detached workers inherit their group to Webots and controllers (engine.py uses
   * Popen without start_new_session); capture also follows PPIDs for other children. */
  observeRun(run: ScenarioRun): ScenarioRun {
    const start = run.start.bind(run), action = run.action.bind(run), close = run.close.bind(run);
    run.start = () => this.observe(start);
    run.action = async (...args) => { try { return await action(...args); } finally { this.capture(); } };
    run.close = async () => { this.capture(); try { return await close(); } finally { this.capture(); } };
    return run;
  }
}
