// ===================== Tactus visualizations (drawn behind the code) =====================
// roll: piano roll (1 bar past, 3 bars ahead) · grid: each track's 2-bar steps on its own code line
// spiral: one turn per bar · fft: spectrum. Future notes come straight from the patterns, not from audio.
var VZ = { mode: 'roll', ver: 0 };
try { VZ.mode = localStorage.getItem('pulse-viz') || 'roll'; } catch (e) { }
const VZ_OPACITY = { roll: 0.55, grid: 0.4, spiral: 0.5, fft: 0.45, off: 0 };
const VZ_GPU_OPACITY = { terrain: 1, contour: 1, dots: 1, demo: 0.55, sono: 1 };
const VZ_COLORS = TRACK_COLORS;
const vizCv = document.getElementById('viz'), vizG = vizCv.getContext('2d'), vizGpu = document.getElementById('vizgpu');

function vizCycle(def, n) {
  if (!def.vz || def.vzVer !== VZ.ver) { def.vz = new Map(); def.vzVer = VZ.ver; }
  let arr = def.vz.get(n);
  if (arr) return arr;
  arr = [];
  for (const ev of cycleEvents(def, n)) {
    if (def.kind === 'synth') {
      const P = evalParams(def, ev.s);
      const notes = atomNotes(ev.v, S.root, S.scale, Math.round(P.oct), def.fixed ? 0 : progAt(ev.s));
      if (notes) for (const m of notes) arr.push({ s: ev.s, d: ev.d * Math.max(0.05, P.len), m });
    } else arr.push({ s: ev.s, d: Math.min(ev.d, 1 / 16), m: null });
  }
  def.vz.set(n, arr);
  if (def.vz.size > 24) def.vz.delete(def.vz.keys().next().value);
  return arr;
}
function vizTracks(c) {
  const sc = sceneAt(c);
  return S.order.map((name, i) => {
    const def = S.tracks.get(name);
    return def && { def, name, color: VZ_COLORS[i % VZ_COLORS.length], on: audible(name) && activeIn(sc, name) };
  }).filter(Boolean);
}
function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill();
}
function noteAlpha(e, c, on) {
  if (!on) return 0.12;
  if (c >= e.s && c < e.s + e.d) return 1;
  return e.s > c ? 0.55 : 0.3;
}

function drawRoll(g, w, h, c, dpr) {
  const past = 1, fut = 3, span = past + fut, X = t => (t - c + past) / span * w;
  const tracks = vizTracks(c), notes = [], drums = [];
  let lo = 999, hi = -999;
  tracks.forEach(tr => {
    if (tr.def.kind === 'loop') return;
    for (let n = Math.floor(c - past); n < c + fut; n++) for (const e of vizCycle(tr.def, n)) {
      if (e.s + e.d < c - past || e.s > c + fut) continue;
      if (e.m == null) drums.push({ e, tr }); else { notes.push({ e, tr }); lo = Math.min(lo, e.m); hi = Math.max(hi, e.m); }
    }
  });
  const drumNames = [...new Set(drums.map(d => d.tr.name))];
  const drumH = drumNames.length ? Math.min(h * 0.28, drumNames.length * 9 * dpr) : 0;
  if (hi - lo < 24) { const mid = (hi + lo) / 2 || 60; lo = Math.floor(mid - 12); hi = Math.ceil(mid + 12); }
  const top = 8 * dpr, synH = h - drumH - top * 2, rowH = synH / (hi - lo + 1);
  // bar and beat lines
  g.lineWidth = dpr;
  for (let b = Math.floor(c - past) - 1; b <= c + fut; b++) for (let q = 0; q < 4; q++) {
    const x = X(b + q / 4); g.strokeStyle = q ? 'rgba(125,133,148,.10)' : 'rgba(125,133,148,.28)';
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
  }
  for (const { e, tr } of notes) {
    g.globalAlpha = noteAlpha(e, c, tr.on); g.fillStyle = tr.color;
    rrect(g, X(e.s), top + (hi - e.m) * rowH, Math.max(2 * dpr, e.d / span * w - dpr), Math.max(2 * dpr, rowH - dpr), 2 * dpr);
  }
  const dRow = drumH / Math.max(1, drumNames.length);
  for (const { e, tr } of drums) {
    g.globalAlpha = noteAlpha(e, c, tr.on); g.fillStyle = tr.color;
    rrect(g, X(e.s), h - drumH - top + drumNames.indexOf(tr.name) * dRow, Math.max(3 * dpr, e.d / span * w * 0.6), Math.max(2 * dpr, dRow - 2 * dpr), 2 * dpr);
  }
  g.globalAlpha = 1; g.strokeStyle = '#ff9a4d'; g.lineWidth = 2 * dpr;
  g.beginPath(); g.moveTo(X(c), 0); g.lineTo(X(c), h); g.stroke();
}

