// Synced from source packages/contracts/generated/engineering.ts @ f55c5826d2d5c3a0fd939e9e24e9fe02134ea582 (sha256 e6b2fb2f52676119fceba98609ac2306b6367ca07d793302be1bb1b83e6a1342). Run node scripts/sync-engineering-contracts.mjs; do not edit.
/* Generated from the engineering schemas. Run pnpm contracts:generate; do not edit. */
import type {LabProjectV2,AssetRevision} from './types';
export type CoffeeRecipe=Record<string,unknown>;
import type { DriveModelV1 } from './navigation2d';
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
export type EngineeringProfile =
  | 'engineering-rigid-v1'
  | 'engineering-contact-v1'
  | 'engineering-irsim-2d-v1'
  | 'engineering-webots-3d-v1'
  | 'engineering-mujoco-3d-v1';
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
  jointIds: EngineeringId[];
  transmission: {
    ratio: Scalar;
    efficiency: Scalar;
  };
  commandInterface: 'velocity' | 'position' | 'effort';
  /**
   * @minItems 2
   * @maxItems 200
   */
  torqueSpeedTable: {
    speed: Scalar;
    torque: Scalar;
  }[];
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
  reservoirs: {
    resourceId: EngineeringId;
    capacityMl: Scalar;
    initialMl: Scalar;
  }[];
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
  payloadRatings?: PayloadRating[];
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
  /**
   * Registered server-owned new-run payload or tray experiment; only engineering-mujoco-3d-v1.
   */
  mujocoExperimentId?:
    | 'payload-empty-v1'
    | 'payload-center-v1'
    | 'payload-offset-v1'
    | 'payload-slow-v1'
    | 'payload-fast-v1'
    | 'payload-friction-low-v1'
    | 'payload-friction-high-v1'
    | 'tray-nominal-v1'
    | 'tray-low-friction-v1'
    | 'tray-accel-high-v1'
    | 'tray-torque-limited-v1'
    | 'tray-person-crossing-v1'
    | 'tray-stop-brake-v1'
    | 'tray-stop-coast-v1'
    | 'tray-stop-slow-brake-v1'
    | 'tray-stop-slow-coast-v1'
    | 'tray-stop-low-brake-v1'
    | 'tray-stop-low-coast-v1';
  /**
   * Registered server-owned virtual-drive experiment (R4); only engineering-mujoco-3d-v1. Absent: the R2b control path, byte for byte.
   */
  driveExperimentId?:
    | 'drive-ideal-v1'
    | 'drive-nominal-v1'
    | 'drive-torque-limited-v1'
    | 'drive-latency-v1'
    | 'drive-coarse-encoder-v1'
    | 'drive-hw-c-brake-v1'
    | 'drive-hw-c-coast-v1';
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
    walls: {
      x: number;
      y: number;
      width: number;
      height: number;
    }[];
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
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "DeviceDocument".
 */
export interface DeviceDocument {
  id: EngineeringId;
  kind:
    | 'datasheet'
    | 'manual'
    | 'safety_manual'
    | 'certificate'
    | 'description_file'
    | 'description_summary'
    | 'drawing'
    | 'quotation'
    | 'vendor_page';
  title: string;
  revision: string;
  url: string;
  digest: Digest;
  license: string;
}
/**
 * Verbatim claim from a document. Certified only when a certificate names the order code of the profile; computed, never typed.
 *
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "SafetyClaim".
 */
