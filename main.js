// Results ledger: filter the rows by verdict. Without JS every row shows and the buttons stay hidden.
const ledger = document.querySelector('.ledger');
if (ledger) {
  const bar = ledger.querySelector('.ledger-filter');
  const status = ledger.querySelector('[data-ledger-status]');
  const rows = [...ledger.querySelectorAll('tbody tr')];
  const names = { all: 'all results', pass: 'passes', fail: 'fails', notyet: 'not yet tested', measured: 'measured results' };
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button[value]');
    if (!b) return;
    bar.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    let shown = 0;
    for (const r of rows) { r.hidden = b.value !== 'all' && r.dataset.v !== b.value; if (!r.hidden) shown += 1; }
    status.textContent = `Showing ${shown} ${names[b.value]}.`;
  });
  bar.hidden = false;
}

// NEPHRON loop: the poster still without JS or with reduced motion; otherwise it plays, with a pause button (WCAG 2.2.2).
const loop = document.querySelector('.loop video');
if (loop) {
  const btn = loop.parentElement.querySelector('.loop-toggle');
  const play = (on) => { if (on) loop.play().catch(() => {}); else loop.pause(); btn.textContent = on ? 'Pause the loop' : 'Play the loop'; };
  btn.addEventListener('click', () => play(loop.paused));
  play(!matchMedia('(prefers-reduced-motion: reduce)').matches);
  btn.hidden = false;
}
