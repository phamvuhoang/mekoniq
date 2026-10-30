'use strict';
const tr=(vi,ja,en)=>[vi,ja,en];
const locales=['vi','ja','en'];
const W={
  language:tr('Ngôn ngữ','言語','Language'),next:tr('Trang tiếp','次のページ','Next page'),previous:tr('Trang trước','前のページ','Previous page'),
  chapters:tr('Nội dung','目次','Chapters'),skip:tr('Đến nội dung','本文へ移動','Skip to content'),
  pause:tr('Tạm dừng animation','アニメーションを停止','Pause animation'),resume:tr('Bật animation','アニメーションを再開','Resume animation'),
  print:tr('In / lưu PDF','印刷 / PDF保存','Print / save PDF'),fullscreen:tr('Toàn màn hình','全画面表示','Full screen'),
  view:tr('Tài liệu tương tác','インタラクティブ資料','Interactive presentation'),
  planned:tr('Thiết kế đã duyệt · chưa triển khai','承認済み設計 · 実装前','Approved design · implementation planned'),
  illustration:tr('Minh hoạ tương tác · không kết nối robot thật','操作できる概念図 · 実機には接続しません','Interactive illustration · no connection to a live robot'),
  more:tr('Chi tiết & nguồn','詳細と参照資料','Details & references'),
  step:tr('Bước tiếp','次のステップ','Next step'),play:tr('Chạy luồng','フローを再生','Play flow'),stop:tr('Tạm dừng','一時停止','Pause'),reset:tr('Đặt lại','リセット','Reset'),
  core:tr('Lõi bắt buộc','必須機能','Required core'),enabled:tr('Trong cấu hình','構成に含む','In this preset'),optional:tr('Tùy chọn','オプション','Optional'),
  target:tr('Mục tiêu nghiệm thu','検証目標','Acceptance target'),tasks:tr('task dự kiến','計画タスク','planned tasks'),
  state:tr('Trạng thái','状態','Status'),on:tr('Bật','有効','On'),off:tr('Tắt','無効','Off'),
  design:tr('Minh hoạ thiết kế','設計イメージ','Design illustration'),
  printTitle:tr('MEKONIQ · bản in','MEKONIQ · 印刷版','MEKONIQ · print edition')
};
const state={lang:'vi',page:0,node:0,flow:0,playing:false,drop:false,network:0,adapter:0,preset:0,cap:0,wave:0,problem:false,journey:0,segment:0,future:0,venues:10,fee:1.5,paused:false};
state.paused=matchMedia('(prefers-reduced-motion: reduce)').matches;
let CONFIG,flowTimer=null,printing=false;
function L(v){if(Array.isArray(v))return v[locales.indexOf(state.lang)];return String(v??'');}
function E(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function T(v){return E(L(v));}
function number(n,decimals=0){return new Intl.NumberFormat({vi:'vi-VN',ja:'ja-JP',en:'en-US'}[state.lang],{maximumFractionDigits:decimals}).format(n);}
const icons={
  chevron:'<path d="m9 5 7 7-7 7"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',check:'<path d="m5 12 4 4L19 6"/>',plus:'<path d="M12 5v14M5 12h14"/>',
  cloud:'<path d="M6 18a4 4 0 0 1-.7-7.9A7 7 0 0 1 19 9a4.5 4.5 0 0 1-.5 9z"/>',
  database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  tablet:'<rect x="4" y="2" width="16" height="20" rx="3"/><path d="M10 18h4"/>',
  robot:'<rect x="5" y="7" width="14" height="12" rx="3"/><path d="M12 3v4M2 11v5m20-5v5M8 22v-3m8 3v-3M9 11h.01M15 11h.01M9 15h6"/><circle cx="12" cy="2.5" r="1"/>',
  kitchen:'<path d="M4 17h16M5 17a7 7 0 0 1 14 0M3 21h18M12 8V6m-1-2h2"/>',
  order:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6m-6 5h6m-6 5h3"/>',
  wallet:'<path d="M20 8H5a2 2 0 0 1 0-4h13v4M4 8v12h16V8m0 4h-5v4h5"/>',
  shield:'<path d="m12 3 8 3v6c0 5-8 10-8 10S4 17 4 12V6z"/><path d="m8 12 3 3 5-6"/>',
  layers:'<path d="m3 7 9-5 9 5-9 5zm0 5 9 5 9-5m-18 5 9 5 9-5"/>',
  wifi:'<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0m-11 4a6 6 0 0 1 8 0"/><circle cx="12" cy="20" r="1"/>',
  sync:'<path d="M20 7a9 9 0 0 0-15-3L2 7m0-5v5h5M4 17a9 9 0 0 0 15 3l3-3m0 5v-5h-5"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',
  chart:'<path d="M4 3v18h18M8 16v-4m5 4V8m5 8V5"/>',
  people:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v2"/>',
  route:'<circle cx="5" cy="5" r="3"/><circle cx="19" cy="19" r="3"/><path d="M8 5h9a4 4 0 0 1 0 8H7a4 4 0 0 0 0 8h9"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  play:'<path d="m8 4 12 8-12 8z"/>',pause:'<path d="M8 4v16M16 4v16"/>',
  printer:'<path d="M6 8V2h12v6M6 17H3V8h18v9h-3M6 14h12v8H6zM17 11h.01"/>',
  expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  spark:'<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>',
  store:'<path d="m3 9 2-6h14l2 6M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M4 12v9h16v-9M9 21v-7h6v7"/>',
  code:'<path d="m8 5-7 7 7 7m8-14 7 7-7 7m-3-16-2 18"/>',
  stop:'<path d="m8 2-6 6v8l6 6h8l6-6V8l-6-6zM8 8l8 8m0-8-8 8"/>',
  flag:'<path d="M5 22V3m0 0c5-5 9 5 14 0v11c-5 5-9-5-14 0"/>',
  box:'<path d="m3 6 9-4 9 4v12l-9 4-9-4zm0 0 9 5 9-5M12 11v11M8 4l9 5"/>',
  pin:'<path d="M19 9c0 6-7 13-7 13S5 15 5 9a7 7 0 0 1 14 0z"/><circle cx="12" cy="9" r="2"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'
};
function icon(name,size=24){return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.layers}</svg>`;}
function tag(text,kind=''){return `<span class="tag ${kind}">${kind?'<i class="status-dot" aria-hidden="true"></i>':''}${T(text)}</span>`;}
function btn(text,action,value='',kind='ghost',symbol){return `<button class="button ${kind}" data-action="${action}" data-value="${value}">${symbol?icon(symbol,16):''}${T(text)}</button>`;}
function choice(text,action,value,selected){return `<button class="button" data-action="${action}" data-value="${value}" aria-pressed="${selected}">${T(text)}</button>`;}
function header(kicker,title,subtitle,badge){return `<div class="slide-head"><div><div class="eyebrow">${T(kicker)}</div><h1>${T(title)}</h1>${subtitle?`<p class="lede">${T(subtitle)}</p>`:''}</div>${badge?tag(badge,'warn'):''}</div>`;}
function note(text){return `<p class="bottom-note">${icon('info',15)}<span>${T(text)}</span></p>`;}
function card(symbol,title,desc){return `<div class="panel"><div class="card-icon">${icon(symbol)}</div><h3>${T(title)}</h3><p class="small muted gap-top">${T(desc)}</p></div>`;}
function metric(value,label){return `<div class="metric-cell"><b>${E(value)}</b><small>${T(label)}</small></div>`;}
function more(text,links=[]){return `<details><summary>${T(W.more)}</summary><p>${T(text)}</p>${links.map(([label,url])=>`<a href="${E(url)}" target="_blank" rel="noopener noreferrer">${E(label)}</a>`).join('')}</details>`;}
function updateUrl(){try{const url=new URL(location.href);url.searchParams.set('lang',state.lang);url.hash=CONFIG.pages[state.page].id;history.replaceState(null,'',url);}catch{}}
function render(focusMain=false){
  if(printing)return;
  const active=document.activeElement;
  const focus=active?.dataset.action?{action:active.dataset.action,value:active.getAttribute('data-value')}:null;
  document.documentElement.lang=state.lang;
  document.title='MEKONIQ · '+L(CONFIG.title);
  document.body.classList.toggle('paused',state.paused);
  const current=CONFIG.pages[state.page];
  document.getElementById('app').innerHTML=`<a class="skip" href="#main">${T(W.skip)}</a><div class="shell ${CONFIG.id}">
  <header class="topbar"><a class="brand" href="#${CONFIG.pages[0].id}" data-action="goto" data-value="0" aria-label="MEKONIQ"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>MEKONIQ</a><div class="edition">${T(CONFIG.title)}<br>2026.10.30 · ${CONFIG.version||'1.0'}</div><div class="top-actions"><div class="languages" role="group" aria-label="${T(W.language)}">${(CONFIG.languageOrder||['vi','ja','en']).map(code=>[code,...{vi:['VI','Tiếng Việt'],ja:['日本語','日本語'],en:['EN','English']}[code]]).map(([code,label,title])=>`<button lang="${code}" data-action="language" data-value="${code}" title="${title}" aria-label="${title}" aria-pressed="${state.lang===code}">${label}</button>`).join('')}</div><button class="icon-btn" data-action="motion" title="${T(state.paused?W.resume:W.pause)}" aria-label="${T(state.paused?W.resume:W.pause)}" aria-pressed="${state.paused}">${icon(state.paused?'play':'pause',17)}</button><button class="icon-btn" data-action="fullscreen" title="${T(W.fullscreen)}" aria-label="${T(W.fullscreen)}">${icon('expand',17)}</button><button class="icon-btn" data-action="print" title="${T(W.print)}" aria-label="${T(W.print)}">${icon('printer',17)}</button></div></header>
  <div class="workspace">${CONFIG.id==='engineering'?`<nav class="side-nav" aria-label="${T(W.chapters)}"><div class="nav-caption">${T(W.chapters)}</div>${CONFIG.pages.map((p,i)=>`<button class="nav-item ${i===state.page?'active':''}" data-action="goto" data-value="${i}" ${i===state.page?'aria-current="page"':''}><span class="nav-num">${String(i+1).padStart(2,'0')}</span>${T(p.label)}</button>`).join('')}<div class="nav-foot">MEKONIQ / SOURCE<br>${T(CONFIG.navFoot)}</div></nav>`:''}<main id="main" tabindex="-1"><section class="slide" data-page="${current.id}" aria-label="${T(current.label)}">${current.render()}</section></main></div>
  <footer class="footer"><div class="footer-note">${T(CONFIG.footer)}<br><span>${T(CONFIG.id==='engineering'?W.illustration:CONFIG.footer2)}</span></div><div class="nav-control"><div class="progress-rail" aria-hidden="true">${CONFIG.pages.map((_,i)=>`<i class="${i<=state.page?'past':''}"></i>`).join('')}</div><span class="slide-count"><strong>${String(state.page+1).padStart(2,'0')}</strong> / ${String(CONFIG.pages.length).padStart(2,'0')}</span><button class="icon-btn" data-action="previous" aria-label="${T(W.previous)}" ${state.page===0?'disabled':''}><span style="display:flex;transform:rotate(180deg)">${icon('chevron',18)}</span></button><button class="icon-btn" data-action="next" aria-label="${T(W.next)}" ${state.page===CONFIG.pages.length-1?'disabled':''}>${icon('chevron',18)}</button></div></footer><div class="live-announcement" aria-live="polite">${T(current.label)}</div></div>`;
  updateUrl();
  if(focusMain){document.getElementById('main').focus({preventScroll:true});scrollTo({top:0,behavior:state.paused?'instant':'smooth'});}
  else if(focus){document.querySelector(`[data-action="${CSS.escape(focus.action)}"]${focus.value===null?'':`[data-value="${CSS.escape(focus.value)}"]`}`)?.focus({preventScroll:true});}
}
function setPage(index){stopFlow();state.page=Math.max(0,Math.min(CONFIG.pages.length-1,index));render(true);}
function stopFlow(){if(flowTimer)clearInterval(flowTimer);flowTimer=null;state.playing=false;}
function startFlow(){if(state.flow===6)state.flow=0;state.playing=true;flowTimer=setInterval(()=>{if(document.hidden||state.paused)return;if(state.flow>=6){stopFlow();render();return;}state.flow++;render();},1450);render();}
document.addEventListener('click',async event=>{
  const target=event.target.closest('[data-action]');if(!target)return;
  const {action,value}=target.dataset;
  if(action==='goto'){event.preventDefault();setPage(+value);return;}
  if(action==='previous'){setPage(state.page-1);return;}
  if(action==='next'){setPage(state.page+1);return;}
  if(action==='language'){state.lang=value;try{localStorage.setItem('mekoniq-presentation-'+CONFIG.id+'-language',value);}catch{}render();document.querySelector(`[data-action="language"][data-value="${value}"]`)?.focus({preventScroll:true});return;}
  if(action==='motion'){state.paused=!state.paused;if(state.paused)stopFlow();render();document.querySelector('[data-action="motion"]')?.focus({preventScroll:true});return;}
  if(action==='fullscreen'){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{}return;}
  if(action==='print'){window.print();return;}
  if(action==='flow-play'){if(state.playing)stopFlow();else{state.paused=false;startFlow();}render();return;}
  if(action==='flow-next'){stopFlow();state.flow=(state.flow+1)%7;render();return;}
  if(action==='flow-reset'){stopFlow();state.flow=0;render();return;}
  if(action==='flow-step'){stopFlow();state.flow=+value;render();return;}
  if(action==='drop'){state.drop=!state.drop;render();return;}
  if(['node','network','adapter','preset','cap','wave','journey','segment','future'].includes(action)){state[action]=+value;render();return;}
  if(action==='problem'){state.problem=!state.problem;render();return;}
});
document.addEventListener('keydown',event=>{if(event.altKey||event.metaKey||event.ctrlKey||event.target.closest('input,textarea,select,[contenteditable]'))return;if(event.key==='ArrowRight'||event.key==='PageDown'){event.preventDefault();setPage(state.page+1);}if(event.key==='ArrowLeft'||event.key==='PageUp'){event.preventDefault();setPage(state.page-1);}if(event.key==='Home'){event.preventDefault();setPage(0);}if(event.key==='End'){event.preventDefault();setPage(CONFIG.pages.length-1);}});
document.addEventListener('visibilitychange',()=>document.body.classList.toggle('is-hidden',document.hidden));
addEventListener('hashchange',()=>{if(!CONFIG||printing)return;const index=CONFIG.pages.findIndex(p=>p.id===location.hash.slice(1));if(index>=0&&index!==state.page)setPage(index);});
const motionQuery=matchMedia('(prefers-reduced-motion: reduce)');motionQuery.addEventListener('change',e=>{if(e.matches){state.paused=true;stopFlow();render();}});
addEventListener('beforeprint',()=>{stopFlow();printing=true;document.body.classList.add('print-mode');document.getElementById('main').innerHTML=CONFIG.pages.map(p=>`<section class="slide"><div class="print-only label">MEKONIQ / ${T(CONFIG.title)} / 2026.10.30</div>${p.render()}</section>`).join('');});
addEventListener('afterprint',()=>{printing=false;document.body.classList.remove('print-mode');render();});
function boot(config){CONFIG=config;state.lang=config.defaultLang||'vi';try{const q=new URL(location.href).searchParams.get('lang');if(locales.includes(q))state.lang=q;else{const saved=localStorage.getItem('mekoniq-presentation-'+CONFIG.id+'-language');if(locales.includes(saved))state.lang=saved;}}catch{}const hash=location.hash.slice(1);const n=CONFIG.pages.findIndex(p=>p.id===hash);if(n>=0)state.page=n;render();}
