// Playwright JSON reports use nested suites, one spec per test declaration and one result per attempt.
export function playwrightAttempts(suite,bytes){
 const report=JSON.parse(bytes),selector=suite.command.find(a=>a.endsWith('.spec.ts')).replace(/^tests\/e2e\//,''),attempts=[],ids=new Set();
 const check=ok=>{if(!ok)throw Error('PLAYWRIGHT_RESULT:'+suite.id);};
 const visit=node=>{
  if(node.file!==undefined)check(node.file===selector);
  for(const spec of node.specs??[]){
   check(spec.file===selector&&spec.ok===true&&typeof spec.id==='string'&&spec.id&&!ids.has(spec.id)&&spec.title&&spec.tests?.length);ids.add(spec.id);
   for(const t of spec.tests){
    const r=t.results?.[0];check(t.status==='expected'&&t.expectedStatus==='passed'&&t.results?.length===1&&r.status==='passed'&&r.errors?.length===0);
    attempts.push({title:spec.title,result:r});
   }
  }
  for(const child of node.suites??[])visit(child);
 };
 visit(report);
 const s=report.stats;check(report.errors?.length===0&&attempts.length>0&&s?.expected===attempts.length&&s.unexpected===0&&s.skipped===0&&s.flaky===0);
 return attempts;
}
export function checkPlaywrightResult(suite,bytes){
 try{playwrightAttempts(suite,bytes);return [];}catch{return ['PLAYWRIGHT_RESULT:'+suite.id];}
}
export function checkPlaywrightProcess(required,actual,read){
 const prefix='suites/'+required.id,issues=[];
 if(actual.result?.file!==prefix+'/result.json')issues.push('PLAYWRIGHT_RESULT_PATH:'+required.id);
 try{
  const p=JSON.parse(read(prefix+'/process.json')),stats=JSON.parse(read(prefix+'/result.json')).stats;
  const started=Date.parse(p.startedAt),finished=Date.parse(p.finishedAt),run=Date.parse(stats.startTime);
  if(!(started<=run&&Number.isFinite(stats.duration)&&stats.duration>0&&run+stats.duration<=finished+1))throw Error(); // JSON stats can have fractional milliseconds
  if(actual.process!==prefix+'/process.json'||actual.repo!==required.repo||actual.kind!==required.kind||actual.exitCode!==0||p.status!=='completed'||p.exitCode!==0||p.exitSignal!==null||p.spawnError!==null||p.writeError!==null||
    !/(^|[\\/])node(?:\.exe)?$/.test(p.command)||JSON.stringify(p.args)!==JSON.stringify(required.command))throw Error();
 }catch{issues.push('PLAYWRIGHT_PROCESS:'+required.id);}
 return issues;
}
