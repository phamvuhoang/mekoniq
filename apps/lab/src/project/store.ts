import type {AssetRevision,LabProject,LabProjectV2} from '../shared/types';
import {MAX_PROJECT_BYTES,validateProject,validateProjectV2} from './schema';
import {migrateV1Project,type MigrationResult} from './migrations/v1-v2';
const DB_VERSION=2;
export interface LegacyBackup {id:string;backedUpAt:string;project:LabProject;}

/** IndexedDB transaction completion, rather than request success, defines a saved project. Schema v2 only adds stores, so a v1 reader and the v1 `projects` records survive any failed or blocked upgrade. */
export class ProjectStore {
  private connection:Promise<IDBDatabase>|null=null;
  constructor(private readonly databaseName='mekoniq-robot-lab') {}
  private database():Promise<IDBDatabase> {
    if (!this.connection) {
      const attempt:Promise<IDBDatabase>=new Promise((resolve,reject)=>{
        let abandoned=false;
        const fail=(error:Error)=>{abandoned=true;if (this.connection===attempt) this.connection=null;reject(error);};
        const request=indexedDB.open(this.databaseName,DB_VERSION);
        request.onupgradeneeded=()=>{
          const db=request.result;
          for (const [name,keyPath] of [['projects','id'],['legacyProjects','id'],['projectsV2','id'],['assetsV2','contentHash']] as const) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name,{keyPath});
        };
        request.onerror=()=>fail(request.error??new Error('DATABASE_OPEN_FAILED'));
        // The pending request cannot be cancelled: if the blocker closes later, drop that late connection and let a retry open cleanly.
        request.onblocked=()=>fail(new Error('DATABASE_UPGRADE_BLOCKED'));
        request.onsuccess=()=>{
          if (abandoned) {request.result.close();return;}
          request.result.onversionchange=()=>{request.result.close();this.connection=null;};
          resolve(request.result);
        };
      });
      this.connection=attempt;
      void attempt.catch(()=>{if(this.connection===attempt)this.connection=null;});
    }
    return this.connection;
  }
  async save(project:LabProject):Promise<void> {
    const checked=validateProject(project);
    const database=await this.database();
    await new Promise<void>((resolve,reject)=>{
      const transaction=database.transaction('projects','readwrite');
      transaction.oncomplete=()=>resolve();
      transaction.onabort=()=>reject(transaction.error??new Error('PROJECT_SAVE_ABORTED'));
      transaction.onerror=()=>reject(transaction.error??new Error('PROJECT_SAVE_FAILED'));
      transaction.objectStore('projects').put(checked);
    });
  }
  async load(id:string):Promise<LabProject|null> {
    const database=await this.database();
    return new Promise((resolve,reject)=>{
      const transaction=database.transaction('projects','readonly');
      const request=transaction.objectStore('projects').get(id);
      request.onsuccess=()=>{try {resolve(request.result===undefined ? null : validateProject(request.result));} catch(error) {reject(error);}};
      request.onerror=()=>reject(request.error??new Error('PROJECT_LOAD_FAILED'));
    });
  }
  async saveV2(project:LabProjectV2):Promise<void>{
    const checked=validateProjectV2(project),db=await this.database();
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction('projectsV2','readwrite');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??new Error('PROJECT_SAVE_ABORTED'));tx.onerror=()=>reject(tx.error??new Error('PROJECT_SAVE_FAILED'));tx.objectStore('projectsV2').put(checked);});
  }
  async exportV2(id:string):Promise<string>{const p=await this.loadV2(id);if(!p)throw new Error('PROJECT_NOT_FOUND');return JSON.stringify(p,null,2);}
  async importV2(json:string):Promise<LabProjectV2>{if(new TextEncoder().encode(json).length>MAX_PROJECT_BYTES)throw new Error('PROJECT_TOO_LARGE');const p=validateProjectV2(JSON.parse(json));await this.saveV2(p);return p;}
  async loadV2(id:string):Promise<LabProjectV2|null> {return this.read('projectsV2',id,r=>validateProjectV2(r));}
  async loadLegacy(id:string):Promise<LegacyBackup|null> {return this.read('legacyProjects',id,r=>r as LegacyBackup);}
  async loadAssets(project:LabProjectV2):Promise<AssetRevision[]> {
    const found=await Promise.all(project.entities.map(e=>this.read('assetsV2',e.assetRef.contentHash,r=>r as AssetRevision)));
    if (found.some(a=>a===null)) throw new Error('ASSET_NOT_FOUND');
    return found as AssetRevision[];
  }
  private async read<T>(store:string,key:string,decode:(raw:unknown)=>T):Promise<T|null> {
    const database=await this.database();
    return new Promise((resolve,reject)=>{
      const request=database.transaction(store,'readonly').objectStore(store).get(key);
      request.onsuccess=()=>{try {resolve(request.result===undefined ? null : decode(request.result));} catch(error) {reject(error);}};
      request.onerror=()=>reject(request.error??new Error('PROJECT_LOAD_FAILED'));
    });
  }
  /**
   * v1 -> v2 in one transaction: original v1 JSON into `legacyProjects` (kept if one already exists), then the v2 project and its assets.
   * Migration and validation run before the transaction opens; any failure aborts it, so nothing is half-saved and the v1 record is never touched.
   */
  async upgradeToV2(id:string):Promise<MigrationResult> {
    if(await this.loadV2(id))throw new Error('PROJECT_V2_EXISTS');
    const v1=await this.load(id);
    if (!v1) throw new Error('PROJECT_NOT_FOUND');
    const migrated=migrateV1Project(v1);
    validateProjectV2(migrated.projectV2);
    const database=await this.database();
    await new Promise<void>((resolve,reject)=>{
      const transaction=database.transaction(['legacyProjects','projectsV2','assetsV2'],'readwrite');
      let failure:unknown;
      const fail=(error:unknown)=>{failure=error;try {transaction.abort();} catch {/* already finished */}};
      transaction.oncomplete=()=>resolve();
      transaction.onabort=()=>reject(failure??transaction.error??new Error('PROJECT_UPGRADE_ABORTED'));
      transaction.onerror=()=>{};
      const legacy=transaction.objectStore('legacyProjects'),existing=legacy.get(id);
      existing.onsuccess=()=>{
        try {
          if (existing.result===undefined) legacy.put({id,backedUpAt:new Date().toISOString(),project:v1} satisfies LegacyBackup);
          transaction.objectStore('projectsV2').add(migrated.projectV2);
          for (const asset of migrated.assets) transaction.objectStore('assetsV2').put(asset);
        } catch(error) {fail(error);}
      };
      existing.onerror=()=>fail(existing.error);
    });
    return migrated;
  }
  async export(id:string):Promise<string> {
    const project=await this.load(id);
    if (!project) throw new Error('PROJECT_NOT_FOUND');
    return JSON.stringify(project,null,2);
  }
  async import(json:string):Promise<LabProject> {
    if (new TextEncoder().encode(json).length>MAX_PROJECT_BYTES) throw new Error('PROJECT_TOO_LARGE');
    const project=validateProject(JSON.parse(json));
    await this.save(project);
    return project;
  }
  async close():Promise<void> {
    if (this.connection) (await this.connection).close();
    this.connection=null;
  }
}
