import 'fake-indexeddb/auto';
import {afterEach,expect,test,vi} from 'vitest';
import {EngineeringProjectRepository} from '../../src/project/engineering-repository';
import {checkArchive} from '../../src/project/engineering-archive';
import {makeEngineeringArchive} from '../support/engineering';
import {readFileSync} from 'node:fs';
import {sealAsset} from '../../src/twin/model';
import {hashJson} from '../../src/twin/hash';
import type {AssetRevision} from '../../src/shared/types';

const repos:EngineeringProjectRepository[]=[];
const fresh=()=>{const r=new EngineeringProjectRepository(`eng-${crypto.randomUUID()}`);repos.push(r);return r;};
afterEach(async()=>{vi.restoreAllMocks();for (const r of repos.splice(0)) await r.close();});

test('a complete archive roundtrips between two independent repositories', async () => {
  const repository=fresh(),otherRepository=fresh(),archive=makeEngineeringArchive();
  await repository.save(archive);
  const exported = await repository.exportArchive(archive.manifest.project.id);
  await otherRepository.importArchive(exported);
  expect((await otherRepository.loadActive())?.manifest.project).toEqual(archive.manifest.project);
  const loaded=(await otherRepository.loadActive())!;
  expect(Object.keys(loaded.files).sort()).toEqual(Object.keys(archive.files).sort());
  expect(checkArchive(loaded)).toMatchObject({ok:true,missing:[]});
});

test('a corrupt blob is rejected before any write and the previous active project survives', async () => {
  const repository=fresh(),good=makeEngineeringArchive();
  await repository.save(good);
  const bad=makeEngineeringArchive();bad.manifest.project.id='other-project';
  const file=Object.keys(bad.files)[0]!;bad.files[file]=new TextEncoder().encode('tampered');
  await expect(repository.importArchive(bad)).rejects.toThrow(/BLOB_(HASH|SIZE)_MISMATCH/);
  expect((await repository.loadActive())?.manifest.project.id).toBe(good.manifest.project.id);
  expect(await repository.load('other-project')).toBeNull();
});

test('paths, undeclared files and an inconsistent missing list are refused', () => {
  const traversal=makeEngineeringArchive();traversal.manifest.blobs[0]!.file='../../etc/passwd';
  expect(checkArchive(traversal)).toMatchObject({ok:false});
  const extra=makeEngineeringArchive();extra.files['blobs/'+'a'.repeat(64)]=new Uint8Array([1]);
  expect((checkArchive(extra) as {problems:string[]}).problems.join()).toContain('FILE_NOT_DECLARED');
  const lie=makeEngineeringArchive();lie.manifest.missingDigests=['b'.repeat(64)];
  expect((checkArchive(lie) as {problems:string[]}).problems).toContain('MISSING_LIST_INCONSISTENT');
  const noLicense=makeEngineeringArchive();noLicense.manifest.blobs[0]!.license='';
  expect(checkArchive(noLicense).ok).toBe(false);
  const wrongType=makeEngineeringArchive();(wrongType.manifest as unknown as Record<string,unknown>).controllerEndpoint='http://x';
  expect(checkArchive(wrongType).ok).toBe(false);
});

test('a draft exported without its blobs lists them and opens as a draft that cannot run', async () => {
  const repository=fresh(),draft=makeEngineeringArchive({omitBlobs:true});
  const checked=checkArchive(draft);
  expect(checked).toMatchObject({ok:true});
  expect((checked as {missing:string[]}).missing).toHaveLength(2);
  await repository.save(draft);
  const loaded=(await repository.loadActive())!;
  expect(loaded.manifest.missingDigests).toHaveLength(2);
  expect(loaded.files).toEqual({});
});

test('quota failure aborts the whole save and keeps what was stored before', async () => {
  const repository=fresh(),first=makeEngineeringArchive();
  await repository.save(first);
  const second=makeEngineeringArchive();second.manifest.project.id='second';
  const put=IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){
    if (this.name==='content') throw new DOMException('quota','QuotaExceededError');
    return put.call(this,value,key);
  });
  await expect(repository.save(second)).rejects.toThrow(/quota/i);
  vi.restoreAllMocks();
  expect(await repository.load('second')).toBeNull();
  expect((await repository.loadActive())?.manifest.project.id).toBe(first.manifest.project.id);
});

