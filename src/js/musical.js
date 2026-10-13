// ===================== Tactus musical layer =====================
// voice leading, voicings, improvised notes, arpeggiator, fills & transitions,
// per-section automation and master character.

// ---------- chords: voice leading + voicings ----------
// Pick the inversion/octave of each new chord that moves least from the previous one,
// while staying near the register the chord was written in. 'root' turns this off.
function voiceChord(def, notes, mode) {
  if (notes.length < 2 || mode === 'root') return notes;
  const sorted = [...notes].sort((a, b) => a - b);
  const center = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const prev = def.vl;
  let best = sorted, bestCost = Infinity;
  for (let inv = 0; inv < sorted.length; inv++) {
    const v = sorted.map((n, i) => (i < inv ? n + 12 : n)).sort((a, b) => a - b);
    for (const sh of [-12, 0, 12]) {
      const c = v.map(n => n + sh);
      const mean = c.reduce((a, b) => a + b, 0) / c.length;
      let cost = Math.abs(mean - center) * 0.7;
      if (prev && prev.length) for (const n of c) cost += Math.min(...prev.map(p => Math.abs(p - n)));
      if (cost < bestCost) { bestCost = cost; best = c; }
    }
  }
  def.vl = best;
  return shapeVoicing(best, mode);
}
function shapeVoicing(v, mode) {
  const s = [...v].sort((a, b) => a - b);
  if (mode === 'drop2' && s.length >= 3) { const i = s.length - 2; s[i] -= 12; return s.sort((a, b) => a - b); }
  if (mode === 'open' && s.length >= 3) return s.map((n, i) => (i % 2 === 1 ? n + 12 : n)).sort((a, b) => a - b);
  if (mode === 'spread' && s.length >= 3) { s[0] -= 12; s[s.length - 1] += 12; return s; }
  return s;
}

// ---------- improvised notes: the atom r ----------
// Strong beats lean on chord tones, weak beats move by step from the last note; deterministic per bar position.
function improvDegree(def, ev, P) {
  const range = Math.max(3, Math.round(P.range || 7));
  let last = def.lastDeg ?? 2;
  const rnd = k => hash01(ev.s * 91.7 + def.line * 13.1 + k * 7.3);
  const frac = ((ev.s % 1) + 1) % 1, beat = Math.abs(frac * 4 - Math.round(frac * 4)) < 1e-6;
  const cands = [], mid = range / 2;
  // a gentle pull toward the middle of the range keeps lines from sticking to the edges
  const pull = d => 1 / (1 + 0.18 * Math.abs(d - mid));
  if (beat) for (let d = -2; d <= range; d++) { if (mod(d, 7) % 2 === 0 && Math.abs(d - last) <= 4) cands.push([d, pull(d) * (d === last ? 0.4 : 1) / Math.pow(1 + Math.abs(d - last), 1.5)]); }
  else for (const st of [-2, -1, 1, 2, 0]) { const d = last + st; if (d >= -2 && d <= range) cands.push([d, pull(d) * (st === 0 ? 0.25 : Math.abs(st) === 1 ? 1 : 0.5)]); }
  if (!cands.length) cands.push([0, 1]);
  const tot = cands.reduce((a, c) => a + c[1], 0);
  let x = rnd(1) * tot, pick = cands[0][0];
  for (const [d, w] of cands) { x -= w; if (x <= 0) { pick = d; break; } }
  def.lastDeg = pick;
  return pick;
}

