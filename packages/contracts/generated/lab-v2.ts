/* Generated from the Lab v2 schemas. Run pnpm contracts:generate; do not edit. */
/**
 * arm.command.v1: the local bridge envelope of the arm controller. `command` is the mekoniq.cell-command.v2 authority envelope (the only command authority; this schema adds owner token, lease, controller epoch and the profile/model the caller expects). Exactly one of command/acquire/release/renew/reconcile. Transport-internal (Unix socket on the IPC); never exposed under /lab/v2. Exactly one of command/acquire/release/renew/reconcile/local/revoke is present (checked by the bridge and the adapter; Ajv strict mode cannot express it as oneOf/required). `local` (jog/home) and `revoke` exist for the local operator owner only; the arbiter refuses them from any other owner. Optional simScene is negotiated by simulation_scene.v1 and a pinned acquire.simulationScene; exactly one shape including simScene.
 */
export interface ArmCommand {
  schemaVersion: 1;
  kind: 'arm.command.v1';
  machineId: string;
  controllerEpoch: number;
  owner: {
    token: string;
    actor: 'local_operator' | 'lab_simulation' | 'authorized_cell_job';
  };
  leaseId: string;
  expected: {
    profileHash: string;
    modelManifestSha256: string;
  };
  command?: CellCommand;
  acquire?: {
    actor: string;
    leaseMs: number;
    simulationScene?: {
      runId: string;
      worldRevision: string;
    };
  };
  release?: {
    leaseId: string;
  };
  renew?: {
    leaseId: string;
  };
  reconcile?: {
    commandId: string;
  };
  local?: {
    action: 'jog_start' | 'jog_stop' | 'home_all' | 'estop_reset' | 'machine_on';
    joint: number | null;
    velocityDegS: number | null;
  };
  revoke?: {
    actor: string;
    reason: string;
  };
  /**
   * Client request correlation id echoed by the reply; a late reply never answers another request.
   */
  requestId?: string;
  simScene?: {
    runId: string;
    worldRevision: string;
    sceneSeq: string;
    transferId: string;
    commandId: string;
    cup: {
      id: string;
      present: boolean;
      /**
       * @minItems 3
       * @maxItems 3
       */
      positionM: number[];
    };
    receiver: {
      robotId: string;
      slot: number;
      stationary: boolean;
      localizationValid: boolean;
      poseErrorM: number;
      trayPresent: boolean;
    } | null;
    /**
     * @maxItems 3
     */
    faults: ('missing_cup' | 'gripper_stuck' | 'drop_cup')[];
  };
  barrier?: {
    barrierId: string;
    nonce: string;
    bootId: string;
    afterSeq: string;
    state: 'stationary' | 'paused';
  };
}

/**
 * What the arm bridge publishes: arm.status.v1 (authoritative controller state, commanded and actual joints apart, SI on the wire), arm.event.v1 (lifecycle/owner/fault events; a command observation is the mekoniq.cell-observation.v2 payload) and arm.reply.v1 (the answer to one arm.command.v1). An accepted reply is never a completion.
 */
