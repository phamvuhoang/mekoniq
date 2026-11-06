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
    config.read(profile)
    if config.get('MEKONIQ', 'BACKEND', fallback='') != 'linuxcnc_sim':
        raise ValueError('SIM_PROFILE_REQUIRED')
    shutil.copytree(profile.parent, destination, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    config['DISPLAY']['PROGRAM_PREFIX'] = str(root / 'programs')
    config['MEKONIQ']['MODEL_MANIFEST'] = str(root / 'models/puma560-reference/manifest.json')
    if gui:
        shutil.copytree(root / 'hmi/mekoniq_arm', destination / 'qtvcp/screens/mekoniq_arm',
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    else:
        config['DISPLAY']['DISPLAY'] = f'python3 {shlex.quote(str(root / "scripts/smoke_driver.py"))}'
    staged = destination / profile.name
    with staged.open('w') as stream:
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
