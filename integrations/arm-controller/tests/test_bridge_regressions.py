"""Review regressions over the actual port, arbiter and sockets; LinuxCNC API is the unavailable boundary."""
import json
import grp
import inspect
import shutil
import signal
import os
import shlex
import socket
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from support import ROOT, SOURCE
from arm_fixture import T0, cell_command, demo_program_ref, envelope, profile, profile_hash
from bridge.arbiter import Arbiter
from bridge.journal import Journal
from bridge.linuxcnc_port import LinuxcncPort
from bridge.service import BridgeService
from bridge import protocol


def controller_api():
    """Only the native LinuxCNC API is substituted; port/arbiter/service remain real."""
    lc = types.SimpleNamespace()
    for i, name in enumerate('INTERP_IDLE INTERP_READING INTERP_WAITING STATE_ESTOP STATE_ESTOP_RESET STATE_OFF STATE_ON MODE_MANUAL MODE_AUTO MODE_MDI AUTO_RUN AUTO_PAUSE AUTO_RESUME JOG_CONTINUOUS JOG_STOP NML_ERROR OPERATOR_ERROR OPERATOR_TEXT OPERATOR_DISPLAY RCS_DONE RCS_ERROR EXEC_DONE'.split(), 1):
        setattr(lc, name, i)
    st = types.SimpleNamespace(paused=False, interp_state=lc.INTERP_IDLE, task_state=lc.STATE_ON,
        joint=[dict(input=0, output=0, velocity=0) for _ in range(6)], homed=[True]*6, actual_position=[0]*9,
        task_mode=lc.MODE_AUTO, poll=lambda: None, state=lc.RCS_DONE, exec_state=lc.EXEC_DONE)
    calls, errors = [], []
    cmd = types.SimpleNamespace(mode=lambda *a: None, wait_complete=lambda: lc.RCS_DONE,
        auto=lambda *a: calls.append(('auto', *a)), abort=lambda: calls.append(('abort',)),
        program_open=lambda path: setattr(st, 'file', path),
        jog=lambda kind, mode, joint, *v: st.joint[joint].update(velocity=v[0] if kind == lc.JOG_CONTINUOUS else 0))
    lc.stat, lc.command = lambda: st, lambda: cmd
    lc.error_channel = lambda: types.SimpleNamespace(poll=lambda: errors.pop(0) if errors else None)
    lc.version = 'boundary-stub'
    return lc, st, calls, errors


def hal_api():
    """Fixed simulated object-present pin, explicitly a HAL protocol double."""
    class Component(dict):
        def newpin(self, *args): pass
        def ready(self): pass
    return types.SimpleNamespace(component=lambda name: Component(), HAL_BIT=1, HAL_OUT=2, connect=lambda pin, signal: None)


