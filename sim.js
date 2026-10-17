/* hyperspace sim */
const $ = id => document.getElementById(id);

const canvas = $('c');
const ctx = canvas.getContext('2d');
let DPR = window.devicePixelRatio || 1;

// grid
const CW = 120, CH = 90;
const CELL = 8;
const N = CW * CH;
const pot = new Float32Array(N);
const cost = new Float32Array(N);
const dist = new Float32Array(N);
const fx = new Float32Array(N);
const fy = new Float32Array(N);
const flowX = new Float32Array(N);
const flowY = new Float32Array(N);

// particles
const MAXP = 4000;
const px = new Float32Array(MAXP);
const py = new Float32Array(MAXP);
const pvx = new Float32Array(MAXP);
const pvy = new Float32Array(MAXP);
const plife = new Float32Array(MAXP);
let pcount = 0;

// gates
const gate = {
  enter: { x: 120, y: 360, ang: 0, half: 0.35, len: 140 },
  exit: { x: 840, y: 360, ang: Math.PI, half: 0.35, len: 140 }
};

// guide curve samples
const GUIDE = 128;
const gxs = new Float32Array(GUIDE);
const gys = new Float32Array(GUIDE);

// state
const state = {
  running: true,
  noise: true,
  curl: true,
  beacons: true,
  guide: true,
  pressure: false,
  showField: true,
  showHeight: true,
  noiseScale: 0.012,
  noiseAmp: 1.0,
  gradStr: 1.2,
  curlStr: 0.9,
  guideStr: 1.0,
  flowStr: 1.2,
  pcount: 600,
  speed: 1.0
};

let dragging = null; // 'enter' | 'exit'
let mouseX = 0, mouseY = 0;

function resize() {
  const w = window.innerWidth - 320;
  const h = window.innerHeight;
  canvas.width = Math.floor(w * DPR);
  canvas.height = Math.floor(h * DPR);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);

function idx(x, y) { return y * CW + x; }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

function distToGuide(px_, py_) {
  // nearest distance to sampled polyline
  let best = 1e9;
  for (let i = 0; i < GUIDE - 1; i++) {
    const ax = gxs[i], ay = gys[i];
    const bx = gxs[i + 1], by = gys[i + 1];
    const dx = bx - ax, dy = by - ay;
    const t = clamp(((px_ - ax) * dx + (py_ - ay) * dy) / (dx * dx + dy * dy + 1e-9), 0, 1);
    const cx = ax + dx * t, cy = ay + dy * t;
    const d = Math.hypot(px_ - cx, py_ - cy);
    if (d < best) best = d;
  }
  return best;
}

function sampleField(F, x, y) {
  const gx = clamp(Math.floor(x / CELL), 0, CW - 2);
  const gy = clamp(Math.floor(y / CELL), 0, CH - 2);
  const fx_ = (x / CELL) - gx;
  const fy_ = (y / CELL) - gy;
  const i00 = idx(gx, gy);
  const i10 = idx(gx + 1, gy);
  const i01 = idx(gx, gy + 1);
  const i11 = idx(gx + 1, gy + 1);
  const a = F[i00] * (1 - fx_) + F[i10] * fx_;
  const b = F[i01] * (1 - fx_) + F[i11] * fx_;
  return a * (1 - fy_) + b * fy_;
}

