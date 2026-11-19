// What a recorded tick may say about the drive (plan V05): the same axes as the drive model, in its order, finite, on the tick of the record. A run without a drive records none.
import type {DriveAxisSnapshot,DriveCommandV1} from './drive-io';

const finite=(x:unknown):boolean=>typeof x==='number'?Number.isFinite(x):x!==null&&typeof x==='object'?Object.values(x).every(finite):true;
/** The reason a record's `drives` is not admissible, or null. `axes` is the drive model's axis order, undefined when the run has no drive. */
export function driveRecordProblem(drives:readonly DriveAxisSnapshot[]|undefined,axes:readonly string[]|undefined,tick:number,substeps:number):string|null{
 if(!axes)return drives===undefined?null:'DRIVE_EVIDENCE_UNEXPECTED';
 if(!drives)return 'DRIVE_EVIDENCE_MISSING';
 if(drives.length!==axes.length||drives.some((d,i)=>d.axisId!==axes[i]))return 'DRIVE_EVIDENCE_AXES_MISMATCH';
 if(drives.some(d=>d.tick!==tick||d.saturatedSubsteps>substeps||!finite(d)))return 'DRIVE_EVIDENCE_INVALID';
 return null;
}
/** The same for the commands of a tick (a world records them; tick 0 has none). */
export function driveCommandProblem(commands:readonly DriveCommandV1[]|undefined,axes:readonly string[]|undefined,expectCommands:boolean):string|null{
 if(!axes)return commands===undefined?null:'DRIVE_COMMANDS_UNEXPECTED';
 if(!expectCommands)return commands===undefined?null:'DRIVE_COMMANDS_UNEXPECTED';
 if(!commands)return 'DRIVE_COMMANDS_MISSING';
 const ids=new Set(commands.map(c=>c.axisId));
 if(commands.length!==axes.length||ids.size!==axes.length||axes.some(a=>!ids.has(a))||!finite(commands))return 'DRIVE_COMMANDS_AXES_MISMATCH';
 return null;
}
