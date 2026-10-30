import {spawnSync} from 'node:child_process';
const checks=[['Node24',process.versions.node.startsWith('24.')],
  ...[['docker',['info','--format','{{.ServerVersion}}']],['python3',['--version']],['java',['-version']],['supabase',['--version']]].map(([name,args])=>[name,spawnSync(name,args,{stdio:'ignore',timeout:10000}).status===0])];
if(process.argv.includes('--android')) checks.push(['Android SDK',!!process.env.ANDROID_HOME],['adb',spawnSync('adb',['version'],{stdio:'ignore',timeout:5000}).status===0]);
if(process.argv.includes('--database')) {
 const version=spawnSync('docker',['exec','supabase_db_mekoniq-w00-w04','psql','-U','postgres','-d','postgres','-Atc','SHOW server_version_num'],{encoding:'utf8',timeout:10000});
 checks.push(['local PostgreSQL 17',version.status===0&&Number(version.stdout.trim())>=170000&&Number(version.stdout.trim())<180000]);
}
for(const [name,ok] of checks) console.log(`${ok?'OK':'MISSING'} ${name}`);
process.exit(checks.every(([,ok])=>ok)?0:2);
