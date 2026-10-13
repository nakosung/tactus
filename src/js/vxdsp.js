// ===================== Voice to code: the analysis =====================
// Pure functions over a mono recording that starts `pre` seconds before bar 1 of the take. No DOM and no audio
// context, so tests run them in Node on synthesized voices.
//   vxBeat: beatboxing ("boom", "tuk", "chik", "ts") -> kick, snare and hat lines on a 16th grid
//   vxHum:  humming or la-la-la -> a melody line on an 8th grid, in the song's key
// Both return what they heard (hits, pitch contour) as well as the code, so the page can draw it.

// ---------- small DSP ----------
function vxFFT(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
const vxHann = n => { const w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)); return w; };
const vxPow2 = x => 1 << Math.round(Math.log2(x));
// magnitude spectrum of x[i .. i+N) (zero outside)
function vxSpec(x, i, N, win) {
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let k = 0; k < N; k++) { const j = i + k; re[k] = j >= 0 && j < x.length ? x[j] * win[k] : 0; }
  vxFFT(re, im);
  const m = new Float32Array(N / 2);
  for (let k = 0; k < N / 2; k++) m[k] = Math.hypot(re[k], im[k]);
  return m;
}
// the metronome clicks are short sine bursts at one frequency: a notch takes them out of what the mic heard
function vxNotch(x, sr, f, q = 6) {
  const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
  const b0 = 1 / a0, b1 = -2 * c / a0, b2 = 1 / a0, a1 = -2 * c / a0, a2 = (1 - al) / a0;
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
function vxMedian(a) { if (!a.length) return 0; const s = Float64Array.from(a).sort(); return s[s.length >> 1]; }
// the room's own level: the quietest frames, but never more than a quarter of the loud ones (a take that is all voice)
function vxFloor(rms, min) { return Math.max(Math.min(vxPct(rms, 0.05) * 3, vxPct(rms, 0.9) * 0.25), min); }
function vxPct(a, p) { if (!a.length) return 0; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; }

// ---------- onsets ----------
// Spectral flux finds where something starts; the exact sample is then taken from the amplitude envelope.
function vxOnsets(x, sr, opt = {}) {
  const N = vxPow2(sr * 0.023), hop = Math.round(sr * 0.005), win = vxHann(N);
  const frames = Math.max(0, Math.floor((x.length - N) / hop) + 1), lo = Math.floor(40 * N / sr);
  const flux = new Float32Array(frames), rms = new Float32Array(frames);
  let prev = null;
  for (let f = 0; f < frames; f++) {
    const m = vxSpec(x, f * hop, N, win);
    let s = 0; for (let k = lo; k < m.length; k++) { const v = Math.log1p(100 * m[k]); if (prev) s += Math.max(0, v - prev[k]); m[k] = v; }
    flux[f] = s; prev = m;
    let e = 0; for (let k = 0; k < N; k++) { const v = x[f * hop + k]; e += v * v; } rms[f] = Math.sqrt(e / N);
  }
  const floor = vxFloor(rms, opt.gate ?? 0.004), fmax = Math.max(1e-9, ...flux);
  // a smoothed envelope (about 1 ms) for the exact start
  const env = new Float32Array(x.length), sm = Math.exp(-1 / (sr * 0.001));
  for (let i = 0, v = 0; i < x.length; i++) { v = Math.max(Math.abs(x[i]), v * sm); env[i] = v; }
  const out = [], gap = Math.round((opt.minGap ?? 0.07) * sr / hop);
  for (let f = 2; f < frames - 1; f++) {
    let med = []; for (let k = Math.max(0, f - 10); k <= Math.min(frames - 1, f + 10); k++) med.push(flux[k]);
    const thr = vxMedian(med) * 1.5 + fmax * (opt.delta ?? 0.08);
    if (flux[f] < thr || flux[f] < flux[f - 1] || flux[f] < flux[f + 1]) continue;
    // loud enough somewhere in the next 40 ms
    const w = Math.ceil(0.03 * sr / hop);
    let loud = 0, before = 0;
    for (let k = f; k < Math.min(frames, f + w + 2); k++) loud = Math.max(loud, rms[k]);
    for (let k = Math.max(0, f - w - 2); k < f - 1; k++) before = Math.max(before, rms[k]);
    // a real start makes it louder; a sound that only changes colour as it fades (a falling kick) does not
    if (loud < floor || loud < before * 1.4) continue;
    const a = Math.max(0, f * hop - N / 2), b = Math.min(x.length, f * hop + N + N / 2);
    let pk = 0, pi = a; for (let i = a; i < b; i++) if (env[i] > pk) { pk = env[i]; pi = i; }
    let i0 = pi; while (i0 > a && env[i0 - 1] > pk * 0.3) i0--;
    const o = { i: i0, t: i0 / sr, flux: flux[f] / fmax, amp: pk };
    const last = out[out.length - 1];
    if (last && (f - last.f) < gap) { if (o.flux > last.flux) { o.f = f; out[out.length - 1] = o; } continue; }
    o.f = f; out.push(o);
  }
  return out;
}

// ---------- beatbox ----------
function vxHitFeatures(x, sr, i) {
  const N = vxPow2(sr * 0.04), m = vxSpec(x, i, N, vxHann(N));
  let s = 0, sw = 0, lo = 0, hi = 0;
  for (let k = 1; k < m.length; k++) { const f = k * sr / N, p = m[k] * m[k]; s += p; sw += p * f; if (f < 250) lo += p; if (f > 5000) hi += p; }
  return { cent: s ? sw / s : 1000, lo: s ? lo / s : 0, hi: s ? hi / s : 0 };
}
// 1-D k-means on log-centroid; keeps k (1..3) only while the groups sit far enough apart to be different sounds
function vxCluster(vals) {
  let best = { k: 1, lab: vals.map(() => 0), means: [vxMedian(vals)] };
  const sorted = [...vals].sort((a, b) => a - b);
  for (let k = 2; k <= Math.min(3, vals.length); k++) {
    let means = Array.from({ length: k }, (_, j) => sorted[Math.floor((j + 0.5) * sorted.length / k)]), lab = [];
    for (let it = 0; it < 30; it++) {
      lab = vals.map(v => { let b = 0; for (let j = 1; j < k; j++) if (Math.abs(v - means[j]) < Math.abs(v - means[b])) b = j; return b; });
      means = means.map((m, j) => { const g = vals.filter((_, i) => lab[i] === j); return g.length ? g.reduce((a, b) => a + b) / g.length : m; });
    }
    const used = new Set(lab).size === k, ms = [...means].sort((a, b) => a - b);
    let sep = Infinity; for (let j = 1; j < k; j++) sep = Math.min(sep, ms[j] - ms[j - 1]);
    // groups count as different sounds when the gap between them is wide next to how much each one wanders
    const sd = Math.sqrt(vals.reduce((a, v, i) => a + (v - means[lab[i]]) ** 2, 0) / vals.length);
    if (used && sep >= Math.max(0.45, 3 * sd)) best = { k, lab, means };
  }
  return best;
}
function vxBeat(x, sr, barSec, bars, pre = 0, opt = {}) {
  const steps = 16, stepSec = barSec / steps;
  const ons = vxOnsets(x, sr, opt).map(o => ({ ...o, t: o.t - pre, ...vxHitFeatures(x, sr, o.i) }))
    .filter(o => o.t > -stepSec / 2 && o.t < bars * barSec - stepSec / 2);
  if (!ons.length) return { hits: [], lines: {}, steps };
  const cl = vxCluster(ons.map(o => Math.log2(o.cent)));
  const order = cl.means.map((m, j) => j).sort((a, b) => cl.means[a] - cl.means[b]);
  const kindOf = {};
  if (cl.k === 3) { kindOf[order[0]] = 'kick'; kindOf[order[1]] = 'snare'; kindOf[order[2]] = 'hat'; }
  else if (cl.k === 2) {
    const hiG = ons.filter((_, i) => cl.lab[i] === order[1]), hiHz = 2 ** cl.means[order[1]];
    // a high, busy sound is a hi-hat ("ts ts ts"); a high sound on a few beats is a snare ("chik")
    kindOf[order[0]] = 'kick'; kindOf[order[1]] = hiHz > 5500 && hiG.length / bars >= 6 ? 'hat' : 'snare';
  } else {
    const hz = 2 ** cl.means[0];
    kindOf[0] = hz < 1400 ? 'kick' : hz > 5500 ? 'hat' : 'snare';
  }
  const hits = ons.map((o, i) => ({ t: o.t, step: Math.round(o.t / stepSec), kind: kindOf[cl.lab[i]], amp: o.amp, cent: o.cent, err: o.t / stepSec - Math.round(o.t / stepSec) }));
  const lines = {};
  for (const h of hits) {
    if (h.step < 0 || h.step >= bars * steps) continue;
    const g = (lines[h.kind] = lines[h.kind] || Array(bars * steps).fill('.'));
    g[h.step] = 'x';
  }
  return { hits, lines, steps };
}

// ---------- humming ----------
// YIN pitch at sample i: cumulative-mean-normalized difference, first dip under the threshold, parabolic refinement
function vxYin(x, sr, i, W, tmin, tmax) {
  const d = new Float32Array(tmax + 1);
  for (let tau = 1; tau <= tmax; tau++) {
    let s = 0; for (let j = 0; j < W; j++) { const a = x[i + j] - x[i + j + tau]; s += a * a; } d[tau] = s;
  }
  let run = 0; d[0] = 1;
  for (let tau = 1; tau <= tmax; tau++) { run += d[tau]; d[tau] = run ? d[tau] * tau / run : 1; }
  let tau = -1;
  for (let t = tmin; t < tmax; t++) if (d[t] < 0.15) { while (t + 1 < tmax && d[t + 1] < d[t]) t++; tau = t; break; }
  if (tau < 0) { let b = tmin; for (let t = tmin; t < tmax; t++) if (d[t] < d[b]) b = t; if (d[b] > 0.3) return null; tau = b; }
  const a = d[tau - 1], b = d[tau], c = d[tau + 1] ?? b, den = a - 2 * b + c, off = den ? 0.5 * (a - c) / den : 0;
  return { f0: sr / (tau + off), ap: b };
}
const VX_SHARP = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'], VX_FLAT = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
function vxNoteName(m, flat) { return (flat ? VX_FLAT : VX_SHARP)[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }
// keys whose signature has flats write flats (F major, Bb, Eb ... and their relative minors)
function vxFlatKey(root, scale) { const maj = /minor|aeolian|dorian|phrygian|minpent|harmonic|melodic|blues/.test(scale) ? (root + 3) % 12 : root; return [5, 10, 3, 8, 1, 6].includes(maj); }
function vxHum(x, sr, barSec, bars, pre, key, opt = {}) {
  const per = opt.per || 8, stepSec = barSec / per, hop = Math.round(sr * 0.01), W = vxPow2(sr * 0.025);
  const tmin = Math.floor(sr / 1100), tmax = Math.ceil(sr / 70);
  const contour = [], rmsAll = [];
  for (let i = 0; i + W + tmax < x.length; i += hop) {
    let e = 0; for (let j = 0; j < W; j++) e += x[i + j] * x[i + j];
    rmsAll.push(Math.sqrt(e / W));
  }
  const gate = vxFloor(rmsAll, opt.gate ?? 0.006);
  for (let n = 0, i = 0; i + W + tmax < x.length; i += hop, n++) {
    const t = (i + W / 2) / sr - pre;
    if (rmsAll[n] < gate) { contour.push({ t, m: null, rms: rmsAll[n] }); continue; }
    const p = vxYin(x, sr, i, W, tmin, tmax);
    contour.push({ t, m: p && p.f0 > 70 && p.f0 < 1100 ? 69 + 12 * Math.log2(p.f0 / 440) : null, rms: rmsAll[n] });
  }
  // a five-frame median removes single-frame octave slips
  const mm = contour.map((c, i) => { const w = contour.slice(Math.max(0, i - 2), i + 3).map(z => z.m).filter(v => v != null); return c.m == null || w.length < 3 ? c.m : vxMedian(w); });
  const voiced = mm.filter(v => v != null);
  if (voiced.length < 5) return { notes: [], tokens: [], contour, per, shift: 0, tune: 0 };
  // sung a little sharp or flat throughout: measure it and take it out before rounding
  const tune = Math.atan2(vxMedian(voiced.map(v => Math.sin(2 * Math.PI * v))), vxMedian(voiced.map(v => Math.cos(2 * Math.PI * v)))) / (2 * Math.PI);
  const pcs = (SCALES[key.scale] || SCALES.major).map(s => (s + key.root) % 12);
  const snap = m => { let best = Math.round(m), bd = 9; for (let r = Math.floor(m) - 2; r <= Math.ceil(m) + 2; r++) if (pcs.includes(((r % 12) + 12) % 12) && Math.abs(r - m) < bd) { bd = Math.abs(r - m); best = r; } return best; };
  // onsets mark re-sung notes of the same pitch ("la la la")
  const ons = vxOnsets(x, sr, { gate, delta: 0.12, minGap: 0.09 }).map(o => o.t - pre);
  const notes = [];
  for (let k = 0; k < bars * per; k++) {
    const a = k * stepSec - stepSec * 0.25, b = (k + 1) * stepSec - stepSec * 0.25;
    const fr = []; let all = 0;
    contour.forEach((c, i) => { if (c.t >= a && c.t < b) { all++; if (mm[i] != null) fr.push(mm[i]); } });
    if (!all || fr.length / all < 0.45) { notes.push(null); continue; }
    const m = snap(vxMedian(fr) - tune);
    // sung again, not held: an onset in this step, or the voice dipping between the two notes
    let dip = Infinity, lvl = [];
    contour.forEach(c => { if (Math.abs(c.t - k * stepSec) < 0.05) dip = Math.min(dip, c.rms); if (c.t >= a - stepSec && c.t < b) lvl.push(c.rms); });
    notes.push({ m, onset: ons.some(t => t >= a && t < b) || dip < vxMedian(lvl) * 0.35 });
  }
  // a melody sits in a melody's register: move it up by octaves until its middle is at least middle C
  const sung = notes.filter(Boolean).map(n => n.m);
  let shift = 0; while (sung.length && vxMedian(sung) + shift < 60) shift += 12;
  const flat = vxFlatKey(key.root, key.scale), tokens = [];
  notes.forEach((n, k) => {
    if (!n) { tokens.push('.'); return; }
    const p = notes[k - 1];
    // a hold carries a note within its bar; a new bar sings the note again
    tokens.push(p && p.m === n.m && !n.onset && k % per ? '_' : vxNoteName(n.m + shift, flat));
  });
  return { notes, tokens, contour: contour.map((c, i) => ({ t: c.t, m: mm[i] == null ? null : mm[i] - tune + shift })), per, shift, tune };
}

// ---------- writing patterns ----------
// One bar of step tokens in as few slots as it needs: 16 steps where only 8ths are used become 8 slots, and so on.
// For drums the steps inside a slot must be rests; for melodies they must continue the slot's note.
function vxBar(tok, melodic) {
  const n = tok.length;
  for (const d of [1, 2, 4, 8, 16, 32]) {
    if (n % d) continue;
    const w = n / d; let ok = true;
    for (let s = 0; s < d && ok; s++) {
      const first = tok[s * w];
      for (let j = 1; j < w && ok; j++) { const v = tok[s * w + j]; ok = melodic ? (v === '_' || (v === '.' && first === '.')) : v === '.'; }
    }
    if (ok) return Array.from({ length: d }, (_, s) => tok[s * w]).join(' ');
  }
  return tok.join(' ');
}
// several bars: the same bar repeated is written once; different bars take turns with <>
function vxPattern(tok, bars, melodic) {
  const per = tok.length / bars, bs = [];
  for (let b = 0; b < bars; b++) bs.push(vxBar(tok.slice(b * per, (b + 1) * per), melodic));
  if (bs.every(s => s === bs[0])) return bs[0];
  if (bars === 4 && bs[0] === bs[2] && bs[1] === bs[3]) return `<[${bs[0]}] [${bs[1]}]>`;
  return `<${bs.map(s => `[${s}]`).join(' ')}>`;
}
if (typeof module !== 'undefined') module.exports = { vxFFT, vxOnsets, vxBeat, vxHum, vxPattern, vxBar, vxCluster, vxNotch, vxNoteName };
