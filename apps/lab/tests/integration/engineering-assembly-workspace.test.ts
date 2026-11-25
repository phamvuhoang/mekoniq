import {IDBFactory} from 'fake-indexeddb';
import {afterEach,expect,test,vi} from 'vitest';
import {AssemblyWorkspace} from '../../src/ui/assembly-page';
import {EngineeringProjectRepository} from '../../src/project/engineering-repository';
import {checkArchive,type EngineeringArchiveFiles} from '../../src/project/engineering-archive';
import {archiveFor,parseArchive,referenceCatalog,referenceProject,serializeArchive} from '../../src/design/assembly';
import type {TwinRuntime} from '../../src/scenarios/controls';
import {richArchive} from '../support/engineering';

vi.hoisted(()=>{vi.stubGlobal('localStorage',{getItem:()=>null});});

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

function workspace() {
  vi.stubGlobal('indexedDB',new IDBFactory());
  const importer=Object.assign(new EventTarget(),{files:[] as File[]});
  vi.stubGlobal('document',{getElementById:(id:string)=>id==='asm-import'?importer:null});
  const health=vi.fn(async()=>({capabilities:[]}));
  let downloaded='',renders=0;
  const page=new AssemblyWorkspace(()=>{renders++;}, {health} as unknown as TwinRuntime,(_name,data)=>{downloaded=data;});
  const exported=()=>{page.click('asm-export');return parseArchive(downloaded);};
  const imported=async(archive:EngineeringArchiveFiles)=>{
    const before=renders;
    importer.files=[new File([serializeArchive(archive)],'project.json')];
    importer.dispatchEvent(new Event('change'));
    await vi.waitFor(()=>expect(renders).toBeGreaterThan(before));
    await vi.waitFor(()=>expect(exported().manifest.project.revision).toBe(archive.manifest.project.revision));
  };
  page.mounted();
  return {page,health,exported,imported,importer};
}

// Reusing project IDs or byte digests must never choose metadata from an older history entry.
test('same-ID imports keep their archive metadata through editing, Undo, Redo, autosave and startup restore',async()=>{
  const {page,health,exported,imported}=workspace();
  await vi.waitFor(()=>expect(health).toHaveBeenCalled());
  const first=richArchive();first.manifest.project.revision=11;
  first.manifest.migration={original:{id:'legacy-first',schemaVersion:1},report:{warnings:['first migration']}};
  // Even identical project JSON/revision cannot identify the attached archive metadata.
  const second=structuredClone(first);
  second.manifest.assets=[];second.manifest.recipes=[];
  second.manifest.migration={original:{id:'legacy-second',schemaVersion:2},report:{warnings:['second migration']}};
  const blob=second.manifest.blobs.find(b=>b.mediaType==='text/plain')!;
  blob.mediaType='application/octet-stream';blob.license='Apache-2.0';
  expect(checkArchive(first)).toMatchObject({ok:true});
  expect(checkArchive(second)).toMatchObject({ok:true});
  const expectMetadata=(want:EngineeringArchiveFiles)=>{
    const out=exported();
    expect(checkArchive(out)).toMatchObject({ok:true});
    expect(out.manifest.assets).toEqual(want.manifest.assets);
    expect(out.manifest.recipes).toEqual(want.manifest.recipes);
    expect(out.manifest.migration).toEqual(want.manifest.migration);
    expect(out.manifest.blobs.find(b=>b.digest===blob.digest)).toEqual(want.manifest.blobs.find(b=>b.digest===blob.digest));
    expect(out.files[blob.file]).toEqual(want.files[blob.file]);
  };
  await imported(first);
  await imported(second);
  expectMetadata(second);
  page.click('asm-remove','battery');
  expectMetadata(second);
  page.click('asm-undo');expectMetadata(second);
  page.click('asm-undo');expectMetadata(first);
  const repository=new EngineeringProjectRepository();
  await vi.waitFor(async()=>expect((await repository.loadActive())?.manifest.migration).toEqual(first.manifest.migration));
  expect((await repository.loadActive())!.manifest.assets).toEqual(first.manifest.assets);
  page.click('asm-redo');expectMetadata(second);
  page.click('asm-redo');expectMetadata(second);
  await vi.waitFor(async()=>expect((await repository.loadActive())?.manifest.project.revision).toBe(exported().manifest.project.revision));
  const saved=(await repository.loadActive())!;
  expect(saved.manifest.migration).toEqual(second.manifest.migration);
  expect(saved.manifest.blobs.find(b=>b.digest===blob.digest)?.license).toBe('Apache-2.0');
  const restored=new AssemblyWorkspace(()=>{}, {health:async()=>({capabilities:[]})} as unknown as TwinRuntime,(_name,data)=>{
    expect(parseArchive(data).manifest).toEqual(saved.manifest);
  });
  restored.mounted();
  await vi.waitFor(()=>expect(restored.projectDigest()).toBe(page.projectDigest()));
  restored.click('asm-export');
  await repository.close();
});

