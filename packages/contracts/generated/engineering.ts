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
export type EngineeringProfile = 'engineering-rigid-v1' | 'engineering-contact-v1';
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
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "Instance".
 */
export interface Instance {
  id: EngineeringId;
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
