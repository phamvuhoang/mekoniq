import type {CommandEnvelope} from '../../../contracts/src/index';
import {amount,text,change,ok} from './shared';
export function recordPaymentObservation(c:CommandEnvelope) {
  return ok([change('PaymentObserved','payment-observation',c.operationId,{billId:c.payload.billId===undefined?null:text(c.payload.billId),amountMinor:amount(c.payload.amountMinor),currency:c.payload.currency??'VND',method:text(c.payload.method),status:'unallocated',sourceDeviceId:c.deviceId,occurredAt:c.occurredAt,recordedAt:c.recordedAt,evidenceRef:c.payload.evidenceRef===undefined?null:text(c.payload.evidenceRef)})],{observationId:c.operationId});
}
