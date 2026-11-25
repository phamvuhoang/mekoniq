import {afterEach,expect,test} from 'vitest';
import {spawnSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';

const dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const out=async()=>{const d=await mkdtemp(join(tmpdir(),'hw-cli-'));dirs.push(d);return d;};
const cli=(args:string[],env:NodeJS.ProcessEnv=process.env)=>spawnSync(process.execPath,['scripts/lab-hardware.mjs',...args],{encoding:'utf8',env});
const design=(n:string)=>`robotics/catalog/electrical/${n}.json`;

test('check exits 0 for a compiled option and 1 for a blocked one, naming the reason',()=>{
 expect(cli(['check','--design',design('serve-hw-c-v1')]).status).toBe(0);
 const blocked=cli(['check','--design',design('serve-hw-a-v1')]);
 expect(blocked.status).toBe(1);expect(blocked.stdout).toContain('IOA_SIGNAL_UNALLOCATED');
});
test('a design for another project is refused with exit 2',async()=>{
 const d=await out(),file=join(d,'other.json'),doc=JSON.parse(await readFile(design('serve-hw-c-v1'),'utf8'));
 await writeFile(file,JSON.stringify({...doc,project:{...doc.project,id:'someone-else'}}));
 const r=cli(['check','--design',file]);
 expect(r.status).toBe(2);expect(r.stderr).toContain('ELECTRICAL_PROJECT_MISMATCH');
});
test('compile writes the bundle, also for a blocked option',async()=>{
 const d=await out();
 expect(cli(['compile','--design',design('serve-hw-a-v1'),'--out',d]).status).toBe(1);
 expect(JSON.parse(await readFile(join(d,'electrical-bundle.json'),'utf8')).state).toBe('blocked');
});
test('docs writes seven files, --check passes on them and names the file after a hand edit',async()=>{
 const d=await out();
 expect(cli(['docs','--design',design('serve-hw-c-v1'),'--out',d]).status).toBe(0);
 expect(cli(['docs','--design',design('serve-hw-c-v1'),'--out',d,'--check']).status).toBe(0);
 const f=join(d,'wire-list.csv'),t=await readFile(f,'utf8');
 await writeFile(f,t.replace('yellow','yelloW'));
 const r=cli(['docs','--design',design('serve-hw-c-v1'),'--out',d,'--check']);
 expect(r.status).toBe(1);expect(r.stderr).toContain('DIFFERS wire-list.csv');
});
test('docs on a blocked option refuses; --draw without wireviz still writes harness.yml and says what is missing',async()=>{
 const d=await out();
 expect(cli(['docs','--design',design('serve-hw-a-v1'),'--out',d]).status).toBe(1);
 const r=cli(['docs','--design',design('serve-hw-c-v1'),'--out',d,'--draw'],{...process.env,PATH:dirname(process.execPath)});
 expect(r.status).toBe(0);expect(r.stdout).toContain('TOOL_NOT_INSTALLED wireviz');expect((await readFile(join(d,'harness.yml'),'utf8')).length).toBeGreaterThan(100);
});
test('bad usage exits 2',()=>{
 expect(cli(['check']).status).toBe(2);expect(cli(['nope','--design','x']).status).toBe(2);expect(cli(['docs','--design',design('serve-hw-c-v1')]).status).toBe(2);
});

test('compare prints the comparison and exits 1 while prices are missing', () => {
  const r = cli(['compare', '--design', design('serve-hw-b-v1'), '--design', design('serve-hw-c-v1')]);
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout).notComparableReason).toBe('PRICE_MISSING_FOR_DECIDING_PARTS');
});

test('package writes a verifiable package, verify names a changed file and exits 1, a blocked option writes nothing',async()=>{
 const d=await out(),pkg=join(d,'pkg');
 expect(cli(['package','--design',design('serve-hw-c-v1'),'--out',pkg]).status).toBe(0);
 expect(cli(['verify','--package',pkg]).status).toBe(0);
 await writeFile(join(pkg,'documents/pinout.csv'),'tampered\n');
 const bad=cli(['verify','--package',pkg]);expect(bad.status).toBe(1);expect(bad.stderr).toContain('CHECKSUM_MISMATCH documents/pinout.csv');
 const blocked=cli(['package','--design',design('serve-hw-a-v1'),'--out',join(d,'none')]);
 expect(blocked.status).toBe(1);expect(blocked.stderr).toContain('ELECTRICAL_BUNDLE_BLOCKED');
});
