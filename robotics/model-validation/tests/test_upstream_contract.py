"""Records observed linkforge-core 1.6.0 behaviour (A00). These pass when upstream *still misbehaves as probed*;
A02's wrapper must block each hazard, so a green run here is not an integrated validation pass."""
import linkforge.core as c
from linkforge.core.parsers import URDFParser


def urdf(child='body', ixx='0.1', joint=True):
    inertial = lambda x: (f'<inertial><mass value="1"/><inertia ixx="{x}" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.1"/></inertial>')
    j = (f'<joint name="j1" type="fixed"><parent link="base"/><child link="{child}"/>'
         '<origin xyz="0 0 0.1" rpy="0 0 0"/></joint>') if joint else ''
    return f'<robot name="t"><link name="base">{inertial("0.1")}</link><link name="{child}">{inertial(ixx)}</link>{j}</robot>'


def parse(xml):
    robot = URDFParser().parse_string(xml)
    return robot, c.RobotValidator().validate(robot)


def test_valid_model_parses_whole():
    robot, result = parse(urdf())
    assert (len(robot.links), len(robot.joints), result.is_valid) == (2, 1, True)


def test_missing_joint_is_reported_as_multiple_roots():
    _, result = parse(urdf(joint=False))
    assert not result.is_valid
    assert 'multiple_roots' in {e.code.value for e in result.errors}


def test_negative_inertia_is_silently_repaired_and_reported_valid():
    robot, result = parse(urdf(ixx='-1'))
    assert result.is_valid  # hazard: validator passes the repaired model
    assert robot.links[1].inertial.inertia.ixx == 1e-9  # wrapper must compare against the raw value (-1)


def test_slash_id_drops_link_and_joint_yet_stays_valid():
    robot, result = parse(urdf(child='chassis/body'))
    assert result.is_valid
    assert ([l.name for l in robot.links], len(robot.joints)) == (['base'], 0)  # wrapper must map names + set parity
