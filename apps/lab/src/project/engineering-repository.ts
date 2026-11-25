import type {EngineeringProject} from '../shared/engineering';
import type {LabProject,LabProjectV2} from '../shared/types';
import {migrateV1Project} from './migrations/v1-v2';
import {checkArchive,type EngineeringArchiveFiles} from './engineering-archive';

const DB_VERSION=1;
const STORES=['projects','originals','content','metadata'] as const;
export class EngineeringStorageError extends Error {constructor(readonly code:string,readonly problems:string[]=[]){super(problems.length?`${code}: ${problems.join('; ')}`:code);this.name='EngineeringStorageError';}}
const snapshotArchive=(a:EngineeringArchiveFiles):EngineeringArchiveFiles=>({manifest:structuredClone(a.manifest),files:Object.fromEntries(Object.entries(a.files).map(([k,v])=>[k,v instanceof Uint8Array?new Uint8Array(v):v]))});
type ProjectRecord={id:string;manifest:EngineeringArchiveFiles['manifest']};

/**
 * Engineering projects live in their own database (`mekoniq-robot-lab-engineering`); the legacy `mekoniq-robot-lab` database is never opened here.
 * A save is only acknowledged when its IndexedDB transaction completes; every check runs before the transaction starts, so a rejected archive changes nothing.
 */
export class EngineeringProjectRepository {
  private connection:Promise<IDBDatabase>|null=null;
  constructor(private readonly databaseName='mekoniq-robot-lab-engineering') {}
  private database():Promise<IDBDatabase> {
    if (!this.connection) {
      const attempt:Promise<IDBDatabase>=new Promise((resolve,reject)=>{
        let abandoned=false;
        const fail=(error:Error)=>{abandoned=true;if (this.connection===attempt) this.connection=null;reject(error);};
        const request=indexedDB.open(this.databaseName,DB_VERSION);
        request.onupgradeneeded=()=>{for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name,{keyPath:name==='content'?'digest':name==='metadata'?'key':'id'});};
        request.onerror=()=>fail(request.error??new Error('DATABASE_OPEN_FAILED'));
        request.onblocked=()=>fail(new Error('DATABASE_UPGRADE_BLOCKED'));
        request.onsuccess=()=>{
          if (abandoned) {request.result.close();return;}
          request.result.onversionchange=()=>{request.result.close();this.connection=null;};
          resolve(request.result);
        };
      });
      this.connection=attempt;
      void attempt.catch(()=>{if (this.connection===attempt) this.connection=null;});
    }
    return this.connection;
  }
  private async transaction<T>(stores:readonly (typeof STORES[number])[],mode:IDBTransactionMode,work:(tx:IDBTransaction)=>Promise<T>|T):Promise<T> {
    const database=await this.database();
    return new Promise<T>((resolve,reject)=>{
      const tx=database.transaction([...stores],mode);
      let result:T;
      tx.oncomplete=()=>resolve(result);
      tx.onabort=()=>reject(tx.error??new Error('TRANSACTION_ABORTED'));
      tx.onerror=()=>reject(tx.error??new Error('TRANSACTION_FAILED'));
      Promise.resolve().then(()=>work(tx)).then(r=>{result=r;},error=>{reject(error);try {tx.abort();} catch {/* already finished */}});
    });
  }
  private static request<T>(r:IDBRequest<T>):Promise<T> {return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}

  async save(input:EngineeringArchiveFiles,options:{original?:unknown}={}):Promise<void> {
    // snapshot synchronously: everything below awaits, and validated bytes must be exactly the bytes that get stored
    const archive=snapshotArchive(input);
    const checked=checkArchive(archive);
    if (!checked.ok) throw new EngineeringStorageError('ARCHIVE_REJECTED',checked.problems);
    const id=archive.manifest.project.id,{blobs}=archive.manifest;
    await this.transaction(['projects','originals','content','metadata'],'readwrite',async tx=>{
      const record:ProjectRecord={id,manifest:{...archive.manifest,blobs:[...blobs]}};
      tx.objectStore('projects').put(record);
      // the original is written once and never replaced by a later save or migration
      if (options.original!==undefined&&!await EngineeringProjectRepository.request(tx.objectStore('originals').getKey(id))) tx.objectStore('originals').put({id,original:options.original});
      for (const b of blobs) tx.objectStore('content').put({digest:b.digest,bytes:archive.files[b.file]});
      tx.objectStore('metadata').put({key:'active',projectId:id});
    });
  }
  async load(id:string):Promise<EngineeringArchiveFiles|null> {
    return this.transaction(['projects','content'],'readonly',async tx=>{
      const record=await EngineeringProjectRepository.request<ProjectRecord|undefined>(tx.objectStore('projects').get(id));
      if (!record) return null;
      const files:Record<string,Uint8Array>={};
      for (const b of record.manifest.blobs) {
        const row=await EngineeringProjectRepository.request<{bytes:Uint8Array}|undefined>(tx.objectStore('content').get(b.digest));
        if (row) files[b.file]=row.bytes;
      }
      return {manifest:record.manifest,files};
    });
  }
  async loadActive():Promise<EngineeringArchiveFiles|null> {
    const pointer=await this.transaction(['metadata'],'readonly',tx=>EngineeringProjectRepository.request<{projectId:string}|undefined>(tx.objectStore('metadata').get('active')));
    return pointer?this.load(pointer.projectId):null;
  }
  /** The archive is verified (schema, sizes, SHA-256 of every file, missing-list consistency) before anything is written; a corrupt one leaves prior state intact. */
  async importArchive(files:EngineeringArchiveFiles):Promise<EngineeringArchiveFiles> {
    await this.save(files);
    return (await this.load(files.manifest.project.id))!;
  }
  async exportArchive(id:string):Promise<EngineeringArchiveFiles> {
    const archive=await this.load(id);
    if (!archive) throw new EngineeringStorageError('PROJECT_NOT_FOUND');
    return archive;
  }
  /**
   * Opens a v1/v2 design as an engineering draft without choosing components for the user: no instances, no bindings, so it cannot run until they pick parts.
   * The legacy project is kept verbatim as the original, with the migration report; migrating the same project again returns the stored draft untouched.
   */
  async migrateLegacy(original:LabProject|LabProjectV2):Promise<EngineeringArchiveFiles> {
    const id=`eng-${original.id}`,existing=await this.load(id);
    if (existing) return existing;
    const v2=original.schemaVersion===1?migrateV1Project(original):{projectV2:original as LabProjectV2,assets:[],warnings:[]};
    const project:EngineeringProject={documentType:'engineering-project',schemaVersion:1,id,revision:1,runtimeProject:v2.projectV2 as never,assembly:{instances:[],connections:[]},entityBindings:[],requestedProfile:'engineering-rigid-v1'};
    const archive:EngineeringArchiveFiles={manifest:{documentType:'engineering-project-archive',schemaVersion:1,project,components:[],assets:[],recipes:[],blobs:[],missingDigests:[],
      migration:{report:{warnings:v2.warnings,missing:['COMPONENT_SELECTION','ENTITY_BINDINGS','MOUNTS_AND_PORTS'],runnable:false,sourceSchemaVersion:original.schemaVersion},original:structuredClone(original) as never}},files:{}};
    await this.save(archive,{original});
    return archive;
  }
  async close():Promise<void> {
    const pending=this.connection;this.connection=null;
    if (pending) (await pending.catch(()=>null))?.close();
  }
}
