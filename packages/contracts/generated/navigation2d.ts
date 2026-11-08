/* Generated from the navigation/validation schemas. Run pnpm contracts:generate; do not edit. */
import type { Digest, EngineeringId, Link, Joint, Pose, Scalar, SensorModel, SourceRef } from './engineering';
/**
 * @minItems 2
 * @maxItems 2
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "Vec2".
 */
export type Vec2 = number[];
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "IRSimResponseV1".
 */
export type IRSimResponseV1 =
  | {
      protocol: 'mekoniq-irsim/1';
      requestId: string;
      runId: string;
      bootId: string;
      tick: number;
      ok: true;
      result:
        | IRSimSnapshotV1
        | {
            state: 'created' | 'running' | 'paused' | 'stopped' | 'failed';
          }
        | {
            packageVersion: string;
            pythonVersion: string;
            lockDigest: Digest;
            /**
             * @minItems 0
             * @maxItems 16
             */
            ops: string[];
          };
    }
  | {
      protocol: 'mekoniq-irsim/1';
      requestId: string;
      runId: string;
      bootId: string;
      tick: number;
      ok: false;
      error: {
        code: string;
        detail: string;
      };
    };
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "IRSimRequestV1".
 */
export type IRSimRequestV1 =
  | {
      protocol: 'mekoniq-irsim/1';
      requestId: string;
      runId: string;
      expectedTick: number;
      op: 'describe';
      payload: {};
    }
  | {
      protocol: 'mekoniq-irsim/1';
      requestId: string;
      runId: string;
      expectedTick: number;
      op: 'create';
      payload: {
        sceneRef: string;
        seed: number;
      };
    }
  | {
      protocol: 'mekoniq-irsim/1';
      requestId: string;
      runId: string;
      expectedTick: number;
      op: 'start';
      payload: {};
    }
  | {
      protocol: 'mekoniq-irsim/1';
      requestId: string;
      runId: string;
      expectedTick: number;
      op: 'step';
      payload: {
        targetTick: number;
        /**
         * @minItems 0
         * @maxItems 2
         */
        velocities: {
          robotId: EngineeringId;
          vMps: number;
          omegaRadps: number;
        }[];
        /**
         * @minItems 0
         * @maxItems 16
         */
        actorUpdates: {
          actorId: EngineeringId;
          /**
           * @minItems 3
           * @maxItems 3
           */
          poseMap: number[];
        }[];
        singleStep?: boolean;
      };
    }
  | {
      protocol: 'mekoniq-irsim/1';
      requestId: string;
      runId: string;
      expectedTick: number;
      op: 'pause';
      payload: {};
    }
  | {
      protocol: 'mekoniq-irsim/1';
      requestId: string;
      runId: string;
      expectedTick: number;
      op: 'resume';
      payload: {};
    }
  | {
      protocol: 'mekoniq-irsim/1';
      requestId: string;
      runId: string;
      expectedTick: number;
      op: 'getState';
      payload: {};
    }
  | {
      protocol: 'mekoniq-irsim/1';
      requestId: string;
      runId: string;
      expectedTick: number;
      op: 'stop';
      payload: {
        reason: string;
      };
    };

export interface Navigation2DContracts {}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "InputIdentity".
 */
