/* Generated from the navigation/validation schemas. Run pnpm contracts:generate; do not edit. */
import type { CalibrationResult, Digest, EngineeringId, Link, Joint, Pose, Scalar, SensorModel, SourceRef } from './engineering';
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
 * via the `definition` "NavigationSceneV1".
 */
export type NavigationSceneV1 = NavigationSceneV11;
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
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "NavigationRunEvidenceV1".
 */
export type NavigationRunEvidenceV1 = NavigationRunEvidenceV11;
/**
 * @minItems 3
 * @maxItems 3
 */
export type PoseDriveMap = number[];
/**
 * @minItems 2
 * @maxItems 2
 */
export type BodyVelocity = number[];
/**
 * @minItems 0
 * @maxItems 16
 */
export type Scans = LidarScanV1[];
/**
 * @minItems 0
 * @maxItems 64
 */
export type CollisionIds = string[];
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "DriveAxisId".
 */
export type DriveAxisId = string;
/**
 * @minItems 0
 * @maxItems 1
 */
export type Arms = Sim3DArmStateV1[];
/**
 * @minItems 0
 * @maxItems 8
 */
export type Props = {
  propId: EngineeringId;
  /**
   * @minItems 3
   * @maxItems 3
   */
  position: number[];
  /**
   * @minItems 4
   * @maxItems 4
   */
  quaternionXyzw: number[];
  restingOn: string | null;
}[];
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "DriveState".
 */
export type DriveState = 'disabled' | 'ready' | 'enabled' | 'quick_stop' | 'fault';
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "DriveFault".
 */
export type DriveFault = 'COMMAND_TIMEOUT' | 'FEEDBACK_LOSS' | 'FOLLOWING_ERROR' | 'OVERSPEED' | 'EXTERNAL_TRIP';
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "Sim3DResponseV1".
 */
export type Sim3DResponseV1 =
  | {
      protocol: 'mekoniq-sim3d/1';
      requestId: string;
      runId: string;
      bootId: string;
      tick: number;
      ok: true;
      result:
        | Sim3DWireSnapshotV1
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
            engineVersion?: string;
            executableSha256?: Digest;
            hostArch?: 'arm64' | 'x86_64';
          };
    }
  | {
      protocol: 'mekoniq-sim3d/1';
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
 * via the `definition` "Sim3DRequestV1".
 */
export type Sim3DRequestV1 =
  | {
      protocol: 'mekoniq-sim3d/1';
      requestId: string;
      runId: string;
      expectedTick: number;
      op: 'describe';
      payload: {};
    }
  | {
      protocol: 'mekoniq-sim3d/1';
      requestId: string;
      runId: string;
      expectedTick: number;
      op: 'create';
      payload: {
        sceneRef: string;
        seed: number;
        /**
         * @minItems 0
         * @maxItems 1
         */
        arms?: {
          armId: EngineeringId;
          sceneRef: 'arm-scene.json' | 'arm-cell-scene.json';
        }[];
        /**
         * A bench run (V06, D1): its drive model and control profile (bundle files, the same refs a scene's engine names) and the 1-2 axes whose 500 Hz trace every snapshot carries. A bench scene names no drive refs of its own.
         */
        bench?: {
          driveModelRef: DriveDocumentRef;
          controlProfileRef: DriveDocumentRef;
          /**
           * @minItems 1
           * @maxItems 2
           */
          axisIds: DriveAxisId[];
        };
      };
    }
  | {
      protocol: 'mekoniq-sim3d/1';
      requestId: string;
      runId: string;
      expectedTick: number;
      op: 'start';
      payload: {};
    }
  | {
      protocol: 'mekoniq-sim3d/1';
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
        /**
         * @minItems 0
         * @maxItems 1
         */
        jointTargets?: {
          armId: EngineeringId;
          /**
           * @minItems 1
           * @maxItems 8
           */
          positionsRad: number[];
        }[];
        /**
         * @minItems 0
         * @maxItems 1
         */
        gripperTargets?: {
          armId: EngineeringId;
          openingM: number;
        }[];
        /**
         * @minItems 0
         * @maxItems 8
         */
        propPlacements?: {
          propId: EngineeringId;
          pose: Sim3DPoseV1 | null;
        }[];
        /**
         * @maxItems 16
         */
        worldInteractions?: {
          eventId: string;
          cupId: EngineeringId;
          propId: EngineeringId;
          kind: 'birth' | 'remove';
          targetTick: number;
        }[];
        /**
         * @maxItems 1
         */
        worldPerturbations?: {
          eventId: string;
          presetId: 'world-dock-drift-v1' | 'world-cup-fall-v1' | 'world-cup-nudge-v1';
          revision: 1;
          targetId: string;
          targetTick: number;
        }[];
        worldControl?: WorldControlV1;
        /**
         * @minItems 0
         * @maxItems 16
         */
        driveCommands?: DriveCommandV1[];
        /**
         * @minItems 0
         * @maxItems 32
         */
        faultInjections?: FaultInjectionV1[];
      };
    }
  | {
      protocol: 'mekoniq-sim3d/1';
      requestId: string;
      runId: string;
      expectedTick: number;
      op: 'pause';
      payload: {};
    }
  | {
      protocol: 'mekoniq-sim3d/1';
      requestId: string;
      runId: string;
      expectedTick: number;
      op: 'resume';
      payload: {};
    }
  | {
      protocol: 'mekoniq-sim3d/1';
      requestId: string;
      runId: string;
      expectedTick: number;
      op: 'getState';
      payload: {};
    }
  | {
      protocol: 'mekoniq-sim3d/1';
      requestId: string;
      runId: string;
      expectedTick: number;
      op: 'stop';
      payload: {
        reason: string;
      };
    };
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "DriveMode".
 */
export type DriveMode = 'csp' | 'csv';
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "ArmObstacle".
 */
export type ArmObstacle =
  | {
      id: EngineeringId;
      kind: 'sphere';
      /**
       * @minItems 3
       * @maxItems 3
       */
      center: number[];
      radiusM: number;
    }
  | {
      id: EngineeringId;
      kind: 'box';
      /**
       * @minItems 3
       * @maxItems 3
       */
      min: number[];
      /**
       * @minItems 3
       * @maxItems 3
       */
      max: number[];
    };
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "AxisDriveModel".
 */
export type AxisDriveModel = AxisDriveModel1;
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "ControlMetric".
 */
export type ControlMetric =
  | {
      available: true;
      value: number;
      unit: string;
      samples: number;
      basis: 'actual' | 'feedback';
    }
  | {
      available: false;
      value: null;
      unit: string;
      reason: string;
    };
/**
 * Tagged by kind (one branch is checked, so a refusal names the field of that branch). atTick < 500 and ticks <= 500 are the bench's own tick bounds (bench-signals.ts BENCH_MAX_TICKS); a value past them is TICK_OUT_OF_RANGE.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "BenchSignal".
 */
export type BenchSignal =
  | {
      kind: 'step';
      amplitude: number;
      atTick: number;
    }
  | {
      kind: 'trapezoid';
      distance: number;
      peakVelocity: number;
      acceleration: number;
      atTick: number;
    }
  | {
      kind: 'hold';
      ticks: number;
    };
/**
 * Per-axis drive evidence, tuning results, fault reports and the control oracle policy (R4). Readers build TuningResultV1 and FaultReportV1 from verified streams.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "ControlEvidenceV1".
 */
export type ControlEvidenceV1 = DriveTickRecord | TuningResultV1 | FaultReportV1 | ControlOracleV1 | FaultOracleV1;

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
 * Heights and materials a 3D plant needs and the 2D scene does not carry. Versioned input of the compiler, so it has a digest through the scene.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "World3DV1".
 */