// ---------- arpeggiator ----------
function arpOrder(notes, mode, seed) {
  const up = [...notes].sort((a, b) => a - b);
  if (mode === 'down') return up.reverse();
  if (mode === 'updown') return up.length > 2 ? up.concat(up.slice(1, -1).reverse()) : up;
  if (mode === 'random') return up.map((n, i) => [n, hash01(seed + i * 3.7)]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
  return up;
}
function playArp(def, notes, c, d, P, vel, r) {
  const rate = Math.max(1, P.rate || 16), seq = arpOrder(notes, def.opts.arp, c * 31.3);
  const steps = Math.max(1, Math.round(d * rate)), stepDur = 1 / rate / S.cps;
  const now = S.ctx.currentTime;
  for (let k = 0; k < steps; k++) {
    const time = timeOf(c + k / rate) + (P.nudge || 0) / 1000;
    if (time < now) continue;
    playNotes(def, [seq[k % seq.length]], time, stepDur * P.len, P, vel * (k % 4 === 0 ? 1.12 : 0.92), r);
  }
}
function playNotes(def, notes, time, dur, P, vel, r) {
  if (SAMPLE_PITCHED.has(def.inst)) { for (const m of notes) registerVoice(r, playSamplePitched(def.inst, m, time, dur, P, vel, r.input)); return; }
  if (GPU_INSTS[def.inst]) {
    // GPU-rendered note if it is ready; until then (or without WebGPU) a CPU voice stands in
    const fb = GPU_INSTS[def.inst], miss = gpuPlay(def, notes, time, dur, P, vel, r);
    for (const m of miss) registerVoice(r, SAMPLE_PITCHED.has(fb) ? playSamplePitched(fb, m, time, dur, P, vel * 0.8, r.input) : playSynth(fb, m, time, dur, { ...P, cut: Math.min(P.cut, INST[fb].cut) }, vel * 0.8, r.input));
    return;
  }
  if (wkPlay(def, notes, time, dur, { ...P, gain: P.gain * vel, _vel: vel })) return;
  for (const m of notes) registerVoice(r, playSynth(def.inst === 'zither' ? 'pluck' : def.inst, m, time, dur, P, vel, r.input));
}

// ---------- scene transitions: fill, pause, swell, down, impact ----------
function sceneChangeAt(n) {
  const p = sceneNameAt(n - 1e-4), q = sceneNameAt(n);
  if (!q || (p && p.name === q.name)) return null;
  return S.scenes.get(q.name) || null;
}
const fxHas = (n, fx) => { const s = sceneChangeAt(n); return !!(s && s.fx.has(fx)); };
// the second half of the bar before a 'fill' scene belongs to the fill
const fillAt = n => (S.padFills && S.padFills.has(n)) || fxHas(n, 'fill');
function inFillHalf(c) { const n = Math.floor(c) + 1; return c >= n - 0.5 - EPS && fillAt(n); }
// the last eighth of a bar before a 'pause' scene is silent
function inPause(c) { const n = Math.floor(c) + 1; return c >= n - 0.125 - EPS && fxHas(n, 'pause'); }
function acousticKit() { for (const n of S.order) { const d = S.tracks.get(n); if (d && /^a(snare|hat|ohat|ride|crash|tom|floor)/.test(d.inst)) return true; } return false; }
// the fill itself: 8 sixteenths, snare → high tom → low tom → snare, getting louder
function playFill(a, b) {
  const now = S.ctx.currentTime;
  for (let n = Math.ceil(a); n <= Math.ceil(b) + 1; n++) {
    if (!fillAt(n)) continue;
    const ak = acousticKit() && KIT.ready;
    const kit = ak ? ['asnare', 'asnare', 'atom', 'atom', 'afloor', 'afloor', 'asnare', 'asnare'] : ['snare', 'snare', 'tom', 'tom', 'tom', 'tom', 'snare', 'snare'];
    const tune = [1, 1, 1.25, 1.25, 0.85, 0.85, 1, 1];
    for (let k = 0; k < 8; k++) {
      const c = n - 0.5 + k / 16;
      if (c < a - EPS || c >= b - EPS) continue;
      const time = timeOf(c);
      if (time < now - 0.02) continue;
      playDrum(kit[k], time, 0.6 + 0.55 * k / 7, { ...BASE, gain: 0.75, tune: ak ? 1 : tune[k] }, rt('__fill', true).input);
    }
  }
}
const fxDone = new Set();
function sceneLook(a, b) {
  const now = S.ctx.currentTime;
  for (let n = Math.ceil(a - EPS); n <= Math.ceil(b) + 2; n++) {
    const sc = sceneChangeAt(n);
    if (!sc) continue;
    const key = n + ':' + sc.name;
    // pause: drop the whole mix out for the last eighth of the bar, back on the downbeat
    if (sc.fx.has('pause') && !fxDone.has(key + 'p') && b > n - 0.125 - 0.05) {
      fxDone.add(key + 'p');
      const g = A.gate.gain, t0 = Math.max(now, timeOf(n - 0.125)), t1 = timeOf(n);
      g.setTargetAtTime(0, t0, 0.008); g.setValueAtTime(0, t1 - 0.002); g.setValueAtTime(1, t1);
    }
    // swell: a reversed cymbal that peaks exactly on the downbeat of the new scene
    if (sc.fx.has('swell') && !fxDone.has(key + 's') && b > n - 1 - 0.05) {
      fxDone.add(key + 's');
      const t1 = timeOf(n), t0 = Math.max(now + 0.01, timeOf(n - 1));
      if (t1 - t0 > 0.15) playSwell(t0, t1);
    }
    // fill: a crash on the downbeat it leads into
    if (sc.fx.has('fill') && !fxDone.has(key + 'c') && b > n - 0.05) {
      fxDone.add(key + 'c');
      // the crash comes from the same kit as the fill: recorded only when the song's own drums are recorded
      const ak = acousticKit() && KIT.ready && KIT.bufs.acrash;
      playDrum(ak ? 'acrash' : 'crash', Math.max(now, timeOf(n)), 1, { ...BASE, gain: ak ? 0.5 : 0.6 }, rt('__fill', true).input);
    }
    if (sc.fx.has('impact') && !fxDone.has(key + 'i') && b > n - 0.05) { fxDone.add(key + 'i'); impact(Math.max(now, timeOf(n))); }
    if (sc.fx.has('down') && !fxDone.has(key + 'd') && b > n - 0.05) { fxDone.add(key + 'd'); playDown(Math.max(now, timeOf(n)), 2 / S.cps); }
  }
  // fills started from a pad end on a crash too
  for (const n of S.padFills || []) {
    if (!fxDone.has(n + ':pc') && b > n - 0.05) { fxDone.add(n + ':pc'); const ak = acousticKit() && KIT.ready && KIT.bufs.acrash; playDrum(ak ? 'acrash' : 'crash', Math.max(now, timeOf(n)), 1, { ...BASE, gain: ak ? 0.5 : 0.6 }, rt('__fill', true).input); }
  }
  if (fxDone.size > 200) fxDone.clear();
}
let swellBuf = null;
function playSwell(t0, t1) {
  const ctx = S.ctx, dur = t1 - t0;
  const k = KIT.bufs.acrash && KIT.bufs.acrash.list[0];
  if (k && !swellBuf) {
    const src = k.buf, n = src.length, b = ctx.createBuffer(1, n, src.sampleRate), d = src.getChannelData(0), o = b.getChannelData(0);
    for (let i = 0; i < n; i++) o[i] = d[n - 1 - i];
    swellBuf = b;
  }
  const g = ctx.createGain(), hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 900;
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.5, t1 - 0.01); g.gain.setValueAtTime(0, t1);
  if (swellBuf) {
    const s = ctx.createBufferSource(); s.buffer = swellBuf;
    s.connect(hp).connect(g); g.connect(A.bus); g.connect(A.rIn);
    s.start(t0, Math.max(0, swellBuf.duration - dur)); s.stop(t1 + 0.01);
  } else {
    const s = noiseSrc(t0, dur); s.connect(hp).connect(g); g.connect(A.bus); g.connect(A.rIn);
  }
}
function playDown(t0, dur) {
  const ctx = S.ctx, s = noiseSrc(t0, dur), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  bp.type = 'bandpass'; bp.Q.value = 2; bp.frequency.setValueAtTime(7000, t0); bp.frequency.exponentialRampToValueAtTime(180, t0 + dur);
  g.gain.setValueAtTime(0.3, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  s.connect(bp).connect(g); g.connect(A.bus); g.connect(A.rIn);
}

// ---------- per-section automation ----------
// scene lines can carry "track.param value"; a>b ramps across the section (geometric for frequencies)
function sceneAuto(def, s, P) {
  if (!S.scenes.size) return;
  const x = sceneNameAt(s); if (!x) return;
  const sc = S.scenes.get(x.name); if (!sc || !sc.auto.length) return;
  let prog = null;
  for (const a of sc.auto) {
    if (a.track !== def.name) continue;
    if (a.v.k === 'sec') {
      if (prog === null) prog = x.part ? (x.pos - x.part.start) / x.part.bars : Math.min(1, Math.max(0, (s - (S.liveSince || 0)) / 4));
      const q = Math.max(0, Math.min(1, prog));
      P[a.param] = EXP_PARAMS.has(a.param) && a.v.a > 0 && a.v.b > 0 ? a.v.a * Math.pow(a.v.b / a.v.a, q) : a.v.a + (a.v.b - a.v.a) * q;
    } else { const v = valueAt(a.v, s, a.param); if (v !== null) P[a.param] = v; }
  }
}

// ---------- master character ----------
const MASTER = {
  default: { bus: 0.62, gT: -16, gR: 2.2, sat: 0.05, air: 2.5, lim: -1.5, trim: 0 },
  loud: { bus: 0.66, gT: -20, gR: 3, sat: 0.1, air: 3, lim: -1.2, trim: 3.5 },
  warm: { bus: 0.62, gT: -16, gR: 2, sat: 0.15, air: -2, lim: -1.5, trim: 1 },
  open: { bus: 0.62, gT: -12, gR: 1.6, sat: 0, air: 1.5, lim: -2.5, trim: 0 },
};
function applyMaster(mode) {
  S.masterMode = mode || 'default';
  if (!S.ctx || !A.glue) return;
  const m = MASTER[S.masterMode] || MASTER.default, now = S.ctx.currentTime;
  A.bus.gain.setTargetAtTime(m.bus, now, 0.05);
  A.glue.threshold.setTargetAtTime(m.gT, now, 0.05); A.glue.ratio.setTargetAtTime(m.gR, now, 0.05);
  // more drive = more harmonics, not more level: the waveshaper's gain is compensated against the default
  A.sat.curve = curve(m.sat); A.air.gain.setTargetAtTime(m.air, now, 0.05);
    // and a harder glue compressor would otherwise add its own makeup gain
  const d = MASTER.default, mk = compMakeupDb(d.gT, d.gR) - compMakeupDb(m.gT, m.gR);
  A.satOut.gain.setTargetAtTime(curveGain(d.sat) / curveGain(m.sat) * Math.pow(10, (mk + (m.trim || 0)) / 20), now, 0.05);
  A.lim.threshold.setTargetAtTime(m.lim, now, 0.05);
}