function drawGrid(g, w, h, c, dpr) {
  // each track's two bars, drawn on its own code line
  const cs = getComputedStyle(srcEl), padT = parseFloat(cs.paddingTop), sTop = srcEl.scrollTop;
  const bar0 = Math.floor(c), x0 = w * 0.42, gw = w - x0 - 12 * dpr, X = t => x0 + (t - bar0) / 2 * gw;
  g.lineWidth = dpr;
  for (let k = 0; k <= 32; k++) {
    g.strokeStyle = k % 16 === 0 ? 'rgba(125,133,148,.35)' : k % 4 === 0 ? 'rgba(125,133,148,.16)' : 'rgba(125,133,148,.06)';
    const x = X(bar0 + k / 16); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
  }
  for (const tr of vizTracks(c)) {
    if (tr.def.kind === 'loop') continue;
    const y = (padT + tr.def.line * lineH - sTop) * dpr;
    if (y < -lineH * dpr || y > h) continue;
    const rh = lineH * dpr - 6 * dpr;
    for (let n = bar0; n < bar0 + 2; n++) for (const e of vizCycle(tr.def, n)) {
      g.globalAlpha = noteAlpha(e, c, tr.on); g.fillStyle = tr.color;
      const ww = Math.max(3 * dpr, Math.min(e.d, bar0 + 2 - e.s) / 2 * gw - 2 * dpr);
      rrect(g, X(e.s) + dpr, y + 3 * dpr, ww, rh, 3 * dpr);
    }
  }
  g.globalAlpha = 1; g.strokeStyle = '#ff9a4d'; g.lineWidth = 2 * dpr;
  g.beginPath(); g.moveTo(X(c), 0); g.lineTo(X(c), h); g.stroke();
}

function drawSpiral(g, w, h, c, dpr) {
  const cx = w * 0.72, cy = h * 0.5, R = Math.min(w * 0.26, h * 0.46), turns = 4, r0 = R * 0.12;
  const rad = t => r0 + (t - (c - turns + 1)) / turns * (R - r0);
  const ang = t => (t % 1) * Math.PI * 2 - Math.PI / 2;
  g.strokeStyle = 'rgba(125,133,148,.18)'; g.lineWidth = dpr;
  g.beginPath();
  for (let t = c - turns + 1; t <= c + 1; t += 1 / 96) { const x = cx + Math.cos(ang(t)) * rad(t), y = cy + Math.sin(ang(t)) * rad(t); t === c - turns + 1 ? g.moveTo(x, y) : g.lineTo(x, y); }
  g.stroke();
  for (const tr of vizTracks(c)) {
    if (tr.def.kind === 'loop') continue;
    for (let n = Math.floor(c - turns + 1); n <= Math.floor(c + 1); n++) for (const e of vizCycle(tr.def, n)) {
      if (e.s < c - turns + 1 || e.s > c + 1) continue;
      g.globalAlpha = noteAlpha(e, c, tr.on); g.strokeStyle = tr.color; g.lineWidth = (e.m == null ? 5 : 7) * dpr; g.lineCap = 'round';
      const d = Math.max(e.d, 0.012), r = rad(e.s) + (e.m == null ? 0 : ((e.m % 12) - 6) * 0.6 * dpr);
      g.beginPath(); g.arc(cx, cy, Math.max(1, r), ang(e.s), ang(e.s) + d * Math.PI * 2); g.stroke();
    }
  }
  g.globalAlpha = 1; g.strokeStyle = '#ff9a4d'; g.lineWidth = 2 * dpr;
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ang(c)) * (R + 8 * dpr), cy + Math.sin(ang(c)) * (R + 8 * dpr)); g.stroke();
}

let vizFreq = null;
function drawFft(g, w, h, c, dpr) {
  if (!A.an) return;
  vizFreq = vizFreq || new Uint8Array(A.an.frequencyBinCount);
  A.an.getByteFrequencyData(vizFreq);
  const bands = 72, sr = S.ctx.sampleRate, bin = sr / A.an.fftSize;
  const bw = w / bands;
  for (let k = 0; k < bands; k++) {
    const f0 = 30 * Math.pow(16000 / 30, k / bands), f1 = 30 * Math.pow(16000 / 30, (k + 1) / bands);
    let m = 0; for (let j = Math.floor(f0 / bin); j <= Math.ceil(f1 / bin) && j < vizFreq.length; j++) m = Math.max(m, vizFreq[j]);
    const v = m / 255, bh = v * v * h * 0.9;
    g.fillStyle = VZ_COLORS[Math.min(4, Math.floor(k / bands * 5))];
    g.globalAlpha = 0.35 + 0.65 * v;
    rrect(g, k * bw + dpr, h - bh, Math.max(dpr, bw - 2 * dpr), bh, 2 * dpr);
  }
  g.globalAlpha = 1;
}

