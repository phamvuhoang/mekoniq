"""N06 provider-side barrier proof. Fake controller boundary, never native execution."""
import tempfile
from pathlib import Path
from support import ROOT
from arm_fixture import T0, profile, envelope
from fake_controller import FakeController
from bridge.arbiter import Arbiter
from bridge.journal import Journal
from bridge.service import BridgeService
from bridge import protocol


def test_barrier_reads_actual_state_after_nonce_and_fences_owner_boot_epoch():
    with tempfile.TemporaryDirectory() as directory:
        controller=FakeController();state=controller.state;controller.state=lambda:{**state(),'velocityDegS':[0]*6};p=profile();arb=Arbiter(p,Journal(Path(directory)/'journal'),controller,now_ms=lambda:T0);arb.start()
        service=BridgeService(p,arb,controller,now_ms=lambda:T0,status_hz=0)
        token=arb.acquire('lab_simulation','native-run',1,10000)
        frame=service.status_message()
        env=envelope(None,token=token['token'],lease=token['leaseId']);env.pop('command')
        env['barrier']={'barrierId':'run:transfer:load','nonce':'nonce-1','bootId':frame['bootId'],'afterSeq':frame['seq'],'state':'stationary'}
        reply=service.handle(env)
        assert reply['status']=='accepted',reply
        proof=reply['outcome']['evidence']
        assert proof['nonce']=='nonce-1' and int(proof['seq'])>int(frame['seq'])
        assert protocol.validate(reply,protocol.load_validators())==[]
        env['barrier']['bootId']='old-boot'
        assert service.handle(env)['status']=='rejected'
        env['barrier']['bootId']=frame['bootId'];env['controllerEpoch']=2
        assert service.handle(env)['status']=='rejected'
        env['controllerEpoch']=1;env['owner']['token']='wrong'
        assert service.handle(env)['status']=='rejected'

def test_status_retains_actual_controller_and_bridge_inventory():
    with tempfile.TemporaryDirectory() as directory:
        controller=FakeController();p=profile();arb=Arbiter(p,Journal(Path(directory)/'journal'),controller,now_ms=lambda:T0);arb.start()
        service=BridgeService(p,arb,controller,now_ms=lambda:T0,status_hz=0)
        frame=service.status_message()
        assert frame['inventory']['controllerVersion']=='fake-linuxcnc'
        assert frame['inventory']['profileSha256']==protocol.profile_hash(p)
        assert len(frame['inventory']['bridgeCodeSha256'])==64
        assert protocol.validate(frame,protocol.load_validators())==[]