export interface SafetyClaim {
  function: 'sto' | 'ss1' | 'sbc' | 'safe_input';
  claim: string;
  documentId: EngineeringId;
  locator: string;
  certificate: Certificate | null;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "Certificate".
 */
export interface Certificate {
  documentId: EngineeringId;
  body: string;
  number: string;
  /**
   * @minItems 1
   * @maxItems 32
   */
  models: string[];
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "Connector".
 */
export interface Connector {
  id: EngineeringId;
  label: string;
  matingPart: string | null;
  /**
   * @minItems 1
   * @maxItems 64
   */
  pins: Pin[];
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "Pin".
 */
export interface Pin {
  pin: string;
  name: string;
  role:
    | 'power'
    | 'return'
    | 'pe'
    | 'di'
    | 'do'
    | 'ai'
    | 'ao'
    | 'bus'
    | 'sto'
    | 'brake'
    | 'motor_phase'
    | 'encoder'
    | 'shield'
    | 'nc';
  portId: string | null;
  source: SourceRef;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "IOPointV1".
 */
export interface IOPointV1 {
  pointId: EngineeringId;
  direction: 'input' | 'output';
  pin: string;
  commonPin: string | null;
  electrical: {
    type:
      | 'pnp_sink_input'
      | 'npn_source_input'
      | 'dry_contact_input'
      | 'pnp_source_output'
      | 'npn_sink_output'
      | 'isolated_transistor_output'
      | 'relay_output'
      | 'analog_voltage'
      | 'analog_current';
    /**
     * @minItems 2
     * @maxItems 2
     */
    voltageRangeV: number[];
    maxCurrentA: Scalar | null;
  };
  /**
   * @minItems 1
   * @maxItems 32
   */
  functions: string[];
  defaultFunction: string;
  reassignable: boolean;
  assignmentPersistence: 'retained' | 'volatile' | 'fixed';
  busExposure: {
    kind: 'cyclic' | 'acyclic' | 'none';
    object: string | null;
    bit: number | null;
    precondition: string | null;
    updatePeriodMs: number | null;
  };
  safety: SafetyClaim | null;
  source: SourceRef;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "DeviceInterface".
 */
export interface DeviceInterface {
  id: EngineeringId;
  portId: string;
  protocol: 'canopen' | 'modbus_rtu' | 'ethercat_coe' | 'usb' | 'ethernet' | 'uart';
  profile: 'cia402' | null;
  descriptionDocumentId: string | null;
  source: SourceRef;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "DriveCapabilityV1".
 */
export interface DriveCapabilityV1 {
  axes: 1 | 2;
  /**
   * @minItems 1
   * @maxItems 6
   */
  modes: ('csp' | 'csv' | 'cst' | 'pp' | 'pv' | 'pt')[];
  ratedCurrentA: Scalar;
  peakCurrentA: Scalar;
  profileAccelerationRadS2: Scalar | null;
  feedback: {
    /**
     * @maxItems 8
     */
    kinds: string[];
    countsPerRev: Scalar | null;
  };
  watchdog: {
    kind: 'heartbeat' | 'sync_timeout' | 'modbus_timeout' | 'none';
    rangeMs: number[] | null;
    source: SourceRef;
  };
  stop: {
    quickStop: boolean;
    quickStopOption: Scalar | null;
    faultReactionOption: Scalar | null;
    torqueOff: SafetyClaim | null;
    /**
     * @maxItems 8
     */
    torqueOffPointIds: string[];
    monitorOutputPointId: string | null;
    brakeOutputPointId: string | null;
    source: SourceRef;
  };
  /**
   * @maxItems 64
   */
  faultMap: {
    vendorCode: string;
    neutral: 'COMMAND_TIMEOUT' | 'FEEDBACK_LOSS' | 'FOLLOWING_ERROR' | 'OVERSPEED' | 'EXTERNAL_TRIP' | 'OTHER';
    source: SourceRef;
  }[];
}
/**
 * What a device is, taken from pinned manufacturer documents: connectors, pins, I/O points, interfaces, drive capability, safety claims (verbatim). There is deliberately no field for an evidence level, a safety level or a verified state: those are pure functions of the document and its sources.
 *
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "DeviceProfileV1".
 */
export interface DeviceProfileV1 {
  schemaVersion: 1;
  documentType: 'device-profile';
  id: EngineeringId;
  revision: number;
  digest: Digest;
  component: {
    id: EngineeringId;
    revision: string;
    digest: Digest;
  };
  variant: {
    orderCode: string | null;
    hardwareRevision: string | null;
    firmware: string | null;
  };
  kind:
    | 'servo_drive'
    | 'motor'
    | 'battery'
    | 'compute'
    | 'io_module'
    | 'sensor'
    | 'indicator'
    | 'switch'
    | 'safety_device'
    | 'power_conversion'
    | 'protection';
  /**
   * @maxItems 32
   */
  documents: DeviceDocument[];
  /**
   * @maxItems 16
   */
  connectors: Connector[];
  /**
   * @maxItems 32
   */
  ioPoints: IOPointV1[];
  /**
   * @maxItems 8
   */
  interfaces: DeviceInterface[];
  drive: DriveCapabilityV1 | null;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "DocumentRef".
 */
export interface DocumentRef {
  id: EngineeringId;
  revision: number;
  digest: Digest;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "SignalV1".
 */
export interface SignalV1 {
  id: EngineeringId;
  label: string;
  role:
    | 'bumper'
    | 'cliff'
    | 'dock_detect'
    | 'cover_switch'
    | 'estop_status'
    | 'charger_present'
    | 'lamp'
    | 'buzzer'
    | 'brake_release'
    | 'aux_input'
    | 'aux_output'
    | 'safety';
  direction: 'input' | 'output';
  field: {
    deviceId: EngineeringId;
    pin: string;
    returnPin: string | null;
  };
  electrical: {
    type:
      | 'pnp_sink_input'
      | 'npn_source_input'
      | 'dry_contact_input'
      | 'pnp_source_output'
      | 'npn_sink_output'
      | 'isolated_transistor_output'
      | 'relay_output'
      | 'analog_voltage'
      | 'analog_current';
    nominalV: number;
    currentA: Scalar;
  };
  consumer: 'controller' | 'drive_local' | 'safety_chain';
  maxLatencyMs: number | null;
  required: boolean;
  pinned: {
    deviceId: EngineeringId;
    pointId: EngineeringId;
  } | null;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "StopFunctionV1".
 */
export interface StopFunctionV1 {
  id: 'normal' | 'protective' | 'emergency';
  trigger:
    | {
        kind: 'operator';
      }
    | {
        kind: 'signal';
        signalId: EngineeringId;
      };
  /**
   * @minItems 1
   * @maxItems 16
   */
  axes: string[];
  finalState: 'hold' | 'disabled' | 'torque_off_coast' | 'torque_off_brake';
  requirementId: EngineeringId | null;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "WiringPolicyV1".
 */
export interface WiringPolicyV1 {
  schemaVersion: 1;
  documentType: 'wiring-policy';
  id: EngineeringId;
  revision: number;
  digest: Digest;
  /**
   * @minItems 1
   * @maxItems 16
   */
  ampacity: {
    csaMm2: number;
    maxCurrentA: Scalar;
  }[];
  signalMinCsaMm2: number;
  maxVoltageDropFraction: Scalar;
  copperResistivityOhmMm2PerM: number;
  /**
   * @maxItems 32
   */
  colours: {
    role: string;
    colour: string;
  }[];
  sources: {
    ampacity: SourceRef;
    drop: SourceRef;
  };
}
/**
 * One hardware option for one engineering project: which devices, axes, buses, rails and functional signals. Authored by a person; the compiler derives allocation, netlist and checks. No wire runs from pin to pin unless the author pins it.
 *
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "ElectricalDesignV1".
 */
export interface ElectricalDesignV1 {
  schemaVersion: 1;
  documentType: 'electrical-design';
  id: EngineeringId;
  revision: number;
  digest: Digest;
  project: {
    id: EngineeringId;
    revision: number;
  };
  option: {
    id: EngineeringId;
    label: string;
    rationale: string;
  };
  /**
   * @maxItems 64
   */
  devices: {
    id: EngineeringId;
    profile: {
      id: EngineeringId;
      revision: number;
      digest: Digest;
    };
    assemblyInstanceId: EngineeringId | null;
  }[];
  /**
   * @maxItems 16
   */
  axes: {
    axisId: string;
    driveDeviceId: EngineeringId;
    channel: number;
    motorDeviceId: EngineeringId | null;
  }[];
  /**
   * @maxItems 8
   */
  buses: {
    id: EngineeringId;
    protocol: 'canopen' | 'modbus_rtu' | 'ethercat_coe' | 'usb' | 'ethernet' | 'uart';
    controllerDeviceId: EngineeringId;
    cycleMs: number;
    /**
     * @minItems 1
     * @maxItems 32
     */
    members: {
      deviceId: EngineeringId;
      interfaceId: EngineeringId;
      address: number | null;
    }[];
  }[];
  /**
   * @maxItems 16
   */
  power: {
    railId: EngineeringId;
    nominalV: number;
    source: {
      deviceId: EngineeringId;
      pin: string;
      returnPin: string;
    };
    /**
     * @maxItems 64
     */
    feeds: {
      id: EngineeringId;
      to: {
        deviceId: EngineeringId;
        pin: string;
        returnPin: string;
      };
      protectionDeviceId: EngineeringId | null;
      lengthM: Scalar | null;
    }[];
  }[];
  /**
   * @maxItems 128
   */
  signals: SignalV1[];
  /**
   * @maxItems 3
   */
  stopFunctions: StopFunctionV1[];
  safetyRequirementsRef: DocumentRef | null;
  wiringPolicyRef: DocumentRef;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "CheckResult".
 */
export interface CheckResult {
  ruleId: string;
  level: 'blocking' | 'warning' | 'unverified';
  path: string;
  detail: string;
  /**
   * @maxItems 20
   */
  sources: SourceRef[];
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "IoAllocationV1".
 */
export interface IoAllocationV1 {
  /**
   * @maxItems 128
   */
  assigned: {
    signalId: EngineeringId;
    deviceId: EngineeringId;
    pointId: EngineeringId;
    busId: EngineeringId | null;
    exposure: 'cyclic' | 'acyclic' | 'local';
    pinned: boolean;
  }[];
  /**
   * @maxItems 128
   */
  unassigned: {
    signalId: EngineeringId;
    /**
     * @maxItems 16
     */
    reasons: {
      code: string;
      candidates: number;
    }[];
  }[];
  /**
   * @maxItems 2048
   */
  spare: {
    deviceId: EngineeringId;
    pointId: EngineeringId;
  }[];
  /**
   * @maxItems 2048
   */
  reserved: {
    deviceId: EngineeringId;
    pointId: EngineeringId;
    function: string;
  }[];
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "NetlistV1".
 */
export interface NetlistV1 {
  /**
   * @maxItems 1024
   */
  nets: {
    id: string;
    kind: 'power' | 'return' | 'bus' | 'signal' | 'axis' | 'safety';
    /**
     * @maxItems 128
     */
    nodes: {
      deviceId: EngineeringId;
      pin: string;
    }[];
    reviewRequired: boolean;
  }[];
  /**
   * @maxItems 512
   */
  wires: {
    id: string;
    netId: string;
    from: {
      deviceId: EngineeringId;
      pin: string;
    };
    to: {
      deviceId: EngineeringId;
      pin: string;
    };
    csaMm2: number;
    csaSource: SourceRef;
    colour: string;
    lengthM: Scalar | null;
    currentA: Scalar | null;
  }[];
  /**
   * @maxItems 128
   */
  cables: {
    id: string;
    kind: 'motor' | 'encoder' | 'bus' | 'usb' | 'ethernet';
    from: string;
    to: string;
    part: string | null;
  }[];
}
/**
 * Derived, sealed result of compiling one electrical design: allocation, netlist, checks, extended BOM and a draft drive model. Nobody edits it by hand; it carries the identity of every input.
 *
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "ElectricalBundleV1".
 */
export interface ElectricalBundleV1 {
  schemaVersion: 1;
  documentType: 'electrical-bundle';
  digest: Digest;
  state: 'compiled' | 'blocked';
  inputs: {
    project: {
      id: EngineeringId;
      revision: number;
      digest: Digest;
    };
    assemblyDigest: Digest;
    design: {
      id: EngineeringId;
      revision: number;
      digest: Digest;
    };
    /**
     * @maxItems 64
     */
    profiles: {
      id: EngineeringId;
      revision: number;
      digest: Digest;
      evidenceLevel: 'candidate' | 'documented';
    }[];
    safetyRequirementsDigest: Digest | null;
    wiringPolicyDigest: Digest;
    compilerVersion: 'electrical-compiler/1';
    schemaHash: string;
  };
  allocation: IoAllocationV1;
  netlist: NetlistV1;
  /**
   * @maxItems 2000
   */
  checks: CheckResult[];
  bom: Bom;
  driveModelDraft: DriveModelV1 | null;
  hardwareValidated: false;
  controlAuthority: false;
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "TcoAssumptionsV1".
 */
export interface TcoAssumptionsV1 {
  schemaVersion: 1;
  documentType: 'tco-assumptions';
  id: EngineeringId;
  revision: number;
  digest: Digest;
  currency: string;
  labourPerHour: number;
  minutesPerWire: number;
  minutesPerConnector: number;
  testMinutesPerUnit: number;
  driveReplacementsOverLife: number;
  downtimeHoursPerRepair: number;
  downtimeCostPerHour: number;
  wirePricePerM: number | null;
  connectorPrice: number | null;
  sources: {
    labour: SourceRef;
    service: SourceRef;
  };
}
/**
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "TcoComparisonV1".
 */
export interface TcoComparisonV1 {
  assumptionsDigest: Digest;
  /**
   * @minItems 2
   * @maxItems 4
   */
  options: {
    designId: EngineeringId;
    bundleDigest: Digest;
    comparable: boolean;
    /**
     * @maxItems 1000
     */
    missingPriceLineIds: EngineeringId[];
    parts: {
      hardware: number | null;
      wiring: number | null;
      assembly: number | null;
      testing: number | null;
      service: number | null;
      downtime: number | null;
    };
    total: number | null;
  }[];
  dominant: {
    factor: 'hardware' | 'wiring' | 'assembly' | 'testing' | 'service' | 'downtime';
    spread: number;
  } | null;
  notComparableReason: ('PRICE_MISSING_FOR_DECIDING_PARTS' | 'CURRENCY_MISMATCH' | 'BUNDLE_BLOCKED') | null;
}
/**
 * Manifest of a hardware candidate package: a draft for exchanging one configuration before purchase. The three constants say what it is not; readers hash every listed file and never trust the status written here.
 *
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "HardwareCandidateV1".
 */
export interface HardwareCandidateV1 {
  schemaVersion: 1;
  documentType: 'hardware-candidate';
  status: 'draft';
  hardwareValidated: false;
  controlAuthority: false;
  bundle: {
    digest: Digest;
    designId: EngineeringId;
    designRevision: number;
    projectDigest: Digest;
    assemblyDigest: Digest;
  };
  /**
   * @minItems 1
   * @maxItems 64
   */
  files: {
    path: string;
    sha256: Digest;
    bytes: number;
  }[];
  /**
   * @maxItems 64
   */
  readiness: {
    id: string;
    status: 'ready' | 'pending' | 'blocked_external';
    reason: string;
  }[];
  /**
   * @maxItems 64
   */
  evidenceRefs: {
    kind: 'stop-report' | 'io-fault-report';
    runId: EngineeringId;
    reportDigest: Digest;
  }[];
  /**
   * @maxItems 64
   */
  documents: {
    deviceProfile: EngineeringId;
    id: EngineeringId;
    revision: string;
    url: string;
    digest: Digest;
  }[];
}
/**
 * A register written by the person responsible for safety. It is not executable logic and the Lab never judges it. There is no status field: the evidence state is computed from the documents.
 *
 * This interface was referenced by `EngineeringContracts`'s JSON-Schema
 * via the `definition` "SafetyRequirementsV1".
 */
export interface SafetyRequirementsV1 {
  schemaVersion: 1;
  documentType: 'safety-requirements';
  id: EngineeringId;
  revision: number;
  digest: Digest;
  /**
   * @maxItems 64
   */
  requirements: {
    id: EngineeringId;
    function: string;
    trigger: string;
    stopCategory: 0 | 1 | 2;
    /**
     * @maxItems 64
     */
    deviceIds: EngineeringId[];
    /**
     * @maxItems 64
     */
    signalIds: EngineeringId[];
    /**
     * @maxItems 16
     */
    documents: DeviceDocument[];
    notes: string;
  }[];
}
