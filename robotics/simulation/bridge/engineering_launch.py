"""Server-owned engineering launch policy; no caller-provided nodes, topics or arguments."""
import hashlib
import json
import tempfile
from pathlib import Path
from compiler.manifest import canonical_hash


def plan_engineering_launch(bundle_dir):
    root=Path(bundle_dir).resolve()
    manifest=json.loads((root/'compiler-manifest.json').read_text())
    if manifest.get('compiler') != {'id':'engineering-gazebo-canonical','version':'1'}:
        raise ValueError('ENGINEERING_BUNDLE_REQUIRED')
    if canonical_hash({k:v for k,v in manifest.items() if k!='manifestHash'}) != manifest.get('manifestHash'):
        raise ValueError('BUNDLE_MANIFEST_MISMATCH')
    for entry in manifest['outputs']:
        path=root/entry['path']
        if path.is_symlink() or not path.resolve().is_relative_to(root) or hashlib.sha256(path.read_bytes()).hexdigest()!=entry['sha256']:
            raise ValueError('BUNDLE_DIGEST_MISMATCH:'+entry['path'])
    from compiler.engineering_native import compile_native, CANONICAL, NAMES
    with tempfile.TemporaryDirectory(prefix='engineering-reproduce-') as directory:
        compile_native(*[json.loads((CANONICAL/name).read_text()) for name in NAMES],directory)
        expected=json.loads((Path(directory)/'compiler-manifest.json').read_text())
        if manifest != expected:raise ValueError('NATIVE_MAPPING_MISMATCH')
    robots=manifest['robots']
    if len(robots)!=1 or robots[0]['namespace']!='amr_1' or robots[0]['entityId']!='amr-1':
        raise ValueError('ENGINEERING_ROBOT_MISMATCH')
    topics=['/clock','/amr_1/tf','/amr_1/tf_static','/amr_1/odom','/amr_1/joint_states','/amr_1/scan','/amr_1/cmd_vel','/amr_1/amcl_pose','/model/amr_1/pose','/model/amr_1/contacts','/amr_1/navigate_to_pose/_action/status']
    return {'world':str(root/'world.sdf'),'map':str(root/'map.yaml'),'mapId':manifest['map']['mapId'],'mapRevision':manifest['map']['mapRevision'],'robots':robots,'actors':[],'blockers':[],'cups':[],'topics':topics,'actions':['/amr_1/navigate_to_pose']}
