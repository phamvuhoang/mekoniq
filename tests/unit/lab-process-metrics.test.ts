import {expect,test} from 'vitest';
import {reportKpis} from '../../packages/lab-runtime/src/v2/comparison';
import type {RunReport,BusinessEvent} from '../../packages/lab-runtime/src/v2/report';
const event=(at:number,type:string,kind:string,id:string,state:BusinessEvent['state']={}):BusinessEvent=>({sequence:'1',at:new Date(at*1000).toISOString(),type,kind,id,state});
test('campaign KPIs separate coffee resource queue, observed travel and union of completed process busy intervals',()=>{
 const report={manifest:{clock:{tickMs:20}},outcome:{served:'2'},effects:[],metrics:{distanceM:{a:4},collision:{available:false}},businessEvents:[
  event(1,'TicketQueued','kitchen-ticket','line-a'),event(2,'TicketQueued','kitchen-ticket','line-b'),
  event(3,'CoffeeJobReserved','coffee-job','a',{lineId:'line-a'}),event(7,'CoffeeJobReserved','coffee-job','b',{lineId:'line-b'}),
  event(4,'RobotCommandIssued','robot-command','cmd-a'),event(5,'RobotCommandIssued','robot-command','cmd-b'),
  event(7,'RobotCommandObserved','robot-command','cmd-a',{status:'completed'}),event(9,'RobotCommandObserved','robot-command','cmd-b',{status:'completed'}),
 ],coffee:{plantLog:[{event:'accepted',commandId:'brew',tick:0},{event:'accepted',commandId:'milk',tick:100},{event:'completed',commandId:'brew',tick:200},{event:'completed',commandId:'milk',tick:300}]}} as unknown as RunReport;
 const metrics=Object.fromEntries(reportKpis(report).map(k=>[k.id,k]));
 expect(metrics.coffeeQueueWaitS).toMatchObject({available:true,value:7,unit:'s',samples:2});
 expect(metrics.travelTimeS).toMatchObject({available:true,value:7,unit:'s',samples:2});
 expect(metrics.cellProcessBusyS).toMatchObject({available:true,value:6,unit:'s',samples:2});
 report.coffee!.plantLog.push({event:'accepted',commandId:'unfinished',tick:400});
 expect(reportKpis(report).find(k=>k.id==='cellProcessBusyS')).toMatchObject({available:false,value:null,reason:'INCOMPLETE_CELL_CYCLE'});
});
