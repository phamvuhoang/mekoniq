export type SyncLevel='local'|'venue'|'cloud'|'unknown';
export function SyncStatus({level,language='vi'}:{level:SyncLevel;language?:'vi'|'en'}) {
 const labels={local:['Đã lưu trên thiết bị','Saved on this device'],venue:['Nhà hàng đã nhận','Accepted by the restaurant'],cloud:['Đã đồng bộ cloud','Synced to cloud'],unknown:['Chưa xác định kết quả','Result unknown']};
 const node=document.createElement('span');node.className='sync-status '+level;node.setAttribute('role','status');node.setAttribute('aria-live','polite');node.textContent=labels[level][language==='vi'?0:1];return node;
}