class PortRegressionTest(unittest.TestCase):
    def setUp(self):
        self.lc, self.st, self.calls, self.errors = controller_api()
        self.patch = patch.dict(sys.modules, linuxcnc=self.lc, hal=hal_api()); self.patch.start(); self.addCleanup(self.patch.stop)
        self.port = LinuxcncPort(profile(), str(ROOT))
        self.port._boot, self.port._boot_at = 'same-boot', time.monotonic()

    def test_stage_requires_observed_controller_program_before_reporting_identity(self):
        self.port.c.program_open = lambda path: None
        with self.assertRaisesRegex(Exception, 'PROGRAM_OPEN_NOT_OBSERVED'):
            self.port.stage('demo', 'programs/demo-six-axis.ngc', '')
        self.assertIsNone(self.port.state()['program'])

    def test_delayed_start_is_not_completed_by_initial_idle(self):
        self.port.run('job')
        self.assertEqual(self.port.outcome('job')['status'], 'accepted')
        self.st.interp_state = self.lc.INTERP_READING
        self.assertEqual(self.port.outcome('job')['status'], 'running')
        self.st.interp_state = self.lc.INTERP_IDLE
        self.assertEqual(self.port.outcome('job')['status'], 'completed')

    def test_cancel_marks_original_job_failed_even_if_abort_finishes_idle(self):
        self.port.run('job'); self.st.interp_state = self.lc.INTERP_READING; self.port.state()
        self.port.cancel('cancel'); self.st.interp_state = self.lc.INTERP_IDLE
        self.assertEqual(self.port.outcome('job')['status'], 'failed')
        self.assertEqual(self.port.outcome('job')['evidence']['reason'], 'ABORT_REQUESTED')

    def test_command_rejection_and_error_channel_never_become_success(self):
        for kind in ('rejected', 'error'):
            with self.subTest(kind=kind):
                self.port.run(kind); self.st.interp_state = self.lc.INTERP_READING; self.port.state()
                if kind == 'rejected': self.st.state = self.lc.RCS_ERROR
                else:
                    self.st.state = self.lc.RCS_DONE
                    self.errors.append((self.lc.OPERATOR_ERROR, 'program failed')); self.port.poll_errors()
                self.st.interp_state = self.lc.INTERP_IDLE
                self.assertEqual(self.port.outcome(kind)['status'], 'failed')

    def arbiter(self, journal):
        a = Arbiter(profile(), Journal(journal), self.port, now_ms=lambda: T0)
        a.start(); return a

    def test_pending_async_start_cannot_be_overwritten_or_transferred_on_initial_idle(self):
        with tempfile.TemporaryDirectory() as d:
            a = self.arbiter(Path(d)/'j'); tok = a.acquire('lab_simulation', 'lab', 1, 10000)
            for cap, payload, cid in [('stage_program', {'profileId': profile()['machineId']}, 'stage'), ('start_job', {'jobId':'job'}, 'job')]:
                a.submit(envelope(cell_command(cap, payload, cid, program=demo_program_ref()), token=tok['token'], lease=tok['leaseId']))
            again = a.submit(envelope(cell_command('start_job', {'jobId':'job2'}, 'job2', program=demo_program_ref()), token=tok['token'], lease=tok['leaseId']))
            self.assertEqual(again['status'], 'rejected')
            a.release(tok['leaseId'], tok['token'])
            self.assertFalse(a.acquire('local_operator', 'hmi', 1, 10000)['ok'])
            self.assertEqual(len([x for x in self.calls if x[0] == 'auto']), 1)

    def test_same_boot_restart_retains_gate_when_port_loses_accepted_job_mapping(self):
        with tempfile.TemporaryDirectory() as d:
            a = self.arbiter(Path(d)/'j'); tok = a.acquire('lab_simulation', 'lab', 1, 10000)
            for cap, payload, cid in [('stage_program', {'profileId': profile()['machineId']}, 'stage'), ('start_job', {'jobId':'job'}, 'job')]:
                self.assertEqual(a.submit(envelope(cell_command(cap, payload, cid, program=demo_program_ref()), token=tok['token'], lease=tok['leaseId']))['status'], 'accepted')
            self.port = LinuxcncPort(profile(), str(ROOT)); self.port._boot, self.port._boot_at = 'same-boot', time.monotonic()
            a = self.arbiter(Path(d)/'j')
            self.assertTrue(a.status()['reconcileRequired'])
            self.assertEqual(a.outcome('job')['status'], 'unknown')
            self.assertEqual(a.acquire('local_operator', 'hmi', 1, 10000)['reasonCodes'], ['RECONCILE_REQUIRED'])
            a.reconcile('job')
            self.assertTrue(a.status()['reconcileRequired'])
            a = self.arbiter(Path(d)/'j')
            self.assertTrue(a.status()['reconcileRequired'])
            self.assertEqual(len([x for x in self.calls if x[0] == 'auto']), 1)

    def test_same_boot_restart_queries_acknowledged_nonterminal_pause_too(self):
        with tempfile.TemporaryDirectory() as d:
            a = self.arbiter(Path(d)/'j'); tok = a.acquire('lab_simulation', 'lab', 1, 10000)
            for cap, payload, cid in [('stage_program', {'profileId': profile()['machineId']}, 'stage'), ('start_job', {'jobId':'job'}, 'job')]:
                a.submit(envelope(cell_command(cap, payload, cid, program=demo_program_ref()), token=tok['token'], lease=tok['leaseId']))
            self.st.interp_state = self.lc.INTERP_READING
            a.submit(envelope(cell_command('pause_job', {'jobId':'job'}, 'pause'), token=tok['token'], lease=tok['leaseId']))
            self.port = LinuxcncPort(profile(), str(ROOT)); self.port._boot, self.port._boot_at = 'same-boot', time.monotonic()
            a = self.arbiter(Path(d)/'j')
            self.assertEqual(set(a.status()['unknownCommands']), {'job', 'pause'})
            self.assertEqual(len([x for x in self.calls if x[0] == 'auto']), 2)

    def test_release_expiry_and_revoke_stop_continuous_jog_while_interpreter_idle(self):
        for trigger in ('release', 'expiry', 'revoke', 'restart'):
            with self.subTest(trigger=trigger), tempfile.TemporaryDirectory() as d:
                now = [T0]
                a = Arbiter(profile(), Journal(Path(d)/'j'), self.port, now_ms=lambda: now[0]); a.start()
                tok = a.acquire('local_operator', 'hmi', 1, 1000)
                env = envelope({}, token=tok['token'], lease=tok['leaseId'], actor='local_operator'); env.pop('command')
                env['local'] = {'action': 'jog_start', 'joint': 2, 'velocityDegS': 3}
                self.assertEqual(a.local_motion(env)['status'], 'accepted'); self.assertEqual(self.st.joint[2]['velocity'], 3)
                if trigger == 'release': a.release(tok['leaseId'], tok['token'])
                elif trigger == 'revoke': a.revoke('hmi', 'stop')
                elif trigger == 'restart': self.arbiter(Path(d)/'j')
                else: now[0] += 1001; a.observe()
                self.assertEqual(self.st.joint[2]['velocity'], 0)


