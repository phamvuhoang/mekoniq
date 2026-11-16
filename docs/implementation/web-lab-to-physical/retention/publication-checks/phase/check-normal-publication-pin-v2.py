from pathlib import Path
import json,subprocess,sys,hashlib,os,datetime
b=Path(__file__).resolve().parent;active=b.parents[4];paths=json.loads((b/'paths.json').read_text());clone=json.loads((b/'normal-publication-clones-after-lab-link.json').read_text());workspace=Path(clone['workspace']);manifest=json.loads((Path(paths['lab'])/'config/source-runtime.lock.json').read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();reuse=[]
for name in ['source','lab']:
 original=active if name=='source' else Path(paths['lab']);target=workspace/name;assert sha(original/'pnpm-lock.yaml')==sha(target/'pnpm-lock.yaml');assert (target/'node_modules').is_dir() and not (target/'node_modules').is_symlink();reuse.append({'repository':name,'lockSha256':sha(target/'pnpm-lock.yaml'),'nodeModules':str(target/'node_modules'),'scope':'Own real ignored directory with per-entry symlinks to explicitly reused equal-lock dependencies; no fresh installation or producer qualification.'})
ops=[]
def run(name,cwd,args):
 r=subprocess.call([sys.executable,str(b/'run.py'),name,str(cwd),'perl','-e','alarm 300; exec @ARGV',*map(str,args)]);assert r==0,(name,r)
installed=Path(paths['lab'])/'.runtime'/manifest['artifactSha256'];run('normal-clone-v2-import-pin',workspace/'lab',['node','scripts/import-runtime.mjs',installed]);assert sha(workspace/'lab/config/source-runtime.lock.json')==sha(Path(paths['lab'])/'config/source-runtime.lock.json')
run('normal-clone-v2-check-source',workspace/'lab',['pnpm','check:source'])
run('normal-clone-v2-contract-bytes',workspace/'lab',['node','scripts/sync-engineering-contracts.mjs','--check'])
run('normal-clone-v2-portable-licenses',workspace/'source',['node','scripts/portable-licenses.mjs','--check'])
closure="import {nativeToolClosure,portableToolClosure} from './scripts/native-sim/tool-identity.mjs';const native=nativeToolClosure(process.cwd()),portable=portableToolClosure(process.cwd());console.log(JSON.stringify({native:native.digest,portable:portable.digest,nativeFiles:native.files.length,portableFiles:portable.files.length}));if(native.digest!=='79018e0a2601d8a27d3739751910bb392c86c2857cc39ad5fb451a977de78634'||portable.digest!=='30dc0de3e034b14593ae3629a1f247724392d950578913cacc1dd2e9ca9bc69b')process.exit(1);"
run('normal-clone-v2-closure-identity',workspace/'source',['node','--input-type=module','-e',closure])
run('normal-clone-v2-contracts-check',workspace/'source',['pnpm','contracts:check'])
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'workspace':str(workspace),'publicationHeads':clone['heads'],'pinnedSource':manifest['sourceCommit'],'runtimeArtifact':manifest['artifactSha256'],'dependencyReuse':reuse,'installedRuntimeInput':str(installed),'lockByteIdentity':True,'scope':'Ordinary installed runtime/pin, contracts and portable closure checks after docs publication. No fresh runtime export, engine/browser execution, Linux/native qualification or productionBuildIdentity at publication HEAD claimed.'};(b/'normal-publication-pin-checks.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
