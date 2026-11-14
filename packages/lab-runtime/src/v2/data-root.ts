import {DatabaseSync} from 'node:sqlite';
import {accessSync,closeSync,constants,lstatSync,mkdirSync,openSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
/** Local filesystem lease, independent of run control epochs and source journal transactions.
 * Never unlink this file: the connection-held SQLite writer lock survives PID namespaces and releases on crash.
 * NFS/multi-host filesystems are outside this single-host contract. */
export function acquireDataRoot(directory:string):{directory:string;close():void}{
 let db:DatabaseSync|undefined;
 try{
  mkdirSync(directory,{recursive:true,mode:0o700});
  const root=lstatSync(directory);if(!root.isDirectory()||root.isSymbolicLink())throw Error('LAB_DATA_DIR_INVALID');
  directory=realpathSync(resolve(directory));accessSync(directory,constants.R_OK|constants.W_OK|constants.X_OK);
  const path=join(directory,'.runtime-owner.sqlite');let fresh=false;
  try{const fd=openSync(path,'wx',0o600);closeSync(fd);fresh=true;}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
  const file=lstatSync(path);if(!file.isFile()||file.isSymbolicLink()||!fresh&&file.size===0)throw Error('LAB_DATA_DIR_LOCK_INVALID');
  db=new DatabaseSync(path,{timeout:0});
  if(fresh)db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE runtime_lock (version INTEGER NOT NULL CHECK(version=1)); INSERT INTO runtime_lock VALUES (1);');
  db.exec('BEGIN IMMEDIATE');
  const check=db.prepare('PRAGMA quick_check').get(),versions=db.prepare('SELECT version FROM runtime_lock').all();
  if(Object.values(check??{})[0]!=='ok'||versions.length!==1||versions[0]!.version!==1)throw Error('LAB_DATA_DIR_LOCK_INVALID');
  const held=db;let closed=false;return {directory,close(){if(closed)return;held.close();closed=true;}};
 }catch(e){db?.close();const error=e as Error&{errcode?:number;code?:string};if(error.errcode===5||error.errcode===6)throw Error('LAB_DATA_DIR_BUSY');if(error.message.startsWith('LAB_DATA_DIR_'))throw error;throw Error(error.code==='ERR_SQLITE_ERROR'?'LAB_DATA_DIR_LOCK_INVALID':'LAB_DATA_DIR_UNWRITABLE');}
}
