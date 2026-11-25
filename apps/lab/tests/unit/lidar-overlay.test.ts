// LiDAR and footprint layers of an IR-SIM run: a scan is drawn from the sensor pose of its own sample tick, a missed beam is never a hit, unknown beams are
// counted (not drawn), the compiled footprint sits on the drive frame (not on the base origin), and a frame without scans says why instead of drawing nothing.
import {expect,test} from 'vitest';
import {projectScan,sensorPoseAt,scanLayer,footprintInMap,planarPose} from '../../src/twin/lidar';
import type {LidarScanV1,NavigationSceneV1} from '../../src/shared/navigation2d';
import scene from '../../fixtures/engineering/serve-demo-v1/navigation-scene.json' with {type:'json'};

const scan=(over:Partial<LidarScanV1>={}):LidarScanV1=>({sensorId:'lidar-2d',frameId:'lidar/head',tick:40,simTimeNs:'800000000',angleMinRad:0,angleIncrementRad:Math.PI/2,rangeMinM:0.05,rangeMaxM:10,rangesM:[2,null,null],states:['hit','no_return','invalid'],...over});
const identity={xyzM:[0,0,0.12] as [number,number,number],quaternionXyzw:[0,0,0,1] as [number,number,number,number]};

test('fixture hit, miss, invalid: exactly one hit point; the miss is never a hit, the invalid beam is unknown',()=>{
 const projected=projectScan(scan(),identity);
 expect(projected.hitPointsM).toHaveLength(1);
 expect(projected.hitPointsM[0]![0]).toBeCloseTo(2,12);expect(projected.hitPointsM[0]![1]).toBeCloseTo(0,12);expect(projected.hitPointsM[0]![2]).toBeCloseTo(0.12,12);
 expect(projected.unknownBeams).toBe(1);
});
test('a "hit" without a finite in-range distance and a below_min beam are unknown, never points',()=>{
 const p=projectScan(scan({rangesM:[Number.NaN,20,null,0.01],states:['hit','hit','below_min','below_min']}),identity);
 expect(p.hitPointsM).toEqual([]);expect(p.unknownBeams).toBe(4);
 // mismatched arrays are refused as a whole (unknown), not truncated
 expect(projectScan(scan({rangesM:[2],states:['hit','hit']}),identity)).toEqual({hitPointsM:[],unknownBeams:2});
});
test('points use the sensor pose of the sample tick: yaw, mount offset and height compose; a later pose would move them',()=>{
 const model=(scene as unknown as NavigationSceneV1).robots[0]!.model,lidar=model.sensors[0]!;
 const at40=sensorPoseAt([1,2,Math.PI/2],lidar),later=sensorPoseAt([3,2,Math.PI/2],lidar);
 expect(at40.xyzM[0]).toBeCloseTo(1,12);expect(at40.xyzM[1]).toBeCloseTo(2+lidar.poseInDrive[0]!,12);expect(at40.xyzM[2]).toBeCloseTo(lidar.heightM,12);
 const hit=projectScan(scan(),at40).hitPointsM[0]!;
 expect(hit[0]).toBeCloseTo(1,9);expect(hit[1]).toBeCloseTo(2+lidar.poseInDrive[0]!+2,9);
 expect(projectScan(scan(),later).hitPointsM[0]![0]).toBeCloseTo(3,9);
});
test('the scan layer needs scans with their own-tick poses; otherwise it is unavailable with a reason and the 2D plan stays',()=>{
 expect(scanLayer(undefined)).toEqual({available:false,reason:'SCAN_STREAM_NOT_EXPOSED',scans:[]});
 const s=scan();
 expect(scanLayer({scans:[{robotId:'amr-1',scan:s,sensorPose:null}]})).toMatchObject({available:false,reason:'SCAN_POSE_UNKNOWN'});
 const ok=scanLayer({scans:[{robotId:'amr-1',scan:s,sensorPose:identity}]});
 expect(ok.available).toBe(true);expect(ok.scans[0]!.hitPointsM).toHaveLength(1);expect(ok.scans[0]!.tick).toBe(40);
});
test('root-drive projection: the compiled footprint (drive frame) lands on T_map_base x T_base_drive, not on the base origin',()=>{
 const model=structuredClone((scene as unknown as NavigationSceneV1).robots[0]!.model);
 model.driveFrameInBase={xyzM:[0.1,0,0],quaternionXyzw:[0,0,Math.sin(Math.PI/4),Math.cos(Math.PI/4)]};// drive 0.1 m ahead, turned +90 deg
 expect(planarPose(model.driveFrameInBase)).toEqual([0.1,0,expect.closeTo(Math.PI/2,12)]);
 const base={x:5,y:5,yawRad:0},poly=footprintInMap(model,base),v0=model.footprint.verticesM[0]!;
 // vertex v in drive = (vx,vy) -> base: (0.1 - vy, vx) -> map at (5,5,0)
 expect(poly[0]![0]).toBeCloseTo(5+0.1-v0[1]!,12);expect(poly[0]![1]).toBeCloseTo(5+v0[0]!,12);
 expect(footprintInMap(model,base,0.02)).toHaveLength(model.footprint.verticesM.length);// safety envelope: same vertices, offset outward
});