export interface World3DV1 {
  obstacleHeightM: number;
  wallHeightM: number;
  floorFriction: number;
  casterFriction: number;
  provenance: 'assumed' | 'measured';
}
export interface NavigationSceneV11 {
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
  engine:
    | {
        id: 'irsim_2d';
        version: '2.12.0';
        collisionMode: 'stop';
      }
    | {
        id: 'webots_3d';
        version: 'R2025a';
        basicTimeStepMs: 1 | 2 | 4 | 5 | 10 | 20;
      }
    | {
        id: 'mujoco_3d';
        version: string;
        timestepMs: 2;
        substeps: number;
        physicsProfileRef: {
          id: string;
          revision: number;
          path: string;
          sha256: Digest;
        };
        loadProfileRef: {
          id: string;
          revision: number;
          path: string;
          sha256: Digest;
        };
        stopPolicyRef?: {
          id: string;
          revision: number;
          path: string;
          sha256: Digest;
        };
        controllerPolicyRef?: {
          id: string;
          revision: number;
          path: string;
          sha256: Digest;
        };
        driveModelRef?: DriveDocumentRef;
        controlProfileRef?: DriveDocumentRef;
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
  world3d?: World3DV1;
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "DriveDocumentRef".
 */
export interface DriveDocumentRef {
  id: string;
  revision: number;
  path: string;
  sha256: Digest;
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
export interface NavigationRunEvidenceV11 {
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
  engine:
    | {
        id: 'irsim_2d';
        version: string;
        pythonVersion: string;
        platform: string;
        lockDigest: Digest;
      }
    | {
        id: 'webots_3d';
        engineVersion: 'R2025a';
        executableSha256: Digest;
        basicTimeStepMs: 1 | 2 | 4 | 5 | 10 | 20;
        pythonVersion: string;
        platform: string;
        lockDigest: Digest;
      }
    | {
        id: 'mujoco_3d';
        engineVersion: '3.17.0';
        pythonVersion: string;
        platform: string;
        lockDigest: Digest;
        timestepMs: 2;
        substeps: 10;
        stopPolicyRef: {
          id: string;
          revision: number;
          path: string;
          sha256: Digest;
        };
        physicsProfileRef: {
          id: string;
          revision: number;
          path: string;
          sha256: Digest;
        };
        loadProfileRef: {
          id: string;
          revision: number;
          path: string;
          sha256: Digest;
        };
        controllerPolicyRef: {
          id: string;
          revision: number;
          path: string;
          sha256: Digest;
        };
        hostArch?: 'arm64' | 'x86_64';
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
    engineSeedAlgorithm: 'irsim-env-seed-v1' | 'webots-worldinfo-seed-v1' | 'mujoco-identity-seed-v1';
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
  /**
   * Optional (added with the B05 review): the recorder's own end-of-recording record as committed in its manifest (the gaps it recorded, the terminal reason or null for a recording that was not ended early, and the last durable tick). An import without it cannot claim a complete recording.
   */
  recording?: {
    /**
     * @minItems 0
     * @maxItems 10000
     */
    gaps: {
      fromTick: number;
      toTick: number;
      reason: string;
    }[];
    terminal: string | null;
    lastTick: number | null;
    /**
     * Optional (added with review 4): the run's logical tick when the document was built (null before start). An import compares the durable horizon with it: ticks the run reached that the chunks do not hold are EVIDENCE_PENDING, never complete.
     */
    runTick?: number | null;
  };
}
/**
 * One verdict of an independent algorithm check. The verdict is decided in TypeScript from the checker output; the Python checker never grades itself.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "AlgorithmResultV1".
 */
export interface AlgorithmResultV1 {
  schemaVersion: 1;
  checkerId: 'rtb_kinematics' | 'pid_reference';
  caseId: string;
  verdict: 'pass' | 'fail' | 'not_run';
  metrics: {
    [k: string]: number | null;
  };
  oracleProfileDigest: Digest;
  inputDigest: Digest;
  toolVersions: {
    [k: string]: string;
  };
  /**
   * @minItems 0
   * @maxItems 100
   */
  reasons: string[];
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "Pose3DV1".
 */
export interface Pose3DV1 {
  z: number;
  roll: number;
  pitch: number;
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "WheelStateV1".
 */
export interface WheelStateV1 {
  leftRadS: number;
  rightRadS: number;
}
/**
 * Every field of the IR-SIM robot state, plus the 3D pose and wheel speeds. Contact with the floor is never a collisionId.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "Sim3DRobotStateV1".
 */
export interface Sim3DRobotStateV1 {
  robotId: EngineeringId;
  poseDriveMap: PoseDriveMap;
  bodyVelocity: BodyVelocity;
  scans: Scans;
  collisionIds: CollisionIds;
  pose3d: Pose3DV1;
  wheels: WheelStateV1;
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "Sim3DArmStateV1".
 */
export interface Sim3DArmStateV1 {
  armId: EngineeringId;
  /**
   * @minItems 1
   * @maxItems 8
   */
  positionsRad: number[];
  /**
   * @minItems 1
   * @maxItems 8
   */
  velocitiesRadS: number[];
  /**
   * @minItems 0
   * @maxItems 64
   */
  collisionIds: string[];
  gripper?: {
    openingM: number;
    /**
     * @minItems 0
     * @maxItems 8
     */
    heldPropIds: EngineeringId[];
  };
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "Sim3DSnapshotV1".
 */
export interface Sim3DSnapshotV1 {
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
  robots: Sim3DRobotStateV1[];
  model?: Sim3DModelReadbackV1;
  arms?: Arms;
  props?: Props;
  physics?: PhysicsTickRecord;
  worldStep?: WorldStep;
  /**
   * @minItems 0
   * @maxItems 16
   */
  drives?: DriveAxisSnapshot[];
  /**
   * @minItems 0
   * @maxItems 2
   */
  driveTrace?: DriveTrace[];
  /**
   * @minItems 0
   * @maxItems 32
   */
  faultReceipts?: FaultReceiptV1[];
}
/**
 * What the engine reports about the world it loaded (getState only): link masses and world positions, wheel radius and separation, wheel hinge axes. Compared with the physical model by the parity test.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "Sim3DModelReadbackV1".
 */
export interface Sim3DModelReadbackV1 {
  /**
   * @minItems 0
   * @maxItems 2
   */
  robots: {
    robotId: EngineeringId;
    /**
     * @minItems 1
     * @maxItems 64
     */
    links: {
      name: string;
      massKg: number;
      /**
       * @minItems 3
       * @maxItems 3
       */
      positionMap: number[];
    }[];
    wheelRadiusM: number;
    wheelSeparationM: number;
    /**
     * @minItems 2
     * @maxItems 2
     */
    wheelAxes: number[][];
  }[];
  /**
   * The arm as the engine loaded it (getState only): link masses and, per joint in chain order, the hinge axis in the parent frame and the motor's position limits.
   */
  arm?: {
    /**
     * @minItems 1
     * @maxItems 9
     */
    links: {
      name: string;
      massKg: number;
    }[];
    /**
     * @minItems 1
     * @maxItems 8
     */
    joints: {
      name: string;
      /**
       * @minItems 3
       * @maxItems 3
       */
      axis: number[];
      lower: number;
      upper: number;
      /**
       * The joint actuator's force (torque, N*m for a hinge) limit as the engine loaded it; MuJoCo plant only.
       */
      forceN?: number;
    }[];
  };
  /**
   * Bench only (V06, D4): the effective inertia of each traced axis at the pose of the readback. A joint or the gripper: the diagonal of the joint-space mass matrix at its dof. A wheel: that diagonal plus m*r^2/2 (m the mass of the AMR body tree, r the wheel radius: straight-line drive, each wheel carries half the mass).
   *
   * @minItems 1
   * @maxItems 2
   */
  effectiveInertiaKgM2?: {
    axisId: DriveAxisId;
    valueKgM2: number;
    basis: 'mass_matrix_diagonal' | 'wheel_straight_line';
    provenance: 'assumed';
  }[];
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "PhysicsTickRecord".
 */
export interface PhysicsTickRecord {
  schemaVersion: 1;
  tick: number;
  simTimeNs: string;
  /**
   * @minItems 0
   * @maxItems 256
   */
  contacts: ContactAggregate[];
  /**
   * @minItems 0
   * @maxItems 8
   */
  loads: LoadObservation[];
  /**
   * @minItems 0
   * @maxItems 1
   */
  wheels: {
    robotId: string;
    /**
     * @minItems 2
     * @maxItems 2
     */
    angleRad: number[];
    /**
     * @minItems 2
     * @maxItems 2
     */
    velocityRadS: number[];
    /**
     * @minItems 2
     * @maxItems 2
     */
    torqueNm: number[];
    /**
     * @minItems 2
     * @maxItems 2
     */
    targetRadS: number[];
    saturatedSubsteps: number;
  }[];
  /**
   * @minItems 0
   * @maxItems 1
   */
  odometry: {
    robotId: string;
    /**
     * @minItems 3
     * @maxItems 3
     */
    poseDriveMap: number[];
  }[];
  /**
   * @minItems 0
   * @maxItems 1
   */
  base: {
    robotId: string;
    poseMap: {
      /**
       * @minItems 3
       * @maxItems 3
       */
      positionM: number[];
      /**
       * @minItems 4
       * @maxItems 4
       */
      quaternionXyzw: number[];
    };
    rollRad: number;
    pitchRad: number;
  }[];
  /**
   * @minItems 0
   * @maxItems 16
   */
  drives?: DriveAxisSnapshot[];
  /**
   * @minItems 0
   * @maxItems 32
   */
  faultIntents?: FaultInjectionV1[];
  /**
   * @minItems 0
   * @maxItems 32
   */
  faultReceipts?: FaultReceiptV1[];
  /**
   * @minItems 0
   * @maxItems 2
   */
  sensorTransforms?: {
    entryId: string;
    sensorId: string;
    scanTick: number;
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
  }[];
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "ContactAggregate".
 */
export interface ContactAggregate {
  a: string;
  b: string;
  samples: number;
  peakNormalN: number;
  normalImpulseNs: number;
  /**
   * @minItems 3
   * @maxItems 3
   */
  netImpulseMapNs: number[];
  /**
   * @minItems 3
   * @maxItems 3
   */
  pointAtPeakMapM: number[];
  expected: boolean;
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "LoadObservation".
 */
export interface LoadObservation {
  propId: string;
  poseMap: {
    /**
     * @minItems 3
     * @maxItems 3
     */
    positionM: number[];
    /**
     * @minItems 4
     * @maxItems 4
     */
    quaternionXyzw: number[];
  };
  /**
   * @minItems 3
   * @maxItems 3
   */
  linearVelocityMapMps: number[];
  /**
   * @minItems 3
   * @maxItems 3
   */
  angularVelocityMapRadps: number[];
  supportId: string | null;
  poseInSupport: {
    /**
     * @minItems 3
     * @maxItems 3
     */
    positionM: number[];
    /**
     * @minItems 4
     * @maxItems 4
     */
    quaternionXyzw: number[];
  } | null;
}
/**
 * Feedback plus the true state; the actual* fields never reach a controller.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "DriveAxisSnapshot".
 */
export interface DriveAxisSnapshot {
  axisId: DriveAxisId;
  state: DriveState;
  fault: DriveFault | null;
  commandSeq: number;
  positionRad: number | null;
  velocityRadS: number | null;
  torqueNm: number | null;
  tick: number;
  targetApplied: number;
  actualPositionRad: number;
  actualVelocityRadS: number;
  saturatedSubsteps: number;
  followingErrorRad: number | null;
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "FaultInjectionV1".
 */
export interface FaultInjectionV1 {
  entryId: string;
  faultId: string;
  targetId: string;
  params: {
    [k: string]: number;
  };
  phase: 'start' | 'end';
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "FaultReceiptV1".
 */
export interface FaultReceiptV1 {
  entryId: string;
  faultId: string;
  targetId: string;
  params: {
    [k: string]: number;
  };
  phase: 'start' | 'end';
  appliedTick: number;
  runId: string;
  bootId: string;
  sceneDigest: string;
  requestDigest: string;
  overriddenBy?: 'WORLD_MOVEMENT_INTERLOCK';
}
export interface WorldStep {
  workerPid: number;
  modelCount: 1;
  physicsSubsteps: number;
  primingSubsteps: 10;
  nq: number;
  nv: number;
  nbody: number;
  ngeom: number;
  /**
   * @maxItems 1
   */
  disturbances?: {
    eventId: string;
    presetId: 'world-dock-drift-v1' | 'world-cup-fall-v1' | 'world-cup-nudge-v1';
    revision: 1;
    targetId: string;
    targetTick: number;
    runId: string;
    bootId: string;
    sceneDigest: string;
    requestId: string;
    requestDigest: string;
    frame: 'map';
    /**
     * @minItems 3
     * @maxItems 3
     */
    forceMapN: number[];
    durationSubsteps: 10;
    /**
     * @minItems 3
     * @maxItems 3
     */
    beforePositionM: number[];
    /**
     * @minItems 3
     * @maxItems 3
     */
    afterPositionM: number[];
  }[];
  /**
   * Pick-rig-only native placement read after mj_forward and before the first integration substep. Post-step props remain separate observations.
   *
   * @minItems 1
   * @maxItems 16
   */
  birthObservations?: {
    method: 'mujoco-freejoint-body-before-step-v1';
    frame: 'map';
    propId: string;
    cupId: string;
    eventId: string;
    runId: string;
    bootId: string;
    requestId: string;
    sceneDigest: string;
    requestDigest: string;
    targetTick: number;
    physicsSubstepsBefore: number;
    /**
     * @minItems 3
     * @maxItems 3
     */
    qposPositionM: number[];
    /**
     * @minItems 3
     * @maxItems 3
     */
    bodyPositionM: number[];
    /**
     * @minItems 4
     * @maxItems 4
     */
    quaternionXyzw: number[];
  }[];
}
/**
 * One sample per substep (dtS apart). A null entry is a missing substep (a gap): a metric over a window containing one is TRACE_GAP. actual is the true state (position for csp, velocity for csv); feedback is what the controller saw.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "DriveTrace".
 */
export interface DriveTrace {
  axisId: DriveAxisId;
  dtS: number;
  /**
   * @minItems 0
   * @maxItems 5000
   */
  samples: ({
    target: number;
    actual: number;
    feedback: number | null;
    torqueNm: number;
    saturated?: boolean;
  } | null)[];
}
/**
 * Sim3DRobotStateV1 as a worker ACK carries it: a MuJoCo worker sends `scans` only on the sensor's publish tick; the source client carries the last publication forward, so every Sim3DRobotStateV1 (and world evidence) still has it.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "Sim3DWireRobotStateV1".
 */
export interface Sim3DWireRobotStateV1 {
  robotId: EngineeringId;
  poseDriveMap: PoseDriveMap;
  bodyVelocity: BodyVelocity;
  scans?: Scans;
  collisionIds: CollisionIds;
  pose3d: Pose3DV1;
  wheels: WheelStateV1;
}
/**
 * Sim3DSnapshotV1 as a worker ACK carries it (robots as Sim3DWireRobotStateV1).
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "Sim3DWireSnapshotV1".
 */
export interface Sim3DWireSnapshotV1 {
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
  robots: Sim3DWireRobotStateV1[];
  model?: Sim3DModelReadbackV1;
  arms?: Arms;
  props?: Props;
  physics?: PhysicsTickRecord;
  worldStep?: WorldStep;
  /**
   * @minItems 0
   * @maxItems 16
   */
  drives?: DriveAxisSnapshot[];
  /**
   * @minItems 0
   * @maxItems 2
   */
  driveTrace?: DriveTrace[];
  /**
   * @minItems 0
   * @maxItems 32
   */
  faultReceipts?: FaultReceiptV1[];
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "Sim3DPoseV1".
 */
export interface Sim3DPoseV1 {
  /**
   * @minItems 3
   * @maxItems 3
   */
  position: number[];
  /**
   * @minItems 4
   * @maxItems 4
   */
  quaternionXyzw: number[];
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "WorldControlV1".
 */
export interface WorldControlV1 {
  version: 1;
  program: {
    commandId: string;
    transferId: string;
    cupId: string;
    sourceEventId: string;
    payloadHash: string;
    controlEpoch: number;
    programId: 'cup-pick' | 'cup-place';
    stage: number;
    waypoint: string;
  } | null;
  attachmentProxyPropId: string | null;
  movementInterlocked: boolean;
  stopLatched: boolean;
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "DriveCommandV1".
 */
export interface DriveCommandV1 {
  axisId: DriveAxisId;
  seq: number;
  mode: DriveMode;
  target: number;
  enable: boolean;
  quickStop: boolean;
  faultReset: boolean;
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "ArmScene3DV1".
 */
export interface ArmScene3DV1 {
  schemaVersion: 1;
  sceneDigest: Digest;
  arm: {
    armId: EngineeringId;
    modelId: 'arm-ref-3d-v1';
    modelRevision: Digest;
    baseInMap: {
      /**
       * @minItems 3
       * @maxItems 3
       */
      position: number[];
      /**
       * @minItems 4
       * @maxItems 4
       */
      quaternionXyzw: number[];
    };
    /**
     * @minItems 1
     * @maxItems 8
     */
    homeRad: number[];
  };
  /**
   * @minItems 0
   * @maxItems 64
   */
  statics: ArmObstacle[];
  world3d: {
    floorFriction: number;
    provenance: 'assumed';
  };
  engine: {
    id: 'webots_3d';
    basicTimeStepMs: 20;
  };
  engineSeed: number;
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "ArmCellPoseV1".
 */
export interface ArmCellPoseV1 {
  /**
   * @minItems 3
   * @maxItems 3
   */
  position: number[];
  /**
   * @minItems 4
   * @maxItems 4
   */
  quaternionXyzw: number[];
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "ArmCellSceneV1".
 */
export interface ArmCellSceneV1 {
  schemaVersion: 1;
  sceneDigest: Digest;
  arm: {
    armId: EngineeringId;
    modelId: 'xarm6-g2-v1';
    modelRevision: Digest;
    baseInMap: ArmCellPoseV1;
    /**
     * @minItems 1
     * @maxItems 8
     */
    homeRad: number[];
  };
  /**
   * @minItems 0
   * @maxItems 64
   */
  statics: ArmObstacle[];
  /**
   * @minItems 2
   * @maxItems 2
   */
  supports: {
    id: 'nozzle-stand' | 'tray';
    /**
     * @minItems 3
     * @maxItems 3
     */
    centerM: number[];
    /**
     * @minItems 3
     * @maxItems 3
     */
    sizeM: number[];
  }[];
  /**
   * @minItems 1
   * @maxItems 8
   */
  props: {
    propId: EngineeringId;
    kind: 'cup';
    radiusM: number;
    heightM: number;
    massKg: number;
    provenance: 'assumed';
  }[];
  graspFrames: {
    pick: ArmCellPoseV1;
    place: ArmCellPoseV1;
  };
  /**
   * @minItems 0
   * @maxItems 16
   */
  allowedContacts: {
    a: 'gripper' | 'held_prop';
    b: 'nozzle-stand' | 'tray';
  }[];
  world3d: {
    padFriction: number;
    propFriction: number;
    supportFriction: number;
    provenance: 'assumed';
  };
  engine: {
    id: 'mujoco_3d';
    timestepMs: 2;
    substeps: 10;
  };
  engineSeed: number;
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "LoadProfileV1".
 */
export interface LoadProfileV1 {
  schemaVersion: 1;
  documentType: 'load-profile';
  id: string;
  revision: number;
  digest: Digest;
  calibration: 'not_calibrated';
  modelRef: {
    path: string;
    sha256: Digest;
  };
  /**
   * @minItems 1
   * @maxItems 8
   */
  supports: {
    supportId: string;
    parentBodyId: string;
    poseInBody: {
      /**
       * @minItems 3
       * @maxItems 3
       */
      positionM: number[];
      /**
       * @minItems 4
       * @maxItems 4
       */
      quaternionXyzw: number[];
    };
    /**
     * @minItems 3
     * @maxItems 32
     */
    polygonM: number[][];
    source: SourceRef;
  }[];
  /**
   * @minItems 0
   * @maxItems 8
   */
  props: {
    propId: string;
    massKg: number;
    /**
     * @minItems 6
     * @maxItems 6
     */
    inertiaKgM2: number[];
    /**
     * @minItems 3
     * @maxItems 3
     */
    comM: number[];
    geometry: {
      kind: 'cylinder';
      radiusM: number;
      heightM: number;
    };
    friction: {
      sliding: number;
      torsionalM: number;
      rollingM: number;
    };
    sources: {
      mass: SourceRef;
      inertia: SourceRef;
      com: SourceRef;
      geometry: SourceRef;
      friction: SourceRef;
      attachment: SourceRef;
    };
    attachment:
      | {
          kind: 'free';
          supportId: string;
          initialPoseInSupport: {
            /**
             * @minItems 3
             * @maxItems 3
             */
            positionM: number[];
            /**
             * @minItems 4
             * @maxItems 4
             */
            quaternionXyzw: number[];
          };
        }
      | {
          kind: 'fixed_ballast';
          parentLinkId: string;
          poseInLink: {
            /**
             * @minItems 3
             * @maxItems 3
             */
            positionM: number[];
            /**
             * @minItems 4
             * @maxItems 4
             */
            quaternionXyzw: number[];
          };
        };
  }[];
  /**
   * @minItems 1
   * @maxItems 32
   */
  assumptions: SourceRef[];
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "PhysicsEvidenceV1".
 */
export interface PhysicsEvidenceV1 {
  schemaVersion: 1;
  documentType: 'physics-evidence';
  identity: {
    runId: string;
    bootId: string;
    sceneDigest: Digest;
    loadProfileDigest: Digest;
    physicsProfileDigest: Digest;
  };
  /**
   * @minItems 0
   * @maxItems 1
   */
  streams: {
    stream: 'physics';
    /**
     * @minItems 0
     * @maxItems 10000
     */
    chunks: {
      path: string;
      sha256: Digest;
      bytes: number;
    }[];
  }[];
  coverage: {
    firstTick: number;
    lastTick: number;
    complete: boolean;
  };
  /**
   * @minItems 0
   * @maxItems 10000
   */
  gaps: {
    firstTick: number;
    lastTick: number;
    reason: string;
  }[];
  terminalReason: string | null;
  metricsPolicyDigest: Digest;
  /**
   * @minItems 1
   * @maxItems 64
   */
  assumptions: SourceRef[];
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "LabWorldSceneV1".
 */
export interface LabWorldSceneV1 {
  schemaVersion: 1;
  documentType: 'lab-world-scene';
  id: string;
  revision: number;
  sceneDigest: Digest;
  inputs: {
    projectDigest: Digest;
    armModelDigest: Digest;
    mobileModelDigest: Digest;
  };
  navigation: NavigationSceneV1;
  armCell: ArmCellSceneV1;
  models: {
    armComponent: {
      path: string;
      sha256: Digest;
    };
    armPhysics: {
      path: string;
      sha256: Digest;
    };
    mobilePhysical: {
      path: string;
      sha256: Digest;
    };
    emptyLoad: {
      path: string;
      sha256: Digest;
    };
    mobilePhysics: {
      path: string;
      sha256: Digest;
    };
  };
  supportMap: {
    replacedStaticSupportId: 'tray';
    mobileSupportId: string;
  };
  /**
   * @minItems 1
   * @maxItems 8
   */
  propBindings: {
    propId: string;
    cupId: string;
  }[];
  numericalPolicy: {
    id: 'coffee-delivery-world-numerics-v1';
    revision: 1;
    calibration: 'not_calibrated';
    timestepMs: 2;
    substeps: 10;
    primingSubsteps: 10;
    integrator: 'implicitfast';
    cone: 'elliptic';
    impratio: 10;
    solver: 'Newton';
    iterations: 100;
    tolerance: 1e-8;
    floorSlidingFriction: 1;
  };
  handoffPolicyRef: {
    path: string;
    sha256: Digest;
  };
  programsRef: {
    path: string;
    sha256: Digest;
  };
  /**
   * @minItems 1
   * @maxItems 128
   */
  files: {
    path: string;
    sha256: Digest;
    bytes: number;
  }[];
  /**
   * @maxItems 32
   */
  allowedContactRules: {
    a: string;
    b: string;
    phase: 'grasp' | 'release';
    regionId: string;
  }[];
  controllerPolicy?: {
    id: 'grid-diff-world-v1' | 'grid-diff-world-v2' | 'grid-diff-world-v3' | 'grid-diff-world-v4';
    version: '1' | '2' | '3' | '4';
    provenance: 'assumed';
    bounds: {
      /**
       * @minItems 2
       * @maxItems 2
       */
      minM: number[];
      /**
       * @minItems 2
       * @maxItems 2
       */
      maxM: number[];
    };
    justification: string;
    tolerances: {
      legM: 0.004;
      positionM: 0.008;
      yawRad: 0.016;
      translationScope: 'every_translation';
    };
    braking?: {
      designBrakingDecelerationMps2: 0.25;
      settleBeforeTranslationAdvance: true;
    };
    terminalApproachDistanceM?: 0.2;
    terminalApproachDirection?: 'reverse';
  };
  disturbance?: {
    presetId: 'world-dock-drift-v1' | 'world-cup-fall-v1' | 'world-cup-nudge-v1';
    revision: 1;
    targetId: string;
    trigger: 'before_release' | 'transport' | 'after_belief_commit';
    cupId: string;
  };
  controlContextVersion?: 1;
  engine?: {
    driveModelRef?: DriveDocumentRef;
    controlProfileRef?: DriveDocumentRef;
  };
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "WorldEvidenceRecord".
 */
export interface WorldEvidenceRecord {
  snapshot: Sim3DSnapshotV1;
  command: {
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
    /**
     * @minItems 0
     * @maxItems 1
     */
    jointTargets?: {
      armId: EngineeringId;
      /**
       * @minItems 1
       * @maxItems 8
       */
      positionsRad: number[];
    }[];
    /**
     * @minItems 0
     * @maxItems 1
     */
    gripperTargets?: {
      armId: EngineeringId;
      openingM: number;
    }[];
    /**
     * @minItems 0
     * @maxItems 8
     */
    propPlacements?: {
      propId: EngineeringId;
      pose: Sim3DPoseV1 | null;
    }[];
    /**
     * @maxItems 16
     */
    worldInteractions?: {
      eventId: string;
      cupId: EngineeringId;
      propId: EngineeringId;
      kind: 'birth' | 'remove';
      targetTick: number;
    }[];
    /**
     * @maxItems 1
     */
    worldPerturbations?: {
      eventId: string;
      presetId: 'world-dock-drift-v1' | 'world-cup-fall-v1' | 'world-cup-nudge-v1';
      revision: 1;
      targetId: string;
      targetTick: number;
    }[];
    worldControl?: WorldControlV1;
    /**
     * @minItems 0
     * @maxItems 16
     */
    driveCommands?: DriveCommandV1[];
    /**
     * @minItems 0
     * @maxItems 32
     */
    faultInjections?: FaultInjectionV1[];
    /**
     * @minItems 0
     * @maxItems 32
     */
    faultReceipts?: FaultReceiptV1[];
  } | null;
  /**
   * @maxItems 16
   */
  interactions: {
    eventId: string;
    cupId: string;
    propId: string;
    kind: 'birth' | 'remove';
    tick: number;
    commandDigest: string;
    reason: 'source_nozzle_birth' | 'source_recipient_removal' | 'rig_birth' | 'rig_removal';
    before: Sim3DPoseV1 | null;
    after: Sim3DPoseV1 | null;
  }[];
  /**
   * @minItems 0
   * @maxItems 16
   */
  drives?: DriveAxisSnapshot[];
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "WorldEvidenceV1".
 */
export interface WorldEvidenceV1 {
  schemaVersion: 1;
  documentType: 'world-evidence';
  runId: string;
  bootId: string;
  sceneDigest: string;
  admissionDigest: string;
  /**
   * @maxItems 2000
   */
  chunks: {
    path: string;
    sha256: string;
    bytes: number;
    firstTick: number;
    lastTick: number;
  }[];
  lastTick: number;
  complete: boolean;
  terminal: string | null;
  /**
   * @maxItems 10000
   */
  gaps: {
    targetTick: number;
    lastCommittedTick: number;
    ackTick: number | null;
    reason: string;
  }[];
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "WebReplayPackageV1".
 */
export interface WebReplayPackageV1 {
  schemaVersion: 1;
  documentType: 'web-replay-package';
  runId: string;
  horizon: {
    tick: number;
    tickMs: 20;
  };
  provenance: {
    kind: 'imported_integrity_only';
    accepted: false;
    calibration: 'not_calibrated';
    scope: 'display_only_not_requalification';
    rawReportSha256: string;
    reportTransform: 'credential_redaction_v1';
  };
  coverage: {
    prefixCovered: boolean;
    streamFinalized: boolean;
    sampled: false;
    terminal: string | null;
    /**
     * @maxItems 100
     */
    gaps: (
      | {
          targetTick: number;
          lastCommittedTick: number;
          ackTick: number | null;
          reason: string;
        }
      | {
          firstTick: number;
          lastTick: number;
          reason: string;
        }
    )[];
    /**
     * @maxItems 100
     */
    issues: string[];
  };
  /**
   * @maxItems 512
   */
  assets: ((
    | {
        role?: 'report' | 'events' | 'scene' | 'profile' | 'vendor' | 'trace' | 'model';
        mediaType?: 'application/json';
        path?: {
          [k: string]: any;
        };
        [k: string]: any;
      }
    | {
        role?: 'model';
        mediaType?: 'model/stl';
        encoding?: 'identity';
        path?: {
          [k: string]: any;
        };
        [k: string]: any;
      }
    | {
        role?: 'notice';
        mediaType?: 'text/plain';
        encoding?: 'identity';
        path?: {
          [k: string]: any;
        };
        [k: string]: any;
      }
    | {
        role?: 'world' | 'physics' | 'navigation';
        mediaType?: 'application/x-ndjson';
        path?: {
          [k: string]: any;
        };
        [k: string]: any;
      }
  ) & {
    path: string;
    sha256: string;
    decodedSha256: string;
    bytes: number;
    decodedBytes: number;
    encoding: 'identity' | 'gzip';
    role:
      | 'report'
      | 'events'
      | 'scene'
      | 'model'
      | 'profile'
      | 'notice'
      | 'vendor'
      | 'trace'
      | 'world'
      | 'physics'
      | 'navigation';
    mediaType: 'application/json' | 'application/x-ndjson' | 'model/stl' | 'text/plain';
  })[];
  /**
   * @maxItems 3
   */
  streams: {
    kind: 'world' | 'physics' | 'navigation';
    /**
     * @maxItems 256
     */
    chunks: string[];
    firstTick: number;
    lastTick: number;
    samples: number;
  }[];
  /**
   * @maxItems 8
   */
  licensing: {
    kind: 'supplemental_licensing';
    repository: string;
    commit: string;
    recordPath: string;
    noticePath: string;
    /**
     * @maxItems 100
     */
    matchedAssets: string[];
  }[];
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "SemanticStudyV1".
 */
export interface SemanticStudyV1 {
  schemaVersion: 1;
  documentType: 'semantic-study';
  accepted: false;
  status: 'complete' | 'incomparable' | 'failed';
  /**
   * @maxItems 100
   */
  reasonCodes: string[];
  equivalence: {
    model: {
      id: string;
      sha256: string;
    };
    world: {
      id: string;
      sha256: string;
    };
    task: {
      id: string;
      sha256: string;
    };
    commonProjection: {
      id: string;
      sha256: string;
    };
  };
  invariantPolicy: {
    id: 'fd01-source-causal-v1';
    revision: 1;
  };
  /**
   * @maxItems 3
   */
  runs: {
    runId: string;
    engine: 'irsim_2d' | 'webots_3d' | 'mujoco_3d';
    reportRef: {
      path: string;
      sha256: string;
      bytes: number;
    };
    /**
     * @maxItems 4000
     */
    artifactRefs: {
      path: string;
      sha256: string;
      bytes: number;
    }[];
    sceneDigest: string;
    modelDigest: string;
    firstTick: number;
    lastTick: number;
    replay: {
      runId: string;
      tick: number;
    };
  }[];
  /**
   * @maxItems 30
   */
  invariants: {
    runId: string;
    id: string;
    status: 'pass' | 'fail' | 'not_run';
    /**
     * @maxItems 50
     */
    reasonCodes: string[];
    tick: number | null;
  }[];
  /**
   * @maxItems 30
   */
  differences: {
    runId: string;
    dimension: string;
    value: number | null;
    unit: string;
    status: 'observed' | 'unavailable';
    reason: string | null;
  }[];
  /**
   * @maxItems 9
   */
  unsupportedDimensions: {
    engine: 'irsim_2d' | 'webots_3d' | 'mujoco_3d';
    dimension: 'contact' | 'slip' | 'tipping';
    status: 'unsupported';
    reason: string;
  }[];
  percentiles: null;
  /**
   * @maxItems 20
   */
  limitations: string[];
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "DriveFeedbackV1".
 */
export interface DriveFeedbackV1 {
  axisId: DriveAxisId;
  state: DriveState;
  fault: DriveFault | null;
  commandSeq: number;
  positionRad: number | null;
  velocityRadS: number | null;
  torqueNm: number | null;
  tick: number;
}
/**
 * A fault-schedule entry of the R4 drive catalog (V08): the shape of FaultScheduleEntry plus catalog parameters, and targets named like axes (robot/axis). It is a separate document so the frozen FaultScheduleEntry schema keeps its bytes.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "DriveFaultEntryV1".
 */
export interface DriveFaultEntryV1 {
  id: string;
  faultId: string;
  targetId: string;
  trigger:
    | {
        kind: 'elapsed_sim_ms';
        value: number;
      }
    | {
        kind: 'phase';
        value: 'brew' | 'grasp' | 'handoff' | 'delivery';
      };
  durationMs: number;
  params?: {
    [k: string]: number;
  };
}
/**
 * Neutral drive command/feedback contract (R4-A). DriveFeedbackV1 carries measured values only; DriveAxisSnapshot adds the true state and is evidence-only.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "DriveIoV1".
 */
export interface DriveIoV1 {
  schemaVersion: 1;
  /**
   * @minItems 0
   * @maxItems 16
   */
  commands?: DriveCommandV1[];
  /**
   * @minItems 0
   * @maxItems 16
   */
  feedback?: DriveFeedbackV1[];
}
export interface AxisDriveModel1 {
  axisId: DriveAxisId;
  mode: DriveMode;
  torque:
    | {
        kind: 'envelope_ref';
        scale: number;
      }
    | {
        kind: 'effort';
        limitNm: number;
      };
  velocityLimitRadS: number;
  encoder: {
    countsPerRev: number | null;
    velocityWindowSubsteps: number;
  };
  feedbackDelaySubsteps: number;
  feedbackLossSubsteps: number;
  commandDelaySubsteps: number;
  commandInterpolation: 'hold' | 'linear';
  watchdogTicks: number | null;
  enableDelaySubsteps: number;
  quickStopSubsteps: number;
  onDisable: 'coast' | 'brake';
  brakeTorqueNm: number | null;
  followingError: {
    limitRad: number;
    substeps: number;
  } | null;
}
/**
 * A device model: what a servo drive is, not how it is tuned. Changes only with a better source (datasheet, measurement).
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "DriveModelV1".
 */
export interface DriveModelV1 {
  schemaVersion: 1;
  documentType: 'drive-model';
  id: string;
  revision: number;
  digest: Digest;
  calibration: 'not_calibrated';
  /**
   * @minItems 1
   * @maxItems 16
   */
  axes: AxisDriveModel[];
  sources: {
    torque: SourceRef;
    velocity: SourceRef;
    encoder: SourceRef;
    delays: SourceRef;
    watchdog: SourceRef;
    disable: SourceRef;
    followingError: SourceRef;
  };
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "AxisControl".
 */
export interface AxisControl {
  axisId: DriveAxisId;
  loop: {
    kp: number;
    ki: number;
    kd: number;
    integralLimit: number | null;
    slewLimit: number | null;
  };
  accelerationLimit: number | null;
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "ControllerConfig".
 */
export interface ControllerConfig {
  controllerId: string;
  revision: number;
  params: {
    [k: string]: number;
  };
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "TuningBound".
 */
export interface TuningBound {
  min: number;
  max: number;
}
/**
 * A field the axis does not accept (kd and slewLimit on a velocity axis, accelerationLimit on a position axis) is absent.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "AxisEnvelope".
 */
export interface AxisEnvelope {
  axisId: DriveAxisId;
  kp: TuningBound;
  ki: TuningBound;
  kd?: TuningBound;
  integralLimit: TuningBound;
  slewLimit?: TuningBound;
  accelerationLimit?: TuningBound;
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "TuningEnvelopeV1".
 */
export interface TuningEnvelopeV1 {
  schemaVersion: 1;
  documentType: 'tuning-envelope';
  id: string;
  revision: number;
  digest: Digest;
  calibration: 'not_calibrated';
  /**
   * @minItems 1
   * @maxItems 16
   */
  axes: AxisEnvelope[];
  source: SourceRef;
}
/**
 * Values tuned in simulation on a registered bench run (R4-A §6.3 export): the run, its bench scenario, the sha256 of its recorded trace (TuningResultV1.trace.sha256), the source commit of the runtime that ran it, the axes it traced and the drive model it ran (final-fix V07 I1: sources are profile-wide, so the attribution names exactly what was tuned). Simulated and not calibrated, like everything on the bench.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "TunedSourceRef".
 */
export interface TunedSourceRef {
  kind: 'tuned_in_simulation';
  benchRunId: string;
  scenarioId: 'MJ-BENCH-WHEEL' | 'MJ-BENCH-ARM';
  traceSha256: Digest;
  sourceCommit: string;
  /**
   * The axes that bench traced (TuningResultV1.axisIds): the values of these axes were tuned on it; the other axes of the profile keep values that bench did not measure.
   *
   * @minItems 1
   * @maxItems 2
   */
  axisIds: DriveAxisId[];
  driveModelDigest: Digest;
}
/**
 * A tuning choice: loop gains and limits per axis, bound to the plant and to the drive models it was declared against.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "ControlProfileV1".
 */
export interface ControlProfileV1 {
  schemaVersion: 1;
  documentType: 'control-profile';
  id: string;
  revision: number;
  digest: Digest;
  calibration: 'not_calibrated';
  plantModelDigest: Digest;
  /**
   * @minItems 1
   * @maxItems 8
   */
  driveModelDigests: Digest[];
  /**
   * @minItems 1
   * @maxItems 16
   */
  axes: AxisControl[];
  /**
   * @minItems 1
   * @maxItems 4
   */
  controllers: ControllerConfig[];
  sources: {
    /**
     * An engineering source (SourceRef), or the bench run the values were tuned on (TunedSourceRef, V07pre).
     */
    loop: SourceRef | TunedSourceRef;
    /**
     * An engineering source (SourceRef), or the bench run the values were tuned on (TunedSourceRef, V07pre).
     */
    limits: SourceRef | TunedSourceRef;
    controller: SourceRef;
  };
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "ControlArtifactRef".
 */
export interface ControlArtifactRef {
  path: string;
  sha256: Digest;
  bytes: number;
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "DriveTickRecord".
 */
export interface DriveTickRecord {
  schemaVersion: 1;
  tick: number;
  simTimeNs: string;
  /**
   * @minItems 0
   * @maxItems 16
   */
  driveCommands?: DriveCommandV1[];
  /**
   * @minItems 1
   * @maxItems 16
   */
  drives: DriveAxisSnapshot[];
}
/**
 * The result of one bench run, built from the trace read back from the recorder. metrics are computed on the true state (basis actual) of axisIds[0]; both wheels of a wheel bench carry the same command. Everything needed to compare two runs is here. A bench ends in exactly one result: completed; drive_fault (an axis latched a drive fault during the run: fault holds its tick, axis and code); unstable (the engine reported instability: unstable holds its tick and warning); collision (a snapshot named a contact of the robot or the arm the plant does not allow: collision holds its tick and the ids the snapshot named). The objects of the other results are null.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "TuningResultV1".
 */
export interface TuningResultV1 {
  schemaVersion: 1;
  documentType: 'tuning-result';
  runId: string;
  status: 'completed' | 'drive_fault' | 'unstable' | 'collision';
  unstable: {
    tick: number;
    warning: string;
  } | null;
  fault: {
    tick: number;
    axisId: DriveAxisId;
    code: string;
  } | null;
  collision: {
    tick: number;
    /**
     * @minItems 1
     * @maxItems 64
     */
    ids: string[];
  } | null;
  /**
   * @minItems 1
   * @maxItems 2
   */
  axisIds: DriveAxisId[];
  signal: BenchSignal;
  seed: number;
  engine: {
    id: string;
    version: string;
    /**
     * The architecture the worker reported (contracts §1): bit identity of two results only means something within one.
     */
    hostArch?: 'arm64' | 'x86_64';
  };
  /**
   * load is the bench load id (for example empty): two runs under different loads are not comparable.
   */
  plant: {
    plantModelDigest: Digest;
    driveModelDigest: Digest;
    controlProfileDigest: Digest;
    load: string;
  };
  effectiveInertia: {
    valueKgM2: number;
    basis: 'mass_matrix_diagonal' | 'wheel_straight_line';
    provenance: 'assumed';
  } | null;
  /**
   * Starting gains from the effective inertia (V07pre, D4): one entry per registered (bandwidthRadS, damping) pair of the health signal catalog's suggestOptions, bandwidth first, computed by the server with the envelope of axisIds[0] (for a wheel bench, the left wheel's). null when the result has no effective inertia. A model-based starting point, not calibrated.
   */
  suggestions?: GainSuggestion[] | null;
  policy: {
    finalWindowS: number;
    settleBand: number;
    holdWindowS: number;
  };
  metrics: {
    [k: string]: ControlMetric;
  };
  /**
   * The durable trace the metrics were computed from: chunks is the number of immutable chunks, sha256 the digest of the recorded stream (the recorder's own hash chain), samples the sample count per axis.
   */
  trace: {
    chunks: number;
    sha256: Digest;
    samples: number;
  };
  accepted: false;
  wheelMeasurement?: {
    quantity: 'wheel_angular_speed';
    inertiaAssumption: 'straight_line_no_slip';
    comparison: {
      tick: number;
      bodyForwardMps: number;
      wheelSurfaceMps: number;
    } | null;
  };
}
/**
 * suggestGains for one (bandwidth, damping) pair: the loop clamped into the envelope, the clamped fields, and no acceleration limit (D4 does not size one).
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "GainSuggestion".
 */
export interface GainSuggestion {
  bandwidthRadS: number;
  damping: number;
  loop: {
    kp: number;
    ki: number;
    kd: number;
    integralLimit: number | null;
    slewLimit: null;
  };
  accelerationLimit: null;
  /**
   * @maxItems 3
   */
  clamped: ('kp' | 'ki' | 'kd')[];
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "FaultReportV1".
 */
export interface FaultReportV1 {
  schemaVersion: 1;
  documentType: 'fault-report';
  runId: string;
  scheduleDigest: Digest;
  oracleDigest: Digest;
  /**
   * @minItems 0
   * @maxItems 16
   */
  entries: {
    entryId: string;
    faultId: string;
    targetId: string;
    params: {
      [k: string]: number;
    };
    durationMs: number;
    injection: {
      appliedTick: number | null;
      endedTick: number | null;
      overriddenBy?: 'WORLD_MOVEMENT_INTERLOCK';
    };
    detection: {
      by: ('drive' | 'controller' | 'arm_program' | 'source') | null;
      code: string | null;
      tick: number | null;
      latencyTicks: number | null;
    };
    firstCommandChangeTick: number | null;
    plantResponse: {
      axisState: string | null;
      axisFault: string | null;
      peakActualSpeedRadS: number | null;
      ticksToRest: number | null;
      baseTravelM: number | null;
    };
    verdict: 'detected_in_time' | 'detected_late' | 'not_detected' | 'not_fired';
  }[];
  /**
   * @minItems 6
   * @maxItems 6
   */
  invariants: {
    id:
      | 'NO_FALSE_SERVE'
      | 'NO_RESEND_AFTER_UNKNOWN'
      | 'NO_MOTION_BEFORE_ENABLED'
      | 'CUSTODY_UNCHANGED'
      | 'LATCH_HELD'
      | 'TORQUE_ZERO_AFTER_TIMEOUT';
    result: 'pass' | 'violated' | 'not_applicable' | 'not_evidenced';
    tick: number | null;
    evidence: string;
  }[];
  /**
   * @minItems 0
   * @maxItems 16
   */
  evidence: ControlArtifactRef[];
  accepted: false;
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "ControlOracleV1".
 */
export interface ControlOracleV1 {
  schemaVersion: 1;
  documentType: 'control-oracle';
  id: string;
  revision: number;
  digest: Digest;
  calibration: 'not_calibrated';
  metricPolicy: {
    finalWindowS: number;
    settleBand: number;
    holdWindowS: number;
  };
  sustainedOscillation: {
    windowRatio: number;
    thresholdRad: number;
    thresholdRadS: number;
  };
  minAmplitudeQuanta: number;
  source: SourceRef;
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "FaultOracleV1".
 */
export interface FaultOracleV1 {
  schemaVersion: 1;
  documentType: 'fault-oracle';
  id: string;
  revision: number;
  digest: Digest;
  calibration: 'not_calibrated';
  /**
   * @minItems 8
   * @maxItems 8
   */
  faults: {
    faultId:
      | 'encoder-dropout'
      | 'motor-weak'
      | 'drive-trip'
      | 'command-delay'
      | 'command-loss'
      | 'grip-weak'
      | 'lidar-noise'
      | 'drive-reset';
    required: boolean;
    detector: ('drive' | 'controller' | 'arm_program' | 'source') | null;
    /**
     * @maxItems 4
     */
    codes: string[];
    deadlineTicks: number | null;
  }[];
  invariantPolicy: {
    holdToleranceRad: number;
    torqueEpsNm: number;
    timeoutSettleTicks: number;
  };
  source: SourceRef;
}
/**
 * A single-axis control bench run (R4): one registered signal on the wheels or on one arm axis, against a user-drafted control profile. The server re-validates everything; cross-field rules (axis against scenario, signal against the axis' mode and limits) live in validateBenchRequest.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "BenchRequestV1".
 */
export interface BenchRequestV1 {
  schemaVersion: 1;
  scenarioId: 'MJ-BENCH-WHEEL' | 'MJ-BENCH-ARM';
  axis: 'wheels' | 'J1' | 'J2' | 'J3' | 'J4' | 'J5' | 'J6' | 'gripper';
  signal: BenchSignal;
  driveExperimentId:
    'drive-ideal-v1' | 'drive-nominal-v1' | 'drive-torque-limited-v1' | 'drive-latency-v1' | 'drive-coarse-encoder-v1';
  controlProfile: ControlProfileV1;
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "BenchTraceIdentity".
 */
export interface BenchTraceIdentity {
  runId: string;
  /**
   * @minItems 1
   * @maxItems 2
   */
  axisIds: DriveAxisId[];
  plantModelDigest: Digest;
  driveModelDigest: Digest;
  controlProfileDigest: Digest;
}
/**
 * One hashed NDJSON record. Optional bodyForwardMps is the chassis forward speed observed at the end of this same wheel tick. Older wheel traces omit it.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "BenchTraceTick".
 */
export interface BenchTraceTick {
  tick: number;
  /**
   * @minItems 1
   * @maxItems 2
   */
  axes: {
    axisId: DriveAxisId;
    /**
     * @minItems 10
     * @maxItems 10
     */
    samples: {
      target: number;
      actual: number;
      feedback: number | null;
      torqueNm: number;
      saturated: boolean;
    }[];
  }[];
  bodyForwardMps?: number;
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "BenchTraceManifest".
 */
export interface BenchTraceManifest {
  schemaVersion: 1;
  documentType: 'drive-trace';
  identity: BenchTraceIdentity;
  dtS: 0.002;
  substeps: 10;
  /**
   * @maxItems 501
   */
  chunks: {
    path: string;
    sha256: Digest;
    bytes: number;
    firstTick: number;
    lastTick: number;
  }[];
  coverage: {
    firstTick: 0;
    lastTick: number;
    complete: boolean;
  };
  /**
   * @maxItems 502
   */
  gaps: {
    firstTick: number;
    lastTick: number;
    reason: string;
  }[];
  terminalReason: string | null;
}
/**
 * A modelled perception error (R4-D22): bias, noise, latency, dropout, view region and maximum age of the estimate a grasp may use. Every value is assumed; this is not camera data.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "PerceptionProfileV1".
 */
export interface PerceptionProfileV1 {
  schemaVersion: 1;
  documentType: 'perception-profile';
  id: string;
  revision: number;
  digest: Digest;
  calibration: 'not_calibrated';
  parameterSource: 'assumed';
  updateEveryTicks: number;
  latencyTicks: number;
  /**
   * @minItems 2
   * @maxItems 2
   */
  biasM: number[];
  /**
   * @minItems 2
   * @maxItems 2
   */
  sigmaM: number[];
  dropoutProbability: number;
  visibleRegionId: string;
  maxAgeTicks: number;
}
/**
 * A bounded recovery table for a failed pick (R4-D27): rules over a closed catalogue of triggers, facts and steps, each with a maximum number of attempts. Every value is assumed. Not a behaviour tree.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "RecoveryPolicyV1".
 */
export interface RecoveryPolicyV1 {
  schemaVersion: 1;
  documentType: 'recovery-policy';
  id: string;
  revision: number;
  digest: Digest;
  calibration: 'not_calibrated';
  parameterSource: 'assumed';
  beliefWaitTicks: number;
  /**
   * @minItems 1
   * @maxItems 8
   */
  rules: {
    id: string;
    /**
     * @minItems 1
     * @maxItems 3
     */
    on: ('GRIP_NOT_ESTABLISHED' | 'BELIEF_UNAVAILABLE' | 'BELIEF_STALE')[];
    /**
     * @maxItems 4
     */
    requires: ('arm_state_fresh' | 'no_unknown_command' | 'cup_on_declared_support' | 'cup_not_between_pads')[];
    /**
     * @minItems 1
     * @maxItems 6
     */
    steps: ('open_gripper' | 'retreat_pick_approach' | 'await_fresh_belief' | 'retry_pick')[];
    maxAttempts: number;
  }[];
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "BeliefObject".
 */
export interface BeliefObject {
  objectId: string;
  kind: 'cup';
  frameId: string;
  /**
   * @minItems 3
   * @maxItems 3
   */
  positionM: number[];
  /**
   * @minItems 3
   * @maxItems 3
   */
  sigmaM: number[];
  observedTick: number;
  publishedTick: number;
  ageTicks: number;
  source: 'ground_truth' | 'pose_estimator_sim';
  valid: boolean;
  reason?: string;
}
/**
 * Scoring record. truthAtObservedTick and errorM exist for evaluation only; they never reach the decision code. Both belief modes estimate x/y; belief z is the declared upright support surface plus half cup height, transformed into arm-base coordinates. ground_truth means exact x/y, not access to truth z.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "BeliefRecord".
 */
export interface BeliefRecord {
  tick: number;
  objectId: string;
  belief: BeliefObject | null;
  dropped: boolean;
  reason?: 'OUT_OF_VIEW' | 'DROPOUT';
  /**
   * @minItems 3
   * @maxItems 3
   */
  truthAtObservedTick: number[];
  /**
   * Euclidean x/y estimator error in metres against truthAtObservedTick. Excludes z, which comes from declared support geometry in both belief modes.
   */
  errorM: number | null;
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "GraspAttempt".
 */
export interface GraspAttempt {
  attemptId: string;
  cupId: string;
  index: number;
  decidedTick: number;
  mode: 'fixed_program' | 'belief_ground_truth' | 'belief_estimated';
  beliefUsed: BeliefObject | null;
  beliefErrorAtCommitM: number | null;
  gates: {
    belief: string;
    region: string;
    ik: string;
    sweep: string;
  };
  /**
   * @maxItems 3
   */
  ikResidual: {
    positionM: number;
    orientationRad: number;
    condition: number;
  }[];
  waypointsRad?: {
    /**
     * @minItems 1
     * @maxItems 16
     */
    pickApproach?: number[];
    /**
     * @minItems 1
     * @maxItems 16
     */
    pick?: number[];
    /**
     * @minItems 1
     * @maxItems 16
     */
    lift?: number[];
  };
  outcome: 'lifted' | 'grip_not_established' | 'cup_dropped' | 'refused' | 'unknown';
  refusal?: string;
  /**
   * The tick this record was written (plan, commit or outcome); decidedTick stays the tick of the decision.
   */
  recordedTick?: number;
  /**
   * Which step of the attempt this record is.
   */
  stage?: 'plan' | 'commit' | 'outcome';
}
/**
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "RecoveryStep".
 */
export interface RecoveryStep {
  stepId: string;
  attemptId: string;
  rule: string;
  action: string;
  commandId: string;
  recordedTick: number;
  completedTick: number | null;
  result: string;
}
/**
 * Manifest of the durable belief, attempts and recovery streams of one run: immutable hashed chunks, coverage and an explicit terminal reason.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "BeliefEvidenceManifestV1".
 */
export interface BeliefEvidenceManifestV1 {
  schemaVersion: 1;
  documentType: 'belief-evidence';
  identity: {
    runId: string;
    bootId: string;
    sceneDigest: Digest;
    perceptionProfileDigest: Digest | null;
    recoveryPolicyDigest: Digest | null;
    graspMode: 'belief_ground_truth' | 'belief_estimated';
    graspProgramDigest?: Digest;
    seed: number;
  };
  /**
   * @minItems 1
   * @maxItems 3
   */
  streams: {
    stream: 'belief' | 'attempts' | 'recovery';
    /**
     * @maxItems 512
     */
    chunks: {
      path: string;
      sha256: Digest;
      bytes: number;
    }[];
    /**
     * How many records the published chunks of this stream hold; a reader compares it with what it read.
     */
    records?: number;
  }[];
  coverage: {
    lastTick: number;
    complete: boolean;
  };
  /**
   * @maxItems 64
   */
  gaps: {
    firstTick: number;
    lastTick: number;
    reason: string;
  }[];
  terminalReason: string | null;
}
/**
 * What an identification run may change and by how much, declared and hashed BEFORE the fit (R4-C §4, contracts §8): the registered parameters with their start and bounds, the channels and weights of the objective, and the optimizer settings that make the run deterministic. At most 12 parameters (the validator names the limit).
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "IdentificationPlanV1".
 */
export interface IdentificationPlanV1 {
  schemaVersion: 1;
  documentType: 'identification-plan';
  id: string;
  revision: number;
  digest: Digest;
  datasetDigest: Digest;
  baseDriveModelDigest: Digest;
  plantModelDigest: Digest;
  controlProfileDigest: Digest;
  benchBinding: Digest;
  /**
   * @minItems 1
   * @maxItems 64
   */
  parameters: {
    path: string;
    initial: number;
    lower: number;
    upper: number;
    unit: string;
  }[];
  objective: {
    /**
     * @minItems 1
     * @maxItems 8
     */
    channels: string[];
    weights: {
      [k: string]: number;
    };
  };
  optimizer: {
    method: 'bounded_least_squares';
    maxIterations: number;
    tolerance: number;
    relativeStep: number;
    maxJacobianCondition: number;
  };
}
/**
 * The outcome of one identification run (R4-C, V15): which parameters were fitted from which dataset within which declared bounds, how the fit ended, how it did on the held-out validation split, and which new model revisions it produced. A record that did not pass, touched a bound, did not converge, could not separate its parameters, or came from synthetic data / the tool self-test produces nothing. Always accepted:false.
 *
 * This interface was referenced by `Navigation2DContracts`'s JSON-Schema
 * via the `definition` "CalibrationRecordV1".
 */
export interface CalibrationRecordV1 {
  schemaVersion: 1;
  documentType: 'calibration-record';
  digest: Digest;
  planDigest: Digest;
  datasetDigest: Digest;
  configDigest: Digest;
  baseDriveModelDigest: Digest;
  fitDigest: Digest;
  sourceKind: 'measured' | 'synthetic';
  /**
   * @minItems 1
   * @maxItems 64
   */
  fitted: {
    path: string;
    value: number;
    atBound: boolean;
    unit: string;
    standardError: number | null;
  }[];
  convergence: {
    iterations: number;
    converged: boolean;
    objectiveInitial: number;
    objectiveFinal: number;
    /**
     * null: the Jacobian is singular (unbounded condition number); JSON cannot carry Infinity.
     */
    jacobianCondition: number | null;
  };
  validation: CalibrationResult;
  domain: {
    [k: string]: {
      min: number;
      max: number;
    };
  };
  /**
   * @maxItems 8
   */
  produced: {
    document: 'drive_model' | 'arm_physics';
    id: string;
    revision: number;
    digest: Digest;
  }[];
  reasonCodes: (
    | 'SYNTHETIC_DATA'
    | 'TOOL_SELF_TEST'
    | 'NOT_CONVERGED'
    | 'PARAMETER_AT_BOUND'
    | 'IDENTIFIABILITY_POOR'
    | 'VALIDATION_FAILED'
    | 'CONFIG_DIGEST_MISMATCH'
    | 'PREDICTION_FAILED'
  )[];
  toolSelfTest: boolean;
  accepted: false;
}
