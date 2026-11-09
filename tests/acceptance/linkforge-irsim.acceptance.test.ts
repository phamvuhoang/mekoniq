// Acceptance guard for the LinkForge + IR-SIM qualification (plan 03 C03). It reads one recorded candidate directory (LAB_IRSIM_EVIDENCE_DIR, written by
// scripts/record-irsim.mjs) and refuses anything that is not a complete, consistent, irsim_2d record whose case and gate statuses are exactly what the stored
// evidence supports. Without a candidate directory it FAILS (missing evidence is never a pass). It never sets a gate to accepted: a reviewer does that in the record.
// Run: LAB_IRSIM_EVIDENCE_DIR=docs/implementation/evidence/linkforge-irsim/candidate-01 pnpm test:acceptance -- linkforge-irsim
import {expect,test} from 'vitest';
import {spawnSync} from 'node:child_process';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
// @ts-expect-error plain ESM script without types
import {GATE_IDS,checkQualification} from '../../scripts/irsim-qualification.mjs';
type Manifest=Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const dir=process.env.LAB_IRSIM_EVIDENCE_DIR?resolve(process.env.LAB_IRSIM_EVIDENCE_DIR):null;
const read=(p:string)=>{const f=join(dir!,p);return existsSync(f)?readFileSync(f):null;};
const manifest=():Manifest=>{const b=read('qualification.json');if(!b)throw new Error(`EVIDENCE_MISSING: ${dir}/qualification.json (record with node scripts/record-irsim.mjs --out <new dir>)`);return JSON.parse(b.toString('utf8'));};

test('a candidate directory is named and holds a qualification record',()=>{
 expect(dir,'EVIDENCE_MISSING: set LAB_IRSIM_EVIDENCE_DIR to a recorded candidate directory').toBeTruthy();
 expect(manifest()).toMatchObject({schemaVersion:1,documentType:'linkforge-irsim-qualification'});
});
test('the record is complete and consistent with every file beside it (fail-closed check shared with the recorder)',()=>{
 expect(checkQualification(manifest(),read)).toEqual([]);
});
test('the campaign directory re-verifies from disk through the headless CLI (exit 0)',()=>{
 const r=spawnSync(process.execPath,['scripts/lab-irsim.mjs','verify','--input',join(dir!,'campaign')],{encoding:'utf8',timeout:120000});
 expect(r.status,r.stderr).toBe(0);
});
test('the Lab checkout pins exactly the recorded source commit and portable tool closure; the record names that pin',()=>{
 const m=manifest(),lab=resolve('..','lab'),lock=JSON.parse(readFileSync(join(lab,'config/source-runtime.lock.json'),'utf8')) as {sourceCommit:string;portableToolsDigest:string;artifactSha256:string};
 expect(m.lab,'the Lab must be recorded with the candidate (INT01/INT04)').toBeTruthy();
 expect(m.lab.pin).toMatchObject({sourceCommit:m.identity.before.sourceCommit,portableToolsDigest:m.identity.before.toolClosures.portable});
 expect(lock.sourceCommit).toBe(m.lab.pin.sourceCommit);expect(lock.portableToolsDigest).toBe(m.lab.pin.portableToolsDigest);expect(lock.artifactSha256).toBe(m.lab.pin.artifactSha256);
});
test('no gate is accepted by this record, the six new gates are the only ones it names, and every not_run case has its reason',()=>{
 const m=manifest();
 expect(Object.keys(m.gates).sort()).toEqual([...GATE_IDS].sort());
 for(const g of GATE_IDS)expect(m.gates[g].accepted,g).toBe(false);
 expect(m.accepted).toBe(false);
 for(const n of m.notRun as {id:string;reason:string}[])expect(n.reason,n.id).toMatch(/\S/);
 // IR07 is declared not_run on the real plant (the velocity cap forbids tunnelling); it must never read tested
 expect(m.cases.IR07.status).toBe('not_run');
});
test('INT04 screenshots (VI/JA/EN, desktop and tablet) are in the candidate when the Lab journey was recorded',()=>{
 const m=manifest();
 if(m.cases.INT04.status!=='tested')return;
 const shots=readdirSync(join(dir!,'screens'));
 for(const size of ['desktop','tablet'])for(const l of ['vi','ja','en'])expect(shots.some(f=>f.startsWith('irsim-')&&f.includes(`-${size}-${l}.png`)),`${size}/${l}`).toBe(true);
});