export type ArmObservation =
  | {
      schemaVersion: 1;
      machineId: string;
      controllerEpoch: number;
      bootId: string;
      seq: string;
      observedAt: string;
      monotonicNs: string;
      kind: 'arm.status.v1';
      owner: {
        kind: 'none' | 'local_operator' | 'lab_simulation' | 'authorized_cell_job';
        actor: string | null;
        leaseId: string | null;
      };
      task: {
        state: 'estop' | 'off' | 'on';
        mode: 'manual' | 'auto' | 'mdi' | 'unknown';
        interp: 'idle' | 'running' | 'paused' | 'unknown';
        homed: boolean;
        fault: string | null;
      };
      joints: {
        /**
         * @minItems 6
         * @maxItems 6
         */
        names: string[];
        commandedRad: number[] | null;
        actualRad: number[] | null;
        velocityRadS: number[] | null;
        followingErrorRad: number[] | null;
        source: 'controller_sim' | 'hardware' | 'unknown';
      };
      tcp: {
        frameId: string;
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
      program: {
        id: string | null;
        hash: string | null;
        state: 'none' | 'staged' | 'running' | 'paused' | 'done' | 'unknown';
      };
      units: {
        source: {
          length: 'inch' | 'mm' | 'm';
          angle: 'deg' | 'rad';
        };
        wire: 'SI';
      };
      freshness: {
        staleMs: number;
        quality: 'valid' | 'stale' | 'unknown';
      };
      /**
       * @maxItems 20
       */
      reasonCodes: string[];
      reconcileRequired: boolean;
      /**
       * @maxItems 50
       */
      unknownCommands: string[];
      /**
       * @maxItems 10
       */
      capabilities?: ('simulation_scene.v1' | 'correlated_barrier.v1')[];
      virtualGrip?: {
        state: 'open' | 'held' | 'empty' | 'fault' | 'unknown' | 'released' | 'lost';
        closeOutput: boolean | null;
        producer: 'linuxcnc_virtual_grip';
        fidelity: 'modeled';
        /**
         * @maxItems 10
         */
        reasonCodes: string[];
      };
      inventory?: {
        controllerVersion: string;
        pythonVersion: string;
        platform: string;
        architecture: string;
        bridgeCodeSha256: string;
        profileSha256: string;
      };
    }
  | {
      schemaVersion: 1;
      machineId: string;
      controllerEpoch: number;
      bootId: string;
      seq: string;
      observedAt: string;
      monotonicNs: string;
      kind: 'arm.event.v1';
      event:
        | 'bridge_start'
        | 'owner_acquired'
        | 'owner_released'
        | 'owner_revoked'
        | 'lease_expired'
        | 'bridge_restart'
        | 'controller_restart'
        | 'command_accepted'
        | 'command_completed'
        | 'command_failed'
        | 'command_rejected'
        | 'outcome_unknown'
        | 'fault'
        | 'reconcile_required'
        | 'reconciled'
        | 'error_channel'
        | 'virtual_grip';
      commandId: string | null;
      observation: CellObservation | null;
      /**
       * @maxItems 20
       */
      reasonCodes: string[];
      detail: string | null;
      /**
       * Transfer/grip evidence the controller can state (sensor capability permitting); absent sensors give null fields, never a claim.
       */
      evidence: {
        [k: string]: any;
      } | null;
    }
  | {
      schemaVersion: 1;
      kind: 'arm.reply.v1';
      commandId: string | null;
      status: 'accepted' | 'rejected' | 'conflict' | 'outcome_unknown';
      lifecycle: 'accepted_not_completed' | 'immediate' | 'none';
      duplicate: boolean;
      /**
       * @maxItems 20
       */
      reasonCodes: string[];
      token?: string | null;
      leaseId?: string | null;
      expiresAtMs?: number | null;
      outcome?: {
        status: 'accepted' | 'running' | 'completed' | 'failed' | 'unknown' | 'not_found';
        evidence: {
          [k: string]: any;
        };
      } | null;
      requestId?: string | null;
      /**
       * @maxItems 10
       */
      capabilities?: ('simulation_scene.v1' | 'correlated_barrier.v1')[];
    };

export interface AssetRevision {
  schemaVersion: 2;
  id: string;
  revision: number;
  contentHash: string;
  hashAlgorithm: 'sha256-canonical-json-v1';
  kind: 'amr' | 'arm' | 'coffee_machine' | 'fixture' | 'cup' | 'sensor' | 'tool';
  visual: {
    contentHash: string;
    mediaType: 'model/gltf-binary' | 'model/gltf+json' | 'application/x-mekoniq-geometry';
  } | null;
  collision: {
    contentHash: string;
    mediaType: 'model/gltf-binary' | 'model/gltf+json' | 'application/x-mekoniq-geometry';
  } | null;
  /**
   * @minItems 1
   * @maxItems 64
   */
  frames: {
    id: string;
    parentId: string | null;
    /**
     * @minItems 3
     * @maxItems 3
     */
    translationM: number[];
    /**
     * @minItems 4
     * @maxItems 4
     */
    quaternionXyzw: number[];
  }[];
  /**
   * @maxItems 200
   */
  geometry: (
    | {
        kind: 'box';
        frameId: string;
        /**
         * @minItems 3
         * @maxItems 3
         */
        sizeM: number[];
      }
    | {
        kind: 'cylinder';
        frameId: string;
        radiusM: number;
        heightM: number;
      }
    | {
        kind: 'sphere';
        frameId: string;
        radiusM: number;
      }
  )[];
  kinematics?: {
    convention: 'modified_dh' | 'urdf';
    jointCount: number;
  };
  inertial?: {
    massKg: number;
  };
  /**
   * @maxItems 20
   */
  sensorRefs?: string[];
  /**
   * @maxItems 20
   */
  toolRefs?: string[];
  /**
   * @minItems 1
   * @maxItems 200
   */
  provenance: {
    parameter: string;
    source: 'measured' | 'vendor_spec' | 'vendor_cad' | 'assumed' | 'illustrative';
    reference?: string;
    license?: string;
  }[];
}

export type CellCommand =
  | {
      commandId: string;
      runId: string;
      deviceId: string;
      controlEpoch: number;
      expiresAt: string;
      recipeRevision: number | null;
      programRef: {
        id: string;
        hash: string;
      } | null;
      capability: 'stage_program';
      payloadHash: string;
      payload: {
        profileId: string;
      };
    }
  | {
      commandId: string;
      runId: string;
      deviceId: string;
      controlEpoch: number;
      expiresAt: string;
      recipeRevision: number | null;
      programRef: {
        id: string;
        hash: string;
      } | null;
      capability: 'start_job';
      payloadHash: string;
      payload: {
        jobId: string;
      };
    }
  | {
      commandId: string;
      runId: string;
      deviceId: string;
      controlEpoch: number;
      expiresAt: string;
      recipeRevision: number | null;
      programRef: {
        id: string;
        hash: string;
      } | null;
      capability: 'pause_job';
      payloadHash: string;
      payload: {
        jobId: string;
      };
    }
  | {
      commandId: string;
      runId: string;
      deviceId: string;
      controlEpoch: number;
      expiresAt: string;
      recipeRevision: number | null;
      programRef: {
        id: string;
        hash: string;
      } | null;
      capability: 'resume_job';
      payloadHash: string;
      payload: {
        jobId: string;
      };
    }
  | {
      commandId: string;
      runId: string;
      deviceId: string;
      controlEpoch: number;
      expiresAt: string;
      recipeRevision: number | null;
      programRef: {
        id: string;
        hash: string;
      } | null;
      capability: 'cancel_job';
      payloadHash: string;
      payload: {
        jobId: string;
      };
    }
  | {
      commandId: string;
      runId: string;
      deviceId: string;
      controlEpoch: number;
      expiresAt: string;
      recipeRevision: number | null;
      programRef: {
        id: string;
        hash: string;
      } | null;
      capability: 'query_outcome';
      payloadHash: string;
      payload: {
        targetCommandId: string;
      };
    }
  | {
      commandId: string;
      runId: string;
      deviceId: string;
      controlEpoch: number;
      expiresAt: string;
      recipeRevision: number | null;
      programRef: {
        id: string;
        hash: string;
      } | null;
      capability: 'brew';
      payloadHash: string;
      payload: {
        recipeId: string;
        cupId: string;
      };
    }
  | {
      commandId: string;
      runId: string;
      deviceId: string;
      controlEpoch: number;
      expiresAt: string;
      recipeRevision: number | null;
      programRef: {
        id: string;
        hash: string;
      } | null;
      capability: 'dispense';
      payloadHash: string;
      payload: {
        resource: 'water' | 'ice' | 'milk';
        amount: string;
        unit: 'm3' | 'kg';
      };
    };

export interface CellObservation {
  schemaVersion: 2;
  commandId: string;
  deviceId: string;
  controlEpoch: number;
  payloadHash: string;
  bootId: string;
  seq: string;
  result: 'accepted' | 'completed' | 'failed' | 'rejected' | 'outcome_unknown';
  observedAt: string | null;
  /**
   * @maxItems 20
   */
  reasonCodes: string[];
  /**
   * Recipe revision the device executed, when it can state it; must equal the job's frozen revision.
   */
  recipeRevision?: number | null;
}

export interface CoffeeRecipe {
  schemaVersion: 2;
  id: string;
  revision: number;
  hash: string;
  outputType: string;
  cupType: string;
  /**
   * @minItems 1
   * @maxItems 50
   */
  steps: {
    id: string;
    kind: 'grind' | 'brew' | 'add_ice' | 'add_milk' | 'add_water' | 'stir' | 'clean';
    target: {
      amount: string;
      tolerance: string;
      unit: 'kg' | 'm3' | 'K' | 's';
      provenance: 'measured' | 'vendor_spec' | 'vendor_cad' | 'assumed' | 'illustrative';
    } | null;
    /**
     * @maxItems 10
     */
    requires: string[];
    timeoutMs: number;
  }[];
  /**
   * @maxItems 20
   */
  resources: {
    resourceId: string;
    kind: 'water' | 'coffee_beans' | 'ice' | 'milk' | 'cup' | 'machine';
    requiredAmount: {
      amount: string;
      tolerance: string;
      unit: 'kg' | 'm3' | 'K' | 's';
      provenance: 'measured' | 'vendor_spec' | 'vendor_cad' | 'assumed' | 'illustrative';
    } | null;
    /**
     * @minItems 1
     * @maxItems 50
     */
    allocations?: {
      stepId: string;
      amount: string;
    }[];
  }[];
  recovery: {
    onTimeout: 'hold_and_reconcile' | 'quarantine';
    autoRetry: false;
  };
  policies?: {
    cup?: {
      revision: number;
      provenance: 'measured' | 'vendor_spec' | 'assumed' | 'illustrative';
      capacityM3: string;
      headspaceM3: string;
      iceVolumeM3PerKg: string;
    };
    milk?: {
      revision: number;
      provenance: 'measured' | 'vendor_spec' | 'assumed' | 'illustrative';
      maxOpenMs: number;
      minTemperatureK: string;
      maxTemperatureK: string;
      temperatureMaxAgeMs: number;
    };
    measurement?: {
      revision: number;
      provenance: 'measured' | 'vendor_spec' | 'assumed' | 'illustrative';
      maxTargetMultiplier: string;
    };
  };
}

export type LabActionV2 =
  | {
      actionId: string;
      expectedRevision: number;
      kind: 'start';
      payload: {};
    }
  | {
      actionId: string;
      expectedRevision: number;
      kind: 'pause';
      payload: {};
    }
  | {
      actionId: string;
      expectedRevision: number;
      kind: 'resume';
      payload: {};
    }
  | {
      actionId: string;
      expectedRevision: number;
      kind: 'cancel';
      payload: {};
    }
  | {
      actionId: string;
      expectedRevision: number;
      kind: 'step';
      payload: {
        ticks: number;
        pace?: {
          factor: 1 | 4 | 16 | 64;
        };
      };
    }
  | {
      actionId: string;
      expectedRevision: number;
      kind: 'confirm';
      payload: {
        subjectId: string;
        confirmationType: string;
        actorProvenance?: 'human' | 'scripted';
      };
    }
  | {
      actionId: string;
      expectedRevision: number;
      kind: 'injectFault';
      payload: {
        faultId: string;
        entityId?: string;
      };
    }
  | {
      actionId: string;
      expectedRevision: number;
      kind: 'reconcile';
      payload: {
        subjectId: string;
      };
    }
  | {
      actionId: string;
      expectedRevision: number;
      kind: 'restoreCup';
      payload: {
        subjectId: string;
      };
    };

export interface ArmCollisionEvidenceRecord {
  id: 'ARM03';
  result: 'pass' | 'fail' | 'not_run';
  /**
   * @maxItems 1000
   */
  reasonCodes: string[];
  engine: string | null;
  modelRevision: string;
  geometryRevision: string | null;
  worldRevision: {
    id: string;
    revision: number;
    hash: string;
  };
  assetRef: {
    [k: string]: any;
  };
  trace: {
    samples: number;
    fromTick: number;
    toTick: number;
  } | null;
  /**
   * @maxItems 10000
   */
  attachments: {
    cupId: string;
    fromTick: number;
    toTick: number;
  }[];
  /**
   * @maxItems 10000
   */
  allowedContacts: {
    /**
     * @minItems 2
     * @maxItems 2
     */
    pair: string[];
    phase: 'grasp' | 'release';
    fromTick: number;
    toTick: number;
    revision: number;
  }[];
  /**
   * Present only when the pairs are static for the whole trace (a contact plant): says so, and what phase and revision mean then.
   */
  allowedContactsNote?: string;
  method: {
    kind: string;
    bound: string;
    toleranceM: number;
    maxDepth: number;
  } | null;
  coverage: {
    intervals: number;
    evaluations: number;
    uncertain: number;
    allowedContactsApplied: number;
  } | null;
  /**
   * @maxItems 10000
   */
  colliding: {
    /**
     * @minItems 2
     * @maxItems 2
     */
    pair: string[];
    reason: string;
    fraction: number | null;
    clearanceM: number | null;
    interval: {
      fromTick: number;
      toTick: number;
    };
  }[];
  provenance: 'geometric_checker';
  fidelity: 'modeled';
}

export interface LabEvidenceV2 {
  schemaVersion: 2;
  id: string;
  /**
   * @minItems 1
   * @maxItems 50
   */
  requirementIds: string[];
  scenarioId: string | null;
  runId: string | null;
  inputsManifest: {
    projectHash: string;
    sourceCommit: string;
    schemaHash: string;
    seed: number | null;
    mode: 'mock' | 'simulation' | 'hardware';
    access: 'simulated' | 'shadow' | 'hil' | 'live';
    /**
     * @maxItems 8
     */
    backends: string[];
  };
  result: 'pass' | 'fail' | 'blocked_external' | 'not_run';
  /**
   * @maxItems 500
   */
  assertions: {
    id: string;
    passed: boolean;
    detail?: string;
  }[];
  /**
   * @maxItems 200
   */
  artifacts: {
    name: string;
    sha256: string;
  }[];
  actualFidelity: 'business' | 'modeled' | 'physics_sim' | 'hardware';
  signer: {
    id: string;
    trust: 'local_unsigned' | 'authorized_signer';
  } | null;
}

export interface FaultScheduleEntry {
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
}

export interface LabProjectV2 {
  schemaVersion: 2;
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
  /**
   * @maxItems 200
   */
  entities: {
    id: string;
    kind: 'amr' | 'arm' | 'coffee_machine' | 'cup_station';
    assetRef: {
      id: string;
      revision: number;
      contentHash: string;
    };
    /**
     * @maxItems 50
     */
    recipeRefs?: {
      id: string;
      revision: number;
      hash: string;
    }[];
    /**
     * Illustrative mock AMR speed limit in metres per second; fixed run input.
     */
    speedLimitMps?: number;
  }[];
  world: {
    id: string;
    revision: number;
    width: number;
    height: number;
    /**
     * @maxItems 200
     */
    points: {
      id: string;
      name: string;
      kind: 'table' | 'kitchen' | 'parking' | 'dock' | 'coffee_pickup';
      x: number;
      y: number;
    }[];
    /**
     * @maxItems 200
     */
    handoffPoints?: {
      id: string;
      name: string;
      kind: 'table' | 'kitchen' | 'parking' | 'dock' | 'coffee_pickup';
      /**
       * @minItems 3
       * @maxItems 3
       */
      position: number[];
      yawRad: number | null;
    }[];
    /**
     * @maxItems 200
     */
    obstacles: {
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }[];
  };
  /**
   * Optional illustrative arm scene: SI map-from-base pose, normalized xyzw quaternion, and explicit vertical extrusions above map z=0. No calibrated or physical collision claim.
   */
  armCollisionProfile?: {
    schemaVersion: 1;
    id: string;
    revision: number;
    units: 'SI';
    provenance: 'illustrative';
    reference: string;
    modelId: string;
    modelRevision: string;
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
    fixtureHeightM: number;
    robotHeightM: number;
  };
  /**
   * @maxItems 100
   */
  faultSchedule?: FaultScheduleEntry[];
}

export interface LabRunSnapshotV2 {
  schemaVersion: 2;
  id: string;
  mode: 'mock' | 'simulation' | 'hardware';
  access: 'simulated' | 'shadow' | 'hil' | 'live';
  backendSetId: string;
  /**
   * @minItems 1
   * @maxItems 8
   */
  backends: string[];
  status: 'ready' | 'running' | 'paused' | 'awaiting_confirmation' | 'completed' | 'cancelled' | 'needs_attention';
  runRevision: number;
  eventCursor: string | null;
  telemetryCursor: string | null;
  fidelity: 'business' | 'modeled' | 'physics_sim' | 'hardware';
  ageMs: number | null;
  sourceCommit: string;
  scenarioId: string;
  scenarioRevision: number;
  seed: number;
  faultScheduleHash?: string;
}
/**
 * This interface was referenced by `LabRunSnapshotV2`'s JSON-Schema
 * via the `definition` "CreateRunRequest".
 */
export interface CreateRunRequest {
  project?: {
    [k: string]: any;
  };
  scenarioId: string;
  scenarioRevision: number;
  seed: number;
  mode: 'mock' | 'simulation' | 'hardware';
  backendSetId: string;
  access: 'simulated' | 'shadow' | 'hil' | 'live';
  runtimeIdentity: {
    sourceCommit: string;
    schemaHash: string;
  };
  engineeringRef?: {
    bundleDigest: string;
    projectDigest: string;
  };
}

export interface RunVerification {
  schemaVersion: 1;
  execution: 'not_run' | 'ran';
  result: 'pass' | 'fail' | 'not_run';
  /**
   * @maxItems 1000
   */
  blockers: string[];
  target: 'mac-mock' | 'linux-vm-sim' | 'linux-amd64-sim';
  /**
   * @maxItems 100
   */
  aspects: {
    name: string;
    producer: string;
    fidelity: 'mock' | 'controller_sim' | 'physics_sim' | 'modeled';
    artifactSha256: string;
  }[];
  arm: ArmCollisionEvidenceRecord | null;
  /**
   * @maxItems 10000
   */
  transfers: TransferObservation[];
  /**
   * @maxItems 10000
   */
  artifacts: {
    path: string;
    sha256: string;
    bytes: number;
  }[];
  /**
   * @maxItems 10000
   */
  armTickMap?: {
    sampleTick: number;
    runTick: number;
    entityId?: string;
    bootId?: string;
    seq?: string;
  }[];
}

/**
 * This interface was referenced by `TransferObservation`'s JSON-Schema
 * via the `definition` "SimProducer".
 */
export type SimProducer = 'mock_arm' | 'mock_amr' | 'linuxcnc_virtual_grip' | 'gazebo_tray';

export interface TransferObservation {
  observationId: string;
  runId: string;
  cupId: string;
  transferId: string;
  commandId: string;
  deviceId: string;
  observerId: string;
  bootId: string;
  clockDomain: string;
  payloadHash: string;
  controlEpoch: number;
  seq: string;
  producer: SimProducer;
  fidelity: 'modeled';
  phase: 'grasp' | 'release' | 'receive' | 'lost';
  parent: string | null;
  grip: {
    closed: boolean;
    objectPresent: boolean;
  } | null;
  observedMonotonicNs: string;
  receivedMonotonicNs: string;
  quality: 'valid' | 'stale' | 'unknown';
  /**
   * Optional actual/modeled lift observation. Grasp alone projects attachment; arm custody confirmation requires true.
   */
  liftPoseReached?: boolean;
}
/**
 * This interface was referenced by `TransferObservation`'s JSON-Schema
 * via the `definition` "CorrelatedTransferEvidence".
 */
export interface CorrelatedTransferEvidence {
  giver: TransferObservation;
  receiver: TransferObservation;
  dock: {
    robotId: string;
    slot: number;
    bootId: string;
    stationary: boolean;
    localizationValid: boolean;
    errorM: number;
    receivedMonotonicNs: string;
  };
}
/**
 * This interface was referenced by `TransferObservation`'s JSON-Schema
 * via the `definition` "CupPhysicalState".
 */
export interface CupPhysicalState {
  cupId: string;
  parent: string | null;
  status: 'known' | 'unknown' | 'lost';
  lastObservationId: string;
}

export interface TwinSampleV2 {
  schemaVersion: 2;
  runId: string;
  entityId: string;
  providerId: string;
  bootId: string;
  seq: string;
  simTimeNs: string | null;
  observedAt: string | null;
  receivedMonotonicNs: string;
  frameId: string;
  origin: 'mock' | 'controller_sim' | 'physics_sim' | 'hardware';
  quality: 'valid' | 'stale' | 'unknown' | 'invalid';
  /**
   * @maxItems 20
   */
  reasonCodes: string[];
  commanded: TwinAmrState | TwinAmrGoal | TwinArmState | TwinCoffeeCellState | TwinCupState | null;
  observed: TwinAmrState | TwinAmrGoal | TwinArmState | TwinCoffeeCellState | TwinCupState | null;
  estimated: TwinAmrState | TwinAmrGoal | TwinArmState | TwinCoffeeCellState | TwinCupState | null;
  causationId: string | null;
}
/**
 * AMR base_link in frameId (map): metres, radians; commanded carries the goal, observed the pose.
 *
 * This interface was referenced by `TwinSampleV2`'s JSON-Schema
 * via the `definition` "TwinAmrState".
 */
export interface TwinAmrState {
  xM: number;
  yM: number;
  yawRad: number;
  linearMps?: number;
  angularRadps?: number;
  moving?: boolean;
  hold?: string | null;
  goalCommandId?: string | null;
  goalState?: string | null;
  batteryRatio?: number | null;
  /**
   * Height of the base origin above the floor; only a 3D plant reports it.
   */
  zM?: number;
  rollRad?: number;
  pitchRad?: number;
}
/**
 * AMR commanded goal: command id and state, optional target in metres.
 *
 * This interface was referenced by `TwinSampleV2`'s JSON-Schema
 * via the `definition` "TwinAmrGoal".
 */
export interface TwinAmrGoal {
  goalCommandId: string;
  goalState: string;
  targetXM?: number;
  targetYM?: number;
}
/**
 * Six-joint arm in frameId (arm_base): radians, metres.
 *
 * This interface was referenced by `TwinSampleV2`'s JSON-Schema
 * via the `definition` "TwinArmState".
 */
export interface TwinArmState {
  /**
   * @minItems 6
   * @maxItems 6
   */
  jointsRad: number[];
  /**
   * @minItems 6
   * @maxItems 6
   */
  jointVelocityRadps?: number[];
  /**
   * @minItems 6
   * @maxItems 6
   */
  followingErrorRad?: number[];
  /**
   * @minItems 3
   * @maxItems 3
   */
  tcpM?: number[];
  homed?: boolean;
  limitsOk?: boolean;
  gripper?: 'open' | 'closed' | 'unknown';
  virtualGrip?: {
    state: 'open' | 'held' | 'empty' | 'fault' | 'unknown' | 'released' | 'lost';
    closeOutput: boolean | null;
    producer: 'linuxcnc_virtual_grip';
    fidelity: 'modeled';
    /**
     * @maxItems 10
     */
    reasonCodes: string[];
  };
  gripperOpeningM?: number;
}
/**
 * Coffee cell process state; quantities stay in the domain (exact decimals), temperature in kelvin.
 *
 * This interface was referenced by `TwinSampleV2`'s JSON-Schema
 * via the `definition` "TwinCoffeeCellState".
 */
export interface TwinCoffeeCellState {
  cycleState: string;
  cupPresent: boolean | null;
  machineStatus?: string | null;
  jobId?: string | null;
  stepId?: string | null;
  temperatureK?: number | null;
  cleaning?: string | null;
}
/**
 * Cup attachment parent (exactly one owner at a time).
 *
 * This interface was referenced by `TwinSampleV2`'s JSON-Schema
 * via the `definition` "TwinCupState".
 */
export interface TwinCupState {
  ownerKind: 'cell' | 'arm' | 'robot' | 'customer' | 'quarantine' | 'unknown';
  ownerId: string | null;
  /**
   * @minItems 3
   * @maxItems 3
   */
  positionM?: number[];
  /**
   * @minItems 4
   * @maxItems 4
   */
  quaternionXyzw?: number[];
  restingOn?: string | null;
}
