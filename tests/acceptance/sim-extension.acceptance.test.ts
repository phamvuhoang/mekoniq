// Acceptance guard for the simulation-extension qualification: Release 1 (plan 01 W09) and Release 1.1 (Webots arm, X08; the record names its release). It reads one recorded candidate directory (LAB_SIMEXT_EVIDENCE_DIR, written by
// scripts/record-sim-extension.mjs) and refuses anything that is not a complete, consistent, webots_3d record whose case and gate statuses are exactly what the stored evidence
// supports. Without a candidate directory it FAILS (missing evidence is never a pass). It never sets a gate to accepted: a reviewer does that in the record.
// Run: LAB_SIMEXT_EVIDENCE_DIR=docs/implementation/evidence/sim-extension/r1-candidate-01 pnpm test:acceptance -- sim-extension
import {expect,test} from 'vitest';
import {spawnSync} from 'node:child_process';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
// @ts-expect-error plain ESM script without types
import {GATE_IDS,GATE_IDS_R11,checkQualification} from '../../scripts/sim-extension-qualification.mjs';
type Manifest=Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const dir=process.env.LAB_SIMEXT_EVIDENCE_DIR?resolve(process.env.LAB_SIMEXT_EVIDENCE_DIR):null;
const read=(p:string)=>{const f=join(dir!,p);return existsSync(f)?readFileSync(f):null;};
const SIMEXT='docs/implementation/evidence/sim-extension',IRSIM='docs/implementation/evidence/linkforge-irsim';
const manifest=():Manifest=>{const b=read('qualification.json');if(!b)throw new Error(`EVIDENCE_MISSING: ${dir}/qualification.json (record with node scripts/record-sim-extension.mjs --release r1 --out <new dir> ...)`);return JSON.parse(b.toString('utf8'));};

