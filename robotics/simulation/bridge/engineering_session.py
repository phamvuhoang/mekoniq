"""Native engineering entrypoint. Exact profile admission, isolated ownership and durable no-resend Nav2 protocol.
ROS imports occur only after profile admission. Protocol tests do not substitute native qualification.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import threading
import time
from .engineering_launch import plan_engineering_launch
from .engineering_worker import NativeClockMapping
from .nav2_session import RosPorts, Nav2Session, _SceneNode, _emit, serve
from .native_profile import inspect_profile


class _ObservedTfBuffer:
    """Observe the exact writes made by Jazzy TransformListener, not cache lookups.

    The canonical chain has two dynamic edges and one fixed sensor edge. Other
    joint TF traffic must never refresh these edges' monotonic receipt ages.
    """
    DYNAMIC = {('map','odom'):1_000_000_000, ('odom','chassis/base'):500_000_000}
    SENSOR = ('chassis/base','lidar/head')

    def __init__(self, buffer):
        self.buffer=buffer;self._samples={};self._lock=threading.Lock()

    def _record(self, transform, static):
        edge=(transform.header.frame_id,transform.child_frame_id)
        if edge in self.DYNAMIC or edge==self.SENSOR:
            stamp=transform.header.stamp
            self._samples[edge]=(stamp.sec*1_000_000_000+stamp.nanosec,time.monotonic_ns(),static)

    def set_transform(self, transform, authority):
        with self._lock:
            self.buffer.set_transform(transform,authority);self._record(transform,False)

    def set_transform_static(self, transform, authority):
        with self._lock:
            self.buffer.set_transform_static(transform,authority);self._record(transform,True)

    def can_transform(self, *args):
        return self.buffer.can_transform(*args)

    def freshness_reasons(self, clock):
        reasons=[]
        with self._lock:
            now=time.monotonic_ns()
            for edge,future_ns in self.DYNAMIC.items():
                label=':'.join(edge);sample=self._samples.get(edge)
                if sample is None:reasons.append('TF_MISSING:'+label);continue
                stamp,receipt,static=sample
                if static:reasons.append('TF_EXPECTED_DYNAMIC:'+label)
                # AMCL postdates map->odom by transform_tolerance=1.0 in the
                # owned navigation config. Receipt expiry still applies at 500 ms.
                elif clock is None or not 0<=now-receipt<=500_000_000 or not -future_ns<=clock-stamp<=500_000_000:
                    reasons.append('TF_FEEDBACK_STALE:'+label)
            sensor=self._samples.get(self.SENSOR)
            if sensor is None:reasons.append('TF_MISSING:'+':'.join(self.SENSOR))
            elif not sensor[2]:reasons.append('TF_EXPECTED_STATIC:'+':'.join(self.SENSOR))
        return reasons


class EngineeringRosPorts(RosPorts):
    def __init__(self,bundle,log,emit):
        self.plan=plan_engineering_launch(bundle); self.robots=['amr_1'];self.bundle=Path(bundle);self.log_path=log
        self._proc=self._log=self._scene=None;self._scene_lock=threading.Lock();self._clients={}
        self.mapping=NativeClockMapping();self.emit=emit;self.fatal=None;self._bag=None;self._closed=False;self._leases=[]
        self._scan=None;self._joints=None;self._tf=None;self._ready=False;self._health_lock=threading.RLock();self._startup=time.monotonic()

    def launch(self):
        if self._proc:return
        # Exclusive domain lease prevents hash collisions with another owned engineering run.
        import fcntl
        lease=Path('/tmp')/f'mekoniq-ros-domain-{os.environ["ROS_DOMAIN_ID"]}.lock'
        stream=lease.open('a');fcntl.flock(stream,fcntl.LOCK_EX|fcntl.LOCK_NB);self._leases.append(stream)
        graph=subprocess.run(['ros2','node','list','--no-daemon'],capture_output=True,text=True,timeout=15,check=False)
        if graph.returncode!=0 or graph.stdout.strip():raise RuntimeError('ROS_DOMAIN_NOT_EMPTY')
        self._log=open(self.log_path,'w')
        (self.bundle/'.native').mkdir(exist_ok=True)
        launch=Path(__file__).resolve().parents[1]/'launch/engineering_world.launch.py'
        self._proc=subprocess.Popen(['ros2','launch',str(launch),f'bundle:={self.bundle}'],stdout=self._log,stderr=subprocess.STDOUT,start_new_session=False,shell=False)
        self._bag=subprocess.Popen(['ros2','bag','record','--storage','sqlite3','--use-sim-time','--include-hidden-topics','--output',str(self.bundle/'.native/raw-bag'),'--topics',*self.plan['topics']],stdout=self._log,stderr=subprocess.STDOUT,start_new_session=False,shell=False)

    def _node(self):
        with self._scene_lock:
            if self._scene is None:
                from geometry_msgs.msg import Twist,TwistStamped
                from sensor_msgs.msg import LaserScan,JointState
                from rclpy.parameter import Parameter
                from rclpy.qos import qos_profile_sensor_data
                from tf2_ros import Buffer,TransformListener
                self._scene=_SceneNode(self.plan,['amr_1']); node=self._scene.node
                node.set_parameters([Parameter('use_sim_time',value=True)])
                import rclpy
                self._tf_node=rclpy.create_node('engineering_tf_observer',cli_args=['--ros-args','-r','/tf:=/amr_1/tf','-r','/tf_static:=/amr_1/tf_static'])
                self._scene.executor.add_node(self._tf_node)
                self._tf=_ObservedTfBuffer(Buffer());self._listener=TransformListener(self._tf,self._tf_node,spin_thread=False)
                def scan(msg):
                    receipt=time.monotonic_ns();self._scan=(msg,receipt)
                    self.emit('native-sensor',{'sensor':'lidar-2d','frame':msg.header.frame_id,'providerSimNs':str(msg.header.stamp.sec*1_000_000_000+msg.header.stamp.nanosec),'receiveMonotonicNs':str(receipt),'rangesM':[float(x) if math.isfinite(x) else None for x in msg.ranges],'nonfinitePolicy':'null_no_return'})
                node.create_subscription(LaserScan,'/amr_1/scan',scan,qos_profile_sensor_data)
                def joints(msg):
                    receipt=time.monotonic_ns();self._joints=(msg,receipt)
                    self.emit('native-joints',{'names':list(msg.name),'positionRad':list(msg.position),'velocityRadS':list(msg.velocity),'providerSimNs':str(msg.header.stamp.sec*1_000_000_000+msg.header.stamp.nanosec),'receiveMonotonicNs':str(receipt)})
                node.create_subscription(JointState,'/amr_1/joint_states',joints,10)
                pub=node.create_publisher(TwistStamped,'/amr_1/diff_drive_controller/cmd_vel',10)
                def forward(msg):
                    if self.fatal:return
                    out=TwistStamped();out.header.stamp=node.get_clock().now().to_msg();out.twist=msg;pub.publish(out)
                node.create_subscription(Twist,'/amr_1/cmd_vel',forward,10)
            return self._scene

    def health(self):
        with self._health_lock:
            return self._health()

    def _health(self):
        from rclpy.time import Time
        reasons=[]
        base=super().health();reasons.extend(base['reasons'])
        now=time.monotonic_ns();clock=self.clock_ns()
        if self._proc and self._proc.poll() is not None:reasons.append('WORKER_PROCESS_DOWN')
        if self._bag and self._bag.poll() is not None:reasons.append('BAG_PROCESS_DOWN')
        if clock is not None:
            try:
                mapped=self.mapping.observe(clock,now);self.emit('clock-mapping',mapped)
                if self._ready:self.mapping.check_fresh(now)
            except RuntimeError as error:reasons.append(str(error));self.fatal=str(error)
        for name,sample in [('SCAN',self._scan),('JOINTS',self._joints)]:
            if sample is None or now-sample[1]>500_000_000 or clock is not None and sample is not None and abs(clock-(sample[0].header.stamp.sec*1_000_000_000+sample[0].header.stamp.nanosec))>500_000_000:reasons.append(name+'_FEEDBACK_STALE')
        if self._joints and not {'wheel-left/axle','wheel-right/axle'} <= set(self._joints[0].name):reasons.append('JOINT_IDENTITY_MISMATCH')
        if self._tf:
            reasons.extend(self._tf.freshness_reasons(clock))
            for target,source in [('map','chassis/base'),('chassis/base','lidar/head')]:
                if not self._tf.can_transform(target,source,Time()):reasons.append('TF_MISSING:'+target+':'+source)
        else:reasons.append('TF_MISSING')
        # Startup advances only the spawned simulation world; no navigation command is sent before all prerequisites are observed.
        if not self._ready and (clock is None or clock==0) and time.monotonic()-self._startup>1:
            self.pause(False)
        if not reasons:self._ready=True
        if self._ready and reasons:self.fatal=self.fatal or reasons[0]
        if self.fatal:
            reasons.append(self.fatal);self.emit('fatal',{'reason':self.fatal})
        return {'alive':not reasons,'reasons':sorted(set(reasons))}

    def close(self):
        if self._closed:return
        self._closed=True
        if hasattr(self,'stop'):self.stop.set()
        errors=[]
        for client in self._clients.values():
            try:client.client.close()
            except Exception as error:errors.append(str(error))
        if self._scene is not None:self._scene.close()
        if hasattr(self,'_tf_node'):self._tf_node.destroy_node()
        # Both are children in the parent-owned worker process group. ros2 launch handles its
        # children on SIGINT; the Node supervisor kills the entire owned group on worker exit.
        for process in (self._proc,self._bag):
            if process and process.poll() is None:
                try:
                    process.send_signal(signal.SIGINT);process.wait(15)
                except subprocess.TimeoutExpired:
                    process.kill();process.wait(5);errors.append('OWNED_PROCESS_SHUTDOWN_TIMEOUT')
                except ProcessLookupError:pass
        if self._log:self._log.close()
        if errors:self.fatal=';'.join(errors)
        raw=self.bundle/'.native/raw-bag';archive=self.bundle.parent/'rosbag2'
        if raw.is_dir():
            archive.mkdir(exist_ok=False)
            for source in raw.iterdir():
                if not source.is_file() or source.is_symlink():raise RuntimeError('BAG_FILE_INVALID')
                destination=archive/source.name;shutil.copyfile(source,destination)
                if hashlib.sha256(source.read_bytes()).digest()!=hashlib.sha256(destination.read_bytes()).digest():raise RuntimeError('BAG_COPY_MISMATCH')
        (self.bundle/'.native/shutdown.json').write_text(json.dumps({'closed':True,'blockers':[self.fatal] if self.fatal else []}))
        for stream in self._leases:stream.close()


CASES=('nominal','obstacle','no-path','cancel','worker-loss')

def engineering_fault_poses(case):
    if case=='obstacle':return [('engineering_fault_0',(1.9,3.0,.6,0.0))]
    if case=='no-path':return [(f'engineering_fault_{i}',pose) for i,pose in enumerate([(1.1,6,.6,0),(2.7,6,.6,0),(1.9,5.2,.6,0),(1.9,6.8,.6,0)],1)]
    if case in CASES:return []
    raise ValueError('ENGINEERING_CASE_INVALID')


class EngineeringNav2Session(Nav2Session):
    def native_blocker(self,args):
        from . import protocol
        protocol.validate_args('native_blocker',args)
        if args['enabled'] is not True:raise ValueError('ENGINEERING_CASE_INVALID')
        case=getattr(self.ports,'native_case','nominal')
        if case not in ('obstacle','no-path','worker-loss'):raise ValueError('ENGINEERING_CASE_INVALID')
        self.ports.emit('native-fault',{'case':case,'status':'intent'})
        for name,(x,y,z,yaw) in engineering_fault_poses(case):
            if not self.ports.set_pose(name,x,y,z,yaw):raise RuntimeError('FAULT_EFFECT_UNKNOWN')
        self.ports.emit('native-fault',{'case':case,'status':'applied'})
        if case=='worker-loss':
            # Abrupt worker loss: parent owns group cleanup. No synthetic success reply or continuation.
            os._exit(86)
        return {'applied':True,'case':case}

    def execute(self,args):
        # Existing receipts are authoritative even after health loss: no second physical send.
        if args.get('commandId') in self._table:return super().execute(args)
        health=self.ports.health()
        if not health['alive']:return {'commandId':args.get('commandId'),'status':'rejected','reason':','.join(health['reasons'])}
        return super().execute(args)

    def query(self,args):
        health=self.ports.health()
        if not health['alive']:return {'commandId':args.get('commandId'),'status':'unknown','evidence':{'reason':','.join(health['reasons'])}}
        return super().query(args)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--bundle',required=True);parser.add_argument('--run-id',required=True);parser.add_argument('--robots',required=True);parser.add_argument('--state-dir',required=True);parser.add_argument('--profile',required=True);parser.add_argument('--case',choices=CASES,default='nominal');args=parser.parse_args()
    if args.profile not in ('engineering-amd64','engineering-arm64') or args.robots!='amr_1':raise RuntimeError('ENGINEERING_PROFILE_REQUIRED')
    report=inspect_profile(args.profile)
    if not report['available']:raise RuntimeError('ENGINEERING_PREREQUISITES:'+','.join(report['reasonCodes']))
    # Never resume a worker against a prior command journal.
    state=Path(args.state_dir)
    if state.exists():raise RuntimeError('NATIVE_REOPEN_RECONCILE_REQUIRED')
    state.mkdir(parents=True);(state/'inventory.json').write_text(json.dumps(report,sort_keys=True))
    lock=threading.Lock();stop=threading.Event()
    event_file=(state/'native-events.jsonl').open('x')
    def emit(kind,payload):
        with lock:
            event_file.write(json.dumps({'event':kind,'payload':payload},allow_nan=False)+'\n');event_file.flush()
        _emit(sys.stdout,lock,kind,payload)
    ports=EngineeringRosPorts(args.bundle,str(state/'native.log'),emit)
    ports.stop=stop;ports.native_case=args.case
    def shutdown(_signum,_frame):
        stop.set();ports.close();raise SystemExit(2)
    signal.signal(signal.SIGTERM,shutdown);signal.signal(signal.SIGINT,shutdown)
    try:
        session=EngineeringNav2Session(ports,args.run_id,['amr_1'],args.state_dir)
        from .scene_loop import SceneLoop
        manifest=json.loads((Path(args.bundle)/'compiler-manifest.json').read_text())
        loop=SceneLoop(ports,{'seed':0,'actors':[],'blockers':[],'faults':[]},manifest['robots'],run_id=args.run_id,boot_id=session.boot_id,emit=emit)
        session.scene_loop=loop
        def watch():
            while not stop.wait(.02):
                try:
                    health=ports.health()
                    if ports.fatal:ports.pause(True)
                    if health['alive']:loop.step()
                except Exception as error:
                    ports.fatal=type(error).__name__+':'+str(error);emit('fatal',{'reason':ports.fatal})
        thread=threading.Thread(target=watch,daemon=True);thread.start()
        serve(sys.stdin,sys.stdout,session,lock)
    finally:
        stop.set()
        if 'thread' in locals():thread.join(5)
        ports.close();event_file.close()

if __name__=='__main__':main()
