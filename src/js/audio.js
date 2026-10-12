// ===================== Tactus audio engine + scheduler =====================
const LOOKAHEAD = 0.12;
const S = {
  ctx: null, playing: false, t0: 0, c0: 0, cps: 138 / 240, lastC: 0, timer: null,
  bpm: 138, root: 9, scale: 'minor', swing: 0, prog: null, progSrc: '', keySrc: 'A minor',
  tracks: new Map(), order: [], pending: null,
  errors: new Map(), lineNames: new Map(),
  muted: new Set(), solo: new Set(),
  knobs: [0.5, 0.5, 0.5, 0.5],
  pads: new Map(), padMute: [], padSet: [], padGate: null, padPitch: 0, padFills: new Set(), autos: new Map(), autoOff: [],
  stutter: null, breakdown: null, build: null,
  rt: new Map(), vis: [], dirty: true,
  scenes: new Map(), song: null, arrSrc: '', songMode: true, songStart: 0, songFrom: 0, songJump: null, songCue: 0, liveScene: null, nextScene: null,
};
const A = {}; // audio nodes
const OUT_GAIN = 0.95;

const transport = t => S.c0 + (t - S.t0) * S.cps;
const timeOf = c => S.t0 + (c - S.c0) / S.cps;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// WebAudio compressors add their own makeup gain (measured in Chrome: about 0.48·|threshold|·(1 − 1/ratio) dB for quiet input)
const compMakeupDb = (thr, ratio) => 0.48 * Math.abs(thr) * (1 - 1 / ratio);
let DRUM_SAT = 0.06, DRUM_THR = -10, DRUM_RATIO = 2.5, DRUM_TRIM_DB = 1.3;
function initAudio() {
  if (S.ctx) return;
  const ctx = S.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
  const bq = (type, f, q = 0.7, gain = 0) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = gain; return b; };
  // master: gesture filters → gentle glue compression → light tape saturation → brick-wall-ish limiter
  A.bus = g(0.62); A.post = g(1);
  A.hp = bq('highpass', 20); A.lp = bq('lowpass', 20000);
  A.glue = ctx.createDynamicsCompressor();
  A.glue.threshold.value = -16; A.glue.ratio.value = 2.2; A.glue.knee.value = 8; A.glue.attack.value = 0.025; A.glue.release.value = 0.22;
  A.sat = ctx.createWaveShaper(); A.sat.curve = curve(0.05); A.sat.oversample = '4x';
  A.lim = ctx.createDynamicsCompressor();
  A.lim.threshold.value = -1.5; A.lim.ratio.value = 20; A.lim.knee.value = 0; A.lim.attack.value = 0.0015; A.lim.release.value = 0.09;
  A.clip = A.lim; // capture point for resampling
  A.out = g(OUT_GAIN);
  A.an = ctx.createAnalyser(); A.an.fftSize = 2048;
  A.gate = g(1);
  A.dryG = g(1); A.bus.connect(A.dryG); A.dryG.connect(A.post);
  // performance chain: pad gate → filters → DJ isolator → bit crusher → glue
  A.fxGate = g(1); A.eqL = bq('lowshelf', 220, 0.7, 0); A.eqM = bq('peaking', 1100, 0.6, 0); A.eqH = bq('highshelf', 4500, 0.7, 0);
  A.crush = ctx.createWaveShaper();
  A.post.connect(A.gate); A.gate.connect(A.fxGate); A.fxGate.connect(A.hp); A.hp.connect(A.lp); A.lp.connect(A.eqL); A.eqL.connect(A.eqM); A.eqM.connect(A.eqH); A.eqH.connect(A.crush); A.crush.connect(A.glue);
  A.mud = bq('peaking', 280, 0.9, -1.5); A.air = bq('highshelf', 9500, 0.7, 2.5);
  // master EQ and stereo width, set from the master line's parameters (flat and 1 by default)
  A.mLow = bq('lowshelf', 110, 0.7, 0); A.mMid = bq('peaking', 1000, 0.7, 0); A.mHigh = bq('highshelf', 7500, 0.7, 0);
  A.glue.connect(A.mLow); A.mLow.connect(A.mMid); A.mMid.connect(A.mHigh); A.mHigh.connect(A.mud); A.mud.connect(A.air);
  A.wIn = g(1); A.wOut = ctx.createChannelMerger(2); A.wSplit = ctx.createChannelSplitter(2);
  A.wM = [g(1), g(0), g(0), g(1)];   // LL, RL, LR, RR
  A.air.connect(A.wIn); A.wIn.connect(A.wSplit);
  A.wSplit.connect(A.wM[0], 0); A.wSplit.connect(A.wM[1], 1); A.wSplit.connect(A.wM[2], 0); A.wSplit.connect(A.wM[3], 1);
  A.wM[0].connect(A.wOut, 0, 0); A.wM[1].connect(A.wOut, 0, 0); A.wM[2].connect(A.wOut, 0, 1); A.wM[3].connect(A.wOut, 0, 1);
  A.satOut = g(1); A.wOut.connect(A.sat); A.sat.connect(A.satOut); A.satOut.connect(A.lim);
  // safety: transparent below -1.4 dBFS, rounds off the few fast transients the limiter lets through
  A.safe = ctx.createWaveShaper(); A.safe.oversample = '4x';
  { const n = 4096, c = new Float32Array(n), t = 0.85; for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1, a = Math.abs(x); c[i] = a <= t ? x : Math.sign(x) * (t + (1 - t) * Math.tanh((a - t) / (1 - t))); } A.safe.curve = c; }
  A.lim.connect(A.safe); A.safe.connect(A.out); A.out.connect(A.an); A.an.connect(ctx.destination);
  // stereo ping-pong delay (dotted 8th), filtered so repeats sit behind the dry sound
  A.dIn = g(1); A.dHP = bq('highpass', 300);
  A.dlL = ctx.createDelay(4); A.dlR = ctx.createDelay(4);
  A.dls = [A.dlL, A.dlR]; A.dl = A.dlL;
  for (const d of A.dls) d.delayTime.value = (S.dlSteps || 3) / 16 / S.cps;
  A.dLP = bq('lowpass', 4200); A.dFb = g(0.42);
  A.dMerge = ctx.createChannelMerger(2); A.dOut = g(0.75);
  A.dIn.connect(A.dHP); A.dHP.connect(A.dlL); A.dlL.connect(A.dlR); A.dlR.connect(A.dLP); A.dLP.connect(A.dFb); A.dFb.connect(A.dlL);
  A.dlL.connect(A.dMerge, 0, 0); A.dlR.connect(A.dMerge, 0, 1); A.dMerge.connect(A.dOut); A.dDuck = g(1); A.dOut.connect(A.dDuck); A.dDuck.connect(A.post);
  A.throw = g(0); A.bus.connect(A.throw); A.throw.connect(A.dIn);
  A.vthrow = g(0); A.bus.connect(A.vthrow);
  // reverb: pre-delay → generated hall (early reflections + damped stereo tail) → cleaned of mud and fizz
  A.rIn = g(1); A.rPre = ctx.createDelay(0.2); A.rPre.delayTime.value = 0.022;
  A.cv = ctx.createConvolver(); A.cv.buffer = impulse(3.4);
  A.rHP = bq('highpass', 240); A.rLP = bq('lowpass', 8500); A.rOut = g(0.85);
  A.vthrow.connect(A.rIn); A.rIn.connect(A.rPre); A.rPre.connect(A.cv); A.cvG = g(1); A.cv.connect(A.cvG); A.cvG.connect(A.rHP); A.rHP.connect(A.rLP); A.rLP.connect(A.rOut); A.rDuck = g(1); A.rOut.connect(A.rDuck); A.rDuck.connect(A.post);
  // noise: white for hats and transients, pink for warmer snare and clap bodies
  const sr = ctx.sampleRate, nb = ctx.createBuffer(1, sr * 2, sr), pb = ctx.createBuffer(1, sr * 2, sr);
  const w = nb.getChannelData(0), p = pb.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < w.length; i++) {
    const x = Math.random() * 2 - 1; w[i] = x;
    b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11; b6 = x * 0.115926;
  }
  A.noise = nb; A.pink = pb;
  // drum bus: the kit is compressed and saturated together so it sounds like one instrument
  A.drumIn = g(1); A.drumComp = ctx.createDynamicsCompressor();
  A.drumComp.threshold.value = DRUM_THR; A.drumComp.ratio.value = DRUM_RATIO; A.drumComp.knee.value = 6; A.drumComp.attack.value = 0.008; A.drumComp.release.value = 0.12;
  A.drumSat = ctx.createWaveShaper(); A.drumSat.curve = curveN(DRUM_SAT); A.drumSat.oversample = '2x';
  A.drumOut = g(Math.pow(10, (DRUM_TRIM_DB - compMakeupDb(DRUM_THR, DRUM_RATIO)) / 20));
  A.synIn = ctx.createDelay(0.05); A.synIn.delayTime.value = 0.006; A.synIn.connect(A.bus);
  A.drumIn.connect(A.drumComp); A.drumComp.connect(A.drumSat); A.drumSat.connect(A.drumOut); A.drumOut.connect(A.bus);
  // a long FFT on the finished mix, read by the spectral freeze pad
  A.frz = ctx.createAnalyser(); A.frz.fftSize = 32768; A.frz.smoothingTimeConstant = 0; A.lim.connect(A.frz);
  ensureSynthWorklet(); loadKit(); applyMaster(S.masterMode); gpuInit().then(gpuPrewarm);
  mixSync();
  if (S.space && S.space !== 'hall-default') applySpace(S.space);
}
// a hall impulse: sparse early reflections, then a decorrelated stereo tail whose highs die faster than its lows
// reverb spaces: 'space <name>' renders that space's modes on the GPU; without one, an algorithmic tail of
// the same length. Without a space line the original hall stays. The new convolver fades in over the old.
async function applySpace(name) {
  const ctx = S.ctx; if (!ctx || !A.cv) return;
  const tok = A.spaceTok = (A.spaceTok || 0) + 1, sp = name && SPACES[name];
  let buf = null;
  S.spaceInfo = { name, state: 'rendering' }; S.dirty = true;
  if (sp && await gpuInit()) {
    try { const r = await modalIR(name, ctx.sampleRate); buf = r.buf; S.spaceInfo = { name, state: 'gpu', modes: r.modes, ms: r.ms }; }
    catch (e) { GPU.err = String(e.message || e); }
  }
  if (tok !== A.spaceTok) return;
  if (!buf) { buf = impulse(sp ? Math.min(8, sp.t60 * 1.25) : 3.4); S.spaceInfo = { name, state: sp ? 'cpu' : 'default' }; }
  const cv = ctx.createConvolver(); cv.buffer = buf;
  const gN = ctx.createGain(); gN.gain.value = 0;
  A.rPre.connect(cv); cv.connect(gN); gN.connect(A.rHP);
  const now = ctx.currentTime, oldCv = A.cv, oldG = A.cvG;
  gN.gain.setTargetAtTime(1, now, 0.12); oldG.gain.setTargetAtTime(0, now, 0.12);
  A.rPre.delayTime.setTargetAtTime(sp ? sp.pre : 0.022, now, 0.05); if (S.mixLast) delete S.mixLast.vp;
  A.cv = cv; A.cvG = gN; S.dirty = true;
  setTimeout(() => { try { A.rPre.disconnect(oldCv); oldCv.disconnect(); oldG.disconnect(); } catch (e) { } }, 1500);
}
function impulse(sec) {
  const ctx = S.ctx, sr = ctx.sampleRate, len = Math.floor(sr * sec), b = ctx.createBuffer(2, len, sr);
  const rt60 = sec * 0.8;
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let y = 0, a = 0;
    for (let i = 0; i < len; i++) {
      if ((i & 255) === 0) { const t = i / sr, fc = 1400 + 9000 * Math.exp(-t * 1.6); a = Math.exp(-2 * Math.PI * fc / sr); }
      y = (1 - a) * (Math.random() * 2 - 1) + a * y;
      const t = i / sr, env = Math.exp(-6.9 * t / rt60) * Math.min(1, t / 0.012);
      d[i] = y * env * 2.2;
    }
    for (let k = 0; k < 10; k++) {
      const at = Math.floor(sr * (0.006 + Math.random() * 0.075)), gain = (0.6 - k * 0.045) * (Math.random() < 0.5 ? -1 : 1);
      for (let j = 0; j < 48 && at + j < len; j++) d[at + j] += gain * Math.exp(-j / 9) * (Math.random() * 0.5 + 0.5);
    }
  }
  return b;
}
const curves = new Map();
function curve(k) {
  k = Math.round(k * 20) / 20;
  if (curves.has(k)) return curves.get(k);
  const n = 2048, c = new Float32Array(n), a = 1 + k * 10, nrm = Math.tanh(a);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * a) / nrm; }
  curves.set(k, c); return c;
}
// small-signal gain of curve(k): used to keep levels steady when the drive changes
const curveGain = k => { const a = 1 + Math.round(k * 20) / 20 * 10; return a / Math.tanh(a); };
// level-neutral soft clipper: unity gain for quiet signals, rounds off only the peaks
function curveN(k) {
  const key = 'n' + k; if (curves.has(key)) return curves.get(key);
  const n = 2048, c = new Float32Array(n), a = 1 + k * 10;
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * a) / a; }
  curves.set(key, c); return c;
}

