import {Capacitor} from '@capacitor/core';
import {el,field,select,panel,list,tr,button,act,type ScreenContext} from '../ui';
export function Maintenance(c:ScreenContext) {
 const mode=select(tr(c,'Phạm vi bảo trì','Maintenance scope'),[{id:'cloud_only',name:tr(c,'Chỉ cloud','Cloud only')},{id:'full_shutdown',name:tr(c,'Tắt toàn bộ ứng dụng','Full application shutdown')}]);
 const missing=field(tr(c,'Thiết bị chưa có checkpoint (phân cách dấu phẩy)','Devices missing checkpoints (comma separated)'));
 const status=list(c,'maintenance').find(s=>s.ref.id==='current');
 const root=panel(tr(c,'Bảo trì có đối soát','Auditable maintenance'),el('p',tr(c,'Đối soát tải robot, quyền thu tiền và checkpoint trước khi tắt toàn bộ.','Reconcile robot cargo, settlement rights and device checkpoints before full shutdown.')),el('p',String(status?.state.status??'—')),mode.node,missing.node,
 button(tr(c,'Chuẩn bị checkpoint','Prepare checkpoint'),()=>act(c,'Maintenance.Prepare',{mode:mode.input.value,missingDevices:missing.input.value.split(',').map(s=>s.trim()).filter(Boolean)}).then(()=>{})),
 button(tr(c,'Bắt đầu bảo trì','Enter maintenance'),()=>act(c,'Maintenance.Enter',{mode:mode.input.value}).then(()=>{}),'danger'),
 button(tr(c,'Mở lại vận hành','Resume service'),()=>act(c,'Maintenance.Resume',{}).then(()=>{})),
 button(tr(c,'Xem danh mục xuất dữ liệu','Inspect export inventory'),async()=>{const result=await act(c,'Continuity.Export',{});if(result?.status==='accepted')c.notify(JSON.stringify(result.value));}));
 if(Capacitor.isNativePlatform()){
  const password=field(tr(c,'Mật khẩu bảo vệ bản xuất (ít nhất 12 ký tự)','Archive password (at least 12 characters)'),'','password');
  root.append(password.node,button(tr(c,'Xuất toàn bộ dữ liệu mã hóa','Export full encrypted archive'),async()=>{try{const {Journal}=await import('../../../tablet-android/src/lan-bridge');const receipt=await Journal.exportArchive({password:password.input.value});password.input.value='';c.notify(tr(c,'Đã xác minh tệp xuất · ','Archive verified · ')+receipt.sha256);}catch(error){c.notify(String(error),true);}}),
   button(tr(c,'Kiểm tra bản sao lưu','Inspect backup'),async()=>{try{const {Journal}=await import('../../../tablet-android/src/lan-bridge');const report=await Journal.inspectArchive({password:password.input.value});password.input.value='';c.notify(JSON.stringify(report));}catch(error){c.notify(String(error),true);}}));
 }
 return root;
}
