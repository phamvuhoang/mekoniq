import {expect,test} from 'vitest';
import {createLab} from '../support/lab';
import {createProductionRegistry} from '../../packages/domain/src/application';
import {rolePermissions} from '../../apps/cloud-web/src/server/modules/identity/rbac';
test('fresh production registry can provision venue layout without restaurant fixture seeds',async()=>{
 const production=createProductionRegistry();
 const lab=await createLab(registry=>registry.register('Venue.Configure',(c,s)=>production.decide(c,s)));
 lab.addAuthorization(actor=>rolePermissions(actor).includes('configuration.publish'));
 try{
  const payload={stations:[{id:'prep',name:'Preparation'}],tables:[{id:'tableA',name:'Table A'}],simulatedRobots:[{id:'training',trays:2,maxLoadMinor:'20000'}]};
  expect((await lab.command('manager','Venue.Configure',payload)).status).toBe('accepted');
  expect((await lab.state<{driver:string;validation:string;ownerDeviceId:string}>('robot','training'))).toMatchObject({driver:'simulator',validation:'simulated',ownerDeviceId:'coordinator'});
  expect((await lab.state<{name:string}>('station','prep')).name).toBe('Preparation');
  expect((await lab.command('manager','Venue.Configure',{...payload,expectedVersion:1,simulatedRobots:[{id:'hardware',driver:'valetudo'}]})).code).toBe('SIMULATION_PROFILE_REQUIRED');
 }finally{await lab.close();}
});