// each track gets a channel strip: high-pass for clarity, low/high shelves, sidechain ducker, sends
function rt(name, drum) {
  let r = S.rt.get(name);
  if (r) return r;
  r = makeStrip(drum ? A.drumIn : A.synIn);
  S.rt.set(name, r);
  return r;
}
// the channel strip shared by tracks and buses:
// input → high-pass → low shelf → mid bell → high shelf → low-pass → distortion → bit crush → compressor
//       → (dry + chorus + phaser) → ducker → out, with sends to the delay, the reverb and the code's buses.
// The modulation effects are built the first time a strip asks for them.
function makeStrip(dest) {
  const ctx = S.ctx, bq = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const g = v => { const n = ctx.createGain(); n.gain.value = v; return n; };
  const r = { input: g(1), hpf: bq('highpass', 20, 0.6), low: bq('lowshelf', 200), mid: bq('peaking', 1000, 0.8), high: bq('highshelf', 6500), lpf: bq('peaking', 20000, 0.6),
    dist: ctx.createWaveShaper(), distG: g(1), crush: ctx.createWaveShaper(), comp: ctx.createDynamicsCompressor(), modIn: g(1), dry: g(1), duck: g(1), dS: g(0), rS: g(0), sends: new Map(), dest, st: {} };
  r.comp.threshold.value = 0; r.comp.ratio.value = 1; r.comp.attack.value = 0.005; r.comp.release.value = 0.15; r.comp.knee.value = 6;
  r.input.connect(r.hpf); r.hpf.connect(r.low); r.low.connect(r.mid); r.mid.connect(r.high); r.high.connect(r.lpf); r.lpf.connect(r.dist); r.dist.connect(r.distG);
  r.distG.connect(r.crush); r.crush.connect(r.comp); r.comp.connect(r.modIn); r.modIn.connect(r.dry); r.dry.connect(r.duck);
  r.duck.connect(dest); r.duck.connect(r.dS); r.duck.connect(r.rS);
  r.dS.connect(A.dIn); r.rS.connect(A.rIn);
  return r;
}
// stereo chorus: two delays swept by slow sines in opposite phase, one per side
function stripChorus(r) {
  if (r.cho) return r.cho;
  const ctx = S.ctx, c = r.cho = { wet: ctx.createGain(), merge: ctx.createChannelMerger(2) };
  c.wet.gain.value = 0;
  [0, 1].forEach(side => {
    const d = ctx.createDelay(0.05), lfo = ctx.createOscillator(), depth = ctx.createGain();
    d.delayTime.value = 0.014 + side * 0.004; lfo.frequency.value = 0.6 + side * 0.17; depth.gain.value = 0.0028;
    lfo.connect(depth); depth.connect(d.delayTime); lfo.start();
    const mono = ctx.createGain(); mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
    r.modIn.connect(mono); mono.connect(d); d.connect(c.merge, 0, side);
  });
  c.merge.connect(c.wet); c.wet.connect(r.duck);
  return c;
}
// phaser: four all-pass stages swept together; mixed with the dry signal they cut moving notches
function stripPhaser(r) {
  if (r.ph) return r.ph;
  const ctx = S.ctx, p = r.ph = { wet: ctx.createGain() };
  p.wet.gain.value = 0;
  const lfo = ctx.createOscillator(), depth = ctx.createGain(); lfo.frequency.value = 0.35; depth.gain.value = 700; lfo.connect(depth); lfo.start();
  let node = r.modIn;
  for (let k = 0; k < 4; k++) { const ap = ctx.createBiquadFilter(); ap.type = 'allpass'; ap.frequency.value = 900 + k * 250; ap.Q.value = 0.6; depth.connect(ap.frequency); node.connect(ap); node = ap; }
  node.connect(p.wet); p.wet.connect(r.duck);
  return p;
}
const bitCurves = new Map();
function bitCurve(bits) {
  if (bitCurves.has(bits)) return bitCurves.get(bits);
  const n = 8192, c = new Float32Array(n), q = Math.pow(2, bits - 1);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.round(x * q) / q; }
  bitCurves.set(bits, c); return c;
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function stripAt(r, P, time) {
  const st = r.st;
  r.dS.gain.setValueAtTime(Math.max(0, P.delay || 0), time);
  r.rS.gain.setValueAtTime(Math.max(0, P.verb || 0), time);
  r.hpf.frequency.setValueAtTime(clamp(P.hpf ?? 20, 20, 2000), time);
  r.low.gain.setValueAtTime(clamp(P.low || 0, -24, 12), time);
  r.high.gain.setValueAtTime(clamp(P.high || 0, -24, 12), time);
  if (P.mid || st.mid) { r.mid.gain.setValueAtTime(clamp(P.mid || 0, -24, 12), time); r.mid.frequency.setValueAtTime(clamp(P.midf || 1000, 60, 12000), time); st.mid = !!P.mid; }
  // without lpf the filter is a 0 dB bell, which passes everything untouched
  if (P.lpf) { if (r.lpf.type !== 'lowpass') r.lpf.type = 'lowpass'; r.lpf.frequency.setValueAtTime(clamp(P.lpf, 60, Math.min(20000, S.ctx.sampleRate * 0.45)), time); }
  else if (r.lpf.type !== 'peaking') { r.lpf.type = 'peaking'; r.lpf.gain.value = 0; }
  // distortion and bit crush only touch the waveshaper's curve when the amount changes
  const dk = Math.round(clamp(P.dist || 0, 0, 1) * 20) / 20;
  if (dk !== (st.dist || 0)) { st.dist = dk; r.dist.curve = dk ? curve(dk) : null; r.dist.oversample = dk ? '2x' : 'none'; r.distG.gain.setValueAtTime(dk ? 1 / Math.sqrt(curveGain(dk)) : 1, time); }
  const bits = P.crush > 0.02 ? Math.round(16 - clamp(P.crush, 0, 1) * 13) : 0;
  if (bits !== (st.bits || 0)) { st.bits = bits; r.crush.curve = bits ? bitCurve(bits) : null; }
  // compressor: 'comp' is one knob; thr / ratio / catk / crel set it by hand
  const cp = clamp(P.comp || 0, 0, 1), thr = P.thr != null ? clamp(P.thr, -60, 0) : -cp * 30, ratio = P.ratio != null ? clamp(P.ratio, 1, 20) : 1 + cp * 5;
  r.comp.threshold.setValueAtTime(thr, time); r.comp.ratio.setValueAtTime(ratio, time);
  if (P.catk != null) r.comp.attack.setValueAtTime(clamp(P.catk, 0.1, 500) / 1000, time);
  if (P.crel != null) r.comp.release.setValueAtTime(clamp(P.crel, 10, 2000) / 1000, time);
  if (P.chorus > 0 || r.cho) stripChorus(r).wet.gain.setTargetAtTime(clamp(P.chorus || 0, 0, 1) * 0.7, time, 0.02);
  if (P.phaser > 0 || r.ph) stripPhaser(r).wet.gain.setTargetAtTime(clamp(P.phaser || 0, 0, 1) * 0.9, time, 0.02);
  // sends to the code's buses: a track parameter named after the bus
  if (S.busRt && S.busRt.size) for (const [bn, b] of S.busRt) {
    if (b === r) continue;
    const amt = Math.max(0, P[bn] || 0);
    let sg = r.sends.get(bn);
    if (!sg && amt > 0) { sg = S.ctx.createGain(); sg.gain.value = 0; r.duck.connect(sg); sg.connect(b.input); r.sends.set(bn, sg); }
    if (sg) sg.gain.setValueAtTime(amt, time);
  }
}

