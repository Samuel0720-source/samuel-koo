// 3D race: the same loop and the same five checkpoints as the 2D map, drivable with a chase camera.
// Loaded only when the visitor presses "Play 3D race" (built to /race3d.js with esbuild).
import {
  WebGLRenderer, Scene, PerspectiveCamera, Color, Fog, HemisphereLight, DirectionalLight, Vector3,
  BufferGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial, MeshBasicMaterial, PlaneGeometry,
  BoxGeometry, CylinderGeometry, ConeGeometry, SphereGeometry, Group, CanvasTexture, InstancedMesh, Object3D,
  PCFSoftShadowMap, SRGBColorSpace, RepeatWrapping, DoubleSide, MathUtils,
} from 'three';

const GATES = [
  { at: 0.1, num: '01', name: 'Projects', href: '#projects', tone: '--color-c1' },
  { at: 0.3, num: '02', name: 'Awards', href: '#awards', tone: '--color-c2' },
  { at: 0.5, num: '03', name: 'Experience', href: '#experience', tone: '--color-c3' },
  { at: 0.7, num: '04', name: 'Toolkit', href: '#toolkit', tone: '--color-c4' },
  { at: 0.9, num: '05', name: 'Contact', href: '#links', tone: '--color-c5' },
];
const SCALE = 1 / 6;        // SVG px to world units
const ROAD = 4;             // road width
const N = 480;              // samples along the loop
const MAX_V = 32, KMH = 6;  // top speed in units/s, and units/s to the km/h shown
const BEST_KEY = 'sk-race-best';

// CSS colour (any syntax the browser knows, oklch included) to a three.js Color, via a 1px canvas.
const probe = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
const css = (value) => { probe.clearRect(0, 0, 1, 1); probe.fillStyle = value; probe.fillRect(0, 0, 1, 1); const [r, g, b] = probe.getImageData(0, 0, 1, 1).data; return new Color(`rgb(${r},${g},${b})`); };
const token = (name) => css(getComputedStyle(document.documentElement).getPropertyValue(name).trim());

const fmt = (ms) => { const s = ms / 1000; const m = Math.floor(s / 60); return `${m}:${(s % 60).toFixed(2).padStart(5, '0')}`; };

