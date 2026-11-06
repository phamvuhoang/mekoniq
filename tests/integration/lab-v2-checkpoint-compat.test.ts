import {afterEach,expect,test} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {act,cleanupRuns,openCoffee,runDirectory,stepUntil} from '../support/lab-v2';
afterEach(cleanupRuns);
test('legacy coffee checkpoint without trays reopens before pickup and completes with journal-owned cup custody',async()=>{
 const directory=await runDirectory(),options={seed:42,directory};let run=await openCoffee('BV01',options);
 await run.start();await act(run,'step',{ticks:30});await run.close();
 const path=join(directory,'run.json'),checkpoint=JSON.parse(await readFile(path,'utf8'));delete checkpoint.coffee.trays;
 await writeFile(path,JSON.stringify(checkpoint));run=await openCoffee('BV01',options);
 try{await stepUntil(run,undefined,500);const report=await run.report();expect(report.outcome).toMatchObject({status:'completed',served:'2'});
  expect(report.coffee!.cups.every(c=>c.ownerKind==='customer')).toBe(true);
 }finally{await run.close();}
});
