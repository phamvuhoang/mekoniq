export type * from '../generated/wire';
export * from './canonical';
export * from './validate';
export * from './signing';
import type { AggregateRef, CommandEnvelope, CommandResult, CommitBatch, CommitReceipt, Decision, Snapshot } from '../generated/wire';

export interface AtomicStore {
  readSnapshot(ref: AggregateRef): Promise<Snapshot>;
  commit(batch: CommitBatch): Promise<CommitReceipt>;
  journalCount(): Promise<number>;
  close(): Promise<void>;
}
export type Handler = (command: CommandEnvelope, snapshots: Snapshot[]) => Decision;
export interface CommandRouter {
  register(type: string, handler: Handler): void;
  dispatch(command: CommandEnvelope): Promise<CommandResult>;
}
