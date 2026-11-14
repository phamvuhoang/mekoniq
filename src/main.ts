import "./styles/main.css";
// Choose local replay before importing LabApp: its runtime clients/probes are never constructed here.
const host=document.getElementById('app')!;
if(location.hash.startsWith('#replay'))void import('./ui/replay-workspace').then(({ReplayWorkspace})=>new ReplayWorkspace(host));
else void import('./app').then(({LabApp})=>new LabApp(host));
// A mode change reloads through the same early boundary, releasing the previous view's owned work.
let local=location.hash.startsWith('#replay');window.addEventListener('hashchange',()=>{const next=location.hash.startsWith('#replay');if(next!==local){local=next;location.reload();}});
