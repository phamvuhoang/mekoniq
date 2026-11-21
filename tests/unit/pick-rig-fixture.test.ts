// V12: the pick rig fixture is derived from the cell fixture by a deterministic generator; the shared files keep their bytes and the scene is valid.
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {expect,test} from 'vitest';
import {generatePickRigFixture} from '../../scripts/generate-pick-rig-fixture.mjs';
import {readWorldFixture} from '../../packages/lab-runtime/src/v2/simulation3d/world-scene';
const root=resolve('robotics/simulation-mujoco'),cell=join(root,'fixtures/coffee-delivery-cell-v1'),rig=join(root,'fixtures/pick-rig-v1');
const sha=async(p:string)=>createHash('sha256').update(await readFile(p)).digest('hex');
test('the generator is deterministic and the committed fixture is its output',async()=>{
 const a=await mkdtemp(join(tmpdir(),'rig-a-')),b=await mkdtemp(join(tmpdir(),'rig-b-'));await generatePickRigFixture(a);await generatePickRigFixture(b);
 for(const name of await readdir(a)){expect(await sha(join(a,name))).toBe(await sha(join(b,name)));expect(await sha(join(a,name)),name).toBe(await sha(join(rig,name)));}
});
test('every model, physics, program, load and project file keeps the cell bytes; only the handoff policy differs',async()=>{
 for(const name of await readdir(cell)){if(['manifest.json','README.md','NOTICE','lab-world-scene.json','handoff-policy.json'].includes(name))continue;expect(await sha(join(rig,name)),name).toBe(await sha(join(cell,name)));}
 const p=JSON.parse(await readFile(join(rig,'handoff-policy.json'),'utf8')),c=JSON.parse(await readFile(join(cell,'handoff-policy.json'),'utf8'));
 expect(p.birth.maxOffsetXYM).toBe(0.03);expect({...p,birth:{...p.birth,maxOffsetXYM:0.005},note:c.note}).toEqual(c);
});
test('the rig scene is a valid world scene with its own digest and the cell closure',async()=>{
 const r=await readWorldFixture(root,'pick-rig-v1'),c=await readWorldFixture(root,'coffee-delivery-cell-v1');
 expect(r.scene.sceneDigest).not.toBe(c.scene.sceneDigest);expect(r.scene.id).toBe('pick-rig-v1');expect(r.scene.propBindings).toEqual(c.scene.propBindings);
});
