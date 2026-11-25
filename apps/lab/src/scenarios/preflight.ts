// Preflight before a run: every item is pass/fail with a reason (text, not color) and, when it is about the project, the affected entity.
// It only explains; the runtime re-checks everything on create and is the authority.
import {engineeringRefFor,TwinRuntimeError,type TwinHealth,type ReadinessSnapshot} from './controls';
import type {TwinPreset} from './catalog';
import {tr} from '../i18n';
import {setReasons} from './support';
/** `codes`: the reason codes of a failing item (diagnosis only; the problems list shows them). */
export interface Check {id:string;ok:boolean;label:string;detail:string;entityId?:string;codes?:string[]}
export function preflight(p:TwinPreset,health:TwinHealth|null,paired:boolean,snapshot:ReadinessSnapshot|null=null,now=Date.now()):Check[] {
 const matching=snapshot?.scenarioId===p.scenarioId&&snapshot.backendSetId===p.backendSetId;
 const set=health?.backendSets.find(s=>s.id===p.backendSetId),required=matching?snapshot.checks.filter(c=>c.id.startsWith('backend:')).map(c=>c.id.slice(8)):undefined;
 const why=health?backendReasons(p,health,required):[],backend=why.filter(c=>c!=='SCENARIO_NOT_OFFERED');
 // the gate is unchanged (U07): the set exists, has the preset's mode and every required backend is enabled; `backend` (shared with the picker) only explains
 const off=(required??set?.backends)?.filter(b=>!health!.backends.find(x=>x.id===b)?.enabled)??[];
 const checks:Check[]=[
  {id:'runtime',ok:!!health,label:tr('Runtime cục bộ','ローカルランタイム','Local runtime'),detail:health?`source ${health.sourceCommit.slice(0,7)} · protocol ${health.protocolMajors.join('/')}`:tr('Không kết nối được /lab/v2. Khởi động runtime trên máy phát triển.','/lab/v2に接続できません。開発機でランタイムを起動してください。','Cannot reach /lab/v2. Start the runtime on your development machine.'),codes:['RUNTIME_UNREACHABLE']},
  {id:'protocol',ok:!!health?.protocolMajors.includes(2),label:'Protocol v2',detail:health?(health.protocolMajors.includes(2)?'v2':tr('Runtime không hỗ trợ v2','v2非対応','Runtime does not offer v2')):'—',codes:['PROTOCOL_V2_MISSING']},
  {id:'paired',ok:paired,label:tr('Ghép nối','ペアリング','Pairing'),detail:paired?tr('Phiên v2 đã ghép nối','v2セッション済み','v2 session paired'):tr('Nhập mã một lần từ terminal','ターミナルのワンタイムコードを入力','Enter the one-time code from your terminal'),codes:['NOT_PAIRED']},
  {id:'backend',ok:!!set&&set.mode===(p.mode??'mock')&&!off.length,label:`${tr('Bộ backend','バックエンドセット','Backend set')} ${p.backendSetId}`,detail:!health?'—':!set?tr('Runtime không có bộ này','このセットなし','Set not offered by this runtime'):backend.length?`${tr('Chưa sẵn sàng','未準備','Not available')}: ${backend.map(c=>{const why=health.backends.find(x=>x.id===c.split(':')[1])?.reason;return why?`${c} (${why})`:c;}).join(', ')}`:`${set.mode} · ${set.backends.join(', ')}`,codes:backend},
  {id:'scenario',ok:!!health?.scenarioIds.includes(p.scenarioId),label:`${tr('Kịch bản','シナリオ','Scenario')} ${p.scenarioId}`,detail:!health?'—':health.scenarioIds.includes(p.scenarioId)?`r${p.scenarioRevision}`:tr('Runtime không có kịch bản này','このシナリオなし','Scenario not offered by this runtime'),codes:['SCENARIO_NOT_OFFERED']},
 ];
 if(p.engineering){let ok=false,detail:string,code='ENGINEERING_NOT_COMPILED';
  try{const ref=engineeringRefFor(p.engineering.project,p.engineering.receipt);ok=true;detail=`bundle ${ref.bundleDigest.slice(0,12)} · ${p.engineering.project.requestedProfile}`;}
  catch(e){if(e instanceof TwinRuntimeError)code=e.code;detail=`${e instanceof TwinRuntimeError?e.code:String(e)} · ${tr('Mở và compile thiết kế trên trang Lắp ráp','組立ページで設計を開いてコンパイル','Open and compile the design on the Assembly page')}`;}
  checks.push({id:'engineering',ok,label:tr('Bundle kỹ thuật cho đúng bản nháp','この下書きのコンパイル済みバンドル','Compiled bundle for this exact draft'),detail,codes:[code]});}
 for(const kind of p.roles.entities){const e=p.project.entities.find(x=>x.kind===kind);checks.push({id:`entity-${kind}`,ok:!!e,label:`${tr('Thực thể','エンティティ','Entity')} ${kind}`,detail:e?e.id:tr('Thiếu trong dự án','プロジェクトに不足','Missing from the project'),codes:[`ENTITY_MISSING:${kind}`],...e?{entityId:e.id}:{}});}
 for(const kind of p.roles.points){const q=p.project.world.points.find(x=>x.kind===kind);checks.push({id:`point-${kind}`,ok:!!q,label:`${tr('Điểm','地点','Point')} ${kind}`,detail:q?`${q.name} (${q.x}, ${q.y}) m`:tr('Thiếu trong mặt bằng','レイアウトに不足','Missing from the layout'),codes:[`POINT_MISSING:${kind}`]});}
 if(health?.features?.readiness){
  const age=matching?now-Date.parse(snapshot.checkedAt):NaN,ttl=matching?Date.parse(snapshot.expiresAt)-Date.parse(snapshot.checkedAt):NaN;
  const fresh=matching&&Number.isFinite(age)&&age>=-5000&&ttl>0&&ttl<=30000&&now<Date.parse(snapshot.expiresAt);
  const ok=!!fresh&&snapshot.canStart===true&&snapshot.checks.length>0&&snapshot.checks.every(c=>c.status==='ready'&&!c.reasonCodes.length);
  const codes=!matching?['READINESS_NOT_CHECKED']:!fresh?['READINESS_EXPIRED']:snapshot.checks.flatMap(c=>c.reasonCodes);
  checks.push({id:'readiness',ok,codes:codes.length?codes:['READINESS_UNKNOWN'],label:tr('Sẵn sàng theo runtime','ランタイムの準備状況','Runtime readiness'),detail:!matching?'READINESS_NOT_CHECKED':!fresh?'READINESS_EXPIRED':ok?tr('Đủ điều kiện bắt đầu; chưa phải kết quả nghiệm thu','開始条件を満たしています。検収結果ではありません','Ready to start; this is not acceptance evidence'):snapshot.checks.flatMap(c=>c.reasonCodes).join(', ')||'READINESS_UNKNOWN'});
 }
 return checks;
}
/** Why `health` cannot run preset `p` (the picker and preflight both use this): the set, its mode, one reason per backend, then the scenario
 * (`required`: the backends a matching readiness answer names; default the set's). Empty: nothing known against it. */
export function backendReasons(p:TwinPreset,health:TwinHealth,required?:readonly string[]):string[]{
 const set=health.backendSets.find(s=>s.id===p.backendSetId);
 return [...!set?[`BACKEND_SET_UNKNOWN:${p.backendSetId}`]:[...set.mode===(p.mode??'mock')?[]:[`BACKEND_SET_MODE:${set.mode}`],...setReasons(health,set,required)],...health.scenarioIds.includes(p.scenarioId)?[]:['SCENARIO_NOT_OFFERED']];
}
export const ready=(checks:Check[])=>checks.every(c=>c.ok);
