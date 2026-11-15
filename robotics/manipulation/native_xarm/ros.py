"""Jazzy FollowJointTrajectory client with independent controller/joint/TCP readback.
Imports ROS only after host admission. No IP, hardware driver, shell or user-supplied action exists here.
"""
import math
import threading
import time
from .policy import load_profile,map_joints

class RosPort:
    def __init__(self,mode,boot_id,emit):
        import rclpy
        from control_msgs.action import FollowJointTrajectory
        from control_msgs.msg import JointTrajectoryControllerState
        from trajectory_msgs.msg import JointTrajectoryPoint
        from sensor_msgs.msg import JointState
        from rosgraph_msgs.msg import Clock
        from rclpy.action import ActionClient
        from rclpy.executors import SingleThreadedExecutor
        from rclpy.parameter import Parameter
        from tf2_ros import Buffer,TransformListener
        if not rclpy.ok():rclpy.init()
        self.node=rclpy.create_node('mekoniq_xarm_observer');self.node.set_parameters([Parameter('use_sim_time',value=mode=='X2')])
        self.mode=mode;self.boot_id=boot_id;self.emit=emit;self.seq=0;self.controller_identity=None;self.clock=None;self.clock_receipt=None;self.joints=None;self.controller=None;self.session=None;self.fatal=None
        self.evidence_kind=load_profile()['modes'][mode]['evidenceKind'];self.Goal=FollowJointTrajectory.Goal;self.Point=JointTrajectoryPoint
        self.client=ActionClient(self.node,FollowJointTrajectory,load_profile()['action']);self.handle=None;self.result_future=None
        self.tf=Buffer();self.listener=TransformListener(self.tf,self.node);self.tf_receipt=None
        from tf2_msgs.msg import TFMessage
        def transforms(msg):
            for t in msg.transforms:
                if t.child_frame_id=='link_tcp':self.tf_receipt=time.monotonic_ns()
        self.node.create_subscription(TFMessage,'/tf',transforms,10)
        self.node.create_subscription(JointState,'/joint_states',self.on_joints,10)
        self.node.create_subscription(JointTrajectoryControllerState,'/xarm6_traj_controller/controller_state',self.on_controller,10)
        self.node.create_subscription(Clock,'/clock',self.on_clock,10)
        self.executor=SingleThreadedExecutor();self.executor.add_node(self.node);self.thread=threading.Thread(target=self.executor.spin,daemon=True);self.thread.start()

    def on_clock(self,msg):
        value=msg.clock.sec*1_000_000_000+msg.clock.nanosec
        if self.clock is not None and value<self.clock:self.fatal='CLOCK_RESET'
        if value!=self.clock:self.clock_receipt=time.monotonic_ns()
        self.clock=value

    def on_joints(self,msg):self.joints=(msg,time.monotonic_ns())
    def on_controller(self,msg):self.controller=(msg,time.monotonic_ns())

    def sample(self):
        from rclpy.time import Time
        now=time.monotonic_ns();clock=self.clock if self.mode=='X2' else self.node.get_clock().now().nanoseconds
        if self.fatal:raise RuntimeError(self.fatal)
        publishers=self.node.get_publishers_info_by_topic('/xarm6_traj_controller/controller_state')
        if len(publishers)!=1:raise RuntimeError('CONTROLLER_IDENTITY_MISSING')
        identity=tuple(publishers[0].endpoint_gid)
        if self.controller_identity is not None and identity!=self.controller_identity:self.fatal='CONTROLLER_RESTART';raise RuntimeError(self.fatal)
        self.controller_identity=identity
        if self.mode=='X2' and (self.clock_receipt is None or now-self.clock_receipt>500_000_000):raise RuntimeError('CLOCK_STALE')
        if self.joints is None or self.controller is None:raise RuntimeError('ACTUAL_FEEDBACK_MISSING')
        joint,jr=self.joints;controller,cr=self.controller
        def stamp(m):return m.header.stamp.sec*1_000_000_000+m.header.stamp.nanosec
        if any(not 0<=now-r<=500_000_000 or not 0<=clock-stamp(m)<=500_000_000 for m,r in [(joint,jr),(controller,cr)]):raise RuntimeError('FEEDBACK_STALE')
        actual=map_joints(list(joint.name),list(joint.position));feedback=map_joints(list(controller.joint_names),list(controller.feedback.positions));commanded=map_joints(list(controller.joint_names),list(controller.reference.positions))
        if max(abs(a-b) for a,b in zip(actual,feedback))>.02:raise RuntimeError('CONTROLLER_JOINT_DISAGREEMENT')
        # Resolve the chain using the current observation time, not a stale cached latest transform.
        transform=self.tf.lookup_transform('link_base','link_tcp',Time(nanoseconds=stamp(joint)))
        pos=transform.transform.translation;tcp=[pos.x,pos.y,pos.z]
        if not all(math.isfinite(x) for x in tcp):raise RuntimeError('TCP_INVALID')
        self.seq+=1
        return {'bootId':self.boot_id,'epoch':1,'seq':self.seq,'receivedMs':min(jr,cr)/1_000_000,'controllerPublisherGid':list(self.controller_identity),'clockNs':clock,'stampNs':stamp(joint),'actualRad':actual,'commandedRad':commanded,'tcpM':tcp}

    def wait(self,future,timeout):
        end=time.monotonic()+timeout
        while not future.done() and time.monotonic()<end:time.sleep(.01)
        if not future.done():raise TimeoutError('ROS_ACTION_TIMEOUT')
        result=future.result()
        if result is None:raise RuntimeError('ROS_ACTION_UNKNOWN')
        return result

    def send(self,points):
        if not self.client.wait_for_server(timeout_sec=3):raise RuntimeError('ACTION_SERVER_MISSING')
        goal=self.Goal();goal.trajectory.joint_names=[j['native'] for j in load_profile()['jointMap']]
        for p in points:
            point=self.Point();point.positions=list(p['positions']);nanoseconds=round(p['timeS']*1e9);point.time_from_start.sec=nanoseconds//1_000_000_000;point.time_from_start.nanosec=nanoseconds%1_000_000_000;goal.trajectory.points.append(point)
        goal.goal_time_tolerance.sec=2
        self.handle=self.wait(self.client.send_goal_async(goal),5)
        if not self.handle.accepted:return 'rejected'
        self.result_future=self.handle.get_result_async();return 'accepted'

    def result(self):
        if self.result_future is None:return 'unknown'
        if not self.result_future.done():return 'running'
        r=self.result_future.result()
        if r is None:return 'unknown'
        if r.status==4:return 'completed' if r.result.error_code==0 else 'failed'
        return {5:'canceled',6:'failed'}.get(r.status,'unknown')

    def cancel(self):
        if self.handle is None:return False
        return bool(self.wait(self.handle.cancel_goal_async(),3).goals_canceling)

    def readback(self):
        from rcl_interfaces.srv import GetParameters
        clients=[]
        try:
            output={}
            for name,parameters in [('/robot_state_publisher',['robot_description']),('/move_group',['robot_description_semantic','planning_pipelines']),('/xarm6_traj_controller',['joints','command_interfaces','state_interfaces'])]:
                client=self.node.create_client(GetParameters,name+'/get_parameters');clients.append(client)
                if not client.wait_for_service(timeout_sec=10):raise RuntimeError('READBACK_SERVICE_MISSING:'+name)
                request=GetParameters.Request();request.names=parameters;response=self.wait(client.call_async(request),10)
                output[name]={p:{'type':v.type,'string':v.string_value,'strings':list(v.string_array_value)} for p,v in zip(parameters,response.values)}
            expected=[j['native'] for j in load_profile()['jointMap']]
            if output['/xarm6_traj_controller']['joints']['strings']!=expected:raise RuntimeError('CONTROLLER_JOINT_MAP_MISMATCH')
            if 'position' not in output['/xarm6_traj_controller']['command_interfaces']['strings'] or 'position' not in output['/xarm6_traj_controller']['state_interfaces']['strings']:raise RuntimeError('CONTROLLER_INTERFACE_MISSING')
            if not output['/move_group']['robot_description_semantic']['string']:raise RuntimeError('COLLISION_READBACK_MISSING')
            return output
        finally:
            for client in clients:self.node.destroy_client(client)

    def close(self):
        self.executor.shutdown(timeout_sec=3);self.thread.join(timeout=3);self.client.destroy();self.node.destroy_node()