// ---------- params ----------
const BASE = { gain: 0.8, pan: 0, delay: 0, verb: 0, duck: 0, len: 1, shape: 0, detune: 18, tune: 1, dec: 1, hpf: 20, low: 0, high: 0, drive: 0, width: 0.7, vib: 0, slide: 0, acc: 0, bright: 0.6, wave: 0, vel: 1, nudge: 0, human: 0, swing: 0, sgrid: 16, comp: 0, rate: 16, tr: 0, range: 7 };
// slope: filter steepness in dB/octave. hpf: default track high-pass so pads and leads leave room for kick and bass
const INST = {
  sine: { lvl: 0.42, oct: 4, cut: 9000, res: 0.5, env: 0, atk: 0.005, dec: 0.3, sus: 0.8, rel: 0.15, slope: 12 },
  tri: { lvl: 0.55, oct: 4, cut: 6000, res: 1, env: 0.2, atk: 0.005, dec: 0.25, sus: 0.6, rel: 0.15, slope: 12, hpf: 60 },
  saw: { lvl: 0.32, oct: 3, cut: 2000, res: 2, env: 0.4, atk: 0.005, dec: 0.25, sus: 0.5, rel: 0.15, slope: 24, hpf: 40 },
  square: { lvl: 0.28, oct: 3, cut: 1800, res: 2, env: 0.4, atk: 0.005, dec: 0.25, sus: 0.5, rel: 0.15, slope: 24, hpf: 40 },
  supersaw: { lvl: 0.24, oct: 4, cut: 3600, res: 1, env: 0.3, atk: 0.012, dec: 0.3, sus: 0.75, rel: 0.3, gain: 0.6, slope: 24, hpf: 140, width: 0.85 },
  pad: { lvl: 0.2, oct: 3, cut: 2200, res: 0.8, env: 0.12, atk: 0.4, dec: 0.9, sus: 0.85, rel: 1.4, detune: 24, gain: 0.5, slope: 24, hpf: 160, width: 1, vib: 4 },
  bass: { lvl: 0.33, oct: 1, cut: 650, res: 2.5, env: 0.5, atk: 0.003, dec: 0.18, sus: 0.6, rel: 0.08, slope: 24, drive: 0.15, width: 0 },
  acid: { lvl: 0.32, oct: 2, cut: 380, res: 14, env: 0.9, atk: 0.003, dec: 0.16, sus: 0.2, rel: 0.06, gain: 0.7, slope: 24, drive: 0.35, hpf: 40, width: 0 },
  pluck: { lvl: 0.3, oct: 4, cut: 2600, res: 2, env: 0.8, atk: 0.002, dec: 0.16, sus: 0, rel: 0.25, gain: 0.6, slope: 24, hpf: 120, width: 0.5 },
  bell: { lvl: 0.34, oct: 5, cut: 9000, res: 0.5, env: 0, atk: 0.002, dec: 1.2, sus: 0, rel: 0.8, gain: 0.45, slope: 12, hpf: 200, width: 0.4 },
  flute: { lvl: 0.42, oct: 5, cut: 7000, res: 0.5, env: 0, atk: 0.08, dec: 0.4, sus: 0.85, rel: 0.25, slope: 12, hpf: 180, vib: 10 },
  bowed: { lvl: 0.24, oct: 4, cut: 2600, res: 1, env: 0.1, atk: 0.14, dec: 0.5, sus: 0.9, rel: 0.4, slope: 24, hpf: 150, vib: 14, drive: 0.1 },
  piano: { lvl: 0.85, oct: 4, cut: 20000, res: 0.7, env: 0, atk: 0.002, dec: 1, sus: 1, rel: 0.45, slope: 12, hpf: 40 },
  vibes: { lvl: 0.8, oct: 4, cut: 20000, res: 0.7, env: 0, atk: 0.002, dec: 1, sus: 1, rel: 0.9, slope: 12, hpf: 120 },
  harp: { lvl: 0.9, oct: 4, cut: 20000, res: 0.7, env: 0, atk: 0.002, dec: 1, sus: 1, rel: 1.2, slope: 12, hpf: 60 },
  sax: { lvl: 0.75, oct: 3, cut: 20000, res: 0.7, env: 0, atk: 0.015, dec: 1, sus: 1, rel: 0.12, slope: 12, hpf: 90 },
  dantranh: { lvl: 0.85, oct: 4, cut: 20000, res: 0.7, env: 0, atk: 0.002, dec: 1, sus: 1, rel: 0.9, slope: 12, hpf: 90 },
  harpsi: { lvl: 0.75, oct: 4, cut: 20000, res: 0.7, env: 0, atk: 0.002, dec: 1, sus: 1, rel: 0.35, slope: 12, hpf: 60 },
  marimba: { lvl: 0.9, oct: 4, cut: 20000, res: 0.7, env: 0, atk: 0.002, dec: 1, sus: 1, rel: 0.5, slope: 12, hpf: 80 },
  kalimba: { lvl: 0.9, oct: 4, cut: 20000, res: 0.7, env: 0, atk: 0.002, dec: 1, sus: 1, rel: 0.6, slope: 12, hpf: 120 },
  zither: { lvl: 0.3, oct: 4, cut: 5000, res: 1, env: 0.6, atk: 0.002, dec: 1.6, sus: 0, rel: 0.5, slope: 12, hpf: 90, bright: 0.6, width: 0.5 },
  // rendered on the GPU (gpu.js); detune, bright, width, dec, atk and rel shape the render
  swarm: { lvl: 0.55, oct: 3, cut: 20000, res: 0.7, env: 0, atk: 0.25, dec: 1, sus: 1, rel: 1.2, slope: 12, hpf: 110, width: 0.85, detune: 22, bright: 0.55 },
  choir: { lvl: 0.6, oct: 3, cut: 20000, res: 0.7, env: 0, atk: 0.35, dec: 1, sus: 1, rel: 1.4, slope: 12, hpf: 130, width: 0.8, detune: 16, bright: 0.35 },
  membrane: { lvl: 0.9, oct: 3, cut: 20000, res: 0.7, env: 0, atk: 0.001, dec: 1, sus: 1, rel: 1, slope: 12, hpf: 30, width: 0.5, bright: 0.5 },
  nsax: { lvl: 1.1, oct: 4, cut: 20000, res: 0.7, env: 0, atk: 0.05, dec: 1, sus: 1, rel: 0.25, slope: 12, hpf: 60, width: 0.3 },
  plate: { lvl: 1.0, oct: 4, cut: 20000, res: 0.7, env: 0, atk: 0.001, dec: 1, sus: 1, rel: 2, slope: 12, hpf: 70, width: 0.6, bright: 0.5 },
  upright: { lvl: 1.0, oct: 2, cut: 20000, res: 0.7, env: 0, atk: 0.002, dec: 1, sus: 1, rel: 0.09, slope: 12, hpf: 35 },
  epiano: { lvl: 0.5, oct: 4, cut: 7000, res: 0.5, env: 0, atk: 0.002, dec: 1.6, sus: 0.25, rel: 0.45, slope: 12, hpf: 90, width: 0.5 },
};
function valueAt(v, s, key) {
  switch (v.k) {
    case 'num': return v.v;
    case 'lfo': s -= patOrigin(s); return v.a + (v.b - v.a) * (0.5 - 0.5 * Math.cos(2 * Math.PI * s / v.per));
    case 'ramp': s -= patOrigin(s); return v.a + (v.b - v.a) * ((s % v.per + v.per) % v.per) / v.per;
    case 'knob': {
      const x = S.knobs[v.i];
      if (EXP_PARAMS.has(key) && v.a > 0 && v.b > 0) return v.a * Math.pow(v.b / v.a, x);
      return v.a + (v.b - v.a) * x;
    }
    case 'pat': { const r = patValueAt(v.p, s); return r === null || isNaN(r) ? null : r; }
  }
  return null;
}
const DRUM_HPF = { kick: 20, tom: 50, snare: 90, clap: 160, rim: 250, hat: 400, ohat: 400, ride: 300, crash: 250, shaker: 500, asnare: 70, ahat: 300, aohat: 300, aride: 250, acrash: 200, handclap: 150, tamb: 300, shake: 400, triangle: 500, gong: 25, kung: 35, deok: 90, buk: 30, buktak: 300, jing: 40, kkwaeng: 250, kkwaengm: 250 };
function evalParams(def, s) {
  const P = Object.assign({}, BASE, def.kind === 'synth' ? INST[def.inst] : { hpf: DRUM_HPF[def.inst] || 20 });
  for (const k in def.params) { const x = valueAt(def.params[k], s, k); if (x !== null) P[k] = x; }
  sceneAuto(def, s, P);
  if (S.padSet && S.padSet.length) padParams(def, s, P);
  return P;
}

