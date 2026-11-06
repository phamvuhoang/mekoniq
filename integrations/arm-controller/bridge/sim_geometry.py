"""Pinned reference DH orientation for modeled cup geometry (metres/radians).
Actual TCP translation comes from the controller; orientation comes from actual
joints and the reference model. No commanded pose substitutes for either input.
"""
import json
import math
from pathlib import Path

DH = json.loads((Path(__file__).resolve().parents[1]/"models/puma560-reference/modified-dh.json").read_text())


def cup_center(actual_joints_rad, tcp_m, world_from_arm_base_m, offset_tcp_m):
    r = [[1.,0.,0.],[0.,1.,0.],[0.,0.,1.]]
    def mul(a,b):return [[sum(a[i][k]*b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
    for joint, theta in zip(DH["joints"], actual_joints_rad):
        a=joint["alpha"];c,s=math.cos(a),math.sin(a)
        r=mul(r,[[1,0,0],[0,c,-s],[0,s,c]])
        t=theta+joint["thetaOffset"]*math.pi/180;c,s=math.cos(t),math.sin(t)
        r=mul(r,[[c,-s,0],[s,c,0],[0,0,1]])
    return [tcp_m[i]+world_from_arm_base_m[i]+sum(r[i][k]*offset_tcp_m[k] for k in range(3)) for i in range(3)]
