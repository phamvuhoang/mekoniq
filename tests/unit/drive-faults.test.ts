import {expect,test} from 'vitest';
import {DRIVE_FAULTS,validateDriveFaultSchedule} from '../../packages/lab-runtime/src/v2/control/drive-faults';
const entry=(faultId:string,targetId:string,at:number,durationMs:number,params:Record<string,number>={})=>({id:`${faultId}-${targetId}-${at}`,faultId,targetId,trigger:{kind:'elapsed_sim_ms' as const,value:at},durationMs,params});
const context={axes:['amr-1/wheel-left','amr-1/wheel-right','arm-1/J1','arm-1/gripper'],lidars:['amr-1/lidar-1'],campaign:false};
const codes=(e:ReturnType<typeof entry>[],c=context)=>validateDriveFaultSchedule(e,c).reasonCodes;

test('overlapping faults of one kind on one axis are refused',()=>{
 const overlap=[entry('motor-weak','amr-1/wheel-left',1000,2000,{torqueScale:0.8}),entry('motor-weak','amr-1/wheel-left',2500,1000,{torqueScale:0.5})];
 expect(validateDriveFaultSchedule(overlap,context)).toEqual({ok:false,reasonCodes:['FAULT_OVERLAP']});
 const split=[overlap[0]!,{...overlap[1]!,targetId:'amr-1/wheel-right'}];
 expect(validateDriveFaultSchedule(split,context).ok).toBe(true);
 // a window ends exclusive: the next one may start on that very ms, and different kinds never collide
 expect(validateDriveFaultSchedule([overlap[0]!,{...overlap[1]!,trigger:{kind:'elapsed_sim_ms' as const,value:3000}}],context).ok).toBe(true);
 expect(validateDriveFaultSchedule([overlap[0]!,entry('encoder-dropout','amr-1/wheel-left',1500,300)],context).ok).toBe(true);
});
test('parameters outside the catalog bounds are refused',()=>{
 expect(codes([entry('command-delay','amr-1/wheel-left',0,1000,{delayMs:25})])).toEqual(['FAULT_PARAM_INVALID']);
 expect(codes([entry('command-delay','amr-1/wheel-left',0,1000,{delayMs:20})])).toEqual([]);
 expect(codes([entry('encoder-dropout','amr-1/wheel-right',0,10)])).toEqual(['FAULT_PARAM_INVALID']);
 expect(codes([entry('encoder-dropout','amr-1/wheel-right',0,6000)])).toEqual(['FAULT_PARAM_INVALID']);
 expect(codes([entry('encoder-dropout','amr-1/wheel-right',0,300)])).toEqual([]);
 expect(codes([entry('motor-weak','amr-1/wheel-left',0,1000,{torqueScale:0.1})])).toEqual(['FAULT_PARAM_INVALID']);
 expect(codes([entry('motor-weak','amr-1/wheel-left',0,1000)])).toEqual(['FAULT_PARAM_INVALID']);           // required
 expect(codes([entry('motor-weak','amr-1/wheel-left',0,1000,{torqueScale:0.5,bogus:1})])).toEqual(['FAULT_PARAM_INVALID']);   // unknown parameter
 expect(codes([entry('motor-weak','amr-1/wheel-left',0,1000,{torqueScale:Number.NaN})])).toEqual(['FAULT_PARAM_INVALID']);
 expect(codes([entry('lidar-noise','amr-1/lidar-1',0,1000,{sigmaM:0.05,dropoutFraction:0.6})])).toEqual(['FAULT_PARAM_INVALID']);
 expect(codes([entry('lidar-noise','amr-1/lidar-1',0,1000,{sigmaM:0.05,dropoutFraction:0.5})])).toEqual([]);
});
test('drive-reset is campaign-only',()=>{
 expect(codes([entry('drive-reset','amr-1/wheel-left',0,20)])).toEqual(['FAULT_CAMPAIGN_ONLY']);
 expect(validateDriveFaultSchedule([entry('drive-reset','amr-1/wheel-left',0,20)],{...context,campaign:true}).ok).toBe(true);
});
test('more than 16 entries are refused',()=>{
 const many=(n:number)=>Array.from({length:n},(_,i)=>entry('encoder-dropout','amr-1/wheel-left',i*10_000,100));
 expect(codes(many(17))).toEqual(['FAULT_SCHEDULE_TOO_LONG']);
 expect(validateDriveFaultSchedule(many(16),context).ok).toBe(true);
});
test('targets must be of the right kind and exist; ids are unique; only elapsed triggers',()=>{
 expect(codes([entry('encoder-dropout','amr-1/nope',0,300)])).toEqual(['FAULT_TARGET_INVALID']);
 expect(codes([entry('grip-weak','arm-1/J1',0,1000,{torqueScale:0.5})])).toEqual(['FAULT_TARGET_INVALID']);       // a gripper fault needs a gripper axis
 expect(codes([entry('motor-weak','arm-1/gripper',0,1000,{torqueScale:0.5})])).toEqual(['FAULT_TARGET_INVALID']);  // an axis fault needs a non-gripper axis
 expect(codes([entry('grip-weak','arm-1/gripper',0,1000,{torqueScale:0.5})])).toEqual([]);
 expect(codes([entry('lidar-noise','amr-1/wheel-left',0,1000,{sigmaM:0.01,dropoutFraction:0})])).toEqual(['FAULT_TARGET_INVALID']);
 expect(codes([entry('unknown-fault','amr-1/wheel-left',0,1000)])).toEqual(['FAULT_UNKNOWN']);
 const a=entry('encoder-dropout','amr-1/wheel-left',0,300);
 expect(codes([a,{...a,targetId:'amr-1/wheel-right'}])).toEqual(['FAULT_SCHEDULE_INVALID']);                      // same id twice
 expect(codes([{...a,trigger:{kind:'phase' as never,value:'grasp' as never}}])).toEqual(['FAULT_TRIGGER_INVALID']);
});
test('a run without a drive model refuses every drive fault',()=>{
 expect(codes([entry('encoder-dropout','amr-1/wheel-left',0,300)],{...context,axes:[]})).toEqual(['FAULT_BACKEND_UNSUPPORTED']);
 expect(validateDriveFaultSchedule([],{...context,axes:[]}).ok).toBe(true);
});
test('the catalog states layer, target, executor and bounds of every fault in the spec',()=>{
 expect(Object.keys(DRIVE_FAULTS).sort()).toEqual(['command-delay','command-loss','drive-reset','drive-trip','encoder-dropout','grip-weak','lidar-noise','motor-weak']);
 expect(DRIVE_FAULTS['command-loss']).toMatchObject({layer:'command',target:'axis',appliedBy:'runtime'});
 expect(DRIVE_FAULTS['lidar-noise']).toMatchObject({layer:'sensor',target:'lidar',appliedBy:'runtime'});
 expect(DRIVE_FAULTS['encoder-dropout']).toMatchObject({layer:'feedback',appliedBy:'worker',params:{durationMs:{min:20,max:5000,required:true}}});
 expect(DRIVE_FAULTS['drive-reset'].campaignOnly).toBe(true);
});
