// Isolated committed checker snapshot: test edits never touch the real checkout or retained evidence.
import {mkdtemp,mkdir,readFile,writeFile,symlink} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
export async function checkerFixture(){
 const root=await mkdtemp(join(tmpdir(),'native-checker-test-')),source=process.cwd();
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',timeout:15000});
 const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z','--','scripts','packages','robotics','integrations','tests/fixtures','package.json','pnpm-lock.yaml','tsconfig.json','.gitignore'],{cwd:source,encoding:'utf8',timeout:15000}).split('\0').filter(Boolean);
 for(const path of new Set(paths)){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),await readFile(resolve(source,path)));}
 await symlink(join(source,'node_modules'),join(root,'node_modules'));
 git('init','--quiet');git('add','.');git('-c','user.name=Protocol test','-c','user.email=protocol@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','--quiet','-m','Synthetic checker snapshot');
 return {root,git};
}