test('the legacy database is not touched and an incompatible database version is a clear error', async () => {
  const name=`eng-${crypto.randomUUID()}`;
  await new Promise<void>((resolve,reject)=>{const r=indexedDB.open(name,5);r.onsuccess=()=>{r.result.close();resolve();};r.onerror=()=>reject(r.error);});
  const repository=new EngineeringProjectRepository(name);repos.push(repository);
  await expect(repository.loadActive()).rejects.toBeDefined();
  const dbs=(await indexedDB.databases()).map(d=>d.name);
  expect(dbs).not.toContain('mekoniq-robot-lab');
});

test('bytes changed after save() is called are not what gets stored (the archive is snapshotted first)', async () => {
  const repository=fresh(),archive=makeEngineeringArchive(),file=Object.keys(archive.files)[0]!;
  const original=new Uint8Array(archive.files[file]!);
  const pending=repository.save(archive);
  archive.files[file]![0]=archive.files[file]![0]!^0xff;      // the caller mutates while the save is in flight
  archive.manifest.project.id='mutated-after-call';
  await pending;
  const loaded=(await repository.loadActive())!;
  expect(loaded.manifest.project.id).not.toBe('mutated-after-call');
  expect(loaded.files[file]).toEqual(original);
  expect(checkArchive(loaded).ok).toBe(true);
});

test('assets and recipes are validated, and anything that looks like authority or a secret is refused anywhere in the archive', () => {
  for (const key of ['credentials','controllerEndpoint','session','commandQueue','proof','token']) {
    const a=makeEngineeringArchive();
    a.manifest.assets=[{ [key]: 'x' } as never];
    expect(checkArchive(a).ok,key).toBe(false);
    const r=makeEngineeringArchive();
    r.manifest.recipes=[{ id:'espresso', revision:1, hash:'a'.repeat(64), nested:{ [key]:'x' } } as never];
    expect(checkArchive(r).ok,key).toBe(false);
  }
  const notAnAsset=makeEngineeringArchive();notAnAsset.manifest.assets=[{id:'x'} as never];
  expect((checkArchive(notAnAsset) as {problems:string[]}).problems.join()).toContain('ASSET_INVALID');
  const notARecipe=makeEngineeringArchive();notARecipe.manifest.recipes=[{id:'espresso'} as never];
  expect((checkArchive(notARecipe) as {problems:string[]}).problems.join()).toContain('RECIPE_INVALID');
});

const fixture=(path:string)=>JSON.parse(readFileSync(new URL(`../../fixtures/${path}`,import.meta.url),'utf8'));
test('real assets and recipes are accepted; contract violations are refused even when the hash is self-consistent',()=>{
  const asset=fixture('twins/restaurant-v2.json').assets[0] as AssetRevision,recipe=fixture('recipes/espresso.json');
  const ok=makeEngineeringArchive();ok.manifest.assets=[asset as never];ok.manifest.recipes=[recipe];
  expect(checkArchive(ok)).toMatchObject({ok:true});
  const sealedButEmpty=makeEngineeringArchive();sealedButEmpty.manifest.assets=[sealAsset({schemaVersion:2,id:'x'} as unknown as AssetRevision) as never];
  expect((checkArchive(sealedButEmpty) as {problems:string[]}).problems.join()).toContain('ASSET_INVALID');
  const badRevision=makeEngineeringArchive();badRevision.manifest.recipes=[{...recipe,revision:-1,hash:hashJson({...recipe,revision:-1,hash:undefined})}];
  expect((checkArchive(badRevision) as {problems:string[]}).problems.join()).toContain('RECIPE_INVALID');
  const wrongHash=makeEngineeringArchive();wrongHash.manifest.recipes=[{...recipe,hash:'a'.repeat(64)}];
  expect((checkArchive(wrongHash) as {problems:string[]}).problems.join()).toContain('RECIPE_INVALID');
  const stub=makeEngineeringArchive();stub.manifest.recipes=[{id:'espresso',revision:1,hash:'b'.repeat(64)} as never];
  expect((checkArchive(stub) as {problems:string[]}).problems.join()).toContain('RECIPE_INVALID');
  const tamperedAsset=makeEngineeringArchive();tamperedAsset.manifest.assets=[{...asset,kind:'tool'} as never];
  expect((checkArchive(tamperedAsset) as {problems:string[]}).problems.join()).toContain('ASSET_INVALID');
});