function regenerate() {
  // guide curve
  const ex = gate.enter.x, ey = gate.enter.y;
  const xx = gate.exit.x, xy = gate.exit.y;
  const mx = (ex + xx) * 0.5;
  const my = (ey + xy) * 0.5;
  const nx = -(xy - ey);
  const ny = (xx - ex);
  const nl = Math.hypot(nx, ny) || 1;
  const off = 120;
  const cx = mx + (nx / nl) * off;
  const cy = my + (ny / nl) * off;
  for (let i = 0; i < GUIDE; i++) {
    const t = i / (GUIDE - 1);
    const u = 1 - t;
    gxs[i] = u * u * ex + 2 * u * t * cx + t * t * xx;
    gys[i] = u * u * ey + 2 * u * t * cy + t * t * xy;
  }

  // potential
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const wx = x * CELL, wy = y * CELL;
      let v = 0;
      if (state.noise) {
        v += fbm2(wx * state.noiseScale, wy * state.noiseScale, 4) * state.noiseAmp;
      }
      // source/sink
      const dE = Math.hypot(wx - gate.enter.x, wy - gate.enter.y);
      const dX = Math.hypot(wx - gate.exit.x, wy - gate.exit.y);
      v += 2.0 * Math.exp(-(dE * dE) / (2 * 90 * 90));
      v -= 2.0 * Math.exp(-(dX * dX) / (2 * 90 * 90));
      if (state.guide) {
        const gd = distToGuide(wx, wy);
        v -= 1.5 * Math.exp(-(gd * gd) / (2 * 60 * 60));
      }
      pot[idx(x, y)] = v;
    }
  }
  // gradient
  for (let y = 1; y < CH - 1; y++) {
    for (let x = 1; x < CW - 1; x++) {
      const i = idx(x, y);
      const gxv = (pot[idx(x + 1, y)] - pot[idx(x - 1, y)]) * 0.5;
      const gyv = (pot[idx(x, y + 1)] - pot[idx(x, y - 1)]) * 0.5;
      fx[i] = -gxv * state.gradStr;
      fy[i] = -gyv * state.gradStr;
      if (state.curl) {
        fx[i] += -gyv * state.curlStr;
        fy[i] += gxv * state.curlStr;
      }
    }
  }
  // border zero
  for (let x = 0; x < CW; x++) { fx[idx(x, 0)] = 0; fy[idx(x, 0)] = 0; fx[idx(x, CH - 1)] = 0; fy[idx(x, CH - 1)] = 0; }
  for (let y = 0; y < CH; y++) { fx[idx(0, y)] = 0; fy[idx(0, y)] = 0; fx[idx(CW - 1, y)] = 0; fy[idx(CW - 1, y)] = 0; }

  if (state.pressure) {
    // cost field
    for (let y = 0; y < CH; y++) {
      for (let x = 0; x < CW; x++) {
        const i = idx(x, y);
        let c = 1.0;
        if (state.noise) c += Math.abs(pot[i]) * 0.6;
        if (state.guide) {
          const gd = distToGuide(x * CELL, y * CELL);
          c += (gd / 40) * 0.5;
        }
        cost[i] = c;
      }
    }
    // dijkstra from exit cell
    const exCell = { x: clamp(Math.floor(gate.exit.x / CELL), 0, CW - 1), y: clamp(Math.floor(gate.exit.y / CELL), 0, CH - 1) };
    const start = idx(exCell.x, exCell.y);
    dist.fill(Infinity);
    dist[start] = 0;
    // min heap
    const heap = [start];
    const push = (v) => { heap.push(v); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (dist[heap[p]] <= dist[heap[i]]) break; const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; while (true) { let l = i * 2 + 1, r = l + 1, m = i; if (l < heap.length && dist[heap[l]] < dist[heap[m]]) m = l; if (r < heap.length && dist[heap[r]] < dist[heap[m]]) m = r; if (m === i) break; const t = heap[i]; heap[i] = heap[m]; heap[m] = t; i = m; } } return top; };
    // standard
    const visited = new Uint8Array(N);
    // re-init heap properly
    heap.length = 0;
    heap.push(start);
    while (heap.length) {
      const u = pop();
      if (visited[u]) continue;
      visited[u] = 1;
      const ux = u % CW, uy = (u / CW) | 0;
      const neighbors = [];
      if (ux > 0) neighbors.push(u - 1);
      if (ux < CW - 1) neighbors.push(u + 1);
      if (uy > 0) neighbors.push(u - CW);
      if (uy < CH - 1) neighbors.push(u + CW);
      for (let k = 0; k < neighbors.length; k++) {
        const v = neighbors[k];
        if (visited[v]) continue;
        const w = cost[v];
        const nd = dist[u] + w;
        if (nd < dist[v]) { dist[v] = nd; push(v); }
      }
    }
    // flow gradient
    for (let y = 1; y < CH - 1; y++) {
      for (let x = 1; x < CW - 1; x++) {
        const i = idx(x, y);
        const gxv = (dist[idx(x + 1, y)] - dist[idx(x - 1, y)]) * 0.5;
        const gyv = (dist[idx(x, y + 1)] - dist[idx(x, y - 1)]) * 0.5;
        const mag = Math.hypot(gxv, gyv) || 1;
        flowX[i] = (-gxv / mag) * state.flowStr * 40;
        flowY[i] = (-gyv / mag) * state.flowStr * 40;
      }
    }
  }
}

