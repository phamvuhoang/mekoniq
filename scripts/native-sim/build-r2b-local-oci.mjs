#!/usr/bin/env node
// Called only at the final Docker prerequisite stage. Uses an existing running local builder; never creates one or pushes.
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {runProbeCommand} from './mujoco-probe-process.mjs';
import {readLocalOciLayout,localImageAssociationIssues,localBuilderIssues} from './local-oci.mjs';
const [contextArg,tag,platform,outArg]=process.argv.slice(2);if(!contextArg||!tag||platform!=='linux/amd64'||!outArg||process.argv.length!==6)throw Error('USAGE: CONTEXT TAG linux/amd64 FRESH_OUT');
if(process.env.DOCKER_HOST||process.env.DOCKER_CONTEXT||process.env.BUILDX_BUILDER)throw Error('LOCAL_BUILDER_CONTEXT');
const context=resolve(contextArg),out=resolve(outArg);if(/[,\r\n]/.test(out))throw Error('OCI_OUTPUT_PATH');await mkdir(out,{mode:0o700});let index=0;
const command=async(args,timeoutMs=30000)=>{const dir=join(out,'command-'+ ++index);await mkdir(dir);const r=await runProbeCommand('docker',args,{out:dir,timeoutMs});if(r.status!=='completed')throw Error('LOCAL_OCI_COMMAND_FAILED:'+index);return readFile(join(dir,'stdout.log'),'utf8');};
const ctx=JSON.parse(await command(['context','inspect'])),version=await command(['buildx','version']),inspection=await command(['buildx','inspect','--timeout','20s']),builder=localBuilderIssues(ctx,version,inspection,process.env);if(builder.issues.length)throw Error(builder.issues.join(','));
const pkg=await readFile(join(context,'r2b-campaign-package.json')),parsed=JSON.parse(pkg),{createHash}=await import('node:crypto'),sha=b=>createHash('sha256').update(b).digest('hex');
await command(['--context',ctx[0].Name,'buildx','build','--builder',builder.name,'--platform',platform,'--provenance=false','--output','type=oci,tar=false,dest='+join(out,'layout'),'--output','type=docker','--build-arg','SOURCE_COMMIT='+parsed.sourceCommit,'--build-arg','R2B_CAMPAIGN_PACKAGE_SHA256='+sha(pkg),'--build-arg','R2B_CAMPAIGN_BUNDLE_SHA256='+parsed.bundleSha256,'--tag',tag,context],1800000);
const oci=await readLocalOciLayout(join(out,'layout')),inspected=JSON.parse(await command(['--context',ctx[0].Name,'image','inspect',oci.configDigest]));if(inspected.length!==1)throw Error('OCI_INSPECT_COUNT');const issues=localImageAssociationIssues(oci,inspected[0]);if(issues.length)throw Error(issues.join(','));
await writeFile(join(out,'image-inspect.json'),JSON.stringify(inspected[0],null,2)+'\n');await writeFile(join(out,'local-image-association.json'),JSON.stringify({...oci,manifest:undefined,config:undefined,sourceCommit:parsed.sourceCommit,accepted:false},null,2)+'\n');
await writeFile(join(out,'platform-manifest.json'),await readFile(join(out,'layout/blobs/sha256',oci.manifestDigest.slice(7))));await writeFile(join(out,'image-config.json'),await readFile(join(out,'layout/blobs/sha256',oci.configDigest.slice(7))));await cp(join(context,'r2b-campaign-package.json'),join(out,'r2b-campaign-package.json'),{errorOnExist:true,force:false});console.log(JSON.stringify({out,manifestDigest:oci.manifestDigest,configDigest:oci.configDigest,accepted:false,registryObservation:false}));
