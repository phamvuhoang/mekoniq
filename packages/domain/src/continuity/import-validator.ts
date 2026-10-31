import type {JsonObject} from '../../../contracts/src/index';
import {amount,text,objects} from './shared';
export function validateImportRows(value:JsonObject['rows']):JsonObject[] {
  const rows=objects(value);if(rows.length===0||rows.length>1000)throw new Error('INVALID_ROW_COUNT');
  return rows.map(r=>{
    text(r.sourceType);text(r.sourceSeries);text(r.sourceNumber);
    if(!['paper','device','external'].includes(String(r.sourceType)))throw new Error('INVALID_SOURCE_TYPE');
    const total=amount(r.totalMinor),cash=amount(r.paidCashMinor??'0');
    if(BigInt(cash)>BigInt(total))throw new Error('CASH_EXCEEDS_TOTAL');
    if(typeof r.occurredAt!=='string'||!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(r.occurredAt)||!Number.isFinite(Date.parse(r.occurredAt)))throw new Error('INVALID_OCCURRED_AT');
    if(r.currency!==undefined&&(typeof r.currency!=='string'||!/^[A-Z]{3}$/.test(r.currency)))throw new Error('INVALID_CURRENCY');
    return {...r,totalMinor:total,paidCashMinor:cash,currency:r.currency??'VND',fulfilled:r.fulfilled===true};
  });
}
