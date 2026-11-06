// Cross-runtime contract of the arm bridge (plan 03 A03): the TS adapter validates the same shared fixture the Python bridge validates, so a
// message one side accepts the other cannot refuse. arm.command.v1 wraps the cell command authority envelope; forbidden fields are named.
import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {validateArmCommand,validateArmObservation,classifyField} from '../../packages/lab-runtime/src/v2/contracts';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
const fixture=JSON.parse(readFileSync('tests/fixtures/digital-twin/arm/messages.json','utf8')) as {profileHash:string;valid:{name:string;message:Record<string,unknown>}[];invalid:{name:string;message:Record<string,unknown>;code:string}[]};
const profile=JSON.parse(readFileSync('integrations/arm-controller/configs/sim/puma560/profile.json','utf8')) as Record<string,unknown>;
const validate=(m:Record<string,unknown>)=>m.kind==='arm.command.v1'?validateArmCommand(m):validateArmObservation(m);
test('the fixture is bound to the pinned sim profile by the same canonical hash',()=>{expect(fixture.profileHash).toBe(hashJson(profile));});
test('every valid fixture message validates; every invalid one is refused with the named code',()=>{
 for(const v of fixture.valid){const r=validate(v.message);expect(r.ok,v.name+JSON.stringify(r)).toBe(true);}
 for(const i of fixture.invalid){
  const r=validate(i.message);expect(r.ok,i.name).toBe(false);
  if(r.ok)continue;
  const codes=r.issues.map(x=>x.path?`${x.code}:${x.path}`:x.code);
  const [code,field]=i.code.split(':');
  // the same classification as the Python bridge: forbidden property name, required field, or the offending path; unknown kinds fail the discriminator
  const matched=i.code==='KIND_UNKNOWN'?r.issues.length>0:code==='FIELD_REQUIRED'?r.issues.some(x=>x.code==='FIELD_REQUIRED'&&x.message.includes(field!)):code==='INVALID_FIELD'?r.issues.some(x=>x.path===field):r.issues.some(x=>x.code===classifyField(field!)&&x.message.includes(field!));
  expect(matched,`${i.name}: ${codes.join(',')}`).toBe(true);
 }
});
