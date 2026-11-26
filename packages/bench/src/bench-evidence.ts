// The bench evidence level of one device by serial (spec B1 §8). R5's deviceEvidenceLevel is unchanged and still gives the level without a record.
import {deviceEvidenceLevel} from '../../lab-runtime/src/engineering/electrical/profiles';
import type {DeviceProfileV1} from '../../lab-runtime/src/engineering/electrical/contracts';
import type {BenchRecordV1} from './contracts';

/** `record` must be one verifyBenchRecord read back clean (this is pure and does not re-read it). bench_measured: a hardware record, this serial among its devices
 * on this profile, G-KID1 tested and no contradicted closure; bench_verified: also an acceptance sidecar bound to this record's SHA-256. Otherwise the R5 level. */
export function benchEvidence(profile:DeviceProfileV1,record:BenchRecordV1|null,serial:string|null,acceptance:{recordSha256:string}|null,recordSha256:string|null):'candidate'|'documented'|'bench_measured'|'bench_verified'{
 const r5=deviceEvidenceLevel(profile).level;
 if(!record||!serial||record.host.testLevel!=='hardware'||record.gates['G-KID1']?.status!=='tested'||record.closures.some(c=>c.result==='contradicted')
  ||!record.devices.some(d=>d.serial===serial&&d.profileId===profile.id))return r5;
 return acceptance&&recordSha256&&acceptance.recordSha256===recordSha256?'bench_verified':'bench_measured';
}
