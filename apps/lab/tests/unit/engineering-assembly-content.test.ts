import {expect,test} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {EngineeringProjectStore} from '../../src/project/engineering-store';
import {catalogFromArchive,mergeCatalog,archiveFor,archiveMetadata,parseArchive,referenceCatalog,referenceProject,serializeArchive,type AssemblyCatalog} from '../../src/design/assembly';
import {checkArchive} from '../../src/project/engineering-archive';
import {makeEngineeringArchive,richArchive} from '../support/engineering';
import {hashJson,sha256Hex} from '../../src/twin/hash';

const normalised=(a:ReturnType<typeof makeEngineeringArchive>)=>({...a.manifest,blobs:[...a.manifest.blobs].sort((x,y)=>x.digest<y.digest?-1:1),missingDigests:[...a.manifest.missingDigests].sort(),files:Object.fromEntries(Object.entries(a.files).map(([k,v])=>[k,Array.from(v)]))});

test('two-argument archive export accepts the legacy catalog extras shape without blob or missing declarations',()=>{
  const project=referenceProject();
  const catalog:AssemblyCatalog={...referenceCatalog(),extras:{[project.id]:{assets:[],recipes:[]}}};
  const out=archiveFor(project,catalog);
  expect(checkArchive(out)).toMatchObject({ok:true});
  expect(out.manifest.assets).toEqual([]);
  expect(out.manifest.recipes).toEqual([]);
  expect(out.manifest.blobs).toHaveLength(2);
});

