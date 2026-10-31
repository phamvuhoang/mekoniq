import type {ModuleRegistry} from '../modules';
import {captureTicket,receiveTicket} from './isolated-ticket';
import {recordPaymentObservation} from './observations';
import {resolveConflict,linkTicket} from './reconciliation';
import {issueGrant,useGrant,returnGrant} from '../billing/settlement-grant';
import {reconcileGrant} from '../billing/grant-reconciliation';
import {prepareMaintenance,enterMaintenance,resumeMaintenance} from './maintenance-window';
import {exportInventory} from './export';
import {validateImport,previewImport,approveImport} from './import-batch';
import {applyImport,amendImport} from './import-apply';
import {prepareHandoff,fenceOwner,activateOwner} from './handoff';
import {reconcileRobot,prepareRobotReconciliation} from '../fleet/reconcile';
import {guarded} from './shared';
export const continuityHandlers={
 'Continuity.CaptureTicket':captureTicket,'Continuity.RecordPaymentObservation':recordPaymentObservation,
 'Continuity.ReceiveTicket':receiveTicket,
 'Continuity.LinkTicket':linkTicket,'Continuity.ResolveConflict':resolveConflict,'Continuity.Export':exportInventory,
 'SettlementGrant.Issue':issueGrant,'SettlementGrant.Use':useGrant,'SettlementGrant.Return':returnGrant,'SettlementGrant.Reconcile':reconcileGrant,
 'Maintenance.Prepare':prepareMaintenance,'Maintenance.Enter':enterMaintenance,'Maintenance.Resume':resumeMaintenance,
 'Import.Validate':validateImport,'Import.Preview':previewImport,'Import.Approve':approveImport,'Import.Apply':applyImport,'Import.Amend':amendImport,
 'Ownership.PrepareHandoff':prepareHandoff,'Ownership.Fence':fenceOwner,'Ownership.Activate':activateOwner,'Robot.Reconcile':reconcileRobot,'Robot.PrepareReconciliation':prepareRobotReconciliation
};
export function registerContinuityModules(registry:ModuleRegistry) {
  for(const [type,handler] of Object.entries(continuityHandlers))registry.register(type,guarded(handler));
}
