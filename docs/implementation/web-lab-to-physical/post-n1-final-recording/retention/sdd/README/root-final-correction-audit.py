from pathlib import Path
import json, hashlib, subprocess, math, datetime
S=Path("/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source")
L=S.parent/"lab"
D=S/".superpowers/sdd/README"
C=Path("/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3")
def sha(b): return hashlib.sha256(b).hexdigest()
def read(p): return json.loads(p.read_text())
def ref(p):
 b=p.read_bytes()
 return {"path":str(p),"bytes":len(b),"sha256":sha(b)}
def git(p,*args): return subprocess.check_output(["git","-C",str(p),*args]).decode().strip()
def p95(xs): return sorted(xs)[math.ceil(len(xs)*.95)-1]
issues=[]
scopeNotes=[]
def check(ok,msg):
 if not ok: issues.append(msg)
ident=read(C/"subject-identity-ordered.json")
heads={}
for key,p in [("source",S),("lab",L)]:
 heads[key]={"head":git(p,"rev-parse","HEAD"),"tree":git(p,"rev-parse","HEAD^{tree}"),"status":git(p,"status","--porcelain","--untracked-files=all")}
 check(heads[key]==ident[key],"subject:"+key)
lock=read(L/"config/source-runtime.lock.json")
check(lock==ident["lock"],"runtime-pin")
build=ident["production"]; files=build["files"]
for f in files:
 p=L/"dist"/f["path"]
 check(p.is_file() and ref(p)["bytes"]==f["bytes"] and ref(p)["sha256"]==f["sha256"],"build-file:"+f["path"])
for f,expected in ident["checker"].items():
 actual=ref(S/f);check(all(actual[k]==v for k,v in expected.items()),"checker:"+f)
receipts=[]
for f in sorted(C.glob("*.json")):
 d=read(f)
 if not isinstance(d,dict) or not isinstance(d.get("log"),str):continue
 log=Path(d["log"]);actual=ref(log)
 matched=actual["bytes"]==d.get("bytes") and actual["sha256"]==d.get("sha256")
 check(matched,"receipt-log:"+f.name)
 receipts.append({"receipt":ref(f),"log":actual,"binding":matched,"exit":d.get("exit"),"start":d.get("start"),"end":d.get("end"),"head":d.get("head"),"beforeStatus":d.get("beforeStatus"),"afterStatus":d.get("afterStatus"),"hasDirtyByteMaps":"beforeFileHashes" in d and "afterFileHashes" in d})
# Check the final dirty-byte checks against the eventual committed blobs.
bytechecks=[]
for name in ["ordered-final-tests","ordered-burst-final","ordered-typecheck","ordered-lint","source-build-ordered","lab-unit-ordered","lab-ordered-typecheck"]:
 d=read(C/(name+".json"));repo=Path(d["cwd"]);head=heads["lab" if repo==L else "source"]["head"]
 checks=[]
 check(d["exit"]==0,"final-check-exit:"+name)
 for f,h in d.get("afterFileHashes",{}).items():
  data=subprocess.check_output(["git","-C",str(repo),"show",head+":"+f])
  ok=d["beforeFileHashes"].get(f)==h and len(data)==h["bytes"] and sha(data)==h["sha256"]
  checks.append({"path":f,"matchesBeforeAfterAndCommit":ok})
  if not ok and name in ["ordered-final-tests","ordered-typecheck","ordered-lint"] and f=="tests/unit/browser-capture-clock.test.ts":
   scopeNotes.append({"check":name,"path":f,"recorded":h,"committed":{"bytes":len(data),"sha256":sha(data)},"scope":"Precedes documented burst fixture narrowing; product bytes match final commit. Exact final burst case has its own focused receipt; do not claim the earlier entire test file was final bytes."})
  else:check(ok,"final-check-bytes:"+name+":"+f)
 bytechecks.append({"check":name,"coveredCommittedHead":head,"files":checks})
r=read(C/"production-capture-ordered/actual-cell-production.json")
a=read(C/"production-capture-ordered/assessment.json")
e=r["capture"]["renderEvents"];ss=r["capture"]["samples"];o=r["capture"]["renderOrdering"];clock=r["clock"]
check(r["buildIdentity"]==build,"capture-build-identity")
check(r["sourceCommit"]==heads["source"]["head"] and r["runtimeArtifact"]==lock["artifactSha256"],"capture-runtime-subject")
check(all(v for v in r["targets"].values()) and not r["errors"],"capture-producer-targets")
check(a["valid"] and a["meetsTargets"] and not a["issues"],"capture-reader-result")
check(o["version"]==1 and o["endCount"]-o["startCount"]==len(e),"counter-window")
check(all(x["count"]==o["startCount"]+i+1 for i,x in enumerate(e)),"counter-consecutive")
check(all(e[i]["atMs"]>=e[i-1]["atMs"] for i in range(1,len(e))),"clock-order")
groups=[x["atMs"] for i,x in enumerate(e) if i==0 or x["atMs"]!=e[i-1]["atMs"]]
intervals=[groups[i]-groups[i-1] for i in range(1,len(groups))]
cursor=0;sumcalls=0;allocationErrors=[]
for i,s in enumerate(ss):
 calls=0;last=None
 while cursor<len(e) and e[cursor]["count"]<=s["renderCount"]:
  last=e[cursor];calls+=last["drawCalls"];cursor+=1
 if calls!=s["drawCalls"] or bool(last)!=s["drawn"] or (last and s["fullCell"] and last["worldTick"]!=s["worldTick"]):allocationErrors.append(i)
 sumcalls+=calls
