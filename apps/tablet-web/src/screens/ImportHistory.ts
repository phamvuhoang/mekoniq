import type {JsonObject} from '../../../../packages/contracts/src/index';
import {el,field,panel,list,tr,money,button,act,type ScreenContext} from '../ui';
/** RFC4180 quoted fields, bounded input, no eval or spreadsheet execution. */
export function parseReceiptCsv(text:string):JsonObject[] {
 if(new TextEncoder().encode(text).length>262144)throw new Error('CSV_TOO_LARGE');
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const char=text[i]!;
  if(char==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(cell===''||quoted)quoted=!quoted;else throw new Error('INVALID_CSV_QUOTE');}
  else if(char===','&&!quoted){row.push(cell);cell='';}
  else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x!==''))rows.push(row);row=[];cell='';}
  else cell+=char;
 }
 if(quoted)throw new Error('UNTERMINATED_CSV_QUOTE');row.push(cell);if(row.some(x=>x!==''))rows.push(row);
 if(rows.length<2||rows.length>1001)throw new Error('INVALID_ROW_COUNT');
 const headers=rows.shift()!;if(new Set(headers).size!==headers.length)throw new Error('DUPLICATE_COLUMN');
 return rows.map(values=>{if(values.length!==headers.length)throw new Error('INVALID_CSV_COLUMNS');const result:JsonObject={};headers.forEach((key,index)=>{result[key]=key==='fulfilled'?values[index]==='true':values[index]!;});return result;});
}
export function ImportHistory(c:ScreenContext) {
 const incident=field(tr(c,'Mã sự cố / đợt bảo trì','Incident / maintenance reference'));
 const csv=el('textarea');csv.rows=8;csv.id='receipt-csv';csv.placeholder='sourceType,sourceSeries,sourceNumber,totalMinor,paidCashMinor,occurredAt,fulfilled';
 const label=el('label',tr(c,'Dữ liệu CSV phiếu cũ','Historical receipts CSV'));label.htmlFor=csv.id;
 const preview=el('div',undefined,'preview');
 const root=panel(tr(c,'Nhập phiếu lịch sử','Import historical receipts'),el('p',tr(c,'Kiểm tra → xem tổng → quản lý duyệt → áp dụng từng phiếu. Nhập lịch sử không phát lệnh robot hoặc thu tiền lần nữa.','Validate, review totals, approve, then apply each receipt. Imports do not dispatch robots or collect payments again.')),incident.node,label,csv,
 button(tr(c,'Kiểm tra và xem tổng','Validate and preview'),async()=>{try{const result=await act(c,'Import.Validate',{incidentRef:incident.input.value,rows:parseReceiptCsv(csv.value)});if(result?.status==='accepted'){const shown=await act(c,'Import.Preview',{batchId:result.value.batchId!});if(shown?.status==='accepted')preview.replaceChildren(el('p',tr(c,'Tổng: ','Gross: ')+money(shown.value.grossMinor)),el('p',tr(c,'Tiền mặt: ','Cash: ')+money(shown.value.cashMinor)));}}catch(error){c.notify(String(error),true);}}),preview);
 for(const batch of list(c,'import-batch')){
  const row=panel(batch.ref.id,el('p',String(batch.state.status)+' · '+String(batch.state.cursor??0)));
  if(batch.state.status==='validated')row.append(button(tr(c,'Duyệt đúng bản đã xem','Approve this preview'),()=>act(c,'Import.Approve',{batchId:batch.ref.id,previewHash:batch.state.previewHash!}).then(()=>{})));
  if(['approved','applying','partial'].includes(String(batch.state.status)))row.append(button(tr(c,'Áp dụng / tiếp tục','Apply / resume'),()=>act(c,'Import.Apply',{batchId:batch.ref.id}).then(()=>{})));
  root.append(row);
 }
 return root;
}
