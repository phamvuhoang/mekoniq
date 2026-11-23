"""One MjModel/MjData and one stepping owner for the shared arm/mobile world.

The legacy reading helpers are bound as non-owning views of this model. Neither
view's constructor or step is called; only this class advances the physics clock.
"""
import copy
import os
import math
import mujoco
import numpy as np
from .compile import CompileError
from .compile_world import compile_world
from .compile_mobile import pose,matrix_pose,resolve_lidar
from .engine import MujocoEngine,BAD_STATE
from .mobile_engine import MobileEngine,ContactAccumulator,_transform
from .drive import wheel_targets,torque_limits
from .drive_binding import build_drive
from .drive_model import plan_actuators
from .protocol import WorkerError
from . import snapshot

# Registered development disturbances, map-frame force for one logical interval.
# These are not natural-slip claims or arbitrary caller-provided force vectors.
WORLD_DISTURBANCES={
 'world-dock-drift-v1':{'revision':1,'forceMapN':[2000.,0.,0.],'durationSubsteps':10},
 'world-cup-fall-v1':{'revision':1,'forceMapN':[30.,0.,30.],'durationSubsteps':10},
 # R4.4: a small horizontal push on the cup at the nozzle stand, once, around the commit of a belief grasp (the cup must stay on its support).
 'world-cup-nudge-v2':{'revision':2,'forceMapN':[4.025,0.,0.],'torqueMapNm':[0.,-.05*4.025,0.],'durationSubsteps':10,'segments':5},
 'world-cup-nudge-v1':{'revision':1,'forceMapN':[14.4,0.,0.],'durationSubsteps':10},
}

