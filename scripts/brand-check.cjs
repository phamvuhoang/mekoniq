/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module */
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
function safePath(value) {
 if(typeof value !== 'string' || !/^[A-Za-z0-9_-]+(?:[./][A-Za-z0-9_-]+)*$/.test(value) || value.split('/').some(p=>p==='.'||p==='..') || path.isAbsolute(value)) throw Error('Unsafe manifest path');
 return value;
}
function noSymlinks(value) {
 let current = path.resolve(value);
 for(;;){try{if(fs.lstatSync(current).isSymbolicLink())throw Error('Symlink rejected: '+current);}catch(e){if(e.code!=='ENOENT')throw e;}const parent=path.dirname(current);if(parent===current)break;current=parent;}
}
function walk(dir, prefix='') {
 noSymlinks(dir);
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const rel=prefix+e.name;const full=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('Symlink rejected');if(e.isDirectory())return walk(full,rel+'/');if(!e.isFile())throw Error('Non-file payload');return [rel];}).sort();
}
function validate(m) {
 if(!m||m.schemaVersion!==1||!/^\d+\.\d+\.\d+$/.test(m.brandVersion)||!/^[a-f0-9]{40}$/.test(m.sourceCommit)||!Array.isArray(m.files)||!m.files.length)throw Error('Invalid release schema');
 const seen=new Set();for(const f of m.files){safePath(f.path);if(f.path==='release.json'||seen.has(f.path)||!/^[a-f0-9]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<0)throw Error('Invalid release entry');seen.add(f.path);}
 for(const required of ['tokens.json','tokens.css','components.css','fonts.css','fonts/JetBrainsMono-500.woff2','fonts/BeVietnamPro-400-latin.woff2','fonts/BeVietnamPro-400-vi.woff2','fonts/BeVietnamPro-700-latin.woff2','fonts/BeVietnamPro-700-vi.woff2','fonts/OFL.txt','assets/MEKONIQ_Icon_Transparent.svg','assets/MEKONIQ_Horizontal_White_Transparent_v2.png','assets/MEKONIQ_Wordmark_White_Transparent.png'])if(!seen.has(required))throw Error('Missing required payload: '+required);
 return m;
}
function digest(bytes){return createHash('sha256').update(bytes).digest('hex');}
function check(dir,against) {
 noSymlinks(dir);const m=validate(JSON.parse(fs.readFileSync(path.join(dir,'release.json'),'utf8')));
 if(against){noSymlinks(against);const expected=validate(JSON.parse(fs.readFileSync(against,'utf8')));if(JSON.stringify(m)!==JSON.stringify(expected))throw Error('Release mismatch');}
 const actual=walk(dir);const wanted=[...m.files.map(f=>f.path),'release.json'].sort();if(JSON.stringify(actual)!==JSON.stringify(wanted))throw Error('Unexpected or missing payload');
 for(const f of m.files){const bytes=fs.readFileSync(path.join(dir,f.path));if(bytes.length!==f.bytes||digest(bytes)!==f.sha256)throw Error('Hash mismatch: '+f.path);}
 return m;
}
function cli(args=process.argv.slice(2)){try{const options={};for(let i=0;i<args.length;i+=2){if(!['--dir','--against'].includes(args[i])||!args[i+1]||options[args[i]])throw Error('Usage: --dir <brand-directory> [--against <release.json>]');options[args[i]]=args[i+1];}if(!options['--dir'])throw Error('--dir required');const m=check(options['--dir'],options['--against']);console.log('MEKONIQ '+m.brandVersion+' verified ('+m.files.length+' files)');}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={safePath,noSymlinks,walk,validate,digest,check,cli};
if(require.main===module)cli();
