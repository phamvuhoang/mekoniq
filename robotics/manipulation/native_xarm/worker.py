"""Fixed native simulation entrypoint. Failed admission never starts a process or imports ROS."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
import uuid
from .policy import ROOT,load_profile,launch_argv,verify_vendor,decode_sim_selector
from .mapping import produce_mapping
from .session import Session

# ROS 2 domains above 101 are unsafe on Linux (ephemeral ports). xArm runs own 1..50; Gazebo/Nav2 (gazebo-nav2.ts, nav2_session.py) owns 51..101.
def ros_domain(run_id):return 1+int(hashlib.sha256(run_id.encode()).hexdigest()[:6],16)%50
# A refusal for one of these is our own checkout/tooling being wrong, never a missing host: it must not read as blocked_external.
TOOLING_REFUSALS={'VENDOR_SOURCE_MISMATCH','SOURCE_DIRTY','XARM_MODEL_SELECTOR_MISMATCH','XARM_VENDOR_CHECKOUT_MISMATCH'}
def refusal(reasons):
    tooling=any(r.split(':')[0] in TOOLING_REFUSALS for r in reasons)
    return {'kind':'refusal','reasons':reasons,'status':'not_run','result':'failed' if tooling else 'blocked_external','category':'tooling' if tooling else 'external','accepted':False,'dynamics':'not_calibrated'}

def preflight(profile):
    from bridge.native_profile import inspect_profile
    report=inspect_profile(profile);reasons=list(report['reasonCodes'])+verify_vendor()
    if decode_sim_selector(load_profile()['syntheticSimModelSelector'])!={'modelNum':1305,'modelType':6,'dateCode':2005,'massType':11,'inertialFile':'xarm6_type6_HT_BR2'}:reasons.append('XARM_MODEL_SELECTOR_MISMATCH')
    # This overlay is fixed operator configuration; no browser path or IP is accepted.
    vendor=Path('/opt/mekoniq/xarm_ros2');lock=json.loads((ROOT/'native-vendor.lock.json').read_text())
    if report['available']:
        source=ROOT.parents[1];status=subprocess.run(['git','status','--porcelain','--untracked-files=all'],cwd=source,capture_output=True,text=True,check=True,timeout=10)
        if status.stdout.strip():reasons.append('SOURCE_DIRTY')
    if not vendor.is_dir():reasons.append('XARM_VENDOR_OVERLAY_MISSING')
    elif not reasons:
        def git(args):return subprocess.run(['git',*args],cwd=vendor,check=True,capture_output=True,text=True,timeout=10).stdout.strip()
        if git(['rev-parse','HEAD'])!=lock['commit'] or git(['status','--porcelain','--untracked-files=all']):reasons.append('XARM_VENDOR_CHECKOUT_MISMATCH')
        for sub in lock['submodules']:
            r=subprocess.run(['git','-C',str(vendor/sub['path']),'rev-parse','HEAD'],check=True,capture_output=True,text=True,timeout=10)
            if r.stdout.strip()!=sub['commit']:reasons.append('XARM_SUBMODULE_MISMATCH')
        share=Path(load_profile()['descriptionShare']);prefix=subprocess.run(['ros2','pkg','prefix','xarm_description'],check=True,capture_output=True,text=True,timeout=10).stdout.strip()
        if Path(prefix)/'share/xarm_description'!=share:reasons.append('XARM_DESCRIPTION_PREFIX_MISMATCH')
        for file in lock['files']+[{**f,'contentSha256':f['sha256']} for f in lock['descriptionParity']['files']]:
            path=vendor/file['path']
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=file['contentSha256']:reasons.append('XARM_INSTALLED_SOURCE_MISMATCH')
            if file['path'].startswith('xarm_description/'):
                installed=share/file['path'].removeprefix('xarm_description/')
                if not installed.is_file() or installed.is_symlink() or hashlib.sha256(installed.read_bytes()).hexdigest()!=file['contentSha256']:reasons.append('XARM_INSTALLED_DESCRIPTION_MISMATCH')
    return report,sorted(set(reasons))

def finish_bag(directory):
    from bridge.engineering_bag import retain_recovered_bag,inspect_bag
    blockers=[]
    try:
        if (directory/'verified-bag').exists():raise ValueError('BAG_DESTINATION_EXISTS')
        retain_recovered_bag(directory/'raw-bag',directory/'verified-bag')
        coverage=inspect_bag(directory/'verified-bag')
        (directory/'bag-coverage.json').write_text(json.dumps(coverage,sort_keys=True))
    except Exception as error:blockers.append(str(error))
    return {'closed':True,'blockers':blockers,'retention':'verified_sqlite_backup','evidenceDirectory':'verified-bag'}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--directory',type=Path,required=True);parser.add_argument('--run-id',required=True);parser.add_argument('--mode',choices=['X1','X2'],required=True);parser.add_argument('--environment-profile',choices=['engineering-amd64','engineering-arm64'],required=True);args=parser.parse_args()
    args.directory.mkdir(parents=True,exist_ok=True)
    with (args.directory/'worker-attempt.json').open('x') as f:json.dump({'runId':args.run_id,'mode':args.mode},f);f.flush();os.fsync(f.fileno())
    inventory,reasons=preflight(args.environment_profile)
    (args.directory/'native-inventory.json').write_text(json.dumps(inventory,indent=2))
    if reasons:
        print(json.dumps(refusal(reasons)),flush=True);return 2
    import fcntl
    domain=ros_domain(args.run_id)
    os.environ.update(ROS_DOMAIN_ID=str(domain),ROS_LOCALHOST_ONLY='1',GZ_PARTITION='mekoniq-xarm-'+args.run_id,TMPDIR='/tmp')
    lease=open('/tmp/mekoniq-ros-domain-'+str(domain)+'.lock','a');fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
    graph=subprocess.run(['ros2','node','list','--no-daemon'],capture_output=True,text=True,timeout=15,check=False)
    if graph.returncode or graph.stdout.strip():raise RuntimeError('ROS_DOMAIN_NOT_EMPTY')
    # Marker is durable and created before launch; an interrupted run must use a new directory/id after reconciliation.
    with (args.directory/'native-started.json').open('x') as f:json.dump({'runId':args.run_id,'domain':domain,'mode':args.mode},f);f.flush();os.fsync(f.fileno())
    lock=threading.Lock();event_file=(args.directory/'observations.jsonl').open('x');stop=threading.Event();process=None;bag=None;port=None;poller=None
    def emit(value):
        with lock:event_file.write(json.dumps(value,allow_nan=False)+'\n');event_file.flush();print(json.dumps(value,allow_nan=False),flush=True)
    def shutdown(_sig,_frame):stop.set();raise KeyboardInterrupt()
    signal.signal(signal.SIGINT,shutdown);signal.signal(signal.SIGTERM,shutdown)
    log=(args.directory/'launch.log').open('x')
    try:
        process=subprocess.Popen(launch_argv(args.mode),stdout=log,stderr=subprocess.STDOUT,shell=False)
        topics=['/joint_states','/tf','/tf_static','/xarm6_traj_controller/controller_state','/xarm6_traj_controller/follow_joint_trajectory/_action/status']
        if args.mode=='X2':topics.insert(0,'/clock')
        bag=subprocess.Popen(['ros2','bag','record','--storage','sqlite3','--include-hidden-topics','--output',str(args.directory/'raw-bag'),'--topics',*topics],stdout=log,stderr=subprocess.STDOUT,shell=False)
        from .ros import RosPort
        boot=str(uuid.uuid4());port=RosPort(args.mode,boot,emit)
        end=time.monotonic()+100;sample=None
        while time.monotonic()<end:
            if process.poll() is not None or bag.poll() is not None:raise RuntimeError('NATIVE_PROCESS_EXITED')
            try:sample=port.sample();break
            except Exception:time.sleep(.05)
        if sample is None:raise RuntimeError('NATIVE_FEEDBACK_NOT_READY')
        readback=port.readback();(args.directory/'controller-readback.json').write_text(json.dumps(readback,indent=2))
        source=ROOT.parents[1];commit=subprocess.run(['git','rev-parse','HEAD'],cwd=source,capture_output=True,text=True,check=True,timeout=10).stdout.strip()
        produce_mapping(readback['/robot_state_publisher']['robot_description']['string'],args.mode,args.directory,{'sourceCommit':commit,'profileId':args.environment_profile,'environmentProfile':args.environment_profile},port.evidence_kind,{'joints':readback.get('/xarm6_traj_controller',{}).get('joints',{}).get('strings'),'commandInterfaces':readback.get('/xarm6_traj_controller',{}).get('command_interfaces',{}).get('strings'),'stateInterfaces':readback.get('/xarm6_traj_controller',{}).get('state_interfaces',{}).get('strings'),'srdf':readback.get('/move_group',{}).get('robot_description_semantic',{}).get('string')})
        sample=port.sample()
        session=Session(args.directory/'native-journal.json',port,args.run_id,boot,1);session.observe(sample)
        def observe():
            last_stamp=sample['stampNs']
            while not stop.wait(.02):
                try:
                    if process.poll() is not None or bag.poll() is not None:raise RuntimeError('NATIVE_PROCESS_EXITED')
                    s=port.sample()
                    # 25 Hz state publication is distinct from the 20 ms Source tick; duplicate cached samples do not renew freshness.
                    if s['stampNs']!=last_stamp:session.observe(s);emit({'kind':'sample','sample':s});last_stamp=s['stampNs']
                    else:session.healthy()
                except Exception as error:
                    with session.lock:session.unknown(str(error))
        poller=threading.Thread(target=observe,daemon=True);poller.start();emit({'kind':'ready','evidenceKind':port.evidence_kind,'bootId':boot})
        for line in sys.stdin:
            if len(line)>65536:raise ValueError('REQUEST_TOO_LARGE')
            request=json.loads(line);method=request['method'];a=request['args']
            if set(request)!={'id','method','args'} or method not in ('execute','cancel','query'):raise ValueError('REQUEST_INVALID')
            if method=='execute':result=session.execute(a['commandId'],a['payloadHash'],a['points'])
            elif method=='cancel':result=session.cancel(a['commandId'])
            else:result=session.query(a['commandId'])
            emit({'kind':'reply','id':request['id'],'result':result})
    finally:
        stop.set()
        if poller:poller.join(3)
        if port:port.close()
        for child in (bag,process):
            if child and child.poll() is None:
                child.send_signal(signal.SIGINT)
                try:child.wait(10)
                except subprocess.TimeoutExpired:child.kill();child.wait(5)
        shutdown=finish_bag(args.directory)
        (args.directory/'native-shutdown.json').write_text(json.dumps(shutdown,indent=2))
        log.close();event_file.close();lease.close()
    return 0

if __name__=='__main__':
    try:sys.exit(main())
    except KeyboardInterrupt:sys.exit(2)
