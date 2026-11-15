"""Protocol doubles test data extraction only, never LinuxCNC execution evidence."""
import sys
import math
from pathlib import Path
from types import SimpleNamespace
import pytest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import smoke_driver


def test_trace_api_is_present():
    assert callable(getattr(smoke_driver,'sample_actual_joints',None)), 'actual joint trace sampler is missing'


def test_trace_reads_joint_arrays_not_cartesian_and_never_synthesizes_clock():
    sample=getattr(smoke_driver,'sample_actual_joints',lambda *a,**k: None)
    stat=SimpleNamespace(poll=lambda:None,joint_actual_position=[90,0,0,0,0,0],joint_position=[91,0,0,0,0,0],actual_position=[123]*9,cycle_time=.01,echo_serial_number=900)
    ticks=iter([100,200])
    row=sample(stat,'boot:task:1',0,clock=lambda:next(ticks))
    assert row is not None,'actual joint sampling missing'
    assert row['actual']['rawDeg'][0]==90
    assert row['actual']['rad'][0]==math.pi/2
    assert row['commanded']['rad'][0]==91*math.pi/180
    assert row['receiveMonotonicNs']==['100','200']
    assert row['controllerTime'] is None
    assert row['actual']['sampleId'] != row['commanded']['sampleId']
    assert row['synchrony']=='unavailable'


def test_missing_actual_is_retained_as_missing_not_zero():
    sample=getattr(smoke_driver,'sample_actual_joints',lambda *a,**k: None)
    row=sample(SimpleNamespace(poll=lambda:None,joint_position=[0]*6),'epoch',0)
    assert row is not None
    assert row['actual'] is None


def test_modified_sim_profile_cannot_load_device_hal(tmp_path):
    from prepare_smoke import prepare_profile
    import shutil
    cfg=tmp_path/'unsafe';shutil.copytree(ROOT/'configs/sim/puma560',cfg)
    with (cfg/'machine.hal').open('a') as f:f.write('\nloadrt hm2_eth\n')
    with pytest.raises(ValueError,match='SIM_CONFIG_BYTES_MISMATCH'):
        prepare_profile(ROOT,cfg/'mekoniq.ini',tmp_path/'out')


def test_inventory_preserves_package_source_and_architecture():
    import importlib.util
    spec=importlib.util.spec_from_file_location('runtime_inventory',ROOT/'scripts/runtime-inventory.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    parse=getattr(module,'parse_packages',None)
    assert callable(parse),'source package inventory parser missing'
    rows=parse('linuxcnc-uspace\t2.9-example\tarm64\tinstalled\tlinuxcnc\t2.9-source\nmissing\t0\tamd64\tnot-installed\t\t\n')
    assert rows==[{'name':'linuxcnc-uspace','version':'2.9-example','architecture':'arm64','status':'installed','sourcePackage':'linuxcnc','sourceVersion':'2.9-source'}]


def test_epoch_change_during_poll_discards_uncertain_sample(monkeypatch):
    ctl=smoke_driver.LinuxcncController.__new__(smoke_driver.LinuxcncController)
    ctl.epoch='old';ctl.samples=[]
    ctl.lc=SimpleNamespace(STATE_ESTOP=1,STATE_ON=2,INTERP_READING=3,INTERP_WAITING=4)
    ctl.s=SimpleNamespace(poll=lambda:None,joint_actual_position=[0]*6,joint_position=[0]*6,joint=[],task_state=2,homed=[1]*6,file='',interp_state=0,paused=False)
    epochs=iter(['old','new']);monkeypatch.setattr(smoke_driver,'controller_epoch',lambda:next(epochs))
    with pytest.raises(RuntimeError,match='CONTROLLER_EPOCH_CHANGED'):
        ctl.state()
    assert ctl.samples==[]


def test_terminal_failure_preserves_prior_steps():
    class Broken:
        def __getattr__(self,name):
            if name=='state':return lambda:{'estop':False,'machineOn':True,'homed':True}
            if name=='version':return lambda:'protocol_double'
            if name=='program_open':return lambda path:(_ for _ in ()).throw(RuntimeError('controller lost'))
            return lambda:None
    record=smoke_driver.run_sequence(Broken(),'test',lambda x:None,lambda pred,timeout:pred())
    assert record['status']=='fail'
    assert [step['step'] for step in record['steps']]==['estop_reset','machine_on','home_all','program_open']
    assert record['steps'][-1]['error']=='controller lost'


def test_native_identity_failure_is_not_misreported_as_missing_python_module(tmp_path,monkeypatch):
    import json
    monkeypatch.setenv('MEKONIQ_SMOKE_EVIDENCE',str(tmp_path))
    def unavailable():raise RuntimeError('CONTROLLER_PROCESS_AMBIGUOUS')
    monkeypatch.setattr(smoke_driver,'LinuxcncController',unavailable)
    with pytest.raises(SystemExit) as exit_info:smoke_driver.main()
    assert exit_info.value.code==2
    record=json.loads((tmp_path/'smoke-driver.json').read_text())
    assert record['reasons']==['CONTROLLER_INITIALIZATION_FAILED:CONTROLLER_PROCESS_AMBIGUOUS']
