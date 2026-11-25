/* Mirrored generated source verification contracts; schemas checked against the runtime pin by scripts/check-verification-contracts.mjs. */
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