export function startRace(figure) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const trackPath = document.getElementById('track');
  if (!trackPath) throw new Error('no track path');

  // ---------- the loop, sampled from the same SVG path the 2D map uses ----------
  const len = trackPath.getTotalLength();
  const raw = Array.from({ length: N }, (_, i) => trackPath.getPointAtLength((i / N) * len));
  const cx = raw.reduce((a, p) => a + p.x, 0) / N, cy = raw.reduce((a, p) => a + p.y, 0) / N;
  const P = raw.map((p) => new Vector3((p.x - cx) * SCALE, 0, (p.y - cy) * SCALE));
  const T = P.map((p, i) => P[(i + 1) % N].clone().sub(P[(i - 1 + N) % N]).normalize());
  const R = T.map((t) => new Vector3(-t.z, 0, t.x)); // right-hand side of travel
  const L = P.reduce((a, p, i) => a + p.distanceTo(P[(i + 1) % N]), 0);
  // signed curvature (positive = bending right), smoothed over a few samples
  const K0 = P.map((p, i) => T[(i + 1) % N].clone().sub(T[i]).dot(R[i]) / p.distanceTo(P[(i + 1) % N]));
  const K = K0.map((_, i) => { let a = 0; for (let j = -4; j <= 4; j++) a += K0[(i + j + N) % N]; return a / 9; });
  const sample = (s, out = new Vector3()) => { const f = (((s % 1) + 1) % 1) * N, i = Math.floor(f), k = f - i; return out.copy(P[i]).lerp(P[(i + 1) % N], k); };
  const tangent = (s, out = new Vector3()) => { const f = (((s % 1) + 1) % 1) * N, i = Math.floor(f), k = f - i; return out.copy(T[i]).lerp(T[(i + 1) % N], k).normalize(); };

  // ---------- renderer, scene, light ----------
  const paper = token('--color-paper'), field = css('oklch(74% 0.11 145)'), roadC = token('--color-road');
  const wrap = document.createElement('div');
  wrap.className = 'r3';
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'application');
  wrap.setAttribute('aria-label', '3D race. Arrow keys or W A S D to drive, Enter to open the checkpoint you are at, Escape to leave.');
  figure.classList.add('is-3d');
  figure.append(wrap);

  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  wrap.append(renderer.domElement);

  const scene = new Scene();
  scene.background = paper.clone();
  scene.fog = new Fog(paper, 45, 110);
  const camera = new PerspectiveCamera(58, 16 / 10, 0.1, 400);
  scene.add(new HemisphereLight(0xffffff, field.clone().multiplyScalar(0.6), 1.6));
  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const ground = new Mesh(new PlaneGeometry(400, 400), new MeshStandardMaterial({ color: field, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // A ribbon that follows the loop between two lateral offsets.
  const ribbon = (inner, outer, y, colorAt) => {
    const pos = [], col = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const j = i % N, a = P[j].clone().addScaledVector(R[j], inner), b = P[j].clone().addScaledVector(R[j], outer);
      pos.push(a.x, y, a.z, b.x, y, b.z);
      const c = colorAt ? colorAt(i) : new Color(1, 1, 1);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  const road = new Mesh(ribbon(-ROAD / 2, ROAD / 2, 0.02), new MeshStandardMaterial({ color: roadC, roughness: 0.85 }));
  road.receiveShadow = true;
  scene.add(road);
  const red = css('oklch(58% 0.2 28)'), white = new Color(0.96, 0.96, 0.96);
  const curbColor = (i) => (Math.floor(i / 6) % 2 ? red : white);
  const curbMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  for (const [a, b] of [[-ROAD / 2 - 0.45, -ROAD / 2], [ROAD / 2, ROAD / 2 + 0.45]]) {
    const curb = new Mesh(ribbon(a, b, 0.05, curbColor), curbMat);
    curb.receiveShadow = true;
    scene.add(curb);
  }
  // centre dashes
  const dash = new Mesh(ribbon(-0.08, 0.08, 0.035, (i) => (Math.floor(i / 4) % 2 ? roadC : white)), new MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
  scene.add(dash);

  // chequered start line
  const chk = document.createElement('canvas'); chk.width = 64; chk.height = 16;
  const cc = chk.getContext('2d');
  for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) { cc.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; cc.fillRect(x * 8, y * 8, 8, 8); }
  const chkTex = new CanvasTexture(chk); chkTex.colorSpace = SRGBColorSpace;
  const startLine = new Mesh(new PlaneGeometry(ROAD, 1), new MeshStandardMaterial({ map: chkTex, roughness: 0.8 }));
  startLine.rotation.x = -Math.PI / 2;
  startLine.position.copy(P[0]).setY(0.04);
  startLine.rotation.z = -Math.atan2(T[0].x, T[0].z);
  scene.add(startLine);

  // ---------- checkpoint arches ----------
  const banner = (g, color) => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = `#${color.getHexString()}`; x.fillRect(0, 0, 512, 128);
    x.fillStyle = '#16181d'; x.font = '700 64px Geist, system-ui, sans-serif'; x.textBaseline = 'middle'; x.textAlign = 'center';
    x.fillText(`${g.num}  ${g.name}`, 256, 68);
    const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.anisotropy = 4;
    return t;
  };
  const postGeo = new CylinderGeometry(0.14, 0.14, 3.2, 10);
  const dark = new MeshStandardMaterial({ color: 0x23262d, roughness: 0.5, metalness: 0.3 });
  for (const g of GATES) {
    const tone = token(g.tone), p = sample(g.at), t = tangent(g.at);
    const arch = new Group();
    for (const side of [-1, 1]) { const post = new Mesh(postGeo, dark); post.position.set(side * (ROAD / 2 + 0.7), 1.6, 0); post.castShadow = true; arch.add(post); }
    const beam = new Mesh(new BoxGeometry(ROAD + 1.8, 0.9, 0.18), [dark, dark, dark, dark, new MeshBasicMaterial({ map: banner(g, tone) }), new MeshBasicMaterial({ map: banner(g, tone) })]);
    beam.position.y = 3.0; beam.castShadow = true;
    arch.add(beam);
    arch.position.copy(p);
    arch.lookAt(p.clone().add(t));
    scene.add(arch);
    g.color = tone;
  }

  // ---------- trees (instanced), kept clear of the road ----------
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const spots = [];
  while (spots.length < 90) {
    const v = new Vector3((rnd() - 0.5) * 120, 0, (rnd() - 0.5) * 110);
    if (P.every((p) => p.distanceToSquared(v) > (ROAD / 2 + 3.2) ** 2)) spots.push(v);
  }
  const trunks = new InstancedMesh(new CylinderGeometry(0.15, 0.2, 1, 6), new MeshStandardMaterial({ color: 0x6b4f3a, roughness: 1 }), spots.length);
  const crowns = new InstancedMesh(new ConeGeometry(1, 2.6, 7), new MeshStandardMaterial({ color: css('oklch(55% 0.11 150)'), roughness: 0.9, flatShading: true }), spots.length);
  const o = new Object3D();
  spots.forEach((v, i) => {
    const h = 0.8 + rnd() * 0.7;
    o.position.set(v.x, 0.5 * h, v.z); o.scale.set(1, h, 1); o.rotation.set(0, 0, 0); o.updateMatrix(); trunks.setMatrixAt(i, o.matrix);
    o.position.set(v.x, h + 1.2 * h, v.z); o.scale.set(h, h, h); o.rotation.y = rnd() * 6; o.updateMatrix(); crowns.setMatrixAt(i, o.matrix);
  });
  trunks.castShadow = crowns.castShadow = true;
  scene.add(trunks, crowns);

  // ---------- the car (forward is +Z) ----------
  const car = new Group();
  const paint = new MeshStandardMaterial({ color: token('--color-c1'), roughness: 0.35, metalness: 0.2 });
  const carbon = new MeshStandardMaterial({ color: 0x1c1f25, roughness: 0.6 });
  const add = (geo, mat, x, y, z, rx = 0) => { const m = new Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; car.add(m); return m; };
  add(new BoxGeometry(0.62, 0.28, 2.1), paint, 0, 0.36, 0);                 // chassis
  add(new BoxGeometry(0.34, 0.2, 0.9), paint, 0, 0.32, 1.35);               // nose
  add(new BoxGeometry(1.5, 0.05, 0.32), carbon, 0, 0.2, 1.78);              // front wing
  add(new BoxGeometry(1.25, 0.08, 0.36), carbon, 0, 0.92, -1.05);           // rear wing
  for (const x of [-0.45, 0.45]) add(new BoxGeometry(0.05, 0.5, 0.36), carbon, x, 0.68, -1.05);
  for (const x of [-0.52, 0.52]) add(new BoxGeometry(0.34, 0.26, 1.0), paint, x, 0.34, -0.15); // sidepods
  add(new BoxGeometry(0.06, 0.29, 2.11), new MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4 }), 0, 0.365, 0); // stripe
  add(new SphereGeometry(0.2, 16, 12), new MeshStandardMaterial({ color: token('--color-c2'), roughness: 0.3 }), 0, 0.62, 0.05); // helmet
  const wheels = [];
  const tyre = new CylinderGeometry(0.3, 0.3, 0.28, 18); tyre.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-0.66, 0.95], [0.66, 0.95], [-0.7, -0.75], [0.7, -0.75]]) wheels.push(add(tyre, carbon, x, 0.3, z));
  scene.add(car);
  const shadowBlob = new Mesh(new PlaneGeometry(1.8, 2.8), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false, side: DoubleSide }));
  shadowBlob.rotation.x = -Math.PI / 2;
  scene.add(shadowBlob);

  // ---------- HUD ----------
  const el = (tag, cls, html = '') => { const n = document.createElement(tag); n.className = cls; n.innerHTML = html; return n; };
  const hud = el('div', 'r3-hud', '<span><b>Lap</b><i data-k="lap">1</i></span><span><b>Time</b><i data-k="time">0:00.00</i></span><span><b>Best</b><i data-k="best">–</i></span><span><b>Speed</b><i data-k="speed">0 km/h</i></span>');
  hud.setAttribute('aria-hidden', 'true');
  const count = el('div', 'r3-count'); count.setAttribute('aria-live', 'assertive');
  const toast = el('div', 'r3-toast', '<span class="r3-toast-text"></span><button type="button" class="r3-open"></button>');
  toast.setAttribute('role', 'status'); toast.hidden = true;
  const tools = el('div', 'r3-tools', '<button type="button" class="r3-fs" aria-label="Full screen" title="Full screen">⤢</button><button type="button" class="r3-exit" aria-label="Back to the map" title="Back to the map (Esc)">×</button>');
  const touch = el('div', 'r3-touch', '<button type="button" data-key="ArrowLeft" aria-label="Steer left">◀</button><button type="button" data-key="ArrowRight" aria-label="Steer right">▶</button><span></span><button type="button" data-key="ArrowDown" aria-label="Brake">Brake</button><button type="button" data-key="ArrowUp" aria-label="Accelerate">Go</button>');
  const help = el('p', 'r3-help', 'Arrow keys or WASD to drive. Enter opens a checkpoint.');
  wrap.append(hud, count, toast, tools, touch, help);
  const H = Object.fromEntries([...hud.querySelectorAll('[data-k]')].map((n) => [n.dataset.k, n]));
  let best = null; try { best = Number(localStorage.getItem(BEST_KEY)) || null; } catch { /* storage may be off */ }
  if (best) H.best.textContent = fmt(best);

  // ---------- state ----------
  const keys = new Set();
  let s = 0, u = 0, v = 0, uv = 0, steerVis = 0, lap = 1, lapStart = 0, nextGate = 0, nearGate = -1, running = false, raf = 0, last = 0, visible = true, shake = 0;
  let phase = 'intro', clock = 0, gateUntil = 0;
  const camPos = new Vector3(), camLook = new Vector3(), tmp = new Vector3(), fwd = new Vector3(), right = new Vector3();

  const gateOpen = (g) => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    const target = document.querySelector(g.href);
    if (!target) return;
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    const head = target.querySelector('h2');
    if (head) { head.setAttribute('tabindex', '-1'); head.focus({ preventScroll: true }); }
  };
  toast.querySelector('.r3-open').addEventListener('click', () => { if (nearGate >= 0) gateOpen(GATES[nearGate]); });

  const keyName = (e) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
  const DRIVE = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'];
  wrap.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = keyName(e);
    if (DRIVE.includes(k)) { e.preventDefault(); keys.add(k); }
    else if (k === 'Enter' && nearGate >= 0 && e.target === wrap) { e.preventDefault(); gateOpen(GATES[nearGate]); }
    else if (k === 'Escape' && !document.fullscreenElement) { e.preventDefault(); stop(); }
  });
  wrap.addEventListener('keyup', (e) => keys.delete(keyName(e)));
  wrap.addEventListener('focusout', () => keys.clear());
  touch.querySelectorAll('button').forEach((b) => {
    const on = (e) => { e.preventDefault(); keys.add(b.dataset.key); b.classList.add('is-on'); };
    const off = () => { keys.delete(b.dataset.key); b.classList.remove('is-on'); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
  });
  tools.querySelector('.r3-fs').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else figure.requestFullscreen?.().catch(() => {});
    wrap.focus({ preventScroll: true });
  });
  const onFs = () => { const b = tools.querySelector('.r3-fs'); const on = Boolean(document.fullscreenElement); b.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen'); b.title = b.getAttribute('aria-label'); };
  document.addEventListener('fullscreenchange', onFs);
  tools.querySelector('.r3-exit').addEventListener('click', () => stop());

  const resize = () => {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize); ro.observe(wrap);
  const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) loopStart(); }, { threshold: 0.05 });
  io.observe(wrap);
  const onVis = () => { if (!document.hidden) loopStart(); };
  document.addEventListener('visibilitychange', onVis);

  // ---------- one frame ----------
  const place = (dt) => {
    sample(s, tmp); tangent(s, fwd); right.set(-fwd.z, 0, fwd.x);
    const pos = tmp.addScaledVector(right, u);
    car.position.copy(pos);
    steerVis = MathUtils.lerp(steerVis, MathUtils.clamp(uv * 0.09, -0.35, 0.35), 1 - Math.exp(-dt * 10));
    car.lookAt(pos.clone().add(fwd));
    car.rotateY(-steerVis);
    car.rotateZ(steerVis * 0.25 * Math.min(1, Math.abs(v) / 15));
    wheels.forEach((w) => { w.rotation.x += (v * dt) / 0.3; });
    shadowBlob.position.set(pos.x, 0.045, pos.z);
    shadowBlob.rotation.z = -Math.atan2(fwd.x, fwd.z);
    sun.position.set(pos.x + 8, 16, pos.z + 6); sun.target.position.copy(pos);
    return pos;
  };

  const frame = (now) => {
    raf = 0;
    if (!running || !visible || document.hidden) { last = 0; return; }
    const dt = Math.min((now - (last || now)) / 1000, 0.05); last = now;
    clock += dt;

    // intro: a sweep from above to behind the car, then 3, 2, 1, Go
    if (phase === 'intro') {
      const k = reduced ? 1 : Math.min(clock / 2.2, 1);
      if (k >= 1) { phase = 'count'; clock = 0; }
    } else if (phase === 'count') {
      const n = 3 - Math.floor(clock / 0.7);
      count.textContent = n > 0 ? String(n) : 'Go';
      if (clock > 2.1) { phase = 'race'; lapStart = now; setTimeout(() => { count.textContent = ''; }, 600); }
    }

    // driving
    const racing = phase === 'race';
    const up = keys.has('ArrowUp') || keys.has('w'), down = keys.has('ArrowDown') || keys.has('s');
    const left = keys.has('ArrowLeft') || keys.has('a'), rgt = keys.has('ArrowRight') || keys.has('d');
    const off = Math.abs(u) > ROAD / 2;
    const top = off ? MAX_V * 0.45 : MAX_V;
    if (racing) {
      if (up) v += (v < 0 ? 40 : 16 * (1 - v / top)) * dt;
      else if (down) v -= (v > 0 ? 34 : 8) * dt;
      else v -= Math.sign(v) * Math.min(Math.abs(v), 6 * dt);
      if (v > top) v = MathUtils.lerp(v, top, 1 - Math.exp(-dt * 3));
      v = Math.max(v, -6);
      const grip = MathUtils.clamp(Math.abs(v) / 10, 0.25, 1);
      uv += ((rgt ? 1 : 0) - (left ? 1 : 0)) * 26 * grip * dt;
      // corners push the car wide: brake or steer to stay on the road
      uv -= K[Math.floor(s * N) % N] * v * Math.abs(v) * 0.96 * dt;
    }
    uv *= Math.exp(-dt * 5);
    u += uv * dt;
    const wall = ROAD / 2 + 1.4;
    if (Math.abs(u) > wall) { u = Math.sign(u) * wall; uv = 0; v *= 0.96; shake = 0.25; }
    const prev = s;
    s = (((s + (v * dt) / L) % 1) + 1) % 1;

    // gates and laps
    if (racing) {
      const crossed = (at) => v > 0 && prev < at && s >= at && s - prev < 0.5;
      if (nextGate < GATES.length && crossed(GATES[nextGate].at)) nextGate += 1;
      if (v > 0 && prev > 0.9 && s < 0.1) {
        if (nextGate === GATES.length) {
          const t = now - lapStart;
          if (!best || t < best) { best = t; H.best.textContent = fmt(best); try { localStorage.setItem(BEST_KEY, String(Math.round(best))); } catch { /* ignore */ } }
          count.textContent = `Lap ${lap}: ${fmt(t)}`; setTimeout(() => { if (phase === 'race') count.textContent = ''; }, 1400);
          lap += 1;
        }
        nextGate = 0; lapStart = now;
      }
      let near = GATES.findIndex((g) => Math.min(Math.abs(s - g.at), 1 - Math.abs(s - g.at)) < 0.03);
      if (near >= 0) gateUntil = now + 2500; else if (now < gateUntil) near = nearGate;
      if (near !== nearGate) {
        nearGate = near;
        toast.hidden = near < 0;
        if (near >= 0) {
          const g = GATES[near];
          toast.querySelector('.r3-toast-text').textContent = `Checkpoint ${g.num}, ${g.name}`;
          toast.querySelector('.r3-open').textContent = `Open ${g.name} (Enter)`;
          toast.style.setProperty('--gate', `#${g.color.getHexString()}`);
        }
      }
      H.time.textContent = fmt(now - lapStart);
    }
    H.lap.textContent = lap; H.speed.textContent = `${Math.round(Math.abs(v) * KMH)} km/h`;

    // camera
    const pos = place(dt);
    const behind = tmp.copy(pos).addScaledVector(fwd, -7.2).setY(3.1);
    const look = new Vector3().copy(pos).addScaledVector(fwd, 5).setY(0.8);
    if (phase === 'intro' && !reduced) {
      const k = MathUtils.smootherstep(Math.min(clock / 2.2, 1), 0, 1);
      behind.lerp(new Vector3(0, 70, 35), 1 - k); look.lerp(new Vector3(0, 0, 0), 1 - k);
      camPos.copy(behind); camLook.copy(look);
    } else {
      const f = 1 - Math.exp(-dt * 6);
      camPos.lerp(behind, f); camLook.lerp(look, f);
    }
    camera.position.copy(camPos);
    if (shake > 0 && !reduced) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; shake = Math.max(0, shake - dt); }
    if (off && Math.abs(v) > 8 && !reduced) shake = Math.max(shake, 0.06);
    camera.lookAt(camLook);
    const fov = reduced ? 58 : 58 + 14 * Math.min(Math.abs(v) / MAX_V, 1);
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = MathUtils.lerp(camera.fov, fov, 1 - Math.exp(-dt * 4)); camera.updateProjectionMatrix(); }

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  const loopStart = () => { if (running && !raf) raf = requestAnimationFrame(frame); };

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    ro.disconnect(); io.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    document.removeEventListener('fullscreenchange', onFs);
    renderer.dispose();
    scene.traverse((m) => { m.geometry?.dispose?.(); [].concat(m.material || []).forEach((x) => { x.map?.dispose?.(); x.dispose?.(); }); });
    wrap.remove();
    figure.classList.remove('is-3d');
    figure.dispatchEvent(new CustomEvent('race3d:stop'));
  }

  // start: car on the line, camera above
  s = 0.995; place(0);
  camPos.set(0, 70, 35); camLook.set(0, 0, 0);
  resize();
  running = true;
  wrap.focus({ preventScroll: true });
  loopStart();
  return { stop };
}