// ---------- voices ----------
function panTo(dest, pan) {
  if (!pan) return dest;
  const p = S.ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(dest); return p;
}
function noiseSrc(t, dur, pink) {
  const n = S.ctx.createBufferSource(); n.buffer = pink ? A.pink : A.noise;
  n.start(t, Math.random() * 1.5); n.stop(t + dur + 0.05); return n;
}
function envExp(param, t, peak, dur, atk = 0.001) {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + atk);
  param.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, atk + 0.005));
}
// TR-808 style metal: six detuned square oscillators at inharmonic ratios
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
function metal(t, dur, tn, dest, scale = 1) {
  const ctx = S.ctx, mix = ctx.createGain(); mix.gain.value = 0.3;
  for (const f of METAL) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f * tn * scale; o.connect(mix); o.start(t); o.stop(t + dur + 0.05); }
  mix.connect(dest);
}
const DRUM_TRIM = { clap: 4, hat: 1.8, ohat: 1.4, rim: 1.4, shaker: 1.6 }; // +12, +5, +3, +3, +4 dB
function playDrum(inst, t, vel, P, out) {
  if (SAMPLE_HITS.has(inst)) return playSampleHit(inst, t, vel, P, out);
  // Level trims so every voice sits near the kick and snare at the same gain. Measured as 50 ms loudness at
  // gain 1: the clap came out 22 dB under the kick and the hats 16 dB under, so in a full mix they vanished.
  const ctx = S.ctx, amp = P.gain * vel * (DRUM_TRIM[inst] || 1);
  if (amp < 0.002) return;
  const spread = { hat: 0.18, ohat: 0.22, shaker: 0.3, ride: 0.12 }[inst] || 0;
  const dest = panTo(out, P.pan + (Math.random() - 0.5) * spread), dk = Math.max(0.1, P.dec), tn = Math.max(0.2, P.tune);
  const G = () => ctx.createGain(), F = (type, f, q = 0.7, gain = 0) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = gain; return b; };
  const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
  switch (inst) {
    case 'kick': {
      // body: fast pitch drop into a long sub tail, softly clipped for punch; plus a short click for definition
      const d = 0.36 * dk, o = osc('sine', 0), g = G(), ws = ctx.createWaveShaper();
      ws.curve = curve(0.25 + P.drive); ws.oversample = '4x';
      o.frequency.setValueAtTime(230 * tn, t); o.frequency.exponentialRampToValueAtTime(62 * tn, t + 0.045); o.frequency.exponentialRampToValueAtTime(46 * tn, t + 0.28);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp * 0.7, t + 0.002);
      g.gain.setValueAtTime(amp * 0.7, t + 0.022); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(ws).connect(g).connect(dest); o.start(t); o.stop(t + d + 0.05);
      const n = noiseSrc(t, 0.02), h = F('bandpass', 4200, 0.8), cg = G(); envExp(cg.gain, t, amp * 0.32, 0.009);
      n.connect(h).connect(cg).connect(dest);
      const bl = osc('sine', 1600 * tn), bg = G(); envExp(bg.gain, t, amp * 0.18, 0.006);
      bl.connect(bg).connect(dest); bl.start(t); bl.stop(t + 0.03);
      break;
    }
    case 'tom': {
      const d = 0.4 * dk, o = osc('sine', 0), g = G();
      o.frequency.setValueAtTime(190 * tn, t); o.frequency.exponentialRampToValueAtTime(105 * tn, t + 0.18);
      envExp(g.gain, t, amp * 0.9, d, 0.002); o.connect(g).connect(dest); o.start(t); o.stop(t + d + 0.05);
      const n = noiseSrc(t, 0.08, true), b = F('bandpass', 400 * tn, 1.2), ng = G(); envExp(ng.gain, t, amp * 0.25, 0.06);
      n.connect(b).connect(ng).connect(dest);
      break;
    }
    case 'snare': {
      // two drum-head modes + a bright noise rattle with a separate snap
      for (const [f, gl] of [[185, 0.55], [330, 0.3]]) {
        const o = osc('triangle', f * tn), g = G();
        o.frequency.exponentialRampToValueAtTime(f * 0.86 * tn, t + 0.06);
        envExp(g.gain, t, amp * gl, 0.11 * dk); o.connect(g).connect(dest); o.start(t); o.stop(t + 0.25);
      }
      const n = noiseSrc(t, 0.35), h = F('highpass', 1200), pk = F('peaking', 5200, 1, 4), g = G();
      envExp(g.gain, t, amp * 0.6, 0.2 * dk); n.connect(h).connect(pk).connect(g).connect(dest);
      const n2 = noiseSrc(t, 0.05), b = F('bandpass', 3000, 0.9), g2 = G(); envExp(g2.gain, t, amp * 0.5, 0.025);
      n2.connect(b).connect(g2).connect(dest);
      break;
    }
    case 'clap': {
      // four hand hits slightly spread in time and stereo, then a short room tail
      const hits = [0, 0.009, 0.019, 0.031];
      hits.forEach((o, k) => {
        const n = noiseSrc(t + o, 0.03, true), b = F('bandpass', 1250 * tn, 1.4), g = G(), pp = ctx.createStereoPanner();
        pp.pan.value = [-0.3, 0.25, -0.1, 0.15][k];
        envExp(g.gain, t + o, amp * (k === 3 ? 0.9 : 0.7), 0.012);
        n.connect(b).connect(g).connect(pp).connect(dest);
      });
      const n = noiseSrc(t + 0.031, 0.4, true), b = F('bandpass', 1050 * tn, 0.9), g = G();
      envExp(g.gain, t + 0.031, amp * 0.55, 0.24 * dk, 0.002);
      n.connect(b).connect(g).connect(dest);
      break;
    }
    case 'hat': case 'ohat': case 'ride': case 'crash': {
      const d = ({ hat: 0.05, ohat: 0.38, ride: 1.4, crash: 2.2 })[inst] * dk;
      const bp = F('bandpass', inst === 'ride' ? 7000 : 10000, 0.6), hp = F('highpass', inst === 'crash' ? 5000 : 7200), g = G();
      envExp(g.gain, t, amp * (inst === 'hat' ? 0.9 : 0.7), d, 0.0005);
      metal(t, d, tn, bp, inst === 'ride' ? 1.35 : 1);
      const n = noiseSrc(t, d), ng = G(); ng.gain.value = ({ hat: 0.35, ohat: 0.3, ride: 0.12, crash: 0.55 })[inst];
      n.connect(ng).connect(hp);
      bp.connect(hp).connect(g).connect(dest);
      if (inst === 'ride') { const o = osc('sine', 3150 * tn), og = G(); envExp(og.gain, t, amp * 0.06, d * 0.7); o.connect(og).connect(dest); o.start(t); o.stop(t + d); }
      break;
    }
    case 'shaker': {
      const n = noiseSrc(t, 0.12), b = F('bandpass', 6500 * tn, 1.1), g = G(), gg = g.gain;
      gg.setValueAtTime(0.0001, t); gg.exponentialRampToValueAtTime(amp * 0.5, t + 0.012); gg.exponentialRampToValueAtTime(0.0001, t + 0.08 * dk);
      n.connect(b).connect(g).connect(dest);
      break;
    }
    case 'rim': {
      for (const [f, gl] of [[1720, 0.6], [820, 0.35]]) {
        const o = osc('triangle', f * tn), g = G(); envExp(g.gain, t, amp * gl, 0.035 * dk, 0.0005);
        o.connect(g).connect(dest); o.start(t); o.stop(t + 0.08);
      }
      const n = noiseSrc(t, 0.02), b = F('bandpass', 2800 * tn, 2), g = G(); envExp(g.gain, t, amp * 0.3, 0.01);
      n.connect(b).connect(g).connect(dest);
      break;
    }
  }
}
function playSynth(inst, midi, t, dur, P, vel, out) {
  const ctx = S.ctx, def = INST[inst], f = mtof(midi);
  const peak = P.gain * vel * def.lvl;
  if (peak < 0.001) return;
  const atk = Math.max(0.002, P.atk), dec = Math.max(0.01, P.dec), sus = Math.max(0, Math.min(1, P.sus)), rel = Math.max(0.02, P.rel);
  const tOff = t + Math.max(dur, atk + 0.01), tEnd = tOff + rel * 1.3 + 0.05;
  const drift = (Math.random() - 0.5) * 7; // cents — every note a little different, like analog
  // filter: 12 or 24 dB/oct, light key-tracking so high notes stay as bright as low ones
  const kt = Math.pow(f / 261.6, 0.3);
  const cut = Math.max(40, Math.min(18000, P.cut * kt * (0.62 + 0.38 * Math.min(1.6, vel))));
  const filters = [ctx.createBiquadFilter()];
  filters[0].type = 'lowpass'; filters[0].Q.value = Math.max(0.1, P.res);
  if ((def.slope || 12) >= 24) { const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.Q.value = 0.6; filters[0].connect(f2); filters.push(f2); }
  for (const fl of filters) {
    if (P.env > 0) { fl.frequency.setValueAtTime(Math.min(18000, cut * (1 + P.env * 10)), t); fl.frequency.setTargetAtTime(cut, t + 0.002, dec / 3); }
    else fl.frequency.setValueAtTime(cut, t);
  }
  let input = filters[0];
  const drive = (P.drive || 0) + (P.shape || 0);
  if (drive > 0) { const ws = ctx.createWaveShaper(); ws.curve = curve(drive); ws.oversample = '2x'; ws.connect(filters[0]); input = ws; }
  const amp = ctx.createGain(), a = amp.gain;
  a.setValueAtTime(0, t); a.linearRampToValueAtTime(peak, t + atk);
  a.setTargetAtTime(peak * sus, t + atk, dec / 3);
  a.setTargetAtTime(0, tOff, rel / 4);
  filters[filters.length - 1].connect(amp); amp.connect(panTo(out, P.pan));
  const oscs = [];
  const osc = (type, freq, cents = 0, gain = 1, pan = 0, dest = input) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = cents + drift;
    let node = o;
    if (gain !== 1) { const g = ctx.createGain(); g.gain.value = gain; node.connect(g); node = g; }
    if (pan) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); node.connect(p); node = p; }
    node.connect(dest); oscs.push(o); return o;
  };
  const W = Math.max(0, Math.min(1, P.width));
  switch (inst) {
    case 'supersaw': case 'pad': {
      // 7 saws spread across the stereo field, each starting at a different phase
      const n = 7, sp = P.detune;
      for (let k = 0; k < n; k++) {
        const off = (k - 3) / 3, o = osc('sawtooth', f, off * sp + (Math.random() - 0.5) * 3, k === 3 ? 0.42 : 0.3, off * W);
        o._delay = Math.random() * 0.004;
      }
      osc('sine', f / 2, 0, inst === 'pad' ? 0.12 : 0.2);
      break;
    }
    case 'bass': osc('sawtooth', f, 0, 0.62); osc('sine', f / 2, 0, 0.5); osc('sawtooth', f, 9, 0.25); break;
    case 'acid': osc('sawtooth', f); break;
    case 'pluck': {
      osc('sawtooth', f, 3, 0.7, -0.35 * W); osc('sawtooth', f, -5, 0.7, 0.35 * W); osc('triangle', f * 2, 0, 0.22);
      // pick noise: a 6 ms burst through a band around the note
      const n = noiseSrc(t, 0.03), b = ctx.createBiquadFilter(), g = ctx.createGain();
      b.type = 'bandpass'; b.frequency.value = Math.min(12000, f * 3); b.Q.value = 1.5; envExp(g.gain, t, 0.35, 0.012);
      n.connect(b).connect(g).connect(input);
      break;
    }
    case 'bell': {
      for (const [det, pan] of [[-4, -0.3 * W], [4, 0.3 * W]]) {
        const c = osc('sine', f, det, 0.6, pan), m = ctx.createOscillator(), mg = ctx.createGain();
        m.frequency.value = f * 3.5; m.detune.value = det; mg.gain.setValueAtTime(f * 2.4, t); mg.gain.setTargetAtTime(0, t, 0.28);
        m.connect(mg).connect(c.frequency); oscs.push(m);
      }
      break;
    }
    case 'flute': {
      osc('sine', f, 0, 0.9); osc('triangle', f * 2, 0, 0.06);
      const n = ctx.createBufferSource(); n.buffer = A.pink; n.loop = true;
      const b = ctx.createBiquadFilter(), g = ctx.createGain();
      b.type = 'bandpass'; b.frequency.value = f * 1.5; b.Q.value = 2.5;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.05); g.gain.setTargetAtTime(0.12, t + 0.06, 0.15);
      n.connect(b).connect(g).connect(input); n._offset = Math.random(); oscs.push(n);
      break;
    }
    case 'bowed': {
      // two slightly detuned saws through body resonances
      const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter();
      f1.type = 'peaking'; f1.frequency.value = 900; f1.Q.value = 1.2; f1.gain.value = 7;
      f2.type = 'peaking'; f2.frequency.value = 2600; f2.Q.value = 1.5; f2.gain.value = 5;
      f1.connect(f2); f2.connect(input);
      osc('sawtooth', f, -3, 0.7, -0.2 * W, f1); osc('sawtooth', f, 4, 0.7, 0.2 * W, f1);
      break;
    }
    case 'epiano': {
      // FM tine: modulator at 1:1 that fades fast, plus a short high "tine" partial for the key strike
      for (const [det, pan] of [[-3, -0.25 * W], [3, 0.25 * W]]) {
        const c = osc('sine', f, det, 0.55, pan), m = ctx.createOscillator(), mg = ctx.createGain();
        m.frequency.value = f; m.detune.value = det; mg.gain.setValueAtTime(f * 1.3 * vel, t); mg.gain.setTargetAtTime(f * 0.15, t, 0.18);
        m.connect(mg).connect(c.frequency); oscs.push(m);
      }
      const tine = ctx.createOscillator(), tg = ctx.createGain();
      tine.frequency.value = f * 14; envExp(tg.gain, t, 0.05, 0.08); tine.connect(tg).connect(input); oscs.push(tine);
      break;
    }
    default: osc({ sine: 'sine', tri: 'triangle', saw: 'sawtooth', square: 'square' }[inst] || 'triangle', f);
  }
  // vibrato fades in after the attack, like a player settling into the note
  if (P.vib > 0) {
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 5 + Math.random() * 0.8;
    lg.gain.setValueAtTime(0, t); lg.gain.setValueAtTime(0, t + Math.max(0.15, atk)); lg.gain.linearRampToValueAtTime(P.vib, t + Math.max(0.15, atk) + 0.35);
    lfo.connect(lg);
    for (const o of oscs) if (o instanceof OscillatorNode) lg.connect(o.detune);
    oscs.push(lfo);
  }
  for (const o of oscs) { o.start(t + (o._delay || 0), o._offset); o.stop(tEnd); }
  oscs[0].onended = () => { try { amp.disconnect(); } catch (e) { } };
  return { filters, kt, tEnd };
}

