import {readFile,writeFile} from 'node:fs/promises';
import {assessCalibration} from './calibration';
/** `calibration-cli --dataset FILE --prediction FILE --out FILE`: exit 0 pass, 1 fail, 2 not_run or unreadable input. Files must be real inputs; nothing is generated here. */
const arg=(name:string)=>{const i=process.argv.indexOf(`--${name}`);return i>=0?process.argv[i+1]:undefined;};
const [datasetPath,predictionPath,out]=[arg('dataset'),arg('prediction'),arg('out')];
if (!datasetPath||!predictionPath||!out) {console.error('usage: --dataset FILE --prediction FILE --out FILE');process.exit(2);}
const read=async(path:string)=>{try {return JSON.parse(await readFile(path,'utf8'));} catch {return undefined;}};
const dataset=await read(datasetPath),prediction=await read(predictionPath);
if (prediction===undefined) {console.error(`PREDICTION_UNREADABLE: ${predictionPath}`);process.exit(2);}
const result=assessCalibration(dataset??null,prediction);
await writeFile(out,JSON.stringify({schemaVersion:1,datasetPath,predictionPath,result},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));
process.exit(result.status==='pass'?0:result.status==='fail'?1:2);
