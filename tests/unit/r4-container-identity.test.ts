import {expect,test} from 'vitest';
import {assertR4Image,assertR4Runtime} from '../support/r4-container-identity';

const expected={sourceCommit:'a'.repeat(40),schemaHash:'b'.repeat(64),artifactSha256:'c'.repeat(64)};
const host={os:'Darwin',machine:'arm64',daemonPlatform:'linux/arm64'};
const image={Id:'sha256:'+'d'.repeat(64),Os:'linux',Architecture:'arm64',Config:{Labels:{'org.opencontainers.image.revision':expected.sourceCommit}}};
const health={sourceCommit:expected.sourceCommit,schemaHash:expected.schemaHash};
test('accepts the Darwin arm64 host with its matching Linux arm64 image and runtime export',()=>{
 expect(()=>assertR4Image(host,image,expected.sourceCommit)).not.toThrow();
 expect(()=>assertR4Runtime(expected,health,expected.artifactSha256)).not.toThrow();
});
test.each([
 ['Darwin x86 host',{...host,machine:'x86_64'},image],
 ['Linux host',{...host,os:'Linux'},image],
 ['amd64 Docker daemon',{...host,daemonPlatform:'linux/amd64'},image],
 ['emulated amd64 image',host,{...image,Architecture:'amd64'}],
 ['non-Linux image',host,{...image,Os:'windows'}],
] as const)('rejects %s before recording CLD01',(_reason,candidateHost,candidateImage)=>{
 expect(()=>assertR4Image(candidateHost,candidateImage,expected.sourceCommit)).toThrow('NATIVE_ARCH_REQUIRED');
});
test('rejects a stale OCI revision before starting the container',()=>{
 expect(()=>assertR4Image(host,{...image,Config:{Labels:{'org.opencontainers.image.revision':'1'.repeat(40)}}},expected.sourceCommit)).toThrow('IMAGE_STALE');
});
test.each([
 ['old runtime',{...health,sourceCommit:'1'.repeat(40)},expected.artifactSha256],
 ['wrong embedded schema',{...health,schemaHash:'1'.repeat(64)},expected.artifactSha256],
 ['wrong runtime bytes',health,'1'.repeat(64)],
] as const)('rejects %s as IMAGE_STALE',(_reason,candidateHealth,bundle)=>{
 expect(()=>assertR4Runtime(expected,candidateHealth,bundle)).toThrow('IMAGE_STALE');
});
