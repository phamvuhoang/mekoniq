import {afterAll,beforeAll,expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {runTrayCampaign,verifyTrayCampaign} from '../../packages/lab-runtime/src/v2/simulation3d/tray-campaign';

// These run the real MuJoCo worker through the campaign runner and read each case back from its files with the campaign verifier.
const root=resolve('.'),COMMIT='0'.repeat(40);
let dir:string;
beforeAll(async()=>{dir=await mkdtemp(join(tmpdir(),'tray-int-'));});
afterAll(async()=>{if(dir)await rm(dir,{recursive:true,force:true});});
const verdictOf=(s:{verdicts:{id:string;result:string}[]},id:string)=>s.verdicts.find(v=>v.id===id)?.result;

test('tray-nominal-v1 seed 7 serves all three cups after the confirmation and no cup slides past the warning threshold in any window',async()=>{
 const out=join(dir,'a'),v=await runTrayCampaign({root,out,sourceCommit:COMMIT,caseId:'a-nominal-s7'});
 expect(v.issues).toEqual([]);expect(v.completedCases).toBe(1);
 const s=v.summaries[0]!;
 expect(s).toMatchObject({status:'completed',served:'3'});
 expect(verdictOf(s,'SERVED_ALL')).toBe('pass');expect(verdictOf(s,'SLIP_BELOW_WARN')).toBe('pass');expect(verdictOf(s,'NO_FALSE_SERVE')).toBe('pass');
 expect(s.maxLoadSlipM.value!).toBeLessThan(0.005);
 // the soft friction of the engine lets a cup drift some centimetres over a whole mission, far inside the friction cone; that drift is real in this model and is reported, not hidden
 expect(s.cumulativeDriftM).toBeGreaterThan(0.005);
 expect(s.accelerationLimitMps2).toBe(0.5);expect(s.serviceTimeS.available).toBe(true);
 expect((await verifyTrayCampaign(out,'a-nominal-s7')).issues).toEqual([]);   // the same verdicts again, from the files alone
},900_000);

test('tray-person-crossing-v1 seed 7: the robot stops for the person, never touches them, goes on once the way is clear and serves all three',async()=>{
 const out=join(dir,'d'),v=await runTrayCampaign({root,out,sourceCommit:COMMIT,caseId:'d-person-crossing-s7'});
 expect(v.issues).toEqual([]);const s=v.summaries[0]!;
 expect(s).toMatchObject({status:'completed',served:'3'});
 for(const id of ['NO_PROXY_CONTACT','STOPPED_FOR_PERSON','RESUMED_AFTER_PASS','SERVED_ALL'])expect(verdictOf(s,id),id).toBe('pass');
 expect(s.person!.contactTicks).toEqual([]);expect(s.person!.stoppedTicks).toBeGreaterThanOrEqual(10);
},900_000);
