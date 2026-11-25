import {expect,test} from 'vitest';
import {loadCatalog} from '../../packages/lab-runtime/src/engineering/catalog';
import {deviceEvidenceLevel,safetyClaimLevel} from '../../packages/lab-runtime/src/engineering/electrical/profiles';

// The shipped catalog: every value of these profiles was read from a pinned vendor PDF; the level below is what the documents allow today, not a target.
test('the shipped catalog loads its device profiles without problems and states what is still missing',async()=>{
 const c=await loadCatalog('robotics/catalog');
 expect(c.problems).toEqual([]);
 const by=Object.fromEntries(Object.values(c.deviceProfiles).map(p=>[p.id,p]));
 const drv=by['blvd-krd-v1']!;
 expect(deviceEvidenceLevel(drv)).toEqual({level:'candidate',missing:['DATASHEET_MISSING','DESCRIPTION_FILE_MISSING','SAFETY_MANUAL_MISSING']});
 expect(deviceEvidenceLevel(by['blv-r-60w-v1']!).level).toBe('candidate');
 expect(drv.drive!.modes).toEqual(['pp','pv']);                                    // pv only: the ramp is the drive's, so profile acceleration is stated
 expect(drv.drive!.profileAccelerationRadS2!.value).toBeCloseTo(104.7198,3);
 expect(safetyClaimLevel(drv.drive!.stop.torqueOff!,drv)).toBe('manual_only');     // no certificate is pinned
 expect(drv.ioPoints.filter(p=>p.pointId.startsWith('IN')).every(p=>p.busExposure.kind==='none')).toBe(true);
 expect(drv.ioPoints.filter(p=>p.safety).map(p=>p.pointId)).toEqual(['HWTO1','HWTO2']);
});
