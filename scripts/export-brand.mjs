import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import checker from './brand-check.cjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const canonical=path.join(root,'packages/ui/brand');
try {
 const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--target')throw Error('Usage: --target <brand-directory>');
 const target=path.resolve(args[1]);checker.noSymlinks(target);
 if(target===canonical||canonical.startsWith(target+path.sep)||target.startsWith(canonical+path.sep))throw Error('Canonical target rejected');
 const inputs=['packages/ui/brand',':(exclude)packages/ui/brand/release.json'];
 if(execFileSync('git',['status','--porcelain','--',...inputs],{cwd:root,encoding:'utf8'}).trim())throw Error('Canonical brand inputs are dirty');
 const sourceCommit=execFileSync('git',['log','-1','--format=%H','--',...inputs],{cwd:root,encoding:'utf8'}).trim();
 const files=checker.walk(canonical).filter(p=>p!=='release.json').map(p=>{const b=fs.readFileSync(path.join(canonical,p));return {path:p,sha256:checker.digest(b),bytes:b.length};});
 const release=checker.validate({schemaVersion:1,brandVersion:JSON.parse(fs.readFileSync(path.join(canonical,'tokens.json'))).brandVersion,sourceCommit,files});
 const previousPath=path.join(canonical,'release.json');
 if(fs.existsSync(previousPath)){const previous=checker.validate(JSON.parse(fs.readFileSync(previousPath,'utf8')));if(previous.brandVersion===release.brandVersion && JSON.stringify(previous.files)!==JSON.stringify(files))throw Error('Bump brandVersion before changing released content');}
 const receipt=JSON.stringify(release,null,2)+'\n';
 if(fs.existsSync(target)){const allowed=new Set([...files.map(f=>f.path),'release.json']);for(const p of checker.walk(target))if(!allowed.has(p))throw Error('Unrecognized target file: '+p);}
 // Stage a complete sibling directory before replacing the target. Never delete unknown files.
 fs.mkdirSync(path.dirname(target),{recursive:true});checker.noSymlinks(path.dirname(target));
 const stage=fs.mkdtempSync(path.join(path.dirname(target),'.brand-stage-'));const backup=stage+'-old';let moved=false;
 try{for(const f of files){const out=path.join(stage,f.path);fs.mkdirSync(path.dirname(out),{recursive:true});fs.copyFileSync(path.join(canonical,f.path),out);}fs.writeFileSync(path.join(stage,'release.json'),receipt);checker.check(stage);
 if(fs.existsSync(target)){fs.renameSync(target,backup);moved=true;}try{fs.renameSync(stage,target);}catch(e){if(moved)fs.renameSync(backup,target);throw e;}if(moved)fs.rmSync(backup,{recursive:true});
 fs.writeFileSync(path.join(canonical,'release.json'),receipt);console.log('Exported MEKONIQ '+release.brandVersion+' to '+target);
 }finally{if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});}
}catch(e){console.error(e.message);process.exitCode=1;}
