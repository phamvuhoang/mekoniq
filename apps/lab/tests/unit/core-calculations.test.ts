import { describe, expect, it } from 'vitest';
import { calculateBom } from '../../src/cost/bom';
import { priceForMargin, priceForMarkup } from '../../src/cost/pricing';
import { estimateEnergy, estimateDutyEnergy } from '../../src/estimates/energy';
import { estimateDrive, differentialDrive, stoppingDistance } from '../../src/estimates/drive';
import { estimateStability } from '../../src/estimates/stability';

describe('exact costs', () => {
  it('keeps missing prices partial instead of treating them as zero', () => {
    expect(calculateBom([{id:'lidar',quantity:1,priceMinor:null}], 'VND')).toEqual({totalMinor:null,missingIds:['lidar']});
  });
  it('sums integer money beyond floating point precision', () => {
    expect(calculateBom([{id:'base',quantity:3,priceMinor:'9007199254740993'}], 'VND').totalMinor).toBe('27021597764222979');
  });
  it('rejects mixed currencies without an explicit FX conversion', () => {
    expect(() => calculateBom([{id:'base',quantity:1,priceMinor:'10',currency:'USD'}], 'VND')).toThrow(/CURRENCY/);
    expect(() => calculateBom([{id:'base',quantity:-1,priceMinor:'10'}], 'VND')).toThrow(/QUANTITY/);
  });
  it('rounds gross margin upward and keeps markup separate', () => {
    expect(priceForMargin('100000',2500)).toBe('133334');
    expect(priceForMarkup('100000',2500)).toBe('125000');
    expect(() => priceForMargin('100000',10000)).toThrow();
  });
});

describe('bounded engineering estimates', () => {
  it('calculates watt-hours and runtime without applying efficiency twice', () => {
    const result = estimateEnergy({volts:24,ampHours:20,usable:0.8,derating:0.9,watts:120});
    expect(result?.usableWh).toBeCloseTo(345.6,6);
    expect(result?.runtimeHours).toBeCloseTo(2.88,6);
    expect(estimateEnergy({volts:24,ampHours:20,usable:0.8,derating:0.9,watts:0})).toBeNull();
    expect(estimateEnergy({volts:24,ampHours:20,usable:1.2,derating:0.9,watts:120})).toBeNull();
    expect(estimateEnergy({volts:24,ampHours:20,usable:0.8,derating:0.9})).toBeNull();
  });
  it('requires duty fractions to sum to one', () => {
    const battery={volts:24,ampHours:20,usable:0.8,derating:0.9};
    expect(estimateDutyEnergy({...battery,phases:[{duty:0.5,watts:200},{duty:0.5,watts:40}]}).estimate?.runtimeHours).toBeCloseTo(2.88);
    expect(estimateDutyEnergy({...battery,phases:[{duty:0.5,watts:200}]}).missingInputs).toContain('duty_sum');
  });
  it('distinguishes continuous motor torque from short peak torque', () => {
    const input={massKg:50,accelerationMps2:0.5,rollingResistance:0.02,slopeRadians:0,wheelRadiusM:0.1,drivenWheels:2,gearRatio:10,gearEfficiency:0.8};
    const result=estimateDrive({...input,continuousMotorTorqueNm:0.1,peakMotorTorqueNm:100});
    expect(result?.wheelTorqueNm).toBeCloseTo(1.7405);
    expect(result?.motorTorqueNm).toBeCloseTo(0.2175625);
    expect(result?.continuousTorqueStatus).toBe('insufficient');
    expect(estimateDrive(input)?.continuousTorqueStatus).toBe('missing');
  });
  it('retains a nonzero swept envelope when turning in place', () => {
    const result=differentialDrive({leftMps:-0.5,rightMps:0.5,trackM:0.5,widthM:0.6,lengthM:0.8});
    expect(result?.linearMps).toBe(0);
    expect(result?.angularRadPerSec).toBe(2);
    expect(result?.turnRadiusM).toBe(0);
    expect(result?.sweptRadiusM).toBeCloseTo(0.5);
    expect(stoppingDistance({speedMps:1,reactionSeconds:0.2,decelerationMps2:0.5})).toBeCloseTo(1.2);
    expect(stoppingDistance({speedMps:1,reactionSeconds:0.2,decelerationMps2:0})).toBeNull();
  });
  it('checks support polygon geometry and a configurable margin', () => {
    const support=[{x:-1,y:-1},{x:1,y:-1},{x:1,y:1},{x:-1,y:1}];
    const result=estimateStability({masses:[{massKg:10,x:0,y:0,z:1},{massKg:20,x:2,y:0,z:2}],supportPolygon:support,marginM:0.1});
    expect(result?.centerOfMass.x).toBeCloseTo(4/3);
    expect(result?.insideSupport).toBe(false);
    expect(result?.status).toBe('outside_support');
    expect(estimateStability({masses:[{massKg:10,x:0.95,y:0,z:1}],supportPolygon:support,marginM:0.1})?.status).toBe('margin_insufficient');
    expect(estimateStability({masses:[{massKg:10,x:0,y:0,z:1}],supportPolygon:[{x:0,y:0},{x:1,y:0},{x:2,y:0}],marginM:0.1})).toBeNull();
  });
});
