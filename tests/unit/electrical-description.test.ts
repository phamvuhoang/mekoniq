import {expect,test} from 'vitest';
import {crossCheckDescription} from '../../packages/lab-runtime/src/engineering/electrical/profiles';
import type {DescriptionSummary} from '../../packages/lab-runtime/src/engineering/catalog';
import {driveProfile} from '../support/electrical';

const obj=(index:string,subindex:number,pdoMappable:boolean)=>({index,subindex,name:index,access:'rw' as const,pdoMappable});
const summary=(o:Partial<DescriptionSummary>={}):DescriptionSummary=>({kind:'eds',fileSha256:'a'.repeat(64),vendorId:'0x1',productCode:'0x2',revision:'0x3',supportedModes:['pp','pv','csp','csv'],objects:[obj('60FD',0,true),obj('60FE',1,false)],...o});

test('a profile that agrees with the description has no problems',()=>{expect(crossCheckDescription(driveProfile(),summary())).toEqual([]);});
test('a cyclic point on an object the description does not map is a contradiction',()=>{
 expect(crossCheckDescription(driveProfile(),summary({objects:[obj('60FD',0,false),obj('60FE',1,false)]})).map(p=>p.code)).toEqual(['BUS_EXPOSURE_CONTRADICTS_DESCRIPTION','BUS_EXPOSURE_CONTRADICTS_DESCRIPTION']);
});
test('a mode outside the supported-modes mask is a contradiction; an empty mask means unknown and is not checked',()=>{
 expect(crossCheckDescription(driveProfile(),summary({supportedModes:['pp']})).map(p=>p.code)).toEqual(['MODE_CONTRADICTS_DESCRIPTION','MODE_CONTRADICTS_DESCRIPTION']);
 expect(crossCheckDescription(driveProfile(),summary({supportedModes:[]}))).toEqual([]);
});
test('an object the description does not have is OBJECT_UNKNOWN',()=>{
 expect(crossCheckDescription(driveProfile(),summary({objects:[obj('60FD',0,true)]})).map(p=>p.code)).toEqual(['OBJECT_UNKNOWN']);
});