// A startup read that resolves after an edit must not replace it or clear its Undo history.
test('a delayed startup read leaves an intervening edit and its Undo history intact',async()=>{
  let finish!:(archive:EngineeringArchiveFiles)=>void;
  vi.spyOn(EngineeringProjectRepository.prototype,'loadActive').mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  const {page,health,exported}=workspace();
  const initial=exported().manifest.project;
  page.click('asm-add',Object.keys(referenceCatalog().components)[0]);
  const edited=exported().manifest.project;
  expect(edited.assembly.instances).toHaveLength(1);
  finish(richArchive());
  await vi.waitFor(()=>expect(health).toHaveBeenCalled());
  expect(exported().manifest.project).toEqual(edited);
  page.click('asm-undo');
  expect(exported().manifest.project.assembly).toEqual(initial.assembly);
  page.click('asm-redo');
  expect(exported().manifest.project.assembly).toEqual(edited.assembly);
});

test('the same bytes can carry a different license and media type in a later import',async()=>{
  const {health,exported,imported}=workspace();
  await vi.waitFor(()=>expect(health).toHaveBeenCalled());
  const first=richArchive();first.manifest.project.revision=10;
  const second=structuredClone(first);second.manifest.project.revision=20;
  second.manifest.blobs[0]!.license='Apache-2.0';
  second.manifest.blobs[0]!.mediaType='application/octet-stream';
  expect(checkArchive(second)).toMatchObject({ok:true});
  await imported(first);await imported(second);
  expect(exported().manifest.blobs.find(b=>b.digest===second.manifest.blobs[0]!.digest)).toEqual(second.manifest.blobs[0]);
});

test('opening the reference clears imported metadata even when the project ID is identical, and Undo restores it',async()=>{
  const {page,health,exported,imported}=workspace();
  await vi.waitFor(()=>expect(health).toHaveBeenCalled());
  const archive=richArchive();archive.manifest.project.id='fd01-reference';archive.manifest.project.revision=20;
  await imported(archive);
  page.click('asm-reference');
  expect(exported().manifest.assets).toEqual([]);
  expect(exported().manifest.recipes).toEqual([]);
  page.click('asm-undo');
  expect(exported().manifest.assets).toEqual(archive.manifest.assets);
  expect(exported().manifest.recipes).toEqual(archive.manifest.recipes);
});

test('opening the reference keeps canonical model provenance after importing the same bytes with different declarations',async()=>{
  const {page,health,exported,imported}=workspace();
  await vi.waitFor(()=>expect(health).toHaveBeenCalled());
  const reference=archiveFor(referenceProject(),referenceCatalog(),null),incoming=structuredClone(reference);
  incoming.manifest.blobs.forEach(b=>{b.mediaType='application/import-only';b.license='import-only-license';});
  expect(checkArchive(incoming)).toMatchObject({ok:true});
  await imported(incoming);
  expect(exported().manifest.blobs).toEqual(incoming.manifest.blobs);
  page.click('asm-reference');
  expect(exported().manifest.blobs).toEqual(reference.manifest.blobs);
  page.click('asm-undo');
  expect(exported().manifest.blobs).toEqual(incoming.manifest.blobs);
  page.click('asm-redo');
  expect(exported().manifest.blobs).toEqual(reference.manifest.blobs);
});

test('opening a reference while startup storage is pending remains undoable',async()=>{
  let finish!:(archive:EngineeringArchiveFiles)=>void;
  vi.spyOn(EngineeringProjectRepository.prototype,'loadActive').mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  const {page,health,exported}=workspace(),initial=exported().manifest.project;
  page.click('asm-reference');
  const opened=exported().manifest.project;
  finish(richArchive());
  await vi.waitFor(()=>expect(health).toHaveBeenCalled());
  expect(exported().manifest.project).toEqual(opened);
  page.click('asm-undo');
  expect(exported().manifest.project.assembly).toEqual(initial.assembly);
});

test('startup storage cannot apply while an import is still reading its file',async()=>{
  let finishStorage!:(archive:EngineeringArchiveFiles)=>void,finishFile!:(text:string)=>void;
  vi.spyOn(EngineeringProjectRepository.prototype,'loadActive').mockReturnValue(new Promise(resolve=>{finishStorage=resolve;}));
  const {page,health,exported,importer}=workspace(),initial=exported().manifest.project;
  const incoming=richArchive();incoming.manifest.project.revision=40;
  const file=new File(['pending'],'project.json');
  vi.spyOn(file,'text').mockReturnValue(new Promise(resolve=>{finishFile=resolve;}));
  importer.files=[file];importer.dispatchEvent(new Event('change'));
  finishStorage(richArchive());
  await vi.waitFor(()=>expect(health).toHaveBeenCalled());
  expect(exported().manifest.project).toEqual(initial);
  finishFile(serializeArchive(incoming));
  await vi.waitFor(()=>expect(exported().manifest.project.revision).toBe(40));
  page.click('asm-undo');
  expect(exported().manifest.project.assembly).toEqual(initial.assembly);
});