// a viz line in the code picks the backdrop (one per `per` bars) until a button overrides it
function vizModeAt(c) {
  const v = S.vizCode;
  if (!v || S.vizManual) return VZ.mode;
  return v.list[Math.floor(Math.max(0, c) / v.per) % v.list.length];
}
let vizShown = '';
function drawViz(now) {
  const dpr = devicePixelRatio || 1;
  const w = Math.round(vizCv.clientWidth * dpr), h = Math.round(vizCv.clientHeight * dpr);
  if (vizCv.width !== w || vizCv.height !== h) { vizCv.width = w; vizCv.height = h; }
  vizG.clearRect(0, 0, w, h);
  const c = S.playing ? transport(now) : 0, mode = vizModeAt(c);
  if (mode !== vizShown) { vizShown = mode; document.querySelectorAll('#vizbar button').forEach(b => { b.setAttribute('aria-pressed', b.dataset.v === mode); b.classList.toggle('bycode', !!S.vizCode && !S.vizManual && b.dataset.v === mode); }); }
  const custom = S.shaders && S.shaders.has(mode);
  const gpuMode = SCENE_MODES.includes(mode) || custom;
  vizCv.style.opacity = gpuMode ? 0 : VZ_OPACITY[mode] ?? 0.5;
  vizGpu.hidden = !gpuMode || !SCENE.ready;
  if (gpuMode) { vizGpu.style.opacity = custom ? 1 : VZ_GPU_OPACITY[mode]; drawScene(now, mode); return; }
  if (SCENE.ready && S.playing) sceneFrame(null, [], c, { sono: vizSono(c) });
  if (mode === 'off' || !w || !h) return;
  if (mode === 'roll') drawRoll(vizG, w, h, c, dpr);
  else if (mode === 'grid') drawGrid(vizG, w, h, c, dpr);
  else if (mode === 'spiral') drawSpiral(vizG, w, h, c, dpr);
  else if (mode === 'fft' && S.playing) drawFft(vizG, w, h, c, dpr);
}
// where the song is, for the whole-song sonogram: song mode maps the whole arrangement, live mode a 16-bar loop
function vizSono(c) {
  if (S.song && S.songMode) {
    const cur = sceneNameAt(c), T = S.song.total;
    return { pos: cur && cur.part ? cur.pos / T : 0, bars: T, live: !!(cur && cur.part), key: S.arrSrc, cuts: S.song.parts.slice(1).map(p => p.start / T) };
  }
  return { pos: (Math.max(0, c) % 16) / 16, bars: 16, live: true, key: 'live', cuts: [0.25, 0.5, 0.75] };
}
// GPU backdrops (gpu.js): each track's code line is a point the scene can react to
let sceneWarned = false;
function drawScene(now, mode) {
  if (!SCENE.ready) {
    if (!SCENE.loading && !SCENE.failed) sceneInit(vizGpu);
    if (SCENE.failed && !sceneWarned) { sceneWarned = true; loopMsg(t('sceneOff', { e: SCENE.err || 'WebGPU' }), 'bad', 6000); S.vizManual = true; setVizMode('roll'); }
    return;
  }
  const r = vizGpu.getBoundingClientRect(); if (!r.width || !r.height) return;
  const cs = getComputedStyle(srcEl), pt = parseFloat(cs.paddingTop), pl = parseFloat(cs.paddingLeft), em = [];
  for (const [line, name] of S.lineNames) {
    if (!S.tracks.has(name)) continue;
    const y = (pt + line * lineH + lineH / 2 - srcEl.scrollTop) / r.height;
    if (y < -0.1 || y > 1.1) continue;
    em.push({ line, y, x: Math.max(0, (pl + (name.length + 1) * charW - srcEl.scrollLeft) / r.width), col: Math.max(0, S.order.indexOf(name)) % 10 });
  }
  const rs = getComputedStyle(document.documentElement), ink = sceneRgb(rs.getPropertyValue('--fg'), [0.9, 0.91, 0.93]);
  const light = ink[0] + ink[1] + ink[2] < 1.5;
  // the demo scene is opaque; on a light page keep it faint so the code stays readable
  if (mode === 'demo') vizGpu.style.opacity = light ? 0.3 : VZ_GPU_OPACITY.demo;
  // the code's shader lines compile when a backdrop is showing; errors land on their own line
  if (S.shaders) for (const [n, sh] of S.shaders) {
    const e = SCENE.custom.get(n);
    if (!e || e.expr !== sh.expr) sceneCustom(n, sh.expr).then(ent => {
      if (S.shaders.get(n) !== sh || !ent.err) return;
      S.errors.set(sh.line, { msg: t('shaderErr', { e: ent.err }), col: 0, keep: true }); render(); updateStatus();
    });
    else if (e.err && !e.pending && S.shaders.get(n) === sh && !S.errors.has(sh.line)) { S.errors.set(sh.line, { msg: t('shaderErr', { e: e.err }), col: 0, keep: true }); render(); updateStatus(); }
  }
  const c = S.playing ? transport(now) : 0;
  sceneFrame(mode, em, c, { ink, accent: sceneRgb(rs.getPropertyValue('--k-orange'), [1, 0.6, 0.3]), sono: vizSono(c) });
}
function setVizMode(m) {
  VZ.mode = m;
  try { localStorage.setItem('pulse-viz', m); } catch (e) { }
  document.querySelectorAll('#vizbar button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === m));
}
document.getElementById('vizbar').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { if (S.vizCode) S.vizManual = true; setVizMode(b.dataset.v); vizShown = ''; } });
setVizMode(VZ.mode);
