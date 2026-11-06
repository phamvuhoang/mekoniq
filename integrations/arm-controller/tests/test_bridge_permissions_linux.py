"""Actual separate-UID socket authorization; requires a provisioned isolated Linux host and root test runner.
Only the unavailable LinuxCNC native API is substituted. No account/group creation or controller start."""
import grp
import multiprocessing
import os
import pwd
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from support import ROOT
from arm_fixture import T0, cell_command, envelope, profile
from test_bridge_regressions import controller_api
from bridge.arbiter import Arbiter
from bridge.journal import Journal
from bridge.linuxcnc_port import LinuxcncPort
from bridge.service import BridgeService
from bridge import protocol


@unittest.skipUnless(sys.platform == 'linux' and os.geteuid() == 0, 'blocked_external: isolated Linux root runner with provisioned separate service/operator/Lab users required')
class DeployedIdentityTest(unittest.TestCase):
    def test_deployed_users_can_only_connect_to_their_provisioned_channel_after_each_rebind(self):
        names = ('mekoniq-arm', 'mekoniq-lab', 'mekoniq-operator', 'nobody')
        try:
            users = {name: pwd.getpwnam(name) for name in names}
            gids = {name: grp.getgrnam(name).gr_gid for name in ('mekoniq-lab', 'mekoniq-arm-operators')}
        except KeyError as e:
            self.skipTest(f'blocked_external: provision deployment identities first: {e}')
        self.assertEqual(len({u.pw_uid for u in users.values()}), 4)
        self.assertNotIn(gids['mekoniq-arm-operators'], os.getgrouplist('mekoniq-lab', users['mekoniq-lab'].pw_gid))
        self.assertNotIn(gids['mekoniq-lab'], os.getgrouplist('mekoniq-operator', users['mekoniq-operator'].pw_gid))
        ctx = multiprocessing.get_context('fork')
        def become(name):
            user = users[name]
            os.initgroups(name, user.pw_gid); os.setgid(user.pw_gid); os.setuid(user.pw_uid)
        def client(name, path, channel, result):
            try:
                become(name)
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
                    s.settimeout(3); s.connect(path)
                    msg = envelope(cell_command('query_outcome', {'targetCommandId':'absent'}), actor='local_operator' if channel == 'local' else 'lab_simulation')
                    s.sendall(protocol.frame(msg))
                    with s.makefile('rb') as f:
                        result.send(next(m['status'] for m in protocol.read_frames(f, 65536) if m['kind'] == protocol.KIND_REPLY))
            except PermissionError: result.send('permission_denied')
            except Exception as e: result.send(repr(e))
            finally: result.close()
        with tempfile.TemporaryDirectory(prefix='arm-identity-') as d:
            os.chown(d, users['mekoniq-arm'].pw_uid, users['mekoniq-arm'].pw_gid); os.chmod(d, 0o711)
            for _ in range(2):
                ready, child_ready = ctx.Pipe(); stop = ctx.Event()
                def server():
                    try:
                        become('mekoniq-arm')
                        lc, _, _, _ = controller_api()
                        with patch.dict(sys.modules, linuxcnc=lc): ctl = LinuxcncPort(profile(), str(ROOT))
                        a = Arbiter(profile(), Journal(Path(d)/'journal'), ctl, now_ms=lambda:T0); a.start()
                        svc = BridgeService(profile(), a, ctl, socket_path=str(Path(d)/'lab.sock'), local_socket_path=str(Path(d)/'local.sock'), status_hz=0,
                                            socket_groups={'lab':'mekoniq-lab', 'local':'mekoniq-arm-operators'})
                        svc.start(); child_ready.send('ready'); stop.wait(20); svc.stop()
                    except Exception as e: child_ready.send(repr(e))
                    finally: child_ready.close()
                proc = ctx.Process(target=server); proc.start()
                try:
                    self.assertTrue(ready.poll(5)); self.assertEqual(ready.recv(), 'ready')
                    for name, channel, expected in [('mekoniq-lab','lab','accepted'), ('mekoniq-operator','local','accepted'),
                            ('mekoniq-lab','local','permission_denied'), ('mekoniq-operator','lab','permission_denied'),
                            ('nobody','lab','permission_denied'), ('nobody','local','permission_denied')]:
                        result, sender = ctx.Pipe(); c = ctx.Process(target=client, args=(name, str(Path(d)/f'{channel}.sock'), channel, sender)); c.start()
                        try:
                            self.assertTrue(result.poll(5)); self.assertEqual(result.recv(), expected, (name, channel))
                        finally:
                            c.join(5)
                            if c.is_alive(): c.kill(); c.join()
                            result.close(); sender.close()
                finally:
                    stop.set(); proc.join(5)
                    if proc.is_alive(): proc.kill(); proc.join()
                    ready.close(); child_ready.close()


if __name__ == '__main__': unittest.main()