class ServiceRegressionTest(unittest.TestCase):
    setUp = PortRegressionTest.setUp
    arbiter = PortRegressionTest.arbiter
    def test_partially_writable_peer_cannot_extend_send_deadline(self):
        with tempfile.TemporaryDirectory() as d:
            svc = BridgeService(profile(), self.arbiter(Path(d)/'j'), self.port, socket_path=str(Path(d)/'s'), status_hz=0)
            conn, peer = socket.socketpair()
            conn.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 1024)
            worker = threading.Thread(target=lambda: svc._send(conn, {'payload':'x'*65536}, droppable=True), daemon=True)
            try:
                worker.start(); worker.join(1.5)
                self.assertFalse(worker.is_alive(), 'partial write exceeded bounded send deadline')
            finally:
                for sock in (conn, peer):
                    try: sock.shutdown(socket.SHUT_RDWR)
                    except OSError: pass
                    sock.close()
                worker.join(2)

    def test_reconcile_before_tick_classifies_native_errors_and_preserves_single_event_delivery(self):
        with tempfile.TemporaryDirectory() as d:
            a = self.arbiter(Path(d)/'j'); tok = a.acquire('lab_simulation', 'lab', 1, 10000)
            for cap, payload, cid in [('stage_program', {'profileId': profile()['machineId']}, 'stage'), ('start_job', {'jobId':'job'}, 'job')]:
                a.submit(envelope(cell_command(cap, payload, cid, program=demo_program_ref()), token=tok['token'], lease=tok['leaseId']))
            self.st.interp_state = self.lc.INTERP_READING; self.port.state()
            self.errors.append((self.lc.OPERATOR_ERROR, 'program failed before reconcile'))
            self.st.interp_state = self.lc.INTERP_IDLE
            svc = BridgeService(profile(), a, self.port, socket_path=str(Path(d)/'s'), status_hz=0)
            conn, peer = socket.socketpair()
            svc.clients.append(conn); peer.settimeout(2)
            env = envelope({}, token=tok['token'], lease=tok['leaseId']); env.pop('command'); env['reconcile'] = {'commandId':'job'}
            try:
                reply = svc.handle(env)
                self.assertEqual(reply['outcome']['status'], 'failed')
                svc.poll_once()
                with peer.makefile('rb') as f:
                    messages = []
                    while not any(m.get('event') == 'error_channel' for m in messages):
                        messages.append(json.loads(f.readline()))
                error = [m for m in messages if m.get('event') == 'error_channel']
                self.assertEqual(len(error), 1)
                self.assertEqual(error[0]['detail'], 'program failed before reconcile')
                self.assertEqual(self.port.poll_errors(), [])
                self.assertEqual(a.outcome('job')['status'], 'failed')
            finally:
                svc.stop(); peer.close()

    def test_queued_native_error_wins_over_idle_poll_before_service_tick(self):
        with tempfile.TemporaryDirectory() as d:
            a = self.arbiter(Path(d)/'j')
            tok = a.acquire('lab_simulation', 'lab', 1, 10000)
            for cap, payload, cid in [('stage_program', {'profileId': profile()['machineId']}, 'stage'), ('start_job', {'jobId':'job'}, 'job')]:
                a.submit(envelope(cell_command(cap, payload, cid, program=demo_program_ref()), token=tok['token'], lease=tok['leaseId']))
            self.st.interp_state = self.lc.INTERP_READING; self.port.state()
            self.errors.append((self.lc.OPERATOR_ERROR, 'program error'))
            self.st.interp_state = self.lc.INTERP_IDLE
            self.port.state()  # status collection can occur before the service drains native errors
            svc = BridgeService(profile(), a, self.port, socket_path=str(Path(d)/'s'), status_hz=0)
            svc.poll_once()
            self.assertEqual(a.outcome('job')['status'], 'failed')

    def test_reader_survives_telemetry_and_two_real_renewal_intervals(self):
        with tempfile.TemporaryDirectory(prefix='br-') as d:
            a = self.arbiter(Path(d)/'j'); p = profile()
            svc = BridgeService(p, a, self.port, socket_path=str(Path(d)/'s'), now_ms=lambda: T0, status_hz=20)
            svc.start(); self.addCleanup(svc.stop)
            s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); self.addCleanup(s.close); s.settimeout(3); s.connect(svc.path)
            f = s.makefile('rb'); self.addCleanup(f.close)
            env = envelope({}, token='', lease=''); env.pop('command'); env['acquire'] = {'actor': 'lab', 'leaseMs':10000}
            def rpc(msg):
                s.sendall(protocol.frame(msg))
                while True:
                    line = f.readline()
                    self.assertTrue(line, 'healthy command reader disconnected')
                    m = json.loads(line)
                    if m['kind'] == protocol.KIND_REPLY: return m
            r = rpc(env); self.assertEqual(r['status'], 'accepted')
            env.pop('acquire'); env['owner']['token'] = r['token']; env['leaseId'] = r['leaseId']; env['renew'] = {'leaseId':r['leaseId']}
            for _ in range(2):
                until = time.monotonic() + 7.05
                while time.monotonic() < until:
                    self.assertTrue(f.readline(), 'healthy command reader disconnected during telemetry')
                self.assertEqual(rpc(env)['status'], 'accepted')


