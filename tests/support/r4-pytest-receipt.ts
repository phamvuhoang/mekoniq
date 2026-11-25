import {readFileSync} from 'node:fs';
export const fullRoster=readFileSync('scripts/native-sim/r4-cld02-pytest-roster.txt','utf8').trimEnd().split('\n');
export const pytestIdentity={source:'a'.repeat(40),imageId:'sha256:'+'1'.repeat(64),invocation:'0123456789abcdef0123456789abcdef'};
const {source,imageId,invocation}=pytestIdentity;
export function pytestArtifact(ids:string[],collected=ids,extra=''){
 const xmlEscape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const props={cld02Source:source,cld02Image:imageId,cld02Invocation:invocation};
 const properties=Object.entries(props).map(([name,value])=>`<property name="${name}" value="${value}"/>`).join('');
 const rows=ids.map(id=>{const [file,name]=id.split('::');return `<testcase classname="${file!.replaceAll('/','.').replace(/\.py$/,'')}" name="${xmlEscape(name!)}"/>`;}).join('');
 return {'pytest/collection.json':JSON.stringify({schemaVersion:1,sourceCommit:source,imageId,invocationId:invocation,nodeIds:collected}),
  'pytest/full.xml':`<testsuites><testsuite tests="${ids.length+(extra?1:0)}" errors="0" failures="0" skipped="0"><properties>${properties}</properties>${rows}${extra}</testsuite></testsuites>`};
}
