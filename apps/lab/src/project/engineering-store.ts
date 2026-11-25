import type {EngineeringProject} from '../shared/engineering';
import type {AssemblyArchiveMetadata} from '../design/assembly';

type DraftSnapshot={project:EngineeringProject;metadata:AssemblyArchiveMetadata|null};

const freeze=<T>(value:T):T=>{
  if (value&&typeof value==='object'&&!Object.isFrozen(value)) {Object.freeze(value);for (const child of Object.values(value as object)) freeze(child);}
  return value;
};
/**
 * The one editable engineering design that Designer, layout and Twin all read. Reads are deep-frozen copies and the live run keeps its own
 * snapshot, so editing the draft can never change a run in progress. Undo and redo are edits too: each makes a new, higher revision.
 */
export class EngineeringProjectStore {
  private project:EngineeringProject;
  private metadata:AssemblyArchiveMetadata|null;
  private readonly past:DraftSnapshot[]=[];
  private future:DraftSnapshot[]=[];
  private readonly listeners=new Set<()=>void>();
  constructor(project:EngineeringProject,metadata:AssemblyArchiveMetadata|null=null) {this.project=structuredClone(project);this.metadata=structuredClone(metadata);}
  /** A private copy the caller may mutate and hand back to replaceDraft. */
  getDraft():EngineeringProject {return structuredClone(this.project);}
  snapshot():EngineeringProject {return freeze(structuredClone(this.project));}
  /** Immutable archive declarations paired with snapshot(); byte storage stays in the shared catalog. */
  archiveMetadata():AssemblyArchiveMetadata|null {return freeze(structuredClone(this.metadata));}
  private current():DraftSnapshot {return {project:this.project,metadata:this.metadata};}
  private commit(next:DraftSnapshot):void {
    this.project={...structuredClone(next.project),revision:this.project.revision+1};
    this.metadata=structuredClone(next.metadata);
    for (const listener of [...this.listeners]) listener();
  }
  replaceDraft(project:EngineeringProject):void {
    this.past.push(this.current());this.future=[];
    this.commit({project,metadata:this.metadata});
  }
  /** Opens a stored or imported project exactly as it is: same revision, same digest. The previous design stays one undo away. */
  load(project:EngineeringProject,metadata:AssemblyArchiveMetadata|null=null):void {
    this.past.push(this.current());this.future=[];
    this.project=structuredClone(project);
    this.metadata=structuredClone(metadata);
    for (const listener of [...this.listeners]) listener();
  }
  /** Start-up restore: the stored project becomes the baseline with no earlier history. */
  reset(project:EngineeringProject,metadata:AssemblyArchiveMetadata|null=null):void {
    this.past.length=0;this.future=[];
    this.project=structuredClone(project);
    this.metadata=structuredClone(metadata);
    for (const listener of [...this.listeners]) listener();
  }
  undo():boolean {
    const previous=this.past.pop();
    if (!previous) return false;
    this.future.push(this.current());this.commit(previous);return true;
  }
  redo():boolean {
    const next=this.future.pop();
    if (!next) return false;
    this.past.push(this.current());this.commit(next);return true;
  }
  subscribe(listener:()=>void):()=>void {this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
}
