/* Generated from schemas/wire.schema.json. Run pnpm contracts:generate; do not edit. */

export type WireContract =
  | Money
  | Scope
  | AggregateRef
  | JournalKind
  | DomainEvent
  | CommandEnvelope
  | Snapshot
  | CommandResult
  | Decision
  | Mutation
  | EffectIntent
  | CommitBatch
  | CommitReceipt
  | JournalEntry
  | RobotCommand
  | SyncAckEntry
  | SyncAck
  | OfflineGrant
  | SignedOfflineGrant
  | OwnershipGrant
  | AssetManifest
  | SettlementGrantCapability
  | SettlementGrant
  | GrantReturnProof
  | AuthorityProvision
  | SignedAuthorityProvision
  | PairingGrant
  | SignedPairingGrant;
export type JournalKind = 'intent' | 'accepted_fact' | 'observation' | 'historical_import';
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | {
      [k: string]: JsonValue;
    };
export type Decision =
  | {
      ok: true;
      events: DomainEvent[];
      value: JsonObject;
    }
  | {
      ok: false;
      code: string;
      details?: JsonObject;
    };

export interface Money {
  currency: string;
  minor: string;
}
export interface Scope {
  organizationId: string;
  venueId: string;
}
export interface AggregateRef {
  organizationId: string;
  venueId: string;
  kind: string;
  id: string;
}
export interface DomainEvent {
  type: string;
  data: JsonObject;
}
export interface JsonObject {
  [k: string]: JsonValue;
}
export interface CommandEnvelope {
  schemaVersion: 1;
  organizationId: string;
  venueId: string;
  operationId: string;
  type: string;
  actorRef: string;
  deviceId: string;
  deviceEpoch: string;
  coordinatorEpoch: number;
  expectedVersion?: number;
  policyRevision: number;
  occurredAt: string;
  recordedAt: string;
  payload: JsonObject;
  payloadHash: string;
}
export interface Snapshot {
  ref: AggregateRef;
  version: number;
  state: JsonObject;
}
export interface CommandResult {
  status: 'accepted' | 'rejected' | 'pending' | 'unknown';
  code?: string;
  value: JsonObject;
  duplicate: boolean;
  ack: 'none' | 'local' | 'venue' | 'cloud';
  operationId: string;
}
export interface Mutation {
  ref: AggregateRef;
  expectedVersion: number;
  newState: JsonObject;
}
export interface EffectIntent {
  id: string;
  type: string;
  payload: JsonObject;
}
export interface CommitBatch {
  command: CommandEnvelope;
  expectedAuthority: {
    coordinatorEpoch: number;
    policyRevision: number;
  };
  mutations: Mutation[];
  events: DomainEvent[];
  effects: EffectIntent[];
  result: CommandResult;
  expectedReads?: {
    ref: AggregateRef;
    expectedVersion: number;
  }[];
}
export interface CommitReceipt {
  result: CommandResult;
  duplicate: boolean;
  sequence: string;
  payloadHash: string;
  committed: true;
}
export interface JournalEntry {
  schemaVersion: 1;
  entryId: string;
  operationId: string;
  organizationId: string;
  venueId: string;
  deviceId: string;
  deviceEpoch: string;
  sequence: string;
  coordinatorEpoch: number;
  aggregateType: string;
  aggregateId: string;
  expectedVersion: number;
  resultingVersion: number;
  kind: JournalKind;
  occurredAt: string;
  recordedAt: string;
  timezone: string;
  businessDate: string;
  clockConfidence: 'trusted' | 'uncertain' | 'unknown';
  actorRef: string;
  grantRef?: string;
  payload: JsonObject;
  payloadHash: string;
  signature: string;
  attachmentRefs?: string[];
}
export interface RobotCommand {
  schemaVersion: 1;
  commandId: string;
  operationId: string;
  organizationId: string;
  venueId: string;
  robotId: string;
  missionId: string;
  stopId: string;
  missionRevision: number;
  controlEpoch: number;
  issuerDeviceId: string;
  issuedAt: string;
  expiresAt: string;
  target: JsonObject;
  limits: JsonObject;
}
export interface SyncAckEntry {
  entryId: string;
  organizationId: string;
  venueId: string;
  deviceId: string;
  deviceEpoch: string;
  sequence: string;
  payloadHash: string;
  status: 'applied' | 'quarantined' | 'pending' | 'rejected';
}
export interface SyncAck {
  schemaVersion: 1;
  organizationId: string;
  venueId: string;
  deviceId: string;
  deviceEpoch: string;
  receivedCursor: string;
  appliedCursor: string;
  /**
   * @maxItems 100
   */
  entries: SyncAckEntry[];
}
export interface OfflineGrant {
  schemaVersion: 1;
  organizationId: string;
  venueId: string;
  actorRef: string;
  deviceId: string;
  deviceEpoch: string;
  /**
   * @maxItems 100
   */
  permissions: string[];
  coordinatorEpoch: number;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  /**
   * @maxItems 100
   */
  stationIds?: string[];
}
export interface SignedOfflineGrant {
  payload: OfflineGrant;
  signature: string;
}
export interface OwnershipGrant {
  organizationId: string;
  venueId: string;
  resourceId: string;
  deviceId: string;
  deviceEpoch: string;
  epoch: number;
  issuedAt: string;
  nonce: string;
  proofHash: string;
}
export interface AssetManifest {
  id: string;
  organizationId: string;
  venueId: string;
  kind: string;
  objectPath: string;
  expectedBytes: number;
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf' | 'text/csv' | 'application/json';
  expectedHash: string;
  status: 'pending' | 'ready' | 'missing' | 'rejected';
}
export interface SettlementGrantCapability {
  schemaVersion: 1;
  id: string;
  organizationId: string;
  venueId: string;
  billId: string;
  billVersion: number;
  billSnapshotHash: string;
  deviceId: string;
  deviceEpoch: string;
  issuerDeviceId: string;
  issuerDeviceEpoch: string;
  issuerEpoch: number;
  nonce: string;
  currency: string;
  amountMinor: string;
  /**
   * @minItems 1
   * @maxItems 1
   */
  methods: ['cash'];
  issuedAt: string;
  expiresAt: string;
  expiresAtMs: number;
}
export interface SettlementGrant {
  schemaVersion: 1;
  id: string;
  organizationId: string;
  venueId: string;
  billId: string;
  billVersion: number;
  billSnapshotHash: string;
  deviceId: string;
  deviceEpoch: string;
  issuerDeviceId: string;
  issuerDeviceEpoch: string;
  issuerEpoch: number;
  nonce: string;
  currency: string;
  amountMinor: string;
  /**
   * @minItems 1
   * @maxItems 1
   */
  methods: ['cash'];
  issuedAt: string;
  expiresAt: string;
  expiresAtMs: number;
  spentMinor: string;
  status: 'issued' | 'partially_used' | 'used' | 'unknown' | 'returned' | 'reconciled';
  signature: string;
  returnProofId?: string;
  evidenceRef?: string;
  reconciledBy?: string;
  reconciledAt?: string;
}
export interface GrantReturnProof {
  schemaVersion: 1;
  grantId: string;
  organizationId: string;
  venueId: string;
  deviceId: string;
  deviceEpoch: string;
  issuerEpoch: number;
  spentMinor: string;
  /**
   * @maxItems 10000
   */
  receiptIds: string[];
  receiptHash: string;
  returnedAt: string;
  signature: string;
}
export interface AuthorityProvision {
  organizationId: string;
  venueId: string;
  deviceEpoch: string;
  coordinatorEpoch: number;
  policyRevision: number;
  ownerDeviceId: string;
  ownerDeviceEpoch: string;
  publicJwk: JsonObject;
  expiresAt: string;
  previousCoordinatorEpoch?: number;
  handoffId?: string;
  /**
   * @maxItems 100
   */
  fencingProofs?: JsonObject[];
  /**
   * @maxItems 10000
   */
  handoffSnapshots?: Snapshot[];
  /**
   * @maxItems 1000
   */
  handoffEntries?: JournalEntry[];
  /**
   * @maxItems 1000
   */
  handoffProducerKeys?: {
    deviceId: string;
    deviceEpoch: string;
    publicJwk: JsonObject;
  }[];
  handoffReceiptsComplete?: true;
  handoffReceiptCount?: number;
}
export interface SignedAuthorityProvision {
  grant: AuthorityProvision;
  signature: string;
}
export interface PairingGrant {
  organizationId: string;
  venueId: string;
  deviceId: string;
  deviceEpoch: string;
  actorRef: string;
  /**
   * @maxItems 100
   */
  permissions: string[];
  /**
   * @maxItems 100
   */
  stationIds: string[];
  expiresAt: string;
  publicJwk: JsonObject;
  certificateFingerprint: string;
}
export interface SignedPairingGrant {
  grant: PairingGrant;
  signature: string;
}