function spawnParticles() {
  pcount = 0;
  const n = Math.min(state.pcount, MAXP);
  for (let i = 0; i < n; i++) {
    px[pcount] = gate.enter.x + (Math.random() - 0.5) * 20;
    py[pcount] = gate.enter.y + (Math.random() - 0.5) * 20;
    pvx[pcount] = 0;
    pvy[pcount] = 0;
    plife[pcount] = 1;
    pcount++;
  }
}

function inCone(g, x, y) {
  const dx = x - g.x, dy = y - g.y;
  const d = Math.hypot(dx, dy);
  if (d < 1 || d > g.len) return 0;
  const a = Math.atan2(dy, dx);
  let diff = a - g.ang;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) > g.half) return 0;
  return 1 - d / g.len;
}

function update(dt) {
  if (!state.running) return;
  // update velocity field arrays fx/fy possibly blended with flow
  // For pressure mode, override base with flow
  // We'll compute per-particle sampling of fx/fy or flowX/flowY
  const useFlow = state.pressure;
  for (let i = 0; i < pcount; i++) {
    const x = px[i], y = py[i];
    const ix = clamp(Math.floor(x / CELL), 1, CW - 2);
    const iy = clamp(Math.floor(y / CELL), 1, CH - 2);
    const i0 = idx(ix, iy);
    let vxv, vyv;
    if (useFlow) {
      vxv = sampleField(flowX, x, y);
      vyv = sampleField(flowY, x, y);
    } else {
      vxv = sampleField(fx, x, y);
      vyv = sampleField(fy, x, y);
    }
    // beacons cones
    if (state.beacons) {
      for (const key of ['enter', 'exit']) {
        const g = gate[key];
        const t = inCone(g, x, y);
        if (t > 0) {
          vxv += Math.cos(g.ang) * t * 60 * state.speed;
          vyv += Math.sin(g.ang) * t * 60 * state.speed;
        }
      }
    }
    // guide restoring force toward curve
    if (state.guide) {
      // find nearest point on guide
      let bestD = 1e9, bx = x, by = y;
      for (let j = 0; j < GUIDE; j++) {
        const d = Math.hypot(x - gxs[j], y - gys[j]);
        if (d < bestD) { bestD = d; bx = gxs[j]; by = gys[j]; }
      }
      const dx = bx - x, dy = by - y;
      const dd = Math.hypot(dx, dy) || 1;
      const force = clamp(bestD / 80, 0, 2) * state.guideStr * 20;
      vxv += (dx / dd) * force;
      vyv += (dy / dd) * force;
    }
    px[i] += vxv * dt * state.speed;
    py[i] += vyv * dt * state.speed;
    // bounds
    if (px[i] < 0 || px[i] > (CW - 1) * CELL || py[i] < 0 || py[i] > (CH - 1) * CELL) {
      // respawn
      px[i] = gate.enter.x + (Math.random() - 0.5) * 20;
      py[i] = gate.enter.y + (Math.random() - 0.5) * 20;
    }
    // reached exit?
    if (Math.hypot(px[i] - gate.exit.x, py[i] - gate.exit.y) < 24) {
      px[i] = gate.enter.x + (Math.random() - 0.5) * 20;
      py[i] = gate.enter.y + (Math.random() - 0.5) * 20;
    }
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

function render() {
  const w = canvas.width / DPR;
  const h = canvas.height / DPR;
  ctx.clearRect(0, 0, w, h);
  // heightmap
  if (state.showHeight) {
    if (!window._himg) {
      window._hcanvas = document.createElement('canvas');
      window._hcanvas.width = CW; window._hcanvas.height = CH;
      window._hctx = window._hcanvas.getContext('2d');
      window._himg = window._hctx.createImageData(CW, CH);
    }
    const img = window._himg;
    let min = 1e9, max = -1e9;
    for (let i = 0; i < N; i++) { if (pot[i] < min) min = pot[i]; if (pot[i] > max) max = pot[i]; }
    const rng = (max - min) || 1;
    for (let y = 0; y < CH; y++) {
      for (let x = 0; x < CW; x++) {
        const v = (pot[idx(x, y)] - min) / rng;
        const c = (v * 200) | 0;
        const off = (y * CW + x) * 4;
        img.data[off] = c;
        img.data[off + 1] = c;
        img.data[off + 2] = c + 40;
        img.data[off + 3] = 120;
      }
    }
    window._hctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(window._hcanvas, 0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
  }
  // field arrows
  if (state.showField) {
    ctx.strokeStyle = 'rgba(120,200,255,0.5)';
    ctx.lineWidth = 1;
    for (let y = 0; y < CH; y += 4) {
      for (let x = 0; x < CW; x += 4) {
        const i = idx(x, y);
        const vxv = state.pressure ? flowX[i] : fx[i];
        const vyv = state.pressure ? flowY[i] : fy[i];
        const sx = x * CELL + CELL * 0.5;
        const sy = y * CELL + CELL * 0.5;
        const ex = sx + vxv * 0.3;
        const ey = sy + vyv * 0.3;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
    }
  }
  // guide line
  if (state.guide) {
    ctx.strokeStyle = 'rgba(255,220,120,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gxs[0], gys[0]);
    for (let i = 1; i < GUIDE; i++) ctx.lineTo(gxs[i], gys[i]);
    ctx.stroke();
  }
  // cones
  if (state.beacons) {
    for (const key of ['enter', 'exit']) {
      const g = gate[key];
      ctx.fillStyle = key === 'enter' ? 'rgba(80,255,120,0.18)' : 'rgba(255,80,80,0.18)';
      ctx.beginPath();
      ctx.moveTo(g.x, g.y);
      ctx.arc(g.x, g.y, g.len, g.ang - g.half, g.ang + g.half);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = key === 'enter' ? 'rgba(80,255,120,0.6)' : 'rgba(255,80,80,0.6)';
      ctx.stroke();
    }
  }
  // particles
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < pcount; i++) {
    ctx.fillRect(px[i] - 1, py[i] - 1, 2, 2);
  }
  // gates markers
  for (const key of ['enter', 'exit']) {
    const g = gate[key];
    ctx.fillStyle = key === 'enter' ? '#4f4' : '#f44';
    ctx.beginPath();
    ctx.arc(g.x, g.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

// UI wiring
function wire() {
  const bind = (id, prop, parse) => {
    const el = $(id);
    if (!el) return;
    if (el.type === 'checkbox') {
      el.checked = state[prop];
      el.addEventListener('change', () => { state[prop] = el.checked; regenerate(); });
    } else {
      el.value = state[prop];
      el.addEventListener('input', () => { state[prop] = parse ? parse(el.value) : +el.value; if (id.startsWith('noise') || id === 'gradStr' || id === 'curlStr' || id === 'guideStr' || id === 'flowStr') regenerate(); if (id === 'pcount') spawnParticles(); });
    }
  };
  bind('mNoise', 'noise');
  bind('mCurl', 'curl');
  bind('mBeacons', 'beacons');
  bind('mGuide', 'guide');
  bind('mPressure', 'pressure');
  bind('mField', 'showField');
  bind('mHeight', 'showHeight');
  bind('noiseScale', 'noiseScale', parseFloat);
  bind('noiseAmp', 'noiseAmp', parseFloat);
  bind('gradStr', 'gradStr', parseFloat);
  bind('curlStr', 'curlStr', parseFloat);
  bind('guideStr', 'guideStr', parseFloat);
  bind('flowStr', 'flowStr', parseFloat);
  bind('pcount', 'pcount', v => +v);
  bind('speed', 'speed', parseFloat);

  $('regen').addEventListener('click', () => { regenerate(); spawnParticles(); });
  $('resetP').addEventListener('click', () => { spawnParticles(); });
  $('play').addEventListener('click', () => { state.running = !state.running; $('play').textContent = state.running ? 'Pause' : 'Play'; });

  canvas.addEventListener('mousedown', e => {
    const r = canvas.getBoundingClientRect();
    const mx = (e.clientX - r.left);
    const my = (e.clientY - r.top);
    if (Math.hypot(mx - gate.enter.x, my - gate.enter.y) < 12) dragging = 'enter';
    else if (Math.hypot(mx - gate.exit.x, my - gate.exit.y) < 12) dragging = 'exit';
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const r = canvas.getBoundingClientRect();
    const mx = (e.clientX - r.left);
    const my = (e.clientY - r.top);
    gate[dragging].x = mx;
    gate[dragging].y = my;
    regenerate();
  });
  window.addEventListener('mouseup', () => { if (dragging) { dragging = null; spawnParticles(); } });
}

// build UI panel
function buildUI() {
  const panel = document.createElement('aside');
  panel.id = 'panel';
  panel.innerHTML = `
  <h1>Hyperspace Sim</h1>
  <div class="group">
    <label><input type="checkbox" id="mNoise" checked> Noise heightmap</label>
    <label><input type="checkbox" id="mCurl" checked> Curl force</label>
    <label><input type="checkbox" id="mBeacons" checked> Gates as beacons (cones)</label>
    <label><input type="checkbox" id="mGuide" checked> Guide line valley</label>
    <label><input type="checkbox" id="mPressure"> Robust path (pressure/flow)</label>
    <label><input type="checkbox" id="mField" checked> Show field</label>
    <label><input type="checkbox" id="mHeight" checked> Show heightmap</label>
  </div>
  <div class="group">
    <label>Noise scale <input type="range" id="noiseScale" min="0.004" max="0.04" step="0.001" value="0.012"></label>
    <label>Noise amp <input type="range" id="noiseAmp" min="0" max="3" step="0.1" value="1"></label>
    <label>Grad str <input type="range" id="gradStr" min="0" max="3" step="0.1" value="1.2"></label>
    <label>Curl str <input type="range" id="curlStr" min="0" max="3" step="0.1" value="0.9"></label>
    <label>Guide str <input type="range" id="guideStr" min="0" max="3" step="0.1" value="1"></label>
    <label>Flow str <input type="range" id="flowStr" min="0.5" max="3" step="0.1" value="1.2"></label>
    <label>Particles <input type="range" id="pcount" min="100" max="3000" step="100" value="600"></label>
    <label>Speed <input type="range" id="speed" min="0.2" max="3" step="0.1" value="1"></label>
  </div>
  <div class="group">
    <button id="regen">Regenerate</button>
    <button id="resetP">Reset particles</button>
    <button id="play">Pause</button>
  </div>
  <p class="hint">Drag gates. Click handled internally.</p>
  `;
  document.body.appendChild(panel);
}

// init
buildUI();
resize();
regenerate();
spawnParticles();
wire();
requestAnimationFrame(loop);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { regenerate, update };
}
