(() => {
  'use strict';
  document.documentElement.classList.add('js');
  const $ = id => document.getElementById(id);
  const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  const features = [...document.querySelectorAll('.feature')];
  function filter() {
    const query = normalize($('search').value.trim());
    let count = 0;
    for (const card of features) {
      const match = ($('repo-filter').value === 'all' || card.dataset.repo === $('repo-filter').value)
        && ($('status-filter').value === 'all' || card.dataset.state === $('status-filter').value)
        && normalize(card.textContent).includes(query);
      card.hidden = !match; if (match) count++;
    }
    $('feature-count').textContent = `${count} / ${features.length} nhóm chức năng`;
    $('no-results').hidden = count !== 0;
  }
  ['repo-filter', 'status-filter', 'search'].forEach(id => $(id).addEventListener('input', filter));
  $('reset').addEventListener('click', () => { $('repo-filter').value = 'all'; $('status-filter').value = 'all'; $('search').value = ''; filter(); });
  $('gallery-filter').addEventListener('change', () => document.querySelectorAll('.shot').forEach(s => { s.hidden = $('gallery-filter').value !== 'all' && s.dataset.shotRepo !== $('gallery-filter').value; }));
  // Anchors to a filtered screenshot reveal it before the browser scrolls.
  document.querySelectorAll('a[href^="#shot-"]').forEach(a => a.addEventListener('click', () => { $('gallery-filter').value = 'all'; document.querySelectorAll('.shot').forEach(s => { s.hidden = false; }); }));
  let lastFocus;
  document.querySelectorAll('.zoom').forEach(a => a.addEventListener('click', event => {
    if (typeof $('lightbox').showModal !== 'function') return;
    event.preventDefault(); lastFocus = a;
    const figure = a.closest('figure');
    $('lightbox-title').textContent = figure.querySelector('h3').textContent;
    $('lightbox-image').src = a.querySelector('img').src;
    $('lightbox-image').alt = a.querySelector('img').alt;
    $('lightbox-caption').textContent = figure.querySelector('figcaption').textContent;
    $('lightbox').showModal(); $('close-lightbox').focus();
  }));
  $('close-lightbox').addEventListener('click', () => $('lightbox').close());
  $('lightbox').addEventListener('close', () => lastFocus?.focus());
  $('lightbox').addEventListener('click', e => { if (e.target === $('lightbox')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('lightbox').close(); } });
  let toastTimer;
  function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; toastTimer = setTimeout(() => { $('toast').textContent = ''; }, 3200); }
  document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    const code = $(button.dataset.copy);
    try { await navigator.clipboard.writeText(code.textContent); toast('Đã sao chép. Kiểm working directory và target trước khi chạy.'); }
    catch { const range = document.createRange(); range.selectNodeContents(code); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); toast('Đã chọn khối lệnh. Nhấn ⌘C hoặc Ctrl+C để sao chép.'); }
  }));
  $('print').addEventListener('click', () => window.print());
})();
