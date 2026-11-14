// Test-only ownership: absolute bundle directories AND ancestry from this test process,
// never a host-wide executable/module selector. Keep detached worker groups and the
// identities of all descendants so reparented Webots/controllers still count as leaks.
import { execFileSync } from 'node:child_process';
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
export class OwnedProcesses {
  private directories = new Set<string>();
  private known = new Map<string, { row: ProcessRow; bundle: string }>();
  private groups = new Map<number, { leader: string; bundle: string }>();
  constructor(private readonly snapshot = processTable) {}
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
        owned.set(p.pid, { row: p, bundle });
        if (p.pgid === p.pid) this.groups.set(p.pgid, { leader: identity(p), bundle });
      }
    }
    for (const [pgid, group] of this.groups) {
      const leader = byPid.get(pgid);
      // A reused PID/group is not ours. A surviving previously captured member is
      // required before extending an orphan group; a stale numeric PGID is insufficient.
      if ((leader && identity(leader) !== group.leader) || ![...owned.values()].some(p => p.row.pgid === pgid)) { this.groups.delete(pgid); continue; }
      for (const p of rows) if (p.pgid === pgid) owned.set(p.pid, { row: p, bundle: group.bundle });
    }
    let changed = true;
    while (changed) { changed = false; for (const p of rows) { const parent = owned.get(p.ppid); if (parent && !owned.has(p.pid)) { owned.set(p.pid, { row: p, bundle: parent.bundle }); changed = true; } } }
    this.known = new Map([...owned.values()].map(p => [identity(p.row), p]));
    return [...owned.values()].map(p => p.row).sort((a, b) => a.pid - b.pid);
  }
  processes() { return this.capture(); }
  /** Observe long operations (startup/campaign) while roots are still alive, so
   * a worker that exits before the caller resumes cannot hide orphan children. */
  async observe<T>(operation: () => Promise<T>): Promise<T> {
    this.capture(); let samplingError: unknown;
    const timer = setInterval(() => { try { this.capture(); } catch (e) { samplingError ??= e; } }, 50); timer.unref();
    let result: T;
    try { result = await operation(); }
    finally { clearInterval(timer); this.capture(); }
    if (samplingError) throw samplingError;
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
