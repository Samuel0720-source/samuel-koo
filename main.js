// Race track: drive the car around the loop; each gate is a checkpoint link.
const SVG_NS = 'http://www.w3.org/2000/svg';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const GATES = [
  { at: 0.1, num: '01', name: 'Projects', href: '#projects' },
  { at: 0.3, num: '02', name: 'Awards', href: '#awards' },
  { at: 0.5, num: '03', name: 'Experience', href: '#experience' },
  { at: 0.7, num: '04', name: 'Toolkit', href: '#toolkit' },
  { at: 0.9, num: '05', name: 'Contact', href: '#links' },
];

const svg = document.querySelector('.route-svg');
const track = document.getElementById('track');
const marker = document.getElementById('marker');
const status = document.querySelector('.route-status');

const wrap = (s) => ((s % 1) + 1) % 1;
const loopDist = (a, b) => { const d = Math.abs(wrap(a) - wrap(b)); return Math.min(d, 1 - d); };

if (svg && track && marker) {
  const L = track.getTotalLength();
  const at = (s) => track.getPointAtLength(wrap(s) * L);
  const angleAt = (s) => { const a = at(s - 0.002), b = at(s + 0.002); return Math.atan2(b.y - a.y, b.x - a.x); };
  const samples = Array.from({ length: 400 }, (_, i) => ({ s: i / 400, p: at(i / 400) }));
  const centre = samples.reduce((c, { p }) => ({ x: c.x + p.x / samples.length, y: c.y + p.y / samples.length }), { x: 0, y: 0 });

  // Draw the gates: a bar across the road, a numbered disc, and the name outside the loop.
  const gatesG = document.getElementById('gates');
  const gateEls = GATES.map((g) => {
    const p = at(g.at), a = angleAt(g.at);
    let nx = -Math.sin(a), ny = Math.cos(a);
    if ((p.x - centre.x) * nx + (p.y - centre.y) * ny < 0) { nx = -nx; ny = -ny; } // point outward
    const link = document.createElementNS(SVG_NS, 'a');
    link.setAttribute('href', g.href);
    link.setAttribute('class', `gate tone-${Number(g.num)}`);
    link.setAttribute('aria-label', `Checkpoint ${g.num}, ${g.name}`);
    const bar = document.createElementNS(SVG_NS, 'line');
    bar.setAttribute('x1', p.x - nx * 20); bar.setAttribute('y1', p.y - ny * 20);
    bar.setAttribute('x2', p.x + nx * 20); bar.setAttribute('y2', p.y + ny * 20);
    const cx = p.x + nx * 44, cy = p.y + ny * 44;
    const disc = document.createElementNS(SVG_NS, 'circle');
    disc.setAttribute('cx', cx); disc.setAttribute('cy', cy); disc.setAttribute('r', 23);
    const num = document.createElementNS(SVG_NS, 'text');
    num.setAttribute('x', cx); num.setAttribute('y', cy + 7); num.setAttribute('text-anchor', 'middle');
    num.textContent = g.num;
    const name = document.createElementNS(SVG_NS, 'text');
    name.setAttribute('class', 'gate-name');
    const right = nx >= 0;
    name.setAttribute('x', cx + (right ? 31 : -31)); name.setAttribute('y', cy + 7);
    name.setAttribute('text-anchor', right ? 'start' : 'end');
    name.textContent = g.name;
    link.append(bar, disc, num, name);
    gatesG.append(link);
    return link;
  });

  // Chequered start line across the road at s = 0.
  {
    const p = at(0), a = angleAt(0), tx = Math.cos(a), ty = Math.sin(a), nx = -ty, ny = tx, sq = 6.4;
    const g = document.getElementById('startline');
    for (let row = 0; row < 2; row++) for (let col = 0; col < 6; col++) {
      const r = document.createElementNS(SVG_NS, 'rect');
      const u = (col - 3) * sq, v = (row - 1) * sq;
      r.setAttribute('x', 0); r.setAttribute('y', 0); r.setAttribute('width', sq); r.setAttribute('height', sq);
      r.setAttribute('transform', `translate(${p.x + nx * u + tx * v} ${p.y + ny * u + ty * v}) rotate(${(a * 180) / Math.PI})`);
      r.setAttribute('class', (row + col) % 2 ? 'start-sq-light' : 'start-sq-dark');
      g.append(r);
    }
  }

  const trailEl = document.getElementById('trail');
  const hudBox = document.querySelector('.hud');
  const hud = Object.fromEntries([...document.querySelectorAll('[data-hud]')].map((el) => [el.dataset.hud, el]));
  let trail = [], lap = 0, lapStart = null, best = null;
  const drawTrail = () => trailEl.setAttribute('d', trail.length > 1 ? 'M' + trail.map((q) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' L') : '');

  let s = 0, vel = 0, target = null, dragging = false, active = -1, engaged = false;
  const keys = new Set();

  const place = () => {
    const p = at(s);
    const deg = (angleAt(s) * 180) / Math.PI + (vel < 0 ? 180 : 0);
    marker.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${deg}) scale(1.3)`);
    const near = GATES.findIndex((g) => loopDist(s, g.at) < 0.025);
    if (near !== active) {
      active = near;
      gateEls.forEach((el, i) => el.classList.toggle('is-near', i === near));
      if (engaged) status.textContent = near < 0
        ? 'Keep driving to the next checkpoint.'
        : `Checkpoint ${GATES[near].num}, ${GATES[near].name}. Press Enter or click the gate to open it.`;
    }
  };

  // Fixed 60 Hz steps so speed is the same on every refresh rate.
  let last = 0, acc = 0;
  const step = () => {
    const dir = (keys.has('ArrowRight') || keys.has('ArrowUp') || keys.has('d') || keys.has('w') ? 1 : 0)
              - (keys.has('ArrowLeft') || keys.has('ArrowDown') || keys.has('a') || keys.has('s') ? 1 : 0);
    if (dir) { vel += dir * 0.00035; target = null; }
    if (target !== null) { const d = wrap(target - s + 0.5) - 0.5; vel = d * 0.08; if (Math.abs(d) < 0.0005) target = null; }
    vel = Math.max(-0.006, Math.min(0.006, vel)) * (dir ? 0.98 : 0.92);
    if (Math.abs(vel) < 0.00002) vel = 0;
    const prev = s;
    s = wrap(s + vel);
    const clock = performance.now(); // wall-clock lap time, parked time included
    if (engaged && vel > 0 && prev > 0.8 && s < 0.2) { // crossed the start line forwards (the intro roll doesn't count)
      if (lapStart !== null) {
        const t = clock - lapStart; best = best === null ? t : Math.min(best, t);
        status.textContent = `Lap ${lap} done in ${(t / 1000).toFixed(2)} s. Best lap ${(best / 1000).toFixed(2)} s.`;
      }
      lap += 1; lapStart = clock;
    } else if (vel < 0 && prev < 0.2 && s > 0.8) lapStart = null; // backwards over the line voids the lap
    return Boolean(vel || dir || target !== null);
  };
  const tick = (now) => {
    acc += Math.min(now - (last || now), 100); last = now;
    let moving = true;
    while (acc >= 1000 / 60) { moving = step(); acc -= 1000 / 60; }
    place();
    if (!reduced) { const p = at(s); trail.push({ x: p.x, y: p.y }); if (trail.length > 16 || !moving) trail.shift(); if (!moving) trail = []; drawTrail(); }
    if (engaged && hudBox) hudBox.hidden = false; // no HUD until the visitor drives
    hud.lap.textContent = lap;
    hud.best.textContent = best === null ? '–' : `${(best / 1000).toFixed(2)} s`;
    hud.speed.textContent = `${Math.round(Math.abs(vel) * L * 60 * 0.36)} km/h`;
    if (moving) requestAnimationFrame(tick); else { running = false; last = 0; acc = 0; }
  };
  let running = false;
  const run = () => { if (!running) { running = true; requestAnimationFrame(tick); } };

  svg.addEventListener('focusout', () => keys.clear());
  svg.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd'].includes(k)) {
      e.preventDefault(); engaged = true; keys.add(k); run();
    } else if (k === 'Enter' && document.activeElement === svg && active >= 0) {
      const head = document.querySelector(`${GATES[active].href} h2`);
      location.hash = GATES[active].href;
      if (head) { head.setAttribute('tabindex', '-1'); head.focus(); } // move keyboard focus off the map
    }
  });
  addEventListener('keyup', (e) => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  addEventListener('blur', () => keys.clear());

  const nearest = (e) => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    let best = samples[0], bd = Infinity;
    for (const smp of samples) { const d = (smp.p.x - pt.x) ** 2 + (smp.p.y - pt.y) ** 2; if (d < bd) { bd = d; best = smp; } }
    return best.s;
  };
  svg.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.gate')) return; // let gate links click through
    dragging = true; engaged = true; svg.focus({ preventScroll: true }); svg.setPointerCapture(e.pointerId);
    target = nearest(e); run();
  });
  svg.addEventListener('pointermove', (e) => { if (dragging) { target = nearest(e); run(); } });
  svg.addEventListener('pointerup', () => { dragging = false; });
  svg.addEventListener('pointercancel', () => { dragging = false; });

  // Start just behind the line and roll up to the first checkpoint.
  s = 0.97; place();
  if (reduced) { s = GATES[0].at; place(); } else { setTimeout(() => { if (!engaged) { target = GATES[0].at; run(); } }, 500); }
}

// Nav: light up the checkpoint you are passing (the last section whose top is above 40% of the screen).
const links = new Map([...document.querySelectorAll('.nav-list a')].map((a) => [a.getAttribute('href').slice(1), a]));
const spyTargets = [...links.keys()].map((id) => document.getElementById(id)).filter(Boolean);
let spyQueued = false;
const spy = () => {
  spyQueued = false;
  const line = innerHeight * 0.4;
  let current = null;
  for (const el of spyTargets) if (el.getBoundingClientRect().top <= line) current = el.id;
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) current = spyTargets.at(-1)?.id ?? current; // bottom of page = last checkpoint
  links.forEach((a, id) => a.setAttribute('aria-current', id === current ? 'true' : 'false'));
};
addEventListener('scroll', () => { if (!spyQueued) { spyQueued = true; requestAnimationFrame(spy); } }, { passive: true });
addEventListener('resize', spy);
spy();

// Field switcher: every list marked data-sort puts the chosen field's items first (first-listed topic
// first), keeping page order otherwise. The page's own order is the biomedical one, so no-JS readers get that.
const LENSES = { bio: 'biomedical', sw: 'software', mech: 'mechanical' };
const lensBar = document.querySelector('[data-lens-bar]');
if (lensBar) {
  const lensStatus = lensBar.querySelector('[data-lens-status]');
  const lists = [...document.querySelectorAll('[data-sort]')].map((ul) => [ul, [...ul.children]]);
  const rank = (el, lens) => { const i = (el.dataset.topics || '').split(' ').indexOf(lens); return i < 0 ? 99 : i; };
  const setLens = (lens, announce) => {
    document.documentElement.dataset.lens = lens;
    lensBar.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.value === lens)));
    document.querySelectorAll('.lead[data-for]').forEach((p) => { p.hidden = p.dataset.for !== lens; });
    for (const [ul, items] of lists) {
      ul.append(...items.map((el, i) => [el, rank(el, lens), i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(([el]) => el));
    }
    if (announce) lensStatus.textContent = `Showing ${LENSES[lens]} work first.`;
  };
  lensBar.addEventListener('click', (e) => {
    const b = e.target.closest('button[value]');
    if (!b || !Object.hasOwn(LENSES, b.value)) return;
    setLens(b.value, true);
    const url = new URL(location.href);
    if (b.value === 'bio') url.searchParams.delete('focus'); else url.searchParams.set('focus', b.value);
    history.replaceState(null, '', url); // shareable: ?focus=sw or ?focus=mech
  });
  const asked = new URLSearchParams(location.search).get('focus');
  setLens(Object.hasOwn(LENSES, asked ?? "") ? asked : 'bio', false);
  lensBar.hidden = false;
}

// NEPHRON loop: the poster still without JS or with reduced motion; otherwise it plays, with a pause button (WCAG 2.2.2).
const loop = document.querySelector('.work-loop video');
if (loop) {
  const btn = loop.parentElement.querySelector('.loop-toggle');
  const play = (on) => { if (on) loop.play().catch(() => {}); else loop.pause(); btn.textContent = on ? 'Pause the loop' : 'Play the loop'; };
  btn.addEventListener('click', () => play(loop.paused));
  play(!reduced);
  btn.hidden = false;
}

// One reveal for the project rows.
const reveal = new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) { en.target.classList.add('is-in'); reveal.unobserve(en.target); }
}, { rootMargin: '0px 0px -10% 0px' });
document.documentElement.classList.add('js'); // hide-until-revealed only once the observer exists
document.querySelectorAll('.work').forEach((el) => reveal.observe(el));