test('an imported archive exports back unchanged: every blob with its media type and license, assets and recipes included',()=>{
  const a=richArchive(),catalog=catalogFromArchive(a),out=archiveFor(a.manifest.project,catalog);
  expect(normalised(out)).toEqual(normalised(a));
  expect(checkArchive(out)).toMatchObject({ok:true,missing:[]});
  expect(out.manifest.blobs.find(b=>b.mediaType==='text/plain')!.license).toBe('MIT');
  expect(out.manifest.blobs.find(b=>b.mediaType==='model/stl')).toBeDefined();
});
test('a migrated archive retains the original document and migration report when exported',()=>{
  const a=richArchive();
  a.manifest.migration={original:{schemaVersion:1,id:'old-design',name:'Legacy design'},report:{warnings:['choose parts'],runnable:false}};
  const out=archiveFor(a.manifest.project,catalogFromArchive(a));
  expect(out.manifest.migration).toEqual(a.manifest.migration);
});
test('export retains imported supplemental blobs even when no component references them',()=>{
  const a=richArchive(),bytes=new TextEncoder().encode('supplemental drawing'),digest=sha256Hex(bytes);
  const descriptor={digest,file:`blobs/${digest}`,sizeBytes:bytes.length,mediaType:'text/plain',license:'MIT'};
  a.manifest.blobs.push(descriptor);a.files[descriptor.file]=bytes;
  expect(checkArchive(a)).toMatchObject({ok:true});
  const out=archiveFor(a.manifest.project,catalogFromArchive(a));
  expect(out.manifest.blobs).toContainEqual(descriptor);
  expect(out.files[descriptor.file]).toEqual(bytes);
});
test('a valid archive with a 200,000-byte blob survives download and re-open without changing bytes',()=>{
  const a=richArchive(),bytes=Uint8Array.from({length:200_000},(_,n)=>n%256),digest=sha256Hex(bytes);
  a.manifest.blobs.push({digest,file:`blobs/${digest}`,sizeBytes:bytes.length,mediaType:'application/octet-stream',license:'MIT'});
  a.files[`blobs/${digest}`]=bytes;
  expect(checkArchive(a)).toMatchObject({ok:true});
  const out=parseArchive(serializeArchive(archiveFor(a.manifest.project,catalogFromArchive(a))));
  expect(checkArchive(out)).toMatchObject({ok:true});
  expect(out.files[`blobs/${digest}`]).toEqual(bytes);
});
test('store archive metadata is copied on ingress, immutable on read and cleared by opening a plain project',()=>{
  const a=richArchive(),metadata=archiveMetadata(a),store=new EngineeringProjectStore(a.manifest.project,metadata);
  metadata.blobs[0]!.license='changed by caller';
  const snap=store.archiveMetadata()!;
  expect(snap.blobs[0]!.license).toBe('MIT');
  expect(()=>{snap.blobs[0]!.license='changed through snapshot';}).toThrow();
  store.load(referenceProject());expect(store.archiveMetadata()).toBeNull();
  store.undo();expect(store.archiveMetadata()!.blobs[0]!.license).toBe('MIT');
  store.reset(referenceProject());expect(store.archiveMetadata()).toBeNull();
  expect(store.undo()).toBe(false);
});
test('a later draft with missing blobs does not inherit those files from an earlier catalog import',()=>{
  const complete=richArchive(),draft=structuredClone(complete),catalog=catalogFromArchive(complete);
  draft.manifest.missingDigests=draft.manifest.blobs.map(b=>b.digest).sort();
  draft.manifest.blobs=[];draft.files={};
  expect(checkArchive(draft)).toMatchObject({ok:true});
  mergeCatalog(catalog,catalogFromArchive(draft));
  const out=archiveFor(draft.manifest.project,catalog,archiveMetadata(draft));
  expect(checkArchive(out)).toMatchObject({ok:true});
  expect(out.manifest.blobs).toEqual([]);
  expect(out.files).toEqual({});
  expect(out.manifest.missingDigests).toEqual(draft.manifest.missingDigests);
});
test('an archive that still lacks its blobs exports a consistent missing list, mesh included',()=>{
  const a=richArchive();
  for (const b of a.manifest.blobs) delete a.files[b.file];
  const missing=a.manifest.blobs.map(b=>b.digest).sort();
  a.manifest.blobs=[];a.manifest.missingDigests=missing;
  expect(checkArchive(a)).toMatchObject({ok:true});
  const out=archiveFor(a.manifest.project,catalogFromArchive(a));
  expect(checkArchive(out)).toMatchObject({ok:true});
  expect([...out.manifest.missingDigests].sort()).toEqual(missing);
});
test('opening the reference after an import does not make the imported project lose its components',()=>{
  const a=richArchive(),catalog=catalogFromArchive(a);
  mergeCatalog(catalog,referenceCatalog());
  const out=archiveFor(a.manifest.project,catalog);
  expect(checkArchive(out)).toMatchObject({ok:true});
  expect(normalised(out)).toEqual(normalised(a));
  expect(archiveFor(referenceProject(),catalog).manifest.assets).toEqual([]);   // the imported asset belongs to the imported project only
});
test('loading a saved project keeps its identity (revision and digest); only edits and undo/redo make new revisions',()=>{
  const saved={...referenceProject(),revision:3},store=new EngineeringProjectStore(referenceProject());
  store.load(saved);
  expect(store.snapshot().revision).toBe(3);
  expect(hashJson(store.snapshot())).toBe(hashJson(saved));
  store.replaceDraft({...store.getDraft(),assembly:{instances:[],connections:[]}});
  expect(store.snapshot().revision).toBe(4);
  store.undo();
  expect(store.snapshot().assembly).toEqual(saved.assembly);
});
test('reset restores a project without keeping any earlier history',()=>{
  const store=new EngineeringProjectStore(referenceProject());
  store.replaceDraft({...store.getDraft(),assembly:{instances:[],connections:[]}});
  store.reset({...referenceProject(),revision:7});
  expect(store.snapshot().revision).toBe(7);
  expect(store.undo()).toBe(false);
});

test('the checked-in rich archive fixture is exactly what richArchive() builds (UPDATE_FIXTURES=1 rewrites it)',()=>{
  const url=new URL('../../fixtures/engineering/rich-archive.json',import.meta.url),wire=serializeArchive(richArchive());
  if (process.env.UPDATE_FIXTURES==='1') writeFileSync(url,wire);
  const stored=parseArchive(readFileSync(url,'utf8'));
  expect(checkArchive(stored)).toMatchObject({ok:true});
  expect(normalised(stored)).toEqual(normalised(richArchive()));
});