test('a candidate directory is named and holds a qualification record',()=>{
 expect(dir,'EVIDENCE_MISSING: set LAB_SIMEXT_EVIDENCE_DIR to a recorded candidate directory').toBeTruthy();
 expect(manifest()).toMatchObject({schemaVersion:1,documentType:'sim-extension-qualification'});
 expect(['r1','r1.1']).toContain(manifest().release);
});
test('the record is complete and consistent with every file beside it (fail-closed check shared with the recorder)',()=>{
 expect(checkQualification(manifest(),read)).toEqual([]);
});
test('the Webots campaign directory re-verifies from disk through the headless CLI (exit 0)',()=>{
 if(manifest().release==='r1.1'){expect(manifest().campaign).toBeNull();return;} // R1.1 records no campaign; its Webots evidence is the suites on the real engine
 const r=spawnSync(process.execPath,['scripts/lab-irsim.mjs','verify','--input',join(dir!,'campaign')],{encoding:'utf8',timeout:120000});
 expect(r.status,r.stderr).toBe(0);
});
test('the Lab checkout pins exactly the recorded source commit and portable tool closure; the record names that pin',()=>{
 const m=manifest(),lab=resolve('..','lab'),lock=JSON.parse(readFileSync(join(lab,'config/source-runtime.lock.json'),'utf8')) as {sourceCommit:string;portableToolsDigest:string;artifactSha256:string};
 expect(m.lab,'the Lab must be recorded with the candidate (INT11)').toBeTruthy();
 expect(m.lab.pin).toMatchObject({sourceCommit:m.identity.before.sourceCommit,portableToolsDigest:m.identity.before.toolClosures.portable});
 expect(lock.sourceCommit).toBe(m.lab.pin.sourceCommit);expect(lock.portableToolsDigest).toBe(m.lab.pin.portableToolsDigest);expect(lock.artifactSha256).toBe(m.lab.pin.artifactSha256);
});
test('R1.1: the R1 record it carries is the one in the tree (byte for byte), and so are the IR-SIM record and the mock regression that R1 record was built on (REG02)',()=>{
 const m=manifest();if(m.release!=='r1.1')return;
 const r1Dir=join(SIMEXT,m.r1Record.candidate);
 expect(existsSync(join(r1Dir,'qualification.json')),`${r1Dir} is not in the tree (the R1 record this record builds on)`).toBe(true);
 expect(readFileSync(join(r1Dir,'qualification.json')).equals(read(m.r1Record.file)!)).toBe(true);
 expect(readFileSync(join(r1Dir,'irsim-record.json')).equals(read(m.irsimRecord.file)!)).toBe(true);
 expect(readFileSync(join(r1Dir,'mock-regression.json')).equals(read(m.mockRegression.file)!)).toBe(true);
 expect(readFileSync(join(IRSIM,m.irsimRecord.candidate,'qualification.json')).equals(read(m.irsimRecord.file)!),`${IRSIM}/${m.irsimRecord.candidate} is not the IR-SIM record it carries`).toBe(true);
 expect(m.r1Record.sourceCommit).toBe(m.identity.before.sourceCommit);expect(m.irsimRecord.sourceCommit).toBe(m.identity.before.sourceCommit);
});
test('the IR-SIM record it builds on is the one in the tree (byte for byte) and is of the same commit',()=>{
 const m=manifest();if(m.release==='r1.1')return; // covered above: through the R1 record
 const inTree=join(IRSIM,m.irsimRecord.candidate,'qualification.json');
 expect(existsSync(inTree),`${inTree} is not in the tree (the candidate this record builds on)`).toBe(true);
 expect(readFileSync(inTree).equals(read(m.irsimRecord.file)!)).toBe(true);
 expect(m.irsimRecord.sourceCommit).toBe(m.identity.before.sourceCommit);
});
test('no gate is accepted by this record, only its own release\'s gates are named, and every not_run case has a reason (R1: ALG04 is not_run for R3, WB04 carries its limitation)',()=>{
 const m=manifest(),ids=m.release==='r1.1'?GATE_IDS_R11:GATE_IDS;
 expect(Object.keys(m.gates).sort()).toEqual([...ids].sort());
 for(const g of ids)expect(m.gates[g].accepted,g).toBe(false);
 expect(m.accepted).toBe(false);expect(m.acceptedBy).toBeNull();
 for(const n of m.notRun as {id:string;reason:string}[])expect(n.reason,n.id).toMatch(/\S/);
 if(m.release==='r1.1'){for(const g of ids)expect(m.gates[g].status,g).toBe('tested');return;}
 expect(m.cases.ALG04).toMatchObject({status:'not_run',reason:expect.stringMatching(/R3/)});
 // WB04 is tested with its limitation: the source serialises the movers, and no zone-contention rig exists for Webots
 expect(m.cases.WB04).toMatchObject({status:'tested',note:expect.stringMatching(/__venue_movement__/)});
 expect(m.cases.WB04.note).toMatch(/no zone-contention rig/);
});
test('INT13 screenshot of the Lab running the coffee journey on the Webots arm is in the R1.1 candidate',()=>{
 const m=manifest();if(m.release!=='r1.1')return;
 expect(m.cases.INT13.status).toBe('tested');expect(readdirSync(join(dir!,'screens'))).toContain('webots-coffee.png');
});
test('INT11 screenshots (VI/JA/EN, desktop and tablet) are in the candidate when the Lab Webots journey was recorded',()=>{
 const m=manifest();if(m.release==='r1.1')return;
 if(m.cases.INT11.status!=='tested')return;
 const shots=readdirSync(join(dir!,'screens'));
 for(const size of ['desktop','tablet'])for(const l of ['vi','ja','en'])expect(shots.some(f=>f.startsWith('webots-')&&f.includes(`-${size}-${l}.png`)),`${size}/${l}`).toBe(true);
});
test('the performance measurement is recorded and says it is a measurement, not a gate',()=>{
 const m=manifest();if(m.release==='r1.1'){expect(m.performance).toBeNull();return;} // measured in R1; R1.1 adds no measurement of its own
 expect(m.performance).toBe('performance.json');
 const perf=JSON.parse(read('performance.json')!.toString('utf8')) as Manifest;
 expect(perf.documentType).toBe('webots-performance-measurement');expect(perf.note).toMatch(/not a gate/);
 expect(perf.steadyState.perTickMs.p50).toBeGreaterThan(0);expect(perf.steadyState.perTickMs.p95).toBeGreaterThanOrEqual(perf.steadyState.perTickMs.p50);expect(perf.steadyState.realtimeFactor).toBeGreaterThan(0);
});
