import {expect,test} from 'vitest';
import {reportKpis} from '../../src/reports/compare';
import type {RunReport} from '../../src/scenarios/controls';

const journalEvent=(second:number,type:string,kind:string,id:string,state:Record<string,unknown>)=>({sequence:String(second),at:new Date(Date.parse('2026-11-01T00:00:00Z')+second*1000).toISOString(),type,kind,id,state});
const arrival=(second:number,mission:string,stop:string,allocations:string[],action='load')=>journalEvent(second,'MissionArrived','mission',mission,{currentStopId:stop,stops:[{id:stop,action,status:'awaiting_action',allocationIds:allocations}]});
const confirmed=(second:number,mission:string,allocation:string,type='CargoLoaded')=>journalEvent(second,type,'allocation',allocation,{missionId:mission});
const waitKpi=(events:RunReport['businessEvents'])=>reportKpis({businessEvents:events,effects:[],outcome:{served:'0'},metrics:{distanceM:{'amr-1':1},collision:{available:true,contacts:0,minSeparationM:0.2}}} as unknown as RunReport).find(k=>k.id==='humanWaitS');
test('human wait correlates overlapping missions and counts one interval per completed stop',()=>{
 expect(waitKpi([arrival(1,'A','load-A',['a']),arrival(2,'B','load-B',['b']),confirmed(3,'A','a'),confirmed(4,'B','b')])).toMatchObject({value:4,samples:2});
});
test('partial handoff waits until the last allocation without double counting duplicate confirmations',()=>{
 const events=[arrival(1,'A','table',['a','b'],'handoff'),confirmed(2,'A','a','DeliveryHandedOff'),confirmed(3,'A','a','DeliveryHandedOff')];
 expect(waitKpi(events)).toMatchObject({value:null,samples:0,reason:'NO_CONFIRMED_STOP'});
 expect(waitKpi([...events,confirmed(5,'A','b','DeliveryHandedOff')])).toMatchObject({value:4,samples:1});
});
test('cancelled stops are excluded and a later return starts its own interval',()=>{
 expect(waitKpi([arrival(1,'A','table',['a'],'handoff'),journalEvent(2,'MissionCancellationRequested','mission','A',{status:'cancelling',stops:[{id:'table',status:'skipped'}]}),confirmed(3,'A','a','DeliveryHandedOff'),arrival(4,'A','return',['a'],'return'),confirmed(7,'A','a','CargoReturned')])).toMatchObject({value:3,samples:1});
});
test('a single robot has no inter-robot separation even if a legacy report included wall clearance',()=>{
 const r={businessEvents:[],effects:[],outcome:{served:'0'},metrics:{distanceM:{'amr-1':1},collision:{available:true,contacts:0,minSeparationM:0.2}}} as unknown as RunReport;
 expect(reportKpis(r).find(k=>k.id==='minSeparationM')).toMatchObject({available:false,value:null,reason:'SINGLE_ROBOT',samples:0});
});