class SocketPermissionsRegressionTest(unittest.TestCase):
    setUp = PortRegressionTest.setUp
    arbiter = PortRegressionTest.arbiter

    def test_failed_second_channel_provisioning_cleans_up_unstarted_listeners(self):
        gids = list(dict.fromkeys([os.getgid(), *os.getgroups()]))
        if len(gids) < 2: self.skipTest('two groups required')
        groups = dict(zip(('lab', 'local'), [grp.getgrgid(g).gr_name for g in gids[:2]]))
        with tempfile.TemporaryDirectory(prefix='br-') as d:
            a = self.arbiter(Path(d)/'j')
            svc = BridgeService(profile(), a, self.port, socket_path=str(Path(d)/'s'), status_hz=0, socket_groups=groups)
            chown = os.chown
            def fail_local(path, uid, gid):
                if path == svc.local_path: raise PermissionError('LOCAL_GROUP_DENIED')
                return chown(path, uid, gid)
            with patch('bridge.service.os.chown', side_effect=fail_local):
                with self.assertRaisesRegex(PermissionError, 'LOCAL_GROUP_DENIED'): svc.start()
            self.assertFalse(Path(svc.path).exists())
            self.assertFalse(Path(svc.local_path).exists())

    def test_channel_groups_are_applied_on_every_bind_before_clients_connect(self):
        gids = list(dict.fromkeys([os.getgid(), *os.getgroups()]))
        if len(gids) < 2: self.skipTest('two local groups required for actual chgrp test')
        groups = dict(zip(('lab', 'local'), [grp.getgrgid(g).gr_name for g in gids[:2]]))
        with tempfile.TemporaryDirectory(prefix='br-') as d:
            a = self.arbiter(Path(d)/'j')
            for _ in range(2):
                svc = BridgeService(profile(), a, self.port, socket_path=str(Path(d)/'s'), status_hz=0)
                svc.socket_groups = groups
                svc.start()
                try:
                    for channel, path in [('lab', svc.path), ('local', svc.local_path)]:
                        st = os.stat(path)
                        self.assertEqual(st.st_mode & 0o777, 0o660)
                        self.assertEqual(st.st_gid, grp.getgrnam(groups[channel]).gr_gid)
                        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); client.settimeout(2)
                        with client:
                            client.connect(path)
                            env = envelope({}, token='', lease='', actor='local_operator' if channel == 'lab' else 'lab_simulation')
                            env.pop('command'); env['acquire'] = {'actor':'forged', 'leaseMs':1000}
                            client.sendall(protocol.frame(env))
                            with client.makefile('rb') as f: reply = json.loads(f.readline())
                            self.assertEqual(reply['status'], 'rejected')
                            self.assertTrue(reply['reasonCodes'][0].startswith('OWNER_KIND_NOT_ALLOWED_ON_CHANNEL'))
                finally: svc.stop()


