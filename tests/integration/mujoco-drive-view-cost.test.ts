// Review of V05, DRV08: the cost of one run view of a cell with a drive must not grow with the number of ticks run (the view once rebuilt the whole drive report on every poll:
// 0.8 ms at tick 500, 6.3 ms at tick 4000; a cell without a drive stays at 0.12 ms). Measured on the real engine, interleaved with the same run without a drive.
import {afterEach,expect,test} from 'vitest';
import {rm} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {openCell,cellUntil} from '../support/mujoco-cell';

type Cell=Awaited<ReturnType<typeof openCell>>;
const open:Cell[]=[];
afterEach(async()=>{for(const h of open.splice(0)){await h.run.close().catch(()=>{});await rm(h.directory,{recursive:true,force:true});}});
const median=(xs:number[])=>[...xs].sort((a,b)=>a-b)[xs.length>>1]!;
const viewMs=async(h:Cell)=>{const t:number[]=[];for(let i=0;i<41;i++){const s=performance.now();await h.run.snapshot();t.push(performance.now()-s);}return median(t);};

// one MuJoCo run at a time per runtime (MUJOCO_CAPACITY): the two cells run one after the other, the same seed, the same ticks
async function measure(name:string,extra:Record<string,string>){
 const h=await openCell(7,name,{},extra);open.push(h);await h.run.start();
 const out:Record<number,number>={};
 for(const stop of [300,1500]){await cellUntil(h.run,v=>v.tick>=stop,3000,25);out[stop]=await viewMs(h);}
 await h.run.close();await rm(h.directory,{recursive:true,force:true});open.splice(open.indexOf(h),1);
 return out;
}
test('a view of a cell with a drive costs the same at tick 1500 as at tick 300, and about what a cell without a drive costs',async()=>{
 const plain=await measure('view-plain',{}),drive=await measure('view-drive',{driveExperimentId:'drive-nominal-v1'});
 console.log('DRV08 view cost ms',JSON.stringify({plain,drive}));
 expect(drive[1500]!,'the view must not grow with the tick count').toBeLessThanOrEqual(drive[300]!*1.5+0.1);
 expect(drive[1500]!,'and costs about what a cell without a drive costs').toBeLessThanOrEqual(plain[1500]!*2+0.1);
},900_000);
