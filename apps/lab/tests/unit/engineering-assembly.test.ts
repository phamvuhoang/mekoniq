import {expect,test} from 'vitest';
import {addInstance,archiveFor,connect,disconnect,parseArchive,previewProblems,referenceCatalog,referenceProject,removeInstance,serializeArchive,uniqueInstanceId} from '../../src/design/assembly';
import {checkArchive} from '../../src/project/engineering-archive';

const codes=(p:ReturnType<typeof previewProblems>)=>p.map(x=>x.code);
const digestOf=(id:string)=>Object.entries(referenceCatalog().components).find(([,c])=>c.id===id)![0];

test('the reference FD01 project has no structural problems in the offline preview',()=>{
  expect(previewProblems(referenceProject(),referenceCatalog())).toEqual([]);
});
test('removing a part removes its connections and bindings, and the preview reports what is now missing',()=>{
  const p=removeInstance(referenceProject(),'battery');
  expect(p.assembly.connections.some(c=>c.from.startsWith('battery/')||c.to.startsWith('battery/'))).toBe(false);
  expect(p.entityBindings[0]!.instanceIds).not.toContain('battery');
  expect(previewProblems(p,referenceCatalog())).toEqual([]);                 // still structurally tidy: the missing power is the resolver's business
});
test('a part that no entity owns, a wrong mate and a reused port are shown',()=>{
  const c=referenceCatalog();
  let p=addInstance(referenceProject(),digestOf('battery-24v-ref'),'spare');       // added but not bound
  expect(codes(previewProblems(p,c))).toContain('INSTANCE_UNBOUND');
  p=connect(p,'chassis/tray-plate','spare/mount','mount');
  expect(codes(previewProblems(p,c))).toEqual(expect.arrayContaining(['MOUNT_MISMATCH','PORT_REUSED']));
  p=disconnect(p,p.assembly.connections.length-1);
  expect(codes(previewProblems(p,c))).not.toContain('MOUNT_MISMATCH');
  const ghost=connect(referenceProject(),'chassis/nope','tray/mount','mount');
  expect(codes(previewProblems(ghost,c))).toContain('DANGLING_CONNECTION');
});
test('ids stay unique when the same part is added again',()=>{
  const p=addInstance(referenceProject(),digestOf('drive-wheel-ref'),uniqueInstanceId(referenceProject(),'wheel-left'));
  expect(p.assembly.instances.map(i=>i.id)).toContain('wheel-left-2');
});
test('a design becomes a self-consistent archive: used components only, models as hashed blobs, missing documents listed',()=>{
  const a=archiveFor(referenceProject(),referenceCatalog());
  expect(checkArchive(a)).toMatchObject({ok:true});
  expect(a.manifest.components.map(c=>c.id)).not.toContain('ufactory-xarm6');
  expect(a.manifest.blobs.length).toBe(2);                                  // the drive-model JSONs
  const dropped=archiveFor(removeInstance(referenceProject(),'battery'),referenceCatalog());
  expect(dropped.manifest.components.map(c=>c.id)).not.toContain('battery-24v-ref');
});
test('an archive survives download and re-open byte for byte',()=>{
  const a=archiveFor(referenceProject(),referenceCatalog()),b=parseArchive(serializeArchive(a));
  expect(b.manifest).toEqual(a.manifest);
  expect(Object.keys(b.files)).toEqual(Object.keys(a.files));
  for (const k of Object.keys(a.files)) expect(b.files[k]).toEqual(a.files[k]);
  expect(checkArchive(b).ok).toBe(true);
  expect(()=>parseArchive('{"nope":1}')).toThrow('ARCHIVE_SHAPE_INVALID');
});
