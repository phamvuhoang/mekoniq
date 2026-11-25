#!/usr/bin/env node
// Offline electrical engineering: the same compile the runtime runs, from files, with no gateway and no session.
//   node scripts/lab-hardware.mjs check   --design FILE [--catalog DIR]                  exit 0 compiled, 1 blocked, 2 refused or bad usage
//   node scripts/lab-hardware.mjs compile --design FILE --out DIR [--catalog DIR]        writes electrical-bundle.json (also when blocked)
//   node scripts/lab-hardware.mjs docs    --design FILE --out DIR [--check] [--draw]     --check compares bytes with DIR; --draw runs wireviz when installed
//   node scripts/lab-hardware.mjs compare --design FILE --design FILE [--design FILE] [--catalog DIR]
// The design names the project it is for; the project defaults to the Serve tray fixture. A refused design (shape, catalog, project) never produces a bundle.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tsImport} from 'tsx/esm/api';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage=(m)=>{console.error(`${m}\nusage: lab-hardware.mjs check|compile|docs|compare --design FILE [--out DIR] [--catalog DIR] [--check] [--draw]`);process.exit(2);};
const [command,...args]=process.argv.slice(2),o={designs:[]};
for(let i=0;i<args.length;i++){
 const a=args[i];
 if(a==='--check'||a==='--draw'){o[a.slice(2)]=true;continue;}
 if(!['--design','--out','--catalog'].includes(a)||!args[i+1]||args[i+1].startsWith('--'))usage(`BAD_ARGUMENT:${a}`);
 if(a==='--design')o.designs.push(resolve(args[++i]));else o[a.slice(2)]=resolve(args[++i]);
}
if(!['check','compile','docs','compare'].includes(command??''))usage(`UNKNOWN_COMMAND:${command??''}`);
if(!o.designs.length||(command!=='compare'&&o.designs.length!==1)||(command==='compare'&&(o.designs.length<2||o.designs.length>4)))usage('DESIGN_COUNT');
if((command==='compile'||command==='docs')&&!o.out)usage('OUT_REQUIRED');
const lib=(p)=>tsImport(join(root,'packages/lab-runtime/src/engineering/electrical',p),import.meta.url);
const {compileDesignFile}=await lib('offline.ts');
const catalogRoot=o.catalog??join(root,'robotics/catalog');
const results=[];
for(const design of o.designs)results.push(await compileDesignFile({design,catalogRoot,root}));
const refused=results.find(r=>!r.bundle);
if(refused){for(const p of refused.problems)console.error(`REFUSED ${p.code} ${p.path} ${p.detail}`);process.exit(2);}
const r=results[0],b=r.bundle;
const show=()=>{console.log(`${b.state} ${b.digest} ${b.checks.filter(c=>c.level==='blocking').length} blocking, ${b.checks.filter(c=>c.level==='warning').length} warnings, ${b.checks.filter(c=>c.level==='unverified').length} unverified`);for(const c of b.checks.filter(c=>c.level==='blocking'))console.log(`  BLOCKING ${c.ruleId} ${c.path} ${c.detail}`);};
if(command==='check'){show();process.exit(b.state==='compiled'?0:1);}
if(command==='compile'){await mkdir(o.out,{recursive:true});await writeFile(join(o.out,'electrical-bundle.json'),JSON.stringify(b,null,2)+'\n');show();process.exit(b.state==='compiled'?0:1);}
if(command==='docs'){
 const {renderElectricalDocuments}=await lib('documents.ts');
 let docs;try{docs=renderElectricalDocuments(b,r.profiles);}catch(e){console.error(`REFUSED ${e.message}`);show();process.exit(1);}
 if(o.check){
  const differing=[];
  for(const d of docs){const have=await readFile(join(o.out,d.path)).catch(()=>null);if(!have||!Buffer.from(d.bytes).equals(have))differing.push(d.path);}
  if(differing.length){for(const f of differing)console.error(`DIFFERS ${f}`);process.exit(1);}
  console.log('documents match the design');process.exit(0);
 }
 await mkdir(o.out,{recursive:true});
 for(const d of docs)await writeFile(join(o.out,d.path),d.bytes);
 console.log(`wrote ${docs.length} documents for ${b.digest}`);
 if(o.draw){
  const w=spawnSync('wireviz',['harness.yml'],{cwd:o.out,encoding:'utf8'});
  if(w.error?.code==='ENOENT')console.log('TOOL_NOT_INSTALLED wireviz');
  else if(w.status!==0){console.error(w.stderr);process.exit(1);}
 }
 process.exit(0);
}
if(command==='compare'){console.error('COMPARE_NOT_AVAILABLE');process.exit(2);}
