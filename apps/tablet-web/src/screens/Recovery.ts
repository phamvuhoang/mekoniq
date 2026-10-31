import {el,field,panel,list,tr,summary,button,act,type ScreenContext} from '../ui';
import {Capacitor} from '@capacitor/core';
import {parseJsonStrict} from '../../../../packages/contracts/src/index';
import type {JsonObject} from '../../../../packages/contracts/src/index';
export function Recovery(c:ScreenContext) {
 const ownership=list(c,'ownership').find(item=>item.ref.id===c.session.venueId);
 const device=field(tr(c,'Thiết bị điều phối mới','Replacement coordinator device ID'),String(ownership?.state.newDeviceId??''));
 const root=panel(tr(c,'Phục hồi có kiểm soát','Controlled recovery'),el('p',tr(c,'Không đổi chủ điều phối chỉ vì timeout. Cần checkpoint, bằng chứng chặn chủ cũ và xác nhận epoch từ executor.','A timeout does not transfer ownership. Recovery requires checkpoints, fencing evidence and executor epoch acknowledgement.')),device.node,
 button(tr(c,'Chuẩn bị bàn giao','Prepare handoff'),()=>act(c,'Ownership.PrepareHandoff',{newDeviceId:device.input.value,cursorComplete:false}).then(()=>{})));
 for(const kind of ['robot','grant','ownership','device-checkpoint'])for(const item of list(c,kind))root.append(summary(item));
 if(ownership?.state.status==='preparing'&&Capacitor.isNativePlatform()) {
  const label=el('label',tr(c,'Chứng cứ chặn executor đã ký (mảng JSON)','Signed executor fencing evidence (JSON array)'));
  const proofs=el('textarea');proofs.value='[]';proofs.rows=5;label.append(proofs);root.append(label);
  const fence=button(tr(c,'Chặn chủ cũ và xác minh chứng cứ','Fence old owner and verify evidence'),async()=>{
   try {
    const raw=parseJsonStrict(proofs.value);if(!Array.isArray(raw)||raw.some(item=>!item||typeof item!=='object'||Array.isArray(item)))throw new Error('INVALID_FENCING_PROOFS');
    const {Journal}=await import('../../../tablet-android/src/lan-bridge');
    const coordinatorProof=await Journal.fenceCurrentOwner({handoffId:String(ownership.state.handoffId)});
    await act(c,'Ownership.Fence',{newDeviceId:ownership.state.newDeviceId!,proofs:[coordinatorProof,...raw as JsonObject[]]});
   }catch(error){c.notify(String(error),true);}
  },'danger');fence.disabled=ownership.state.cursorComplete!==true;root.append(fence);
 }
 if(ownership?.state.status==='fenced')root.append(button(tr(c,'Kích hoạt chủ đã được chặn hợp lệ','Activate verified replacement'),()=>act(c,'Ownership.Activate',{newDeviceId:ownership.state.newDeviceId!}).then(()=>{}),'danger'));
 root.append(el('p',tr(c,'Bước fence/activate yêu cầu bằng chứng native/protocol trong quy trình phục hồi, không xác nhận bằng một checkbox.','Fencing and activation require native or protocol evidence through the recovery procedure.')));return root;
}
