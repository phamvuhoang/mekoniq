(() => {
  'use strict';
  const root = document.documentElement;
  root.classList.add('js');
  const languages = ['vi', 'ja', 'en'];
  const messages = {
    copied: {vi: 'Đã sao chép.', ja: 'コピーしました。', en: 'Copied.'},
    select: {vi: 'Đã chọn nội dung. Dùng Ctrl+C hoặc ⌘C để sao chép.', ja: '内容を選択しました。Ctrl+C / ⌘Cでコピーしてください。', en: 'Text selected. Use Ctrl+C or ⌘C to copy.'},
  };
  let language = 'vi', toastTimer, previousFocus;
  const chooseLanguage = lang => {
    language = languages.includes(lang) ? lang : 'vi';
    root.dataset.lang = language;
    root.lang = language;
    document.querySelectorAll('[data-lang-switch]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.langSwitch === language)));
    document.querySelectorAll('[data-alt-vi]').forEach(e => {
      const text = e.getAttribute(`data-alt-${language}`);
      if (e.tagName === 'IMG') e.alt = text;
      else e.setAttribute('aria-label', text);
    });
    try { localStorage.setItem('mekoniq-r2a-guide-language', language); } catch { /* file views may disallow storage */ }
  };
  let initial = new URLSearchParams(location.search).get('lang');
  if (!initial) try { initial = localStorage.getItem('mekoniq-r2a-guide-language'); } catch { /* use Vietnamese */ }
  chooseLanguage(initial);
  const chooseRoute = (name, focus = false) => {
    const route = name === 'web' ? 'web' : 'local';
    document.querySelectorAll('[data-route]').forEach(b => {
      const on = b.dataset.route === route;
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    document.querySelectorAll('[data-route-panel]').forEach(p => { p.hidden = p.dataset.routePanel !== route; });
  };
  chooseRoute('local');
  document.querySelectorAll('[data-route]').forEach(b => {
    b.addEventListener('click', () => chooseRoute(b.dataset.route));
    b.addEventListener('keydown', e => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
      e.preventDefault();
      chooseRoute(e.key === 'Home' ? 'local' : e.key === 'End' ? 'web' : b.dataset.route === 'web' ? 'local' : 'web', true);
    });
  });
  document.querySelectorAll('[data-route-link]').forEach(a => a.addEventListener('click', () => chooseRoute(a.dataset.routeLink)));
  document.querySelectorAll('[data-lang-switch]').forEach(b => b.addEventListener('click', () => chooseLanguage(b.dataset.langSwitch)));
  const toast = id => {
    const el = document.getElementById('toast'); el.textContent = messages[id][language];
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.textContent = ''; }, 5000);
  };
  document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    const target = document.getElementById(b.dataset.copy);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(target.textContent); toast('copied');
    } catch {
      const range = document.createRange(); range.selectNodeContents(target);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); toast('select');
    }
  }));
  const checks = [...document.querySelectorAll('.prep-check')];
  const updateChecks = () => { document.getElementById('prep-count').textContent = `${checks.filter(c => c.checked).length} / ${checks.length}`; };
  checks.forEach(c => c.addEventListener('change', updateChecks));
  document.querySelector('[data-reset-checks]').addEventListener('click', () => { checks.forEach(c => { c.checked = false; }); updateChecks(); });
  const dialog = document.getElementById('lightbox');
  document.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => {
    previousFocus = b;
    const source = b.querySelector('img'), target = document.getElementById('lightbox-image');
    target.src = source.src; target.alt = source.alt;
    document.getElementById('lightbox-caption').innerHTML = b.closest('figure').querySelector('figcaption').innerHTML;
    dialog.showModal(); document.getElementById('close-lightbox').focus();
  }));
  document.getElementById('close-lightbox').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => previousFocus?.focus());
  dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
  let printOpen = [];
  addEventListener('beforeprint', () => { printOpen = [...document.querySelectorAll('details')].filter(d => !d.open); printOpen.forEach(d => { d.open = true; }); });
  addEventListener('afterprint', () => { printOpen.forEach(d => { d.open = false; }); });
  document.querySelector('[data-print]').addEventListener('click', () => window.print());
})();
