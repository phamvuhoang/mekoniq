"""Stage a private SIM configuration with resolvable package and QtVCP paths."""
import argparse
import configparser
import shutil
import shlex
from pathlib import Path


def prepare_profile(root, profile, destination, gui=False):
    root, profile, destination = Path(root).resolve(), Path(profile).resolve(), Path(destination)
    config = configparser.ConfigParser()
    config.optionxform = str
    ini_bytes = profile.read_bytes()
    config.read_string(ini_bytes.decode('utf-8'))
    if config.get('MEKONIQ', 'BACKEND', fallback='') != 'linuxcnc_sim':
        raise ValueError('SIM_PROFILE_REQUIRED')
    # This entry point launches only the reviewed virtual HAL closure. A backend
    # label alone cannot authorize a caller-supplied HALFILE, MDI or launch command.
    canonical = root / 'configs/sim/puma560'
    reviewed = {}
    for name in ('mekoniq.ini', 'machine.hal', 'puma560-dh.hal', 'profile.json', 'tool.tbl', 'cup-geometry.json'):
        data = ini_bytes if name == 'mekoniq.ini' else (profile.parent / name).read_bytes()
        if data != (canonical / name).read_bytes():
            raise ValueError('SIM_CONFIG_BYTES_MISMATCH:' + name)
        reviewed[name] = data
    if profile.name != 'mekoniq.ini':
        raise ValueError('SIM_CONFIG_BYTES_MISMATCH:ini')
    # Stage the checked snapshots only. In particular, caller sim.var/work offsets
    # and other siblings are not startup inputs. Never merge into an existing run.
    destination.mkdir(mode=0o700, parents=True)
    for name, data in reviewed.items():
        if name != 'mekoniq.ini':
            with (destination / name).open('xb') as stream:
                stream.write(data)
    config['DISPLAY']['PROGRAM_PREFIX'] = str(root / 'programs')
    config['MEKONIQ']['MODEL_MANIFEST'] = str(root / 'models/puma560-reference/manifest.json')
    if gui:
        shutil.copytree(root / 'hmi/mekoniq_arm', destination / 'qtvcp/screens/mekoniq_arm',
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    else:
        config['DISPLAY']['DISPLAY'] = f'python3 {shlex.quote(str(root / "scripts/smoke_driver.py"))}'
    staged = destination / profile.name
    with staged.open('x', encoding='utf-8') as stream:
        config.write(stream)
    return staged


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--profile', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--gui', action='store_true')
    args = parser.parse_args()
    print(prepare_profile(args.root, args.profile, args.out, args.gui))
