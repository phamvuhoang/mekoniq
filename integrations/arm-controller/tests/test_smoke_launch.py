"""Portable boundary checks; these do not execute LinuxCNC or qualify its GUI."""
import sys
import tempfile
import unittest
import subprocess
import json
import os
import platform
from pathlib import Path
from types import SimpleNamespace
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

class SmokeLaunchTest(unittest.TestCase):
    def test_real_stat_joint_dictionary_fault_is_observed(self):
        from smoke_driver import LinuxcncController
        ctl = LinuxcncController.__new__(LinuxcncController)
        ctl.lc = SimpleNamespace(STATE_ESTOP=1, STATE_ON=2, INTERP_READING=3, INTERP_WAITING=4)
        ctl.s = SimpleNamespace(poll=lambda: None, joint=({'fault': 1},), task_state=1, homed=[1]*6, file='', interp_state=0, paused=False)
        self.assertTrue(ctl.state()['fault'])
        ctl.s.joint = ({'fault': 0},)
        self.assertFalse(ctl.state()['fault'])

    def test_staged_profile_keeps_program_model_and_custom_hmi_resolvable(self):
        from prepare_smoke import prepare_profile
        import configparser
        with tempfile.TemporaryDirectory() as tmp:
            ini = prepare_profile(ROOT, ROOT/'configs/sim/puma560/mekoniq.ini', Path(tmp)/'config', gui=True)
            cfg=configparser.ConfigParser();cfg.read(ini)
            self.assertTrue((Path(cfg['DISPLAY']['PROGRAM_PREFIX'])/'demo-six-axis.ngc').is_file())
            self.assertTrue(Path(cfg['MEKONIQ']['MODEL_MANIFEST']).is_file())
            for name in ('mekoniq_arm.ui','mekoniq_arm_handler.py','mekoniq_arm.qss'):
                self.assertEqual((ini.parent/'qtvcp/screens/mekoniq_arm'/name).read_bytes(),(ROOT/'hmi/mekoniq_arm'/name).read_bytes())
            self.assertEqual(cfg['DISPLAY']['DISPLAY'],'qtvcp -f mekoniq_arm')

    def test_old_smoke_pass_cannot_be_reused_for_a_new_attempt(self):
        with tempfile.TemporaryDirectory() as tmp:
            old=Path(tmp)/'smoke-driver.json';old.write_text(json.dumps({'status':'pass'}))
            result=subprocess.run(['bash',str(ROOT/'scripts/smoke-sim.sh'),'--profile',str(ROOT/'configs/sim/puma560/mekoniq.ini'),'--evidence-dir',tmp],cwd=ROOT,text=True,capture_output=True)
            self.assertEqual(result.returncode,2)
            self.assertIn('EVIDENCE_OUTPUT_EXISTS',result.stderr)
            self.assertEqual(json.loads(old.read_text()),{'status':'pass'})

    def run_wrapper(self, root, body, *, gui=False, profile=None):
        binary=root/'bin';binary.mkdir()
        for name,script in [('uname','echo Linux'),('linuxcnc',body)]:
            path=binary/name;path.write_text('#!/bin/sh\n'+script+'\n');path.chmod(0o755)
        (root/'linuxcnc.py').write_text('version = "protocol_double"\n')
        lock=root/'lock.json';lock.write_text(json.dumps({'host':{'architecture':{'aarch64':'arm64','x86_64':'amd64'}.get(platform.machine(),platform.machine())}}))
        evidence=root/'evidence'
        result=subprocess.run(['bash',str(ROOT/'scripts/smoke-sim.sh'),'--profile',str(profile or ROOT/'configs/sim/puma560/mekoniq.ini'),'--dependencies-lock',str(lock),'--evidence-dir',str(evidence),*(['--gui'] if gui else [])],cwd=ROOT,text=True,capture_output=True,env={**os.environ,'PATH':str(binary)+os.pathsep+os.environ['PATH'],'PYTHONPATH':str(root)})
        return result,json.loads((evidence/'smoke-sim.json').read_text())

    def test_gui_process_exit_alone_does_not_pass_operator_acceptance(self):
        with tempfile.TemporaryDirectory() as tmp:
            result,record=self.run_wrapper(Path(tmp),'exit 0',gui=True)
            self.assertEqual(result.returncode,2,result.stderr)
            self.assertEqual(record['result'],'not_run')
            self.assertEqual(record['reasons'],['GUI_CHECKLIST_NOT_RECORDED'])

    def test_driver_pass_cannot_mask_a_nonzero_controller_exit(self):
        with tempfile.TemporaryDirectory() as tmp:
            result,record=self.run_wrapper(Path(tmp),"echo '{\"status\":\"pass\"}' > \"$MEKONIQ_SMOKE_EVIDENCE/smoke-driver.json\"\nexit 9")
            self.assertEqual(result.returncode,1,result.stderr)
            self.assertEqual(record['result'],'fail')
            self.assertEqual(record['linuxcncExit'],9)

    def test_non_sim_profile_is_recorded_before_any_controller_launch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);profile=root/'hardware.ini'
            profile.write_text('[MEKONIQ]\nBACKEND = hardware\n')
            result,record=self.run_wrapper(root,'touch "$MEKONIQ_SMOKE_EVIDENCE/launched"',profile=profile)
            self.assertEqual(result.returncode,2,result.stderr)
            self.assertEqual(record['result'],'not_run')
            self.assertEqual(record['reasons'],['PROFILE_STAGING_FAILED'])
            self.assertFalse((root/'evidence/launched').exists())
