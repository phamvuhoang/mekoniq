/* Generated from the engineering schemas. Run pnpm contracts:generate; do not edit. */
import type { LabProjectV2, AssetRevision, CoffeeRecipe } from './lab-v2';
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "Digest".
 */
export type Digest = string;
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "EngineeringId".
 */
export type EngineeringId = string;
/**
 * @minItems 3
 * @maxItems 3
 *
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "Vec3".
 */
export type Vec3 = [number, number, number];
/**
 * @minItems 4
 * @maxItems 4
 *
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "Quaternion".
 */
export type Quaternion = [number, number, number, number];
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "Geometry".
 */
export type Geometry =
  | {
      kind: 'box';
      sizeM: Vec3;
    }
  | {
      kind: 'cylinder';
      radiusM: number;
      lengthM: number;
    }
  | {
      kind: 'sphere';
      radiusM: number;
    }
  | {
      kind: 'mesh';
      blobSha256: Digest;
      scale: Vec3;
    };
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "Joint".
 */
export type Joint =
  | {
      id: EngineeringId;
      parent: EngineeringId;
      child: EngineeringId;
      origin: Pose;
      axis: Vec3;
      kind: 'fixed';
    }
  | {
      id: EngineeringId;
      parent: EngineeringId;
      child: EngineeringId;
      origin: Pose;
      axis: Vec3;
      kind: 'continuous';
      limits: JointLimitsContinuous;
    }
  | {
      id: EngineeringId;
      parent: EngineeringId;
      child: EngineeringId;
      origin: Pose;
      axis: Vec3;
      kind: 'revolute' | 'prismatic';
      limits: JointLimitsBounded;
    };
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "EngineeringProfile".
 */
export type EngineeringProfile = 'engineering-rigid-v1' | 'engineering-contact-v1' | 'engineering-irsim-2d-v1';
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "BundleReceipt".
 */
export type BundleReceipt =
  | {
      projectDigest: Digest;
      profile: EngineeringProfile;
      /**
       * @maxItems 500
       */
      problems: Problem[];
      state: 'blocked';
      bundleDigest: null;
      assemblyDigest: null;
      sceneDigest: null;
      runnable: false;
    }
  | {
      projectDigest: Digest;
      profile: EngineeringProfile;
      /**
       * @maxItems 500
       */
      problems: Problem[];
      state: 'compiled';
      bundleDigest: Digest;
      assemblyDigest: Digest;
      sceneDigest: Digest;
      runnable: boolean;
    };

export interface EngineeringContracts {}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "Pose".
 */