class WorldEngine:
    def __init__(self,scene,component,arm_physics,physical_models,load_profile,mobile_physics,blob_dir,drive=None):
        if mujoco.__version__!='3.17.0':raise CompileError('ENGINE_VERSION_MISMATCH')
        plan=plan_actuators(*drive) if drive else None
        xml,names=compile_world(scene,component,arm_physics,physical_models,load_profile,mobile_physics,blob_dir,plan)
        self.scene,self.names=scene,names
        self.model=m=mujoco.MjModel.from_xml_string(xml)
        self.data=d=mujoco.MjData(m)
        self.total_substeps=0;self.tick=-1;self.failed=False
        self.substeps=10;self.opening_max_m=arm_physics['gripper']['openingMaxM']
        # Bind arm observation/placement operations without constructing another model.
        a=self.arm=MujocoEngine.__new__(MujocoEngine)
        a.model,a.data,a.names=m,d,names['arm'];an=a.names
        a.opening_max_m=self.opening_max_m
        a.arm_joints=[m.joint(n).id for n in an['joints']]
        a.arm_qpos,a.arm_qvel=m.jnt_qposadr[a.arm_joints],m.jnt_dofadr[a.arm_joints]
        self.arm_limits=a.arm_limits=[tuple(map(float,r)) for r in m.jnt_range[a.arm_joints]]
        a.arm_act=[m.actuator(n).id for n in an['actuators']]
        a.grip_act=m.actuator(an['gripper']).id;a.grip_range=tuple(m.actuator_ctrlrange[m.actuator_ctrladr[a.grip_act]])
        gj=[m.joint(n).id for n in an['jointIds'].values() if n not in an['joints']]
        a.grip_qpos,a.grip_qvel=m.jnt_qposadr[gj],m.jnt_dofadr[gj]
        a.pads=[m.geom(n).id for n in an['pads']]
        a.contact_bits=(an['propContact']['contype'],an['propContact']['conaffinity'])
        a.prop={};a.in_scene=set()
        for pid,name in an['props'].items():
            bid=m.body(name).id;jid=m.body_jntadr[bid];qa,va=m.jnt_qposadr[jid],m.jnt_dofadr[jid]
            a.prop[pid]={'body':bid,'geom':m.body_geomadr[bid],'qpos':qa,'qvel':va,'park':d.qpos[qa:qa+7].copy()}
        d.qpos[a.arm_qpos]=scene['armCell']['arm']['homeRad']
        if not drive:d.ctrl[a.arm_act]=scene['armCell']['arm']['homeRad']   # on the drive path ctrl is written through actuator_ctrladr every substep (a pid actuator owns two cells: an actuator id is not a ctrl address)
        # Bind mobile observations, independent wheel odometry and raycasting.
        v=self.mobile=MobileEngine.__new__(MobileEngine)
        v.model,v.data,v.names=m,d,names['mobile'];bn=v.names
        v.scene,v.profile,v.physics=scene['navigation'],load_profile,mobile_physics
        v.entry=v.scene['robots'][0];v.rid=v.entry['robotId'];v.physical=physical_models[v.rid]
        v.sensor,v.sensor_physical=resolve_lidar(v.entry['model'],v.physical)
        v.base=m.body(bn['base']).id;v.wj=[m.joint(n).id for n in bn['wheelJoints']]
        v.wq,v.wv=m.jnt_qposadr[v.wj],m.jnt_dofadr[v.wj];v.acts=[m.actuator(n).id for n in bn['actuators']]
        v.prop={};v.dt=.002;v.substeps=10
        v.radius,v.separation=(v.physical['drive'][k]['value'] for k in ('wheelRadiusM','wheelSeparationM'))
        dr=v.physical['drive']['driveFrameInBase'];v.drive_in_base=pose(dr['xyzM'],dr['quaternionXyzw'])
        v.odom=np.array(v.entry['initialPoseMap'],dtype=float);v.tick=-1;v.targets=np.zeros(2)
        v.contacts=[];v.saturated=0;v.unstable=None;v.scans=[]
        a.drive=v.drive=None   # the views never own the drive: WorldEngine.drive does (their readback reports no bench inertia)
        # Every colliding geom has both an arm-classification tag and an exact
        # canonical contact identity. No arm x mobile blanket exemption.
        tags={m.geom(an['floor']).id:('floor',),m.geom(an['palm']).id:('palm',)}
        tags.update({g:('pad',k) for k,g in enumerate(a.pads)})
        tags.update({m.geom(n).id:('static',sid) for sid,n in an['statics'].items()})
        tags.update({m.geom(n).id:('support',sid) for sid,n in an['supports'].items()})
        tags.update({p['geom']:('prop',pid) for pid,p in a.prop.items()})
        link_of={n:lid for lid,n in an['links'].items()}
        arm_bodies={m.jnt_bodyid[j] for j in a.arm_joints}|{m.body_parentid[m.jnt_bodyid[a.arm_joints[0]]]}
        self.support_id=scene['supportMap']['mobileSupportId'];self.support=bn['supports'][self.support_id]
        support_link=self.support['parentBodyId'];self.support_body=m.body(bn['links'][support_link]).id
        for n,tag in bn['tags'].items():
            gid=m.geom(n).id
            if n!='FLOOR':tags[gid]=('support',self.support_id) if m.geom_bodyid[gid]==self.support_body else ('static',tag)
        for g in range(m.ngeom):
            if g not in tags:
                bid=m.geom_bodyid[g];tags[g]=('link',link_of[m.body(bid).name]) if bid in arm_bodies else ('gripper',)
        a.tags=tags
        v.tags={m.geom(n).id:tag for n,tag in bn['tags'].items()}
        aid=scene['armCell']['arm']['armId']
        for lid,name in an['links'].items():
            bid=m.body(name).id
            geoms=[g for g in range(m.body_geomadr[bid],m.body_geomadr[bid]+m.body_geomnum[bid]) if g not in a.pads and g!=m.geom(an['palm']).id]
            for i,g in enumerate(geoms):v.tags[g]=f'{aid}/{lid}/c{i}'
        for g,tag in tags.items():
            if g not in v.tags:
                if tag[0]=='prop':v.tags[g]=f'prop/{tag[1]}'
                elif tag[0]=='palm':v.tags[g]=f'{aid}/palm'
                elif tag[0]=='pad':v.tags[g]=f'{aid}/pad/{tag[1]}'
                elif tag[0] in ('support','static'):v.tags[g]=f'{tag[0]}/{tag[1]}'
                else:raise CompileError('WORLD_CONTACT_ID_UNBOUND')
        self.expected=set(bn['expected'])
        for pid,p in a.prop.items():
            for g in a.pads:self.expected.add(tuple(sorted((v.tags[g],f'prop/{pid}'))))
            for sid,n in an['supports'].items():self.expected.add(tuple(sorted((v.tags[m.geom(n).id],f'prop/{pid}'))))
            for (lid,_),n in bn['geoms'].items():
                if lid==support_link:self.expected.add(tuple(sorted((v.tags[m.geom(n).id],f'prop/{pid}'))))
        self.arm_scene=copy.deepcopy(scene['armCell'])
        self.arm_scene['allowedContacts']=[{'a':c['a'],'b':self.support_id if c['b']=='tray' else c['b']} for c in self.arm_scene['allowedContacts']]
        mujoco.mj_forward(m,d)
        for c in d.contact[:d.ncon]:
            if c.dist < -1e-6:raise CompileError('INITIAL_PENETRATION',f'{v.tags[int(c.geom1)]}/{v.tags[int(c.geom2)]}: {c.dist}')
        self.drive=None
        if drive:
            arm_id,rid=scene['armCell']['arm']['armId'],v.rid
            of_axis={**{f'{arm_id}/J{k+1}':x for k,x in enumerate(a.arm_act)},f'{arm_id}/gripper':a.grip_act,f'{rid}/wheel-left':v.acts[0],f'{rid}/wheel-right':v.acts[1]}
            top=float(v.physical['drive']['actuatorMaxSpeedRadps']['value']) # a wheel's command range is the plant's limit; velocityLimitRadS is where the drive trips
            limits={**{f'{arm_id}/J{k+1}':lim for k,lim in enumerate(self.arm_limits)},f'{arm_id}/gripper':a.grip_range,**{x['axisId']:(-top,top) for x in drive[0]['axes'] if x['mode']=='csv'}}
            self.drive=build_drive(m,d,drive,plan,of_axis,limits,10)
            self.wheel_pos=[self.drive.g.index[f'{rid}/wheel-left'],self.drive.g.index[f'{rid}/wheel-right']]

    def step(self,targets,opening,placements,v_mps,omega_radps,disturbance=None,commands=None):
        if self.failed:raise WorkerError('WORLD_TERMINAL','world may not retry',fatal=True)
        m,d,a,v=self.model,self.data,self.arm,self.mobile
        force_body=None
        if disturbance:
            preset=WORLD_DISTURBANCES.get(disturbance['presetId'])
            if not preset:raise WorkerError('WORLD_PERTURBATION_NOT_ADMITTED','unknown preset')
            target=disturbance['targetId']
            if disturbance['presetId']=='world-dock-drift-v1':
                if target!=v.rid:raise WorkerError('WORLD_PERTURBATION_TARGET_INVALID','AMR identity')
                force_body=v.base
            else:
                if target not in a.in_scene:raise WorkerError('WORLD_PERTURBATION_TARGET_INVALID','inactive prop')
                force_body=a.prop[target]['body']
        drv=self.drive
        if drv is None:
            v.targets[:]=wheel_targets(v_mps,omega_radps,v.radius,v.separation)
            d.ctrl[a.arm_act]=targets;d.ctrl[v.acts]=v.targets
            if opening is not None:
                lo,hi=a.grip_range;d.ctrl[a.grip_act]=lo+(hi-lo)*(1-opening/a.opening_max_m)
        else:drv.g.begin_tick(commands)
        for pid,at in placements:
            if at is None:a.in_scene.discard(pid);a._set_contacts(pid,False)
            else:
                x,y,z,w=at['quaternionXyzw'];q=np.array([w,x,y,z],dtype=float)
                a._put(pid,[*at['position'],*(q/np.linalg.norm(q))]);a._set_contacts(pid,True);a.in_scene.add(pid)
        for pid in a.prop.keys()-a.in_scene:a._put(pid,a.prop[pid]['park'])
        # The derived pick study needs the native birth pose before contacts can
        # move it. Read both free-joint state and body transform; never echo `at`.
        # Ordinary worlds keep their existing step path and snapshot bytes.
        born=[pid for pid,at in placements if at is not None] if self.scene.get('id')=='pick-rig-v1' else []
        birth_observations=[]
        if born:
            mujoco.mj_forward(m,d)
            for pid in born:
                p=a.prop[pid];q=d.qpos[p['qpos']:p['qpos']+7]
                birth_observations.append({'method':'mujoco-freejoint-body-before-step-v1','frame':'map','propId':pid,'physicsSubstepsBefore':self.total_substeps,'qposPositionM':q[:3].tolist(),'bodyPositionM':d.xpos[p['body']].tolist(),'quaternionXyzw':q[[4,5,6,3]].tolist()})
        aggregate=ContactAccumulator(.002,self.expected);seen=set();v.saturated=0
        try:
            if force_body is not None:
                d.xfrc_applied[force_body,:3]=preset['forceMapN']
                if 'torqueMapNm' in preset:d.xfrc_applied[force_body,3:]=preset['torqueMapNm']
            for _ in range(10):
                old=d.qpos[v.wq].copy();saturated=False
                if drv is not None:
                    out=drv.pre_substep();v.targets[:]=[out['target'][i] for i in self.wheel_pos]
                for k,(act,actual,target) in enumerate(zip(v.acts,d.qvel[v.wv],v.targets)):
                    lo,hi=torque_limits(float(actual),float(target),v.physics)
                    if drv is not None:lo,hi=drv.scale_limits(self.wheel_pos[k],lo,hi)
                    m.actuator_forcerange[act]=lo,hi
                    demand=v.physics['velocityGainNmsPerRad']*(target-actual);saturated|=demand<lo-1e-12 or demand>hi+1e-12
                v.saturated+=int(saturated)
                before={k:d.warning[w].number for k,w in BAD_STATE.items()}
                mujoco.mj_step(m,d);self.total_substeps+=1
                if drv is not None:drv.post_substep()
                warnings=[k for k,w in BAD_STATE.items() if d.warning[w].number!=before[k]]
                if warnings or not all(np.isfinite(x).all() for x in (d.qpos,d.qvel,d.qacc)):
                    self.failed=True;raise WorkerError('PLANT_UNSTABLE',','.join(warnings) or 'NONFINITE',fatal=True)
                delta=(d.qpos[v.wq]-old)*v.radius;ds,da=float(sum(delta)/2),float((delta[1]-delta[0])/v.separation)
                distance=ds*float(np.sinc(da/(2*math.pi)));v.odom[:2]+=distance*np.array([math.cos(v.odom[2]+da/2),math.sin(v.odom[2]+da/2)]);v.odom[2]+=da
                aggregate.add(v._sample_contacts());seen.update(a.contacts())
        finally:
            if force_body is not None:d.xfrc_applied[force_body,:]=0
        self.tick+=1;v.tick=self.tick;v.contacts=aggregate.finish();mujoco.mj_forward(m,d)
        if self.tick%v.entry['model']['sensors'][0]['publishEveryTicks']==0:v.scans=[v.scan(self.tick)]
        ar={**a.read(),'tickContacts':sorted(seen),'unstable':None};snapshot.check_stable(ar,a.arm_limits)
        mr=v.read();snapshot.check_mobile_stable(mr)
        arm=snapshot.build(run_id='world',boot_id='world',seq=self.tick+1,tick=self.tick,scene=self.arm_scene,reading=ar,limits=a.arm_limits)
        result=snapshot.build_mobile(run_id='world',boot_id='world',seq=self.tick+1,tick=self.tick,scene=self.scene,reading=mr)
        result['arms'],result['props']=arm['arms'],arm['props']
        sp=self.support['poseInBody'];st=_transform(d,self.support_body)@pose(sp['positionM'],sp['quaternionXyzw'])
        sv=v._velocity(self.support_body)
        for prop in result['props']:
            pid=prop['propId'];bid=a.prop[pid]['body'];at=_transform(d,bid);pv=v._velocity(bid)
            relative=matrix_pose(np.linalg.inv(st)@at)
            support_velocity=sv[3:]+np.cross(sv[:3],at[:3,3]-d.xpos[self.support_body])
            touching=any(set((int(c.geom1),int(c.geom2)))=={a.prop[pid]['geom'],g} for g in range(m.body_geomadr[self.support_body],m.body_geomadr[self.support_body]+m.body_geomnum[self.support_body]) for c in d.contact[:d.ncon] if c.exclude==0)
            # This is instantaneous physical support, not a release receipt. Source
            # must apply the registered polygon/relative-motion observation window.
            if touching:prop['restingOn']=self.support_id if np.linalg.norm(pv[3:]-support_velocity)<.01 else None
            result['physics']['loads'].append({'propId':pid,'poseMap':matrix_pose(at),'linearVelocityMapMps':pv[3:].tolist(),'angularVelocityMapRadps':pv[:3].tolist(),'supportId':self.support_id,'poseInSupport':relative})
        result['worldStep']={'workerPid':os.getpid(),'modelCount':1,'physicsSubsteps':self.total_substeps,'primingSubsteps':10,**{k:int(getattr(m,k)) for k in ('nq','nv','nbody','ngeom')}}
        if birth_observations:result['worldStep']['birthObservations']=birth_observations
        if drv is not None:result['drives']=drv.g.end_tick()
        self.last=result
        return {'time':float(d.time),'unstable':None,'world':result}

    def readback(self):
        return {**self.mobile.readback(),'arm':self.arm.readback()['arm']}

    def close(self):
        self.arm.model=self.arm.data=self.mobile.model=self.mobile.data=None
        self.model=self.data=None