export interface InputIdentity {
  project: {
    id: string;
    revision: number;
    digest: Digest;
  };
  assemblyDigest: Digest;
  world: {
    id: string;
    revision: number;
    hash: Digest;
  };
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "ArtifactRef".
 */
export interface ArtifactRef {
  path: string;
  sha256: Digest;
  bytes: number;
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "SensorMount".
 */
export interface SensorMount {
  sensorId: EngineeringId;
  sourceInstanceId: EngineeringId;
  sensorModelDigest: Digest;
  parentLinkId: EngineeringId;
  poseInBase: Pose;
  model: SensorModel;
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "RobotPhysicalModelV1".
 */
export interface RobotPhysicalModelV1 {
  schemaVersion: 1;
  documentType: 'robot-physical-model';
  modelDigest: Digest;
  inputs: InputIdentity;
  robotId: EngineeringId;
  baseFrameId: EngineeringId;
  /**
   * @minItems 1
   * @maxItems 1000
   */
  links: Link[];
  /**
   * @minItems 0
   * @maxItems 1000
   */
  joints: Joint[];
  drive: {
    entityId: EngineeringId;
    leftJointId: EngineeringId;
    rightJointId: EngineeringId;
    wheelRadiusM: Scalar;
    wheelSeparationM: Scalar;
    actuatorMaxSpeedRadps: Scalar;
    driveFrameInBase: Pose;
  } | null;
  /**
   * @minItems 0
   * @maxItems 16
   */
  sensors: SensorMount[];
  /**
   * @minItems 0
   * @maxItems 1000
   */
  assumptions: SourceRef[];
  projection: {
    id: 'physical-projection-v1';
    sourceSchemaHash: Digest;
  };
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "Lidar2DProjection".
 */
export interface Lidar2DProjection {
  id: EngineeringId;
  type: 'lidar_2d';
  sourceModelDigest: Digest;
  parentLinkId: EngineeringId;
  /**
   * @minItems 3
   * @maxItems 3
   */
  poseInDrive: number[];
  heightM: number;
  rangeMinM: number;
  rangeMaxM: number;
  fieldOfViewRad: number;
  beamCount: number;
  publishEveryTicks: number;
  noise: {
    distribution: 'none' | 'gaussian';
    stddevM: number;
    seed: number;
  };
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "NavigationModel2DV1".
 */
export interface NavigationModel2DV1 {
  schemaVersion: 1;
  documentType: 'navigation-model-2d';
  modelDigest: Digest;
  inputs: InputIdentity;
  robotId: EngineeringId;
  physicalModelDigest: Digest;
  baseFrameId: EngineeringId;
  driveFrameInBase: Pose;
  kinematics: {
    type: 'differential_drive';
    wheelRadiusM: number;
    wheelSeparationM: number;
    maxLinearMps: number;
    maxAngularRadps: number;
    maxWheelRadps: {
      left: number;
      right: number;
    };
  };
  footprint: {
    frame: 'drive';
    /**
     * @minItems 3
     * @maxItems 128
     */
    verticesM: Vec2[];
    method: 'convex-hull-primitive-bounds-v1';
    /**
     * @minItems 1
     * @maxItems 1000
     */
    contributingShapeIds: EngineeringId[];
    conservative: true;
  };
  navigationPolicyRef: {
    id: string;
    revision: number;
    hash: Digest;
  };
  /**
   * @minItems 0
   * @maxItems 16
   */
  sensors: Lidar2DProjection[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  limitations: string[];
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "NavigationPolicyV1".
 */
export interface NavigationPolicyV1 {
  schemaVersion: 1;
  id: string;
  revision: number;
  hash: Digest;
  source: SourceRef;
  parameters: {
    safetyMarginM: number;
    controller: 'grid-diff-v1';
    gridResolutionM: number;
    headingCount: number;
    distanceCostPerM: number;
    rotationCostPerRad: number;
    maxPlannerStates: number;
    maxLinearMps: number;
    maxAngularRadps: number;
    maxAccelerationMps2: number;
    maxAngularAccelerationRadps2: number;
    goalPositionToleranceM: number;
    goalYawToleranceRad: number;
    stoppedLinearMps: number;
    stoppedAngularRadps: number;
    arrivalHoldTicks: number;
    replanEveryTicks: number;
    scanFreshnessTicks: number;
    noProgressTicks: number;
    goalDeadlineTicks: number;
  };
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "NavigationSceneV1".
 */
export interface NavigationSceneV1 {
  schemaVersion: 1;
  documentType: 'navigation-scene';
  sceneDigest: Digest;
  inputs: InputIdentity;
  compilerVersion: string;
  schemaHash: Digest;
  /**
   * @minItems 1
   * @maxItems 2
   */
  robots: {
    robotId: EngineeringId;
    model: NavigationModel2DV1;
    /**
     * @minItems 3
     * @maxItems 3
     */
    initialPoseMap: number[];
    /**
     * @minItems 0
     * @maxItems 200
     */
    targetBindings: {
      pointId: EngineeringId;
      x: number;
      y: number;
      yaw: number;
    }[];
  }[];
  world: {
    id: string;
    revision: number;
    hash: Digest;
    widthM: number;
    heightM: number;
    /**
     * @minItems 0
     * @maxItems 500
     */
    obstacles: {
      id: EngineeringId;
      /**
       * @minItems 3
       * @maxItems 256
       */
      verticesM: Vec2[];
    }[];
    /**
     * @minItems 0
     * @maxItems 16
     */
    boundaries: {
      id: EngineeringId;
      /**
       * @minItems 3
       * @maxItems 256
       */
      verticesM: Vec2[];
    }[];
  };
  /**
   * @minItems 0
   * @maxItems 16
   */
  actors: {
    id: EngineeringId;
    radiusM: number;
    /**
     * @minItems 3
     * @maxItems 3
     */
    initialPoseMap: number[];
    scheduleRef: {
      id: string;
      revision: number;
      hash: Digest;
    };
  }[];
  /**
   * @minItems 0
   * @maxItems 32
   */
  zones: {
    id: EngineeringId;
    /**
     * @minItems 3
     * @maxItems 256
     */
    polygonM: Vec2[];
    /**
     * @minItems 0
     * @maxItems 16
     */
    entryPoints: Vec2[];
    /**
     * @minItems 0
     * @maxItems 16
     */
    exitPoints: Vec2[];
  }[];
  clock: {
    tickMs: 20;
  };
  engine: {
    id: 'irsim_2d';
    version: '2.12.0';
    collisionMode: 'stop';
  };
  policy: NavigationPolicyV1;
  /**
   * @minItems 0
   * @maxItems 64
   */
  files: ArtifactRef[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  limitations: string[];
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "ModelValidationReportV1".
 */
export interface ModelValidationReportV1 {
  schemaVersion: 1;
  documentType: 'model-validation-report';
  reportDigest: Digest;
  physicalModelDigest: Digest;
  assemblyDigest: Digest;
  robotId: EngineeringId;
  execution: 'ran' | 'not_run' | 'failed';
  result: 'pass' | 'fail' | 'inconclusive';
  mode: 'shadow';
  engine: {
    package: string;
    packageVersion: string;
    pythonVersion: string;
    lockDigest: Digest;
    adapterVersion: string;
    policyVersion: string;
  } | null;
  /**
   * @minItems 0
   * @maxItems 200
   */
  checks: {
    id: string;
    source: 'mekoniq' | 'linkforge' | 'parity';
    result: 'pass' | 'fail' | 'inconclusive' | 'not_run';
    coverageScope: string;
  }[];
  /**
   * @minItems 0
   * @maxItems 500
   */
  issues: {
    code: string;
    severity: 'error' | 'warning' | 'info';
    path: string;
    entityId: EngineeringId;
    linkId?: EngineeringId;
    jointId?: EngineeringId;
    source: 'mekoniq' | 'linkforge' | 'parity';
    upstreamCode?: string;
    detail: string;
  }[];
  nameMapRef: ArtifactRef | null;
  inputUrdfRef: ArtifactRef | null;
  referenceUrdfRef: ArtifactRef | null;
  referenceSrdfRef: ArtifactRef | null;
  /**
   * @minItems 0
   * @maxItems 1000
   */
  assumptions: SourceRef[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  limitations: string[];
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "LidarScanV1".
 */
export interface LidarScanV1 {
  sensorId: EngineeringId;
  frameId: EngineeringId;
  tick: number;
  simTimeNs: string;
  angleMinRad: number;
  angleIncrementRad: number;
  rangeMinM: number;
  rangeMaxM: number;
  /**
   * @minItems 0
   * @maxItems 1080
   */
  rangesM: (number | null)[];
  /**
   * @minItems 0
   * @maxItems 1080
   */
  states: ('hit' | 'no_return' | 'below_min' | 'invalid')[];
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "IRSimSnapshotV1".
 */
export interface IRSimSnapshotV1 {
  schemaVersion: 1;
  runId: string;
  bootId: string;
  tick: number;
  simTimeNs: string;
  seq: string;
  sceneDigest: Digest;
  /**
   * @minItems 0
   * @maxItems 2
   */
  robots: {
    robotId: EngineeringId;
    /**
     * @minItems 3
     * @maxItems 3
     */
    poseDriveMap: number[];
    /**
     * @minItems 2
     * @maxItems 2
     */
    bodyVelocity: number[];
    /**
     * @minItems 0
     * @maxItems 16
     */
    scans: LidarScanV1[];
    /**
     * @minItems 0
     * @maxItems 64
     */
    collisionIds: string[];
  }[];
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "NavigationRunEvidenceV1".
 */
export interface NavigationRunEvidenceV1 {
  schemaVersion: 1;
  documentType: 'navigation-run-evidence';
  runId: string;
  sceneDigest: Digest;
  sceneRef: ArtifactRef;
  /**
   * @minItems 1
   * @maxItems 2
   */
  modelDigests: Digest[];
  policyRef: {
    id: string;
    revision: number;
    hash: Digest;
  };
  controller: {
    id: 'grid-diff-v1';
    version: string;
  };
  engine: {
    id: 'irsim_2d';
    version: string;
    pythonVersion: string;
    platform: string;
    lockDigest: Digest;
  };
  /**
   * Optional (added with B05): the versions a rerun must match besides the engine and lock.
   */
  identity?: {
    sourceCommit: string;
    compilerVersion: string;
    sceneSchemaHash: Digest;
    evidenceFormat: 'navigation-evidence-ndjson-gzip-v1';
    os: string;
    arch: string;
    node: string;
  };
  clock: {
    tickMs: 20;
    tickHorizon: number;
    businessEpochMs: number;
  };
  seed: {
    runSeed: number;
    engineSeed: number;
    engineSeedAlgorithm: 'irsim-env-seed-v1';
    /**
     * @minItems 0
     * @maxItems 32
     */
    sensorSeeds: {
      robotId: EngineeringId;
      sensorId: EngineeringId;
      noiseSeed: number;
    }[];
    actorRng: {
      algorithm: string;
      seed: number;
    };
    /**
     * Optional (added with B05): the IR-SIM NumPy stream, separate from the source actor stream.
     */
    engineRng?: {
      library: 'numpy';
      version: string;
      algorithm: string;
      seed: number;
    };
  };
  validationReportRef: ArtifactRef | null;
  artifacts: {
    /**
     * @minItems 0
     * @maxItems 2000
     */
    trajectory: {
      path: string;
      sha256: Digest;
      bytes: number;
      firstTick: number;
      lastTick: number;
    }[];
    /**
     * @minItems 0
     * @maxItems 2000
     */
    sensors: {
      path: string;
      sha256: Digest;
      bytes: number;
      firstTick: number;
      lastTick: number;
    }[];
    /**
     * @minItems 0
     * @maxItems 2000
     */
    control: {
      path: string;
      sha256: Digest;
      bytes: number;
      firstTick: number;
      lastTick: number;
    }[];
    /**
     * @minItems 0
     * @maxItems 2000
     */
    collisions: {
      path: string;
      sha256: Digest;
      bytes: number;
      firstTick: number;
      lastTick: number;
    }[];
  };
  digests: {
    trajectoryDigest: Digest;
    sensorDigest: Digest;
    assertionDigest: Digest;
    algorithm?: 'navigation-evidence-digest-v1';
    /**
     * @minItems 0
     * @maxItems 20
     */
    normalizedOmits?: string[];
  };
  /**
   * @minItems 0
   * @maxItems 200
   */
  assertions: {
    id: string;
    result: 'pass' | 'fail' | 'inconclusive' | 'not_run';
    detail: string;
  }[];
  /**
   * @minItems 0
   * @maxItems 50
   */
  metricCoverage: {
    metric: string;
    status: 'available' | 'unavailable';
    reason: string | null;
  }[];
  /**
   * @minItems 0
   * @maxItems 500
   */
  recordingGaps: {
    fromTick: number;
    toTick: number;
    reason: string;
  }[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  limitations: string[];
  /**
   * Optional (added with B05): incomplete whenever a chunk fails verification, ticks are missing or a limit ended the recording.
   */
  completeness?: {
    status: 'complete' | 'incomplete';
    /**
     * @minItems 0
     * @maxItems 50
     */
    reasons: string[];
  };
}