// ---------- scheduler ----------
function inWin(w, c) { return w && c >= w.startC - EPS && c < w.endC - EPS; }
function mapSpan(a, b) {
  const st = S.stutter;
  if (!st || b <= st.T0 || a >= st.end) return [[a, b, 0]];
  const out = [];
  if (a < st.T0) out.push([a, st.T0, 0]);
  let t = Math.max(a, st.T0);
  const stop = Math.min(b, st.end);
  while (t < stop - EPS) {
    const ph = ((t - st.T0) % st.len + st.len) % st.len;
    const segEnd = Math.min(stop, t + (st.len - ph));
    const pa = st.L + ph;
    out.push([pa, pa + (segEnd - t), t - pa]);
    t = segEnd;
  }
  if (b > st.end) out.push([Math.max(a, st.end), b, 0]);
  return out;
}
function progAt(s) {
  if (!S.prog) return 0;
  s -= patOrigin(s);
  const n = Math.floor(s + EPS);
  let raw = null;
  for (const e of S.prog.q(n, n + 1)) if (e.s <= s + EPS && s < e.s + e.d - EPS) raw = e.v;
  return progValue(raw);
}
// pattern time follows the song: it starts where the song starts, and moves with a jump once the jump lands
setPatOrigin(c => (S.songJump && c >= S.songJump.at - EPS ? S.songJump.start : S.songStart) || 0);
// ---------- scenes & song ----------
function sceneNameAt(c) {
  if (!S.scenes.size) return null;
  if (S.songMode && S.song) {
    const j = S.songJump && c >= S.songJump.at - EPS ? S.songJump : null;
    const start = j ? j.start : S.songStart, from = j ? Math.min(S.songFrom, j.at) : S.songFrom;
    if (c >= from - EPS) {
      const pos = mod(c - start, S.song.total);
      for (const p of S.song.parts) if (pos < p.start + p.bars - EPS) return { name: p.name, part: p, pos };
    }
  }
  if (S.nextScene && c >= S.nextScene.at - EPS) return { name: S.nextScene.name };
  return S.liveScene ? { name: S.liveScene } : null;
}
function sceneAt(c) { const x = sceneNameAt(c); return x ? S.scenes.get(x.name) || null : null; }
function activeIn(sc, name) {
  if (!sc) return true;
  if (sc.exc.has(name)) return false;
  if (sc.inc.has(name) || sc.all) return true;
  if (LOOPS.includes(name)) { for (const n of sc.inc) if (LOOPS.includes(n)) return false; return true; }
  return false;
}
function sceneFx(a, b) {
  for (let n = Math.ceil(a - EPS); n < b - EPS; n++) {
    const p = sceneNameAt(n - 1e-4), q = sceneNameAt(n);
    if ((p && p.name) === (q && q.name)) continue;
    const pf = (p && S.scenes.get(p.name) || {}).fx || new Set(), qf = (q && S.scenes.get(q.name) || {}).fx || new Set();
    if (pf.has('riser') && !qf.has('riser')) dropBuildAt(n);
    if (qf.has('riser') && !pf.has('riser')) startBuildAt(n, q.part ? q.part.bars : 4);
    if (qf.has('filter') !== pf.has('filter')) A.lp.frequency.setTargetAtTime(qf.has('filter') ? 450 : 20000, timeOf(n), qf.has('filter') ? 0.35 : 0.04);
    S.dirty = true;
  }
}
function audible(name) {
  if (S.muted.has(name)) return false;
  return S.solo.size === 0 || S.solo.has(name);
}
function duckAt(time, kickName, s) {
  for (const name of S.order) {
    if (name === kickName) continue;
    const def = S.tracks.get(name); if (!def || !def.params.duck) continue;
    const d = Math.max(0, Math.min(1, valueAt(def.params.duck, s, 'duck') || 0));
    if (!d) continue;
    const g = rt(name).duck.gain;
    g.setTargetAtTime(1 - d, time, 0.004);
    g.setTargetAtTime(1, time + 0.03, 0.07 / Math.max(0.5, S.cps * 2));
  }
  mixDuck(time, s);
}
function playEvents(def, pa, pb, off) {
  const now = S.ctx.currentTime;
  if (!audible(def.name)) return;
  for (const ev of eventsIn(def, pa, pb)) {
    let c = ev.s + off;
    if (!activeIn(sceneAt(c), def.name)) continue;
    if ((def.kind === 'drum' || def.inst === 'bass') && inWin(S.breakdown, c)) continue;
    if (S.padMute && S.padMute.length && padMuted(def, c)) continue;
    if (def.kind === 'drum' && def.inst !== 'kick' && inFillHalf(c)) continue;
    if (inPause(c)) continue;
    const P = def.kind === 'loop' ? loopParams(def, ev.s) : evalParams(def, ev.s);
    // groove: swing on a chosen grid (track swing overrides the global one), nudge, humanize
    const sw = def.params.swing ? P.swing : S.swing, grid = P.sgrid || 16;
    if (sw) { const x = ev.s * grid, rr = Math.round(x); if (Math.abs(x - rr) < 1e-6 && mod(rr, 2) === 1) c += sw / grid; }
    let time = timeOf(c) + (P.nudge || 0) / 1000;
    let vel = accentOf(ev.v) * (P.vel ?? 1);
    if (P.human > 0) { time += (Math.random() + Math.random() - 1) * 0.012 * P.human; vel *= 1 + (Math.random() - 0.5) * 0.35 * P.human; }
    if (time < now - 0.02) continue;
    if (time < now) time = now + 0.002;
    const r = rt(def.name, def.kind === 'drum');
    stripAt(r, P, time);
    let dur = ev.d / S.cps * P.len;
    if (off !== 0 && S.stutter) dur = Math.min(dur, S.stutter.len / S.cps);
    if (def.kind === 'loop') {
      if (def.chop) playChop(def, ev, time, dur, { ...P, gain: P.gain * vel });
    } else if (def.kind === 'drum') {
      const raw = ev.v.replace(/'+$/, '');
      const v0 = raw === 'X' ? 1.3 : /^[\d.]+$/.test(raw) ? +raw : 1;
      playDrum(def.inst, time, v0 * vel, P, r.input);
      if (def.inst === 'kick') duckAt(time, def.name, ev.s);
    } else {
      let raw = ev.v;
      if (/^r'*$/.test(raw)) raw = String(improvDegree(def, ev, P));
      let notes = atomNotes(raw, S.root, S.scale, Math.round(P.oct), def.fixed ? 0 : progAt(ev.s), (ev.tr || 0) + Math.round(P.tr || 0), ev.inv);
      if (!notes) continue;
      if (S.padPitch) notes = notes.map(m => m + S.padPitch);
      if (notes.length > 1) notes = voiceChord(def, notes, def.opts && def.opts.voicing);
      if (def.opts && def.opts.arp && notes.length > 1) playArp(def, notes, c, ev.d, P, vel, r);
      else playNotes(def, notes, time, dur, P, vel, r);
    }
    S.vis.push({ time, id: `a${def.line}_${ev.loc.c0}`, line: def.line });
  }
}
function playRoll(a, b) {
  const B = S.build; if (!B) return;
  const end = B.dropC ?? Infinity;
  for (let n = Math.floor(a); n < b; n++) {
    const bars = Math.max(0, n - Math.floor(B.startC));
    const stage = B.len > 4 ? Math.floor(4 * bars / B.len) : bars;
    const r = 4 * Math.pow(2, Math.min(3, stage));
    for (let j = 0; j < r; j++) {
      const c = n + j / r;
      if (c < a - EPS || c >= b - EPS || c < B.startC || c >= end - EPS) continue;
      const prog = Math.min(1, (c - B.startC) / (B.len || 4));
      const time = timeOf(c);
      if (time < S.ctx.currentTime - 0.02) continue;
      playDrum('snare', time, 0.25 + 0.6 * prog, { ...BASE, gain: 0.7, tune: 1 + prog * 0.3 }, rt('__roll', true).input);
    }
  }
}
function scheduleRange(a, b) {
  S.schedTo = b;
  sceneFx(a, b);
  padGateSched(a, b);
  sceneLook(a, b);
  if (S.pending && S.pending.applyAt <= b) {
    const x = Math.max(a, S.pending.applyAt);
    if (x > a) scheduleRange2(a, x);
    applyPending();
    if (b > x) scheduleRange2(x, b);
    return;
  }
  scheduleRange2(a, b);
}
function scheduleRange2(a, b) {
  autoSched(a, b);
  for (const [pa, pb, off] of mapSpan(a, b))
  {
    for (const name of S.order) { const def = S.tracks.get(name); if (def) playEvents(def, pa, pb, off); }
    playLoops(pa, pb, off);
  }
  playRoll(a, b);
  playFill(a, b);
}
function tick() {
  if (!S.playing) return;
  const now = S.ctx.currentTime;
  if (transport(now) - S.lastC > 1) S.lastC = transport(now);
  const target = transport(now + LOOKAHEAD);
  if (target <= S.lastC) return;
  scheduleRange(S.lastC, target);
  mixTick(S.lastC, target);
  S.lastC = target;
  if (S.stutter && S.lastC > S.stutter.end) S.stutter = null;
  if (S.breakdown && S.lastC > S.breakdown.endC) { S.breakdown = null; }
  if (S.padMute.length) S.padMute = S.padMute.filter(m => m.endC > S.lastC - 1);
  if (S.padSet.length) S.padSet = S.padSet.filter(x => x.endC > S.lastC - 1);
  for (const n of S.padFills) if (n < S.lastC - 2) S.padFills.delete(n);
  if (S.build && S.build.dropC != null && S.lastC > S.build.dropC) S.build = null;
  if (S.nextScene && S.lastC >= S.nextScene.at) { S.liveScene = S.nextScene.name; S.liveSince = S.nextScene.at; S.nextScene = null; S.dirty = true; }
  if (S.songJump && S.lastC >= S.songJump.at) { S.songStart = S.songJump.start; S.songFrom = Math.min(S.songFrom, S.songJump.at); S.songJump = null; S.dirty = true; }
}

// ---------- program state ----------
function applyState(st) {
  S.tracks = st.tracks; S.order = st.order;
  if (st.autos) { S.autos = st.autos; S.autoSig = st.autoSig; }
  if (st.key) { S.root = st.key.root; S.scale = st.key.scale; S.keySrc = st.key.src; }
  S.prog = st.prog; S.progSrc = st.progSrc;
  setTimeout(gpuPrewarm, 0);
  if (st.scenes) {
    S.scenes = st.scenes; S.song = st.song; S.arrSrc = st.arrSrc;
    if (S.liveScene && !S.scenes.has(S.liveScene)) S.liveScene = null;
    if (S.nextScene && !S.scenes.has(S.nextScene.name)) S.nextScene = null;
  }
  S.dirty = true;
}
function applyPending() {
  const p = S.pending; S.pending = null;
  if (p.state.bpm && S.playing) setBpmAt(p.state.bpm, p.applyAt);
  if (p.state.resetSong) { S.songStart = S.songFrom = p.applyAt; S.songJump = null; S.nextScene = null; S.liveScene = null; S.songMode = true; }
  applyState(p.state);
}
function setBpmAt(b, c) {
  b = Math.max(40, Math.min(240, b));
  S.t0 = timeOf(c); S.c0 = c; S.bpm = b; S.cps = b / 240;
  if (A.dls) for (const d of A.dls) d.delayTime.setValueAtTime((S.dlSteps || 3) / 16 / S.cps, Math.max(S.ctx.currentTime, S.t0));
  S.dirty = true;
}

function setBpm(b) {
  b = Math.max(40, Math.min(240, b));
  if (S.ctx && S.playing) { const now = S.ctx.currentTime; S.c0 = transport(now); S.t0 = now; }
  S.bpm = b; S.cps = b / 240;
  if (A.dls) for (const d of A.dls) d.delayTime.setTargetAtTime((S.dlSteps || 3) / 16 / S.cps, S.ctx.currentTime, 0.05);
  S.dirty = true;
}

function play() {
  initAudio();
  S.ctx.resume();
  if (S.pending) applyPending();
  resetLoops();
  S.t0 = S.ctx.currentTime + 0.08; S.c0 = 0; S.lastC = 0;
  S.songStart = -S.songCue; S.songFrom = 0; S.songJump = null; S.nextScene = null;
  S.playing = true;
  S.timer = setInterval(tick, 25);
  tick();
}
function stop() {
  S.playing = false; clearInterval(S.timer);
  cancelTake(); resetLoops(); S.songCue = 0; fxDone.clear();
  if (A.gate) { A.gate.gain.cancelScheduledValues(S.ctx.currentTime); A.gate.gain.setValueAtTime(1, S.ctx.currentTime); }
  S.stutter = S.breakdown = S.build = null;
  if (S.ctx) {
    const now = S.ctx.currentTime;
    A.out.gain.setTargetAtTime(0, now, 0.03);
    A.out.gain.setTargetAtTime(OUT_GAIN, now + 0.25, 0.01);
    resetFx(now);
  }
}

// ---------- performance pads ----------
// Every pad, built-in or written in code, is a list of actions from the fx language (see engine.js).
const G = { held: new Set(), act: new Map() };
function resetFx(now) {
  for (const [p, v] of [[A.lp.frequency, 20000], [A.hp.frequency, 20], [A.lp.Q, 0.7], [A.throw.gain, 0], [A.dFb.gain, S.dlFb ?? 0.42], [A.vthrow.gain, 0], [A.dryG.gain, 1], [A.rIn.gain, 1], [A.dIn.gain, 1], [A.fxGate.gain, 1], [A.eqL.gain, 0], [A.eqM.gain, 0], [A.eqH.gain, 0]]) {
    p.cancelScheduledValues(now); p.setTargetAtTime(v, now, 0.05);
  }
  A.crush.curve = null;
  if (typeof FRZ !== 'undefined' && (FRZ.on || FRZ.srcs.length)) freezeStop();
  if (A.riser) { try { A.riser.src.stop(now + 0.1); } catch (e) { } A.riser = null; }
  S.padMute = []; S.padSet = []; S.padGate = null; S.padPitch = 0; S.padFills = new Set(); S.autoOff = [];
  G.held.clear(); G.act.clear();
}
function hold(p, now) { p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); }
const crushCurve = bits => { const n = 4096, c = new Float32Array(n), q = Math.pow(2, Math.max(1, bits) - 1); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.round(x * q) / q; } return c; };
// a filter move: plain value glides there, a>b ramps across the pad's "in" bars
function padSweep(p, v, base, now, dur) {
  hold(p, now);
  if (v.v !== undefined) p.setTargetAtTime(Math.max(10, v.v), now, 0.18);
  else { p.setValueAtTime(Math.max(10, v.a), now); p.exponentialRampToValueAtTime(Math.max(10, v.b), now + dur); }
}
const padIn = pad => { const a = pad.acts.find(x => x.op === 'in'); return a ? Math.max(0.0625, a.n) : 2; };
function trackMatch(def, w) {
  if (w === 'all' || w === '*') return true;
  if (w === 'drums') return def.kind === 'drum';
  if (w === 'loops') return def.kind === 'loop';
  const isBass = def.kind === 'synth' && (/bass|sub|reese/.test(def.name) || ['bass', 'acid'].includes(def.inst));
  if (w === 'bass') return isBass;
  if (w === 'synths') return def.kind === 'synth';
  if (w === 'melody') return def.kind === 'synth' && !isBass;
  return def.name === w;
}
// is this track silenced by a held mute/only pad at time c?
function padMuted(def, c) {
  for (const m of S.padMute || []) {
    if (c < m.startC - EPS || c >= m.endC - EPS) continue;
    const hit = m.list.some(w => trackMatch(def, w));
    if (m.only ? !hit : hit) return true;
  }
  return false;
}
// pad "set" overrides, after scene automation
function padParams(def, s, P) {
  for (const x of S.padSet || []) {
    if (!trackMatch(def, x.track) || s < x.startC - EPS || s >= x.endC - EPS) continue;
    if (x.v.v !== undefined) P[x.param] = x.v.v;
    else { const q = Math.max(0, Math.min(1, (s - x.startC) / x.dur)); P[x.param] = EXP_PARAMS.has(x.param) && x.v.a > 0 && x.v.b > 0 ? x.v.a * Math.pow(x.v.b / x.v.a, q) : x.v.a + (x.v.b - x.v.a) * q; }
  }
}
function padGateSched(a, b) {
  const gt = S.padGate; if (!gt) return;
  const n = gt.g.length, gg = A.fxGate.gain, now = S.ctx.currentTime;
  for (let k = Math.ceil(a * n - EPS); k < b * n - EPS; k++) {
    const c = k / n; if (c < gt.startC - EPS || c >= (gt.endC ?? Infinity) - EPS) continue;
    const t = Math.max(now, timeOf(c)), on = gt.g[mod(k, n)];
    gg.setTargetAtTime(on ? 1 : 0.0001, t, 0.004);
  }
}
function padOn(name) { const pad = S.pads && S.pads.get(name); if (pad) padStart(name, pad, S.lastC, false); }
function padOff(name) { padStop(name, S.lastC, false); }
// run fn when the audio clock reaches t (for changes that can't be scheduled on an AudioParam)
function atTime(t, fn) { const ms = (t - S.ctx.currentTime) * 1000; if (ms < 4) fn(); else setTimeout(fn, ms); }
// Start a pad's actions at bar position c. A live press (seq false) acts now and lines its release up with the
// beat or bar; an auto line (seq true) is scheduled ahead, so everything happens exactly at c and at the release.
function padStart(key, pad, c, seq) {
  const now = Math.max(S.ctx.currentTime, seq ? timeOf(c) : 0), bar = 1 / S.cps, beat = bar / 4, dur = padIn(pad) * bar;
  if (G.act.has(key)) padStop(key, c, seq);
  const st = { undo: [] };
  G.act.set(key, st);
  for (const a of pad.acts) {
    switch (a.op) {
      case 'lp': padSweep(A.lp.frequency, a.v, 20000, now, dur); st.undo.push(n => { hold(A.lp.frequency, n); A.lp.frequency.setTargetAtTime(20000, n, 0.12); }); break;
      case 'hp': padSweep(A.hp.frequency, a.v, 20, now, dur); st.undo.push(n => { hold(A.hp.frequency, n); A.hp.frequency.setTargetAtTime(20, n, 0.08); }); break;
      case 'res': hold(A.lp.Q, now); A.lp.Q.setTargetAtTime(Math.max(0.1, a.n), now, 0.2); st.undo.push(n => { hold(A.lp.Q, n); A.lp.Q.setTargetAtTime(0.7, n, 0.1); }); break;
      case 'repeat': {
        const len = 1 / Math.max(1, a.n), T0 = Math.ceil(c / len - 1e-6) * len;
        const sx = S.stutter = { T0, L: T0, len, end: Infinity }; stutterCut(T0);
        st.undo.push((n, cEnd) => { if (S.stutter === sx) sx.end = Math.max(cEnd, sx.T0); });
        break;
      }
      case 'mute': case 'only': {
        const m = { list: a.list, only: a.op === 'only', startC: c, endC: Infinity };
        S.padMute.push(m); st.undo.push((n, cEnd) => { m.endC = seq ? cEnd : Math.ceil(cEnd - 1e-6); });
        break;
      }
      case 'throw': {
        const amt = a.n ?? 0.7;
        hold(A.throw.gain, now); A.throw.gain.setTargetAtTime(amt, now, 0.02);
        hold(A.dFb.gain, now); A.dFb.gain.setTargetAtTime(0.74, now, 0.05);
        st.undo.push(n => { hold(A.throw.gain, n); A.throw.gain.setTargetAtTime(0, n, 0.03); hold(A.dFb.gain, n); A.dFb.gain.setTargetAtTime(S.dlFb ?? 0.42, n + 0.4, 0.8); });
        break;
      }
      case 'echo': {
        // echo out: the delay catches one beat, then the dry mix and every send close while the echoes ring
        const t1 = now + beat;
        hold(A.throw.gain, now); A.throw.gain.setTargetAtTime(0.9, now, 0.01); A.throw.gain.setTargetAtTime(0, t1, 0.02);
        hold(A.dFb.gain, now); A.dFb.gain.setTargetAtTime(0.8, now, 0.03);
        for (const p of [A.dryG.gain, A.rIn.gain, A.dIn.gain]) { hold(p, now); p.setTargetAtTime(0, t1, 0.03); }
        st.undo.push((n, cEnd) => {
          const tb = seq ? n : Math.max(n, timeOf(Math.ceil(cEnd * 4 - 1e-6) / 4));
          for (const p of [A.dryG.gain, A.rIn.gain, A.dIn.gain]) { hold(p, n); p.setValueAtTime(p.value, tb); p.setTargetAtTime(1, tb, 0.01); }
          hold(A.throw.gain, n); A.throw.gain.setTargetAtTime(0, n, 0.02); hold(A.dFb.gain, n); A.dFb.gain.setTargetAtTime(S.dlFb ?? 0.42, tb + 0.3, 0.6);
        });
        break;
      }
      case 'verb': hold(A.vthrow.gain, now); A.vthrow.gain.setTargetAtTime(a.n ?? 0.8, now, 0.08); st.undo.push(n => { hold(A.vthrow.gain, n); A.vthrow.gain.setTargetAtTime(0, n, 0.15); }); break;
      case 'gate': {
        const gt = S.padGate = { g: a.g, startC: c, endC: Infinity };
        padGateSched(c, Math.max(S.lastC, S.schedTo || 0));
        st.undo.push((n, cEnd) => { gt.endC = cEnd; if (!seq && S.padGate === gt) S.padGate = null; hold(A.fxGate.gain, n); A.fxGate.gain.setTargetAtTime(1, n, 0.01); });
        break;
      }
      case 'crush': atTime(now, () => { A.crush.curve = crushCurve(a.n); }); st.undo.push(n => atTime(n, () => { A.crush.curve = null; })); break;
      case 'kill': for (const w of a.list) { const p = (w === 'low' ? A.eqL : w === 'mid' ? A.eqM : A.eqH).gain; hold(p, now); p.setTargetAtTime(w === 'mid' ? -28 : -40, now, 0.012); st.undo.push(n => { hold(p, n); p.setTargetAtTime(0, n, 0.012); }); } break;
      case 'pitch': S.padPitch += a.n; st.undo.push(() => { S.padPitch -= a.n; }); break;
      case 'riser': startBuildAt(c, a.n ?? 4); st.undo.push((n, cEnd) => dropBuildAt(seq ? cEnd : Math.ceil(cEnd - 1e-6))); break;
      case 'set': { const x = { track: a.track, param: a.param, v: a.v, startC: c, endC: Infinity, dur: padIn(pad) }; S.padSet.push(x); st.undo.push((n, cEnd) => { x.endC = cEnd; }); break; }
      case 'scene':
        if (a.w === 'next' || a.w === 'prev') { if (S.song && S.songMode) skipPart(a.w === 'next' ? 1 : -1); else { const names = [...S.scenes.keys()]; if (names.length) { const cur = names.indexOf((sceneNameAt(S.lastC) || {}).name); launchScene(names[mod(cur + (a.w === 'next' ? 1 : -1), names.length)], 'bar'); } } }
        else if (S.scenes.has(a.w)) launchScene(a.w, 'bar');
        break;
      case 'fill': { const n = Math.ceil(c + 0.5 - 1e-6); S.padFills.add(n); break; }
      case 'impact': impact(seq ? now : Math.max(now, timeOf(Math.ceil(c * 4 - 1e-6) / 4))); break;
      case 'swell': { const n = Math.ceil(c - 1e-6) + (c % 1 > 0.6 ? 1 : 0); playSwell(now + 0.01, timeOf(n)); break; }
      case 'freeze': atTime(now, freezeStart); st.undo.push(n => atTime(n, freezeStop)); break;
      case 'down': playDown(seq ? now : Math.max(now, timeOf(Math.ceil(c * 4 - 1e-6) / 4)), 2 * bar); break;
    }
  }
}
function padStop(key, cEnd, seq) {
  const st = G.act.get(key); if (!st) return;
  G.act.delete(key);
  const n = Math.max(S.ctx.currentTime, seq ? timeOf(cEnd) : 0);
  for (const u of st.undo) u(n, cEnd);
}
// auto lines: each hit presses its pad at the hit and releases it when the hit ends, in the scenes that have it
function autoSched(a, b) {
  const evs = [], keep = [];
  for (const o of S.autoOff) (o.c < b - EPS ? evs : keep).push(o);
  S.autoOff = keep;
  for (const [name, au] of S.autos || []) {
    const pad = au.pad || (S.pads && S.pads.get(name)); if (!pad) continue;
    for (const e of eventsIn(au, a, b)) {
      if (!activeIn(sceneAt(e.s), name) || inPause(e.s)) continue;
      const key = 'auto:' + name, off = { key, c: e.s + e.d, on: false };
      evs.push({ key, c: e.s, on: true, pad });
      (off.c < b - EPS ? evs : S.autoOff).push(off);
    }
  }
  evs.sort((x, y) => x.c - y.c || (x.on - y.on));   // a release before a press at the same moment
  for (const ev of evs) ev.on ? padStart(ev.key, ev.pad, ev.c, true) : padStop(ev.key, Math.max(a, ev.c), true);
}
// hold pads act while held; latch pads toggle on each press
function gestureOn(g) {
  const pad = S.pads && S.pads.get(g);
  if (pad && pad.latch && G.held.has(g)) { G.held.delete(g); S.dirty = true; if (S.ctx && S.playing) padOff(g); return; }
  if (G.held.has(g)) return;
  G.held.add(g); S.dirty = true;
  if (!S.ctx || !S.playing) return;
  padOn(g);
}
function gestureOff(g) {
  const pad = S.pads && S.pads.get(g);
  if (pad && pad.latch) return;
  if (!G.held.delete(g)) return;
  S.dirty = true;
  if (!S.ctx || !S.playing) return;
  padOff(g);
}
function startBuildAt(c, bars) {
  const ctx = S.ctx, now = ctx.currentTime, t0 = Math.max(now, timeOf(c)), dur = bars / S.cps;
  if (A.riser) { try { A.riser.src.stop(t0); } catch (e) { } A.riser = null; }
  S.build = { startC: c, dropC: null, len: bars };
  const hp = A.hp.frequency; hold(hp, now); hp.setValueAtTime(20, t0); hp.exponentialRampToValueAtTime(1600, t0 + dur);
  const src = ctx.createBufferSource(); src.buffer = A.noise; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.5;
  bp.frequency.setValueAtTime(350, t0); bp.frequency.exponentialRampToValueAtTime(7000, t0 + dur);
  const rg = ctx.createGain(); rg.gain.setValueAtTime(0, t0); rg.gain.linearRampToValueAtTime(0.22, t0 + dur);
  src.connect(bp).connect(rg); rg.connect(A.lp); rg.connect(A.rIn);
  src.start(t0); A.riser = { src, rg };
}
function dropBuildAt(c) {
  if (!S.build) return;
  S.build.dropC = c;
  const now = S.ctx.currentTime, tDrop = Math.max(now, timeOf(c));
  hold(A.hp.frequency, now); A.hp.frequency.setValueAtTime(20, tDrop);
  if (A.riser) { const { src, rg } = A.riser; hold(rg.gain, now); rg.gain.setValueAtTime(0, tDrop); src.stop(tDrop + 0.05); A.riser = null; }
  impact(tDrop);
}
function impact(t) {
  const ctx = S.ctx;
  const n = ctx.createBufferSource(); n.buffer = A.noise;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(9000, t); lp.frequency.exponentialRampToValueAtTime(200, t + 1.6);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
  n.connect(lp).connect(g); g.connect(A.bus); g.connect(A.rIn);
  n.start(t); n.stop(t + 2);
  playDrum('kick', t, 1.2, { ...BASE, gain: 0.9, dec: 2 }, A.bus);
}