class EntryPointRegressionTest(unittest.TestCase):
    def test_systemd_script_invocation_imports_from_independent_directory(self):
        unit = (ROOT/'packaging/systemd/mekoniq-arm-bridge.service').read_text()
        line = next(l.split('=',1)[1] for l in unit.splitlines() if l.startswith('ExecStart='))
        args = shlex.split(line); args[0] = sys.executable
        args[1] = str(ROOT/'bridge/run.py')
        p = subprocess.run([*args[:2], '--help'], cwd='/tmp', env={k:v for k,v in os.environ.items() if k != 'PYTHONPATH'}, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)

    def test_standalone_package_systemd_invocation_starts_real_socket_with_native_api_stub(self):
        with tempfile.TemporaryDirectory(prefix='br-') as d:
            base = Path(d); package = base/'current'; package.mkdir()
            for name in ('bridge', 'configs', 'programs', 'models'):
                shutil.copytree(ROOT/name, package/name, ignore=shutil.ignore_patterns('__pycache__'))
            shutil.copytree(SOURCE/'packages/contracts/schemas', package/'schemas')
            stub = base/'native'; stub.mkdir()
            (stub/'hal.py').write_text('import types\n'+inspect.getsource(hal_api)+'\n_api=hal_api()\nglobals().update(vars(_api))\n')
            (stub/'linuxcnc.py').write_text('import types\n' + inspect.getsource(controller_api) + '\napi, st, calls, errors = controller_api()\nglobals().update(vars(api))\n')
            unit = (ROOT/'packaging/systemd/mekoniq-arm-bridge.service').read_text()
            args = shlex.split(next(l.split('=',1)[1] for l in unit.splitlines() if l.startswith('ExecStart=')))
            args = [arg.replace('/opt/mekoniq-arm-sim/current', str(package)).replace('/var/lib/mekoniq-arm/journal.jsonl', str(base/'journal')) for arg in args]
            args[0] = sys.executable
            gids = list(dict.fromkeys([os.getgid(), *os.getgroups()]))
            if len(gids) < 2: self.skipTest('two groups required for deployed channel provisioning')
            args[args.index('--lab-group')+1] = grp.getgrgid(gids[0]).gr_name
            args[args.index('--local-group')+1] = grp.getgrgid(gids[1]).gr_name
            args += ['--socket', str(base/'s'), '--local-socket', str(base/'l')]
            env = {**os.environ, 'PYTHONPATH':str(stub), 'MEKONIQ_ARM_SCHEMA_DIR':str(package/'schemas')}
            proc = subprocess.Popen(args, cwd='/tmp', env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                until = time.monotonic()+5
                while not (base/'s').exists() and proc.poll() is None and time.monotonic()<until: time.sleep(.02)
                self.assertIsNone(proc.poll(), proc.stderr.read() if proc.poll() is not None else '')
                self.assertTrue((base/'s').exists(), 'service never bound the deployed socket')
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                    client.settimeout(2); client.connect(str(base/'s'))
                    env = envelope({}, token='', lease=''); env.pop('command'); env['acquire'] = {'actor':'lab','leaseMs':10000}
                    client.sendall(protocol.frame(env))
                    with client.makefile('rb') as f:
                        while True:
                            reply = json.loads(f.readline())
                            if reply['kind'] == protocol.KIND_REPLY: break
                    self.assertEqual(reply['status'], 'accepted')
            finally:
                if proc.poll() is None: proc.send_signal(signal.SIGINT)
                out, err = proc.communicate(timeout=5)
            self.assertEqual(proc.returncode, 0, err)
            self.assertTrue(json.loads(out.splitlines()[0])['started'])


if __name__ == '__main__': unittest.main()
