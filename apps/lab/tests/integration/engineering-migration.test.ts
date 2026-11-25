import 'fake-indexeddb/auto';
import {afterEach,expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {EngineeringProjectRepository} from '../../src/project/engineering-repository';
import {checkArchive} from '../../src/project/engineering-archive';
import type {LabProject,LabProjectV2} from '../../src/shared/types';

const v1:{service:LabProject}=JSON.parse(readFileSync(new URL('../../fixtures/twins/v1-legacy.json',import.meta.url),'utf8'));
const v2:LabProjectV2=JSON.parse(readFileSync(new URL('../../fixtures/twins/restaurant-v2.json',import.meta.url),'utf8')).project;
const repos:EngineeringProjectRepository[]=[];
const fresh=()=>{const r=new EngineeringProjectRepository(`mig-${crypto.randomUUID()}`);repos.push(r);return r;};
afterEach(async()=>{for (const r of repos.splice(0)) await r.close();});

test('a v1 project becomes an engineering draft with its original and a missing-data report, and cannot run',async()=>{
  const repository=fresh(),draft=await repository.migrateLegacy(v1.service);
  expect(checkArchive(draft).ok).toBe(true);
  expect(draft.manifest.project.assembly).toEqual({instances:[],connections:[]});
  expect(draft.manifest.project.entityBindings).toEqual([]);
  const m=draft.manifest.migration!;
  expect(m.original).toEqual(v1.service);
  expect(m.report).toMatchObject({runnable:false,sourceSchemaVersion:1});
  expect((m.report as {missing:string[]}).missing).toContain('COMPONENT_SELECTION');
  expect((m.report as {warnings:string[]}).warnings).toContain('GEOMETRY_ILLUSTRATIVE');
  expect(draft.manifest.components).toEqual([]);
});

test('a v2 project migrates unchanged into the runtime project; the stored original is never overwritten',async()=>{
  const repository=fresh(),first=await repository.migrateLegacy(v2);
  expect(first.manifest.project.runtimeProject).toEqual(v2);
  const edited=structuredClone(first);edited.manifest.project.revision=7;
  await repository.save(edited);
  const second=await repository.migrateLegacy({...v2,name:'renamed afterwards'});
  expect(second.manifest.project.revision).toBe(7);          // the user's later edits are not reset by migrating again
  expect(second.manifest.migration!.original).toEqual(v2);   // and the original is the first one
});

test('migrating does not read or write the legacy database',async()=>{
  const repository=fresh();await repository.migrateLegacy(v2);
  expect((await indexedDB.databases()).map(d=>d.name)).not.toContain('mekoniq-robot-lab');
});
