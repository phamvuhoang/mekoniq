export function OfflineBanner(mode:string,language:'vi'|'en'='vi') {
 const node=document.createElement('aside');node.className='offline-banner';node.setAttribute('role','status');
 const messages:Record<string,[string,string]>={isolated:['Không kết nối bộ điều phối. Chỉ ghi nhận riêng trên thiết bị; hóa đơn chung đang khóa.','Coordinator unreachable. Record isolated activity; shared bills remain locked.'],'capture-only':['Quyền offline đã hết hạn. Các ghi nhận cần quản lý đối soát.','Offline permission expired. Captured activity requires manager reconciliation.']};
 node.textContent=messages[mode]?.[language==='vi'?0:1]??'';node.hidden=!node.textContent;return node;
}