export interface Pose {
  xyzM: Vec3;
  quaternionXyzw: Quaternion;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "SourceRef".
 */
export interface SourceRef {
  kind: 'manufacturer' | 'measured' | 'derived' | 'assumed';
  documentId: string;
  revision: string;
  locator: string;
  contentSha256: Digest;
  uncertaintyAbs?: number;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "Scalar".
 */
export interface Scalar {
  value: number;
  unit: string;
  source: SourceRef;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "Shape".
 */
export interface Shape {
  pose: Pose;
  geometry: Geometry;
  source: SourceRef;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "Link".
 */
export interface Link {
  id: EngineeringId;
  /**
   * @maxItems 200
   */
  visual: Shape[];
  /**
   * @maxItems 200
   */
  collision: Shape[];
  massKg: Scalar;
  comM: Vec3;
  inertiaKgM2: [number, number, number, number, number, number] | null;
  inertialSource: SourceRef;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "JointLimitsContinuous".
 */
export interface JointLimitsContinuous {
  velocity: Scalar;
  effort: Scalar;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "JointLimitsBounded".
 */
export interface JointLimitsBounded {
  lower: Scalar;
  upper: Scalar;
  velocity: Scalar;
  effort: Scalar;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "Port".
 */
export interface Port {
  id: EngineeringId;
  kind: 'mount' | 'power' | 'data';
  frame: Pose;
  mate: string;
  direction: 'in' | 'out' | 'bidirectional';
  /**
   * @minItems 2
   * @maxItems 2
   */
  voltageRangeV?: [number, number];
  continuousCurrentA?: Scalar;
  protocol?: string;
  pinoutRevision?: string;
  link?: EngineeringId;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "ModelRef".
 */
export interface ModelRef {
  kind: 'actuator' | 'sensor' | 'process';
  id: EngineeringId;
  digest: Digest;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "ComponentDocument".
 */
export interface ComponentDocument {
  id: EngineeringId;
  url: string | null;
  digest: Digest;
  license: string;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "ActuatorModel".
 */
export interface ActuatorModel {
  schemaVersion: 1;
  kind: 'actuator';
  id: EngineeringId;
  /**
   * @minItems 1
   * @maxItems 50
   */
  jointIds: [EngineeringId, ...EngineeringId[]];
  transmission: {
    ratio: Scalar;
    efficiency: Scalar;
  };
  commandInterface: 'velocity' | 'position' | 'effort';
  /**
   * @minItems 2
   * @maxItems 200
   */
  torqueSpeedTable: [
    {
      speed: Scalar;
      torque: Scalar;
    },
    {
      speed: Scalar;
      torque: Scalar;
    },
    ...{
      speed: Scalar;
      torque: Scalar;
    }[]
  ];
  currentLimit: Scalar;
  voltageLimit: Scalar;
  damping: Scalar;
  friction: Scalar;
  drive?: {
    wheelRadiusM: Scalar;
    wheelSeparationM: Scalar;
    leftMountPort: EngineeringId;
    rightMountPort: EngineeringId;
  };
  torqueConstantNmPerA?: Scalar;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "SensorModel".
 */
export interface SensorModel {
  schemaVersion: 1;
  kind: 'sensor';
  id: EngineeringId;
  frame: EngineeringId;
  rateHz: Scalar;
  range: {
    min: Scalar;
    max: Scalar;
  };
  fieldOfView: Scalar;
  noise: {
    distribution: 'none' | 'gaussian' | 'uniform';
    stddev: Scalar;
    seed: number;
  };
  latency: Scalar;
  dropoutProbability: Scalar;
  sensorType?: 'lidar_2d';
  lidar2d?: {
    beamCount: number;
    beamCountSource: SourceRef;
  };
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "ProcessModel".
 */
export interface ProcessModel {
  schemaVersion: 1;
  kind: 'process';
  id: EngineeringId;
  processKind: 'coffee';
  /**
   * @minItems 1
   * @maxItems 50
   */
  reservoirs: [
    {
      resourceId: EngineeringId;
      capacityMl: Scalar;
      initialMl: Scalar;
    },
    ...{
      resourceId: EngineeringId;
      capacityMl: Scalar;
      initialMl: Scalar;
    }[]
  ];
  flowMlPerSec: Scalar;
  startupDelaySec: Scalar;
  maxDurationSec: Scalar;
  densityKgPerM3: Scalar;
  temperature?: {
    initialC: Scalar;
    targetC: Scalar;
    thermalTimeConstantSec?: Scalar;
  };
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "PayloadRating".
 */
export interface PayloadRating {
  portId: EngineeringId;
  maxMassKg: Scalar;
  maxMomentNm: Scalar;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "BatteryRating".
 */
export interface BatteryRating {
  portId: EngineeringId;
  capacityAh: Scalar;
  usableFraction: Scalar;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "SupportPoint".
 */
export interface SupportPoint {
  linkId: EngineeringId;
  pointM: Vec3;
  source: SourceRef;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "ComponentRevision".
 */
export interface ComponentRevision {
  schemaVersion: 1;
  id: EngineeringId;
  revision: string;
  identity: {
    manufacturer: string;
    family: string;
    sku: string | null;
    status: 'candidate' | 'model_ready' | 'calibrated';
  };
  /**
   * @maxItems 1000
   */
  links: Link[];
  /**
   * @maxItems 1000
   */
  joints: Joint[];
  /**
   * @maxItems 1000
   */
  ports: Port[];
  /**
   * @maxItems 50
   */
  models: ModelRef[];
  /**
   * @maxItems 200
   */
  documents: ComponentDocument[];
  /**
   * @maxItems 20
   */
  payloadRatings?:
    | []
    | [PayloadRating]
    | [PayloadRating, PayloadRating]
    | [PayloadRating, PayloadRating, PayloadRating]
    | [PayloadRating, PayloadRating, PayloadRating, PayloadRating]
    | [PayloadRating, PayloadRating, PayloadRating, PayloadRating, PayloadRating]
    | [PayloadRating, PayloadRating, PayloadRating, PayloadRating, PayloadRating, PayloadRating]
    | [PayloadRating, PayloadRating, PayloadRating, PayloadRating, PayloadRating, PayloadRating, PayloadRating]
    | [
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating
      ]
    | [
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating
      ]
    | [
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating
      ]
    | [
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating
      ]
    | [
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating
      ]
    | [
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating
      ]
    | [
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating
      ]
    | [
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating
      ]
    | [
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating
      ]
    | [
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating
      ]
    | [
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating
      ]
    | [
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating
      ]
    | [
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating,
        PayloadRating
      ];
  battery?: BatteryRating;
  /**
   * @maxItems 50
   */
  supportPoints?: SupportPoint[];
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "Instance".
 */
export interface Instance {
  id: string;
  componentDigest: Digest;
  pose: Pose;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "Connection".
 */
export interface Connection {
  from: string;
  to: string;
  kind: 'mount' | 'power' | 'data';
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "Assembly".
 */
export interface Assembly {
  /**
   * @maxItems 200
   */
  instances: Instance[];
  /**
   * @maxItems 1000
   */
  connections: Connection[];
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "EntityBinding".
 */
export interface EntityBinding {
  entityId: EngineeringId;
  /**
   * @maxItems 200
   */
  instanceIds: EngineeringId[];
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "EngineeringProject".
 */
export interface EngineeringProject {
  documentType: 'engineering-project';
  schemaVersion: 1;
  id: EngineeringId;
  revision: number;
  runtimeProject: LabProjectV2;
  assembly: Assembly;
  /**
   * @maxItems 200
   */
  entityBindings: EntityBinding[];
  requestedProfile: EngineeringProfile;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "Problem".
 */
export interface Problem {
  code: string;
  path: string;
  blocking: boolean;
  detail: string;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "ModelDocument".
 */
export interface ModelDocument {
  schemaVersion: 1;
  kind: 'actuator' | 'sensor' | 'process';
  id: EngineeringId;
  digest: Digest;
  parameters: {
    [k: string]: any;
  };
  [k: string]: any;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "ResolvedPort".
 */
export interface ResolvedPort {
  id: EngineeringId;
  instanceId: EngineeringId;
  port: Port;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "Placement".
 */
export interface Placement {
  instanceId: EngineeringId;
  world: Pose;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "DriveBinding".
 */
export interface DriveBinding {
  entityId: EngineeringId;
  instanceId: EngineeringId;
  model: ModelDocument;
  leftJointId: EngineeringId;
  rightJointId: EngineeringId;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "ResolvedModels".
 */
export interface ResolvedModels {
  drive: DriveBinding | null;
  arm: {
    [k: string]: ModelDocument;
  };
  sensor: {
    [k: string]: ModelDocument;
  };
  process: {
    [k: string]: ModelDocument;
  };
  driveBindingsVersion?: 1;
  drivesByEntity?: {
    [k: string]: DriveBinding;
  };
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "BomPrice".
 */
export interface BomPrice {
  amount: number;
  currency: string;
  quotedOn: string;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "BomLine".
 */
export interface BomLine {
  lineId: EngineeringId;
  componentId: EngineeringId;
  componentRevision: string;
  componentDigest: Digest;
  sku: string | null;
  candidate: boolean;
  qty: number;
  massKg: number | null;
  voltageRangeV: [number, number] | null;
  price: BomPrice | null;
  /**
   * @maxItems 50
   */
  sources: SourceRef[];
  /**
   * @maxItems 200
   */
  instanceIds: EngineeringId[];
  /**
   * @maxItems 50
   */
  requiredAccessories: string[];
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "Bom".
 */
export interface Bom {
  /**
   * @maxItems 1000
   */
  lines: BomLine[];
  /**
   * @maxItems 1000
   */
  missingPriceLineIds: EngineeringId[];
  total: BomPrice | null;
  incompleteTotal: boolean;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "ResolvedAssembly".
 */
export interface ResolvedAssembly {
  assemblyDigest: Digest;
  /**
   * @maxItems 1000
   */
  links: Link[];
  /**
   * @maxItems 1000
   */
  joints: Joint[];
  /**
   * @maxItems 200
   */
  entityBindings: EntityBinding[];
  /**
   * @maxItems 1000
   */
  ports: ResolvedPort[];
  models: ResolvedModels;
  /**
   * @maxItems 200
   */
  placements: Placement[];
  /**
   * @maxItems 1000
   */
  assumptions: SourceRef[];
  bom: Bom;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "SceneFrame".
 */
export interface SceneFrame {
  id: EngineeringId;
  parent: EngineeringId | null;
  pose: Pose;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "GeometryRef".
 */
export interface GeometryRef {
  linkId: EngineeringId;
  kind: 'visual' | 'collision';
  index: number;
  blobSha256: Digest | null;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "FixedJointMapping".
 */
export interface FixedJointMapping {
  jointId: EngineeringId;
  linkId: EngineeringId;
  mergedInto: EngineeringId;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "WheelBinding".
 */
export interface WheelBinding {
  id: string;
  entityId: EngineeringId;
  side: 'left' | 'right';
  radiusM: number;
  jointId: EngineeringId;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "CompiledScene".
 */
export interface CompiledScene {
  schemaVersion: 1;
  /**
   * @maxItems 1000
   */
  links: Link[];
  /**
   * @maxItems 1000
   */
  joints: Joint[];
  /**
   * @maxItems 1000
   */
  frames: SceneFrame[];
  /**
   * @maxItems 5000
   */
  geometryRefs: GeometryRef[];
  /**
   * @maxItems 1000
   */
  fixedJointMapping: FixedJointMapping[];
  /**
   * @maxItems 50
   */
  wheelBindings: WheelBinding[];
  world: {
    id: EngineeringId;
    revision: number;
    widthM: number;
    heightM: number;
    hash: Digest;
    /**
     * @maxItems 16
     */
    walls:
      | []
      | [
          {
            x: number;
            y: number;
            width: number;
            height: number;
          }
        ]
      | [
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          }
        ]
      | [
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          }
        ]
      | [
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          }
        ]
      | [
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          }
        ]
      | [
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          }
        ]
      | [
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          }
        ]
      | [
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          }
        ]
      | [
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          }
        ]
      | [
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          }
        ]
      | [
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          }
        ]
      | [
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          }
        ]
      | [
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          }
        ]
      | [
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          }
        ]
      | [
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          }
        ]
      | [
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          {
            x: number;
            y: number;
            width: number;
            height: number;
          }
        ];
    /**
     * @maxItems 200
     */
    fixtures: {
      obstacleId: EngineeringId;
      x: number;
      y: number;
      width: number;
      height: number;
      heightM: number;
    }[];
  };
  /**
   * @maxItems 200
   */
  entities: {
    entityId: EngineeringId;
    kind: 'amr' | 'arm' | 'coffee_machine' | 'cup_station';
    rootLinkId: EngineeringId;
    /**
     * @maxItems 200
     */
    instanceIds: EngineeringId[];
  }[];
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "EngineeringRef".
 */
export interface EngineeringRef {
  bundleDigest: Digest;
  projectDigest: Digest;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "EngineeringCompileInput".
 */
export interface EngineeringCompileInput {
  schemaVersion: 1;
  project: EngineeringProject;
  projectDigest: Digest;
  resolved: ResolvedAssembly;
  runtimeProjection: {
    project: LabProjectV2;
    /**
     * @maxItems 200
     */
    assets: AssetRevision[];
  };
  /**
   * @maxItems 50
   */
  recipes: CoffeeRecipe[];
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "EngineeringArchive".
 */
export interface EngineeringArchive {
  documentType: 'engineering-project-archive';
  schemaVersion: 1;
  project: EngineeringProject;
  /**
   * @maxItems 1000
   */
  components: ComponentRevision[];
  /**
   * @maxItems 200
   */
  assets: AssetRevision[];
  /**
   * @maxItems 50
   */
  recipes: CoffeeRecipe[];
  migration?: {
    report: {
      [k: string]: any;
    };
    original: {
      [k: string]: any;
    };
  };
  /**
   * @maxItems 5000
   */
  blobs: {
    digest: Digest;
    file: string;
    mediaType: string;
    license: string;
    sizeBytes: number;
  }[];
  /**
   * @maxItems 5000
   */
  missingDigests: Digest[];
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "EngineeringCandidate".
 */
export interface EngineeringCandidate {
  documentType: 'engineering-candidate';
  schemaVersion: 1;
  status: 'draft';
  hardwareValidated: false;
  controlAuthority: false;
  project: EngineeringProject;
  projectDigest: Digest;
  assemblyDigest: Digest | null;
  bundleDigest: Digest | null;
  /**
   * @maxItems 500
   */
  problems: Problem[];
  /**
   * @maxItems 500
   */
  evidenceRefs: {
    runId: string;
    reportDigest: Digest;
    projectDigest: Digest;
    bundleDigest: Digest;
  }[];
  /**
   * @maxItems 500
   */
  historicalEvidenceRefs: {
    runId: string;
    reportDigest: Digest;
    projectDigest: Digest;
    bundleDigest: Digest;
    reason: string;
  }[];
  checksum: Digest;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "CalibrationPolicy".
 */
export interface CalibrationPolicy {
  channels: {
    [k: string]: {
      absoluteTolerance: number;
      relativeTolerance: number;
    };
  };
  minTrialsPerCondition: number;
  maxClockGapNs: number;
  capabilities: {
    [k: string]: 'geometry' | 'rigidBody' | 'actuator' | 'sensor' | 'grasp' | 'process';
  };
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "CalibrationTrial".
 */
export interface CalibrationTrial {
  trialId: string;
  split: 'tune' | 'validation';
  condition: string;
  /**
   * @maxItems 100000
   */
  timesNs: number[];
  channels: {
    /**
     * @maxItems 100000
     */
    [k: string]: number[];
  };
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "PredictionSeries".
 */
export interface PredictionSeries {
  configDigest: string;
  clockDomain: 'sim' | 'wall' | 'instrument';
  units: {
    [k: string]: string;
  };
  /**
   * @maxItems 500
   */
  trials: {
    trialId: string;
    /**
     * @maxItems 100000
     */
    timesNs: number[];
    channels: {
      /**
       * @maxItems 100000
       */
      [k: string]: number[];
    };
  }[];
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "CalibrationResult".
 */
export interface CalibrationResult {
  status: 'pass' | 'fail' | 'not_run';
  reasons: string[];
  residuals: {
    [k: string]: {
      samples: number;
      meanAbs: number;
      maxAbs: number;
      withinTolerance: boolean;
    };
  };
  domain: {
    [k: string]: {
      min: number;
      max: number;
    };
  };
  calibratedCapabilities: string[];
  invalidatedBy: string | null;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "CalibrationDataset".
 */
export interface CalibrationDataset {
  schemaVersion: 1;
  configDigest: string;
  instrument: {
    id: string;
    revision: string;
  };
  units: {
    [k: string]: string;
  };
  clockMapping: {
    domain: 'sim' | 'wall' | 'instrument';
    offsetNs: number;
  };
  uncertainty: {
    [k: string]: number;
  };
  rawDigest: string;
  sourceKind: 'measured' | 'simulated' | 'synthetic';
  policy: CalibrationPolicy;
  /**
   * @maxItems 500
   */
  trials: CalibrationTrial[];
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "CoverageRequirement".
 */
export interface CoverageRequirement {
  id: string;
  kind: 'joint' | 'pose' | 'contact' | 'sensor' | 'process';
  entityId: string;
  minSamples: number;
  maxGapNs: number;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "ThresholdCheck".
 */
export interface ThresholdCheck {
  id: string;
  kind: 'joint' | 'pose' | 'contact' | 'sensor' | 'process';
  entityId: string;
  value: string;
  rule: 'max' | 'min';
  limit: number;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "CaseResult".
 */
export interface CaseResult {
  id: string;
  status: 'pass' | 'fail' | 'not_run';
  detail?: string;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "EngineeringAssessment".
 */
export interface EngineeringAssessment {
  status: 'pass' | 'fail' | 'not_run';
  reasons: string[];
  capabilities: {
    geometry: 'unsupported' | 'modeled' | 'verified';
    rigidBody: 'unsupported' | 'modeled' | 'verified';
    actuator: 'unsupported' | 'modeled' | 'verified';
    sensor: 'unsupported' | 'modeled' | 'verified';
    grasp: 'unsupported' | 'modeled' | 'verified';
    process: 'unsupported' | 'modeled' | 'verified';
    calibration: 'unsupported' | 'modeled' | 'verified';
  };
  caseResults: CaseResult[];
  artifactRefs: {
    sampleCount: number;
    firstSimTimeNs: string | null;
    lastSimTimeNs: string | null;
    samplesSha256: string;
    artifacts: string[];
  };
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "EngineeringRunManifest".
 */
export interface EngineeringRunManifest {
  schemaVersion: 1;
  execution: 'not_started' | 'completed' | 'aborted';
  runId: string;
  bundleDigest: string;
  expectedEpoch: number;
  profile: 'engineering-rigid-v1' | 'engineering-contact-v1';
  /**
   * @maxItems 200
   */
  coverage: CoverageRequirement[];
  /**
   * @maxItems 200
   */
  checks: ThresholdCheck[];
  claims: {
    geometry: 'unsupported' | 'modeled' | 'verified';
    rigidBody: 'unsupported' | 'modeled' | 'verified';
    actuator: 'unsupported' | 'modeled' | 'verified';
    sensor: 'unsupported' | 'modeled' | 'verified';
    grasp: 'unsupported' | 'modeled' | 'verified';
    process: 'unsupported' | 'modeled' | 'verified';
    calibration: 'unsupported' | 'modeled' | 'verified';
  };
  calibrationRefs: {
    [k: string]: string;
  };
  /**
   * @maxItems 200
   */
  artifacts: string[];
  configDigest: string;
  lastSequence: number;
  window: {
    startSimTimeNs: string;
    endSimTimeNs: string;
  };
}