tail=sum(x["drawCalls"] for x in e[cursor:])
check(not allocationErrors and tail==o["tailDrawCalls"] and sumcalls+tail==r["capture"]["drawCalls"],"actual-gl-allocation")
worker=r["workerRaw"];allworker=r["workerOutsideWindow"]["before"]+worker+r["workerOutsideWindow"]["after"]
steps=sorted((x for x in r["actions"] if x["kind"]=="step"),key=lambda x:x["requestStartEpochMs"])
ticks=[x["targetTick"] for x in allworker]
start=steps[0]["tick"]-steps[0]["payload"]["ticks"];end=steps[-1]["tick"]
check(len(ticks)==len(set(ticks)) and set(ticks)==set(range(start+1,end+1)),"every-actual-worker-tick")
p=r["pause"]
check(all(p[k]["tick"]==end and p[k]["run"]["status"]=="paused" for k in ["finalView","stableView","afterExportView"]),"pause-stable-horizon")
active=sum(ss[i]["at"]-ss[i-1]["at"] for i in range(1,len(ss)) if ss[i]["fullCell"] and ss[i-1]["fullCell"])
computed={"renderIntervalP95Ms":p95(intervals),"workerP95Ms":p95([w["elapsedMs"] for w in worker]),"activeCellMs":active}
for k,v in computed.items():check(abs(v-a["metrics"][k])<.001,"independent-metric:"+k)
poseMaps={json.dumps(x["bodies"],sort_keys=True) for x in r["capture"]["drawPoseSamples"]}
cleanup={};browser={}
for name in ["production-capture-ordered","final-closed-browser","final-replay-browser"]:
 pth=C/name/("preview-cleanup.json" if name=="final-replay-browser" else "cleanup.json")
 cleanup[name]=read(pth)
 settled=cleanup[name].get("listening") is False and isinstance(cleanup[name].get("closedAt"),str) if name=="final-replay-browser" else cleanup[name].get("completed") is True
 check(settled,"cleanup:"+name)
 if name!="production-capture-ordered":
  result=read(C/name/("result.json" if name=="final-replay-browser" else "browser-result.json"))
  browser[name]={"result":ref(C/name/("result.json" if name=="final-replay-browser" else "browser-result.json")),"stats":result["stats"],"errors":result.get("errors",[])}
  check(result["stats"]["unexpected"]==0 and result["stats"]["skipped"]==0 and result["stats"]["flaky"]==0,"browser-outcomes:"+name)
  inv=read(C/name/"browser-invocation.json")
  browser[name]["invocationKeys"]=list(inv)
report=D/"task-final-correction-report.md"
out={"at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"scope":"Independent read-only current correction audit; report may still append, final campaign pending. Does not replace scoped review/full qualification.","heads":heads,"lock":lock,"identity":ref(C/"subject-identity-ordered.json"),"buildSha256":build["buildSha256"],"buildFiles":len(files),"selectedCheckerFileSet":ident["checkerSetSha256"],"selectedCheckerIsFullR3Graph":False,"receipts":receipts,"finalByteChecks":bytechecks,"capture":{"raw":ref(C/"production-capture-ordered/actual-cell-production.json"),"assessment":ref(C/"production-capture-ordered/assessment.json"),"runId":r["runId"],"computed":computed,"readerMetrics":a["metrics"],"elapsedMs":r["capture"]["elapsedMs"],"achievedRate":r["achievedRate"],"renderEvents":len(e),"clockGroups":len(groups),"equalTimePairs":len(e)-len(groups),"maxRenderIntervalMs":max(intervals),"orderedWindow":o,"allocationErrors":allocationErrors,"totalDrawCalls":r["capture"]["drawCalls"],"actualWorkerTicks":len(ticks),"activeWorkerTicks":len(worker),"finalRequestedTicks":steps[-1]["payload"]["ticks"],"finalActualTicks":steps[-1]["tick"]-steps[-2]["tick"],"finalH":end,"drawPoseSamples":len(r["capture"]["drawPoseSamples"]),"distinctBodyPoseMaps":len(poseMaps),"accepted":r["accepted"]},"cleanup":cleanup,"browsers":browser,"reportReadCheckpoint":ref(report),"issues":issues}
out["scopeNotes"]=scopeNotes
out["supersedesAuditAssumptionsOnly"]=ref(D/"root-final-correction-audit-cb5-fded.json")
out["auditCorrection"]="Initial audit incorrectly required final bytes for a documented pre-narrowing test fixture and assumed preview cleanup used completed:true. Actual fixture-specific receipt and listening:false/closedAt schema are retained; no product, test or evidence output changed."
dest=D/"root-final-correction-audit-cb5-fded-v2.json"
dest.write_text(json.dumps(out,indent=2)+"\n")
print(json.dumps({"audit":ref(dest),"issues":issues,"receipts":len(receipts),"computed":computed,"browserStats":{k:v["stats"] for k,v in browser.items()}},ensure_ascii=False))
raise SystemExit(bool(issues))

