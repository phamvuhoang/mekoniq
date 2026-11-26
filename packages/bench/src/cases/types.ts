// Bench case types (K04). Types only: the cases are in conformance.ts, the loop that runs them is session.ts.
import type {DriveCommandV1,DriveFault,DriveFeedbackV1} from '../../../lab-runtime/src/v2/control/drive-io';
import type {BenchCycleRow,BenchKitV1,BenchPolicy,BenchTickRecord,Measurement} from '../contracts';

/** What runCase recorded: every tick sent (the stop sequence included), the worker's cycle rows, the operator's answers, the objects `scan` read
 * (axisId -> {'605A:00': value}), the script's own notes (`meta`, plus `error` when the case code threw), and the results of `silence` and of the `stop`
 * runCase sends after it. evaluate() sees nothing else. */
export interface CaseTrace{ticks:BenchTickRecord[];cycles:BenchCycleRow[];prompts:{id:string;answer:string}[];objects?:Record<string,Record<string,number>>;meta?:Record<string,unknown>;silence?:Record<string,unknown>;stop?:Record<string,unknown>}
export interface CaseVerdict{status:'tested'|'failed'|'not_run'|'unsupported_by_device';reason:string|null;measurements:Measurement[]}
export interface CaseScript{
 ticks:number;
 /** The commands of tick k from the feedback of tick k-1 ([] at k = 0). `seq` is local to the case: 1 + the tick that first sent it, so at most k + 1 and never
  * decreasing; runCase adds the worker's tick at the start of the case. A repeated seq is a stale command (the worker's channel watchdog counts it). */
 commandsAt(tick:number,feedback:DriveFeedbackV1[]):DriveCommandV1[];
 prompts?:{id:string;atTick:number;text:string}[];
 silence?:{atTick:number;ms:number};          // at most once, and the last thing of the script
 /** Faults the script provokes on purpose; any other fault feedback ends the case (quick stop, then enable false) and disarms the run (BK-D11). */
 expectedFaults?:DriveFault[];
 meta?:Record<string,unknown>;
}
export interface BenchCase{
 id:string;needsTorque:boolean;requires:string[];
 /** Objects `scan` must read for this case's evaluate (they reach it through CaseTrace.objects). */
 reads?:string[];
 script(kit:BenchKitV1,policy:BenchPolicy):CaseScript;
 evaluate(trace:CaseTrace,kit:BenchKitV1,policy:BenchPolicy):CaseVerdict;      // pure: no I/O, no clock, no randomness
}
