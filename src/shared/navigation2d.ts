// Synced from source packages/contracts/generated/navigation2d.ts @ ddc18dca876fc41e30dc88028dd8365effe32d0e (sha256 6680b00433419d2058e069c865648cff9faa77040bde216bccdb8744a63d1f4a). Run node scripts/sync-engineering-contracts.mjs; do not edit.
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
        | Sim3DSnapshotV1
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
  /**
   * @minItems 0
   * @maxItems 1
   */
  arms?: Sim3DArmStateV1[];
  /**
   * @minItems 0
   * @maxItems 8
   */
  props?: {
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
  physics?: PhysicsTickRecord;
  worldStep?: {
    workerPid: number;
    modelCount: 1;
    physicsSubsteps: number;
    primingSubsteps: 10;
    nq: number;
    nv: number;
    nbody: number;
    ngeom: number;
  };
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
