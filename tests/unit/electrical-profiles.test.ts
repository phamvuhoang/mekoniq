import {expect,test} from 'vitest';
import {deviceEvidenceLevel,safetyClaimLevel,profileSources} from '../../packages/lab-runtime/src/engineering/electrical/profiles';
import {assumedSource,driveProfile} from '../support/electrical';

test('one assumed source keeps a profile at candidate and names the reason',()=>{
 expect(deviceEvidenceLevel(driveProfile({ioSource:assumedSource}))).toEqual({level:'candidate',missing:['ASSUMED_SOURCE']});
});
test('a fully cited profile is documented even when the firmware is not pinned',()=>{
 expect(deviceEvidenceLevel(driveProfile({firmware:null}))).toEqual({level:'documented',missing:[]});
});
test('a missing order code, datasheet, manual, description file or safety manual each lower the level with their own code',()=>{
 expect(deviceEvidenceLevel(driveProfile({orderCode:null})).missing).toEqual(['ORDER_CODE_MISSING']);
 const strip=(kind:string)=>{const p=driveProfile();return {...p,documents:p.documents.filter(d=>d.kind!==kind)};};
 expect(deviceEvidenceLevel(strip('datasheet')).missing).toContain('DATASHEET_MISSING');
 expect(deviceEvidenceLevel(strip('manual')).missing).toContain('MANUAL_MISSING');
 expect(deviceEvidenceLevel(strip('description_file')).missing).toEqual(['DESCRIPTION_FILE_MISSING']);
 expect(deviceEvidenceLevel(strip('safety_manual')).missing).toEqual(['SAFETY_MANUAL_MISSING']);
});
test('a manufacturer source whose document is not declared with that digest counts as assumed',()=>{
 const p=driveProfile(),bad={...p,documents:p.documents.map(d=>d.id==='manual'?{...d,digest:'b'.repeat(64)}:d)};
 expect(deviceEvidenceLevel(bad).missing).toEqual(['ASSUMED_SOURCE']);
});
test('a torque-off claim is certified only by a certificate that names the order code',()=>{
 const p=driveProfile({orderCode:'DRV-200',certificateModels:['DRV-750']});
 expect(safetyClaimLevel(p.drive!.stop.torqueOff!,p)).toBe('manual_only');
 const q=driveProfile({orderCode:'DRV-750',certificateModels:['DRV-750']});
 expect(safetyClaimLevel(q.drive!.stop.torqueOff!,q)).toBe('certified');
 const r={...q,documents:q.documents.filter(d=>d.kind!=='certificate')};
 expect(safetyClaimLevel(r.drive!.stop.torqueOff!,r)).toBe('manual_only');
});
test('profileSources lists every source in a stable order',()=>{
 const a=profileSources(driveProfile()),b=profileSources(driveProfile());
 expect(a.length).toBeGreaterThan(10);expect(a).toEqual(b);
});
