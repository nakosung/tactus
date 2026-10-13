// ===================== Sound match: one recorded note to a synth line =====================
// Pure, like vxdsp.js (tests/match.test.js runs it on made-up sounds). smAnalyze measures one note: its pitch,
// its harmonics while it holds, how its loudness and brightness move, a pitch fall at the start, vibrato, noise and a
// sub octave. smFit then looks for the wavetable frame and filter whose harmonics come closest (every frame of every
// table, a range of cutoffs and resonances, 12 and 24 dB), turns the rest into envelope values, and writes a wt line.

const SM_STEP = 0.005;   // envelope frames, seconds
// the harmonics (n = 1..24) of every wavetable frame, in dB, worked out once
let SM_FRAMES = null;
function smFrames() {
  if (SM_FRAMES) return SM_FRAMES;
  SM_FRAMES = [];
  for (let t = 0; t < WT_SHAPE.t; t++) for (let j = 0; j < WT_SHAPE.f; j++) {
    const { a, b } = wtFrame(t, j / (WT_SHAPE.f - 1)), h = new Float64Array(25);
    for (let n = 1; n <= 24; n++) h[n] = 20 * Math.log10(Math.hypot(a[n], b[n]) + 1e-9);
    SM_FRAMES.push({ t, j, h });
  }
  return SM_FRAMES;
}
const smDb = x => 20 * Math.log10(x + 1e-12);
function smMedian(a) { if (!a.length) return 0; const s = Float64Array.from(a).sort(); return s[s.length >> 1]; }

function smAnalyze(x, sr) {
  // loudness every 5 ms, over 20 ms (a shorter window would ripple with a low note's own cycle)
  const H = Math.max(1, Math.round(sr * SM_STEP)), n = Math.floor(x.length / H), env = new Float64Array(n), half = Math.round(sr * 0.01);
  const sq = new Float64Array(x.length + 1); for (let i = 0; i < x.length; i++) sq[i + 1] = sq[i] + x[i] * x[i];
  for (let k = 0; k < n; k++) { const a = Math.max(0, k * H + (H >> 1) - half), b = Math.min(x.length, k * H + (H >> 1) + half); env[k] = Math.sqrt((sq[b] - sq[a]) / Math.max(1, b - a)); }
  let pk = 0, kp = 0; env.forEach((v, k) => { if (v > pk) { pk = v; kp = k; } });
  if (pk < 1e-4) return { ok: false, why: 'quiet' };
  let on = 0; while (on < kp && env[on] < pk * 0.1) on++;
  let kA = on; while (kA < kp && env[kA] < pk * 0.9) kA++;
  let off = n - 1; while (off > kA && env[off] < pk * 0.03) off--;
  const dur = (off - on) * SM_STEP;
  if (dur < 0.06) return { ok: false, why: 'short' };
  // pitch, every 10 ms through the note (30 Hz .. 2 kHz)
  const W = Math.min(2048, Math.round(sr * 0.03)), tmin = Math.floor(sr / 2000), tmax = Math.min(Math.ceil(sr / 30), Math.floor(sr * 0.04));
  const f0s = [];
  for (let t = kA * SM_STEP; t < off * SM_STEP - 0.03 && f0s.length < 120; t += 0.01) {
    const i = Math.round(t * sr); if (i + W + tmax >= x.length) break;
    const r = vxYin(x, sr, i, W, tmin, tmax); f0s.push(r ? r.f0 : 0);
  }
  const voiced = f0s.filter(f => f > 0);
  if (voiced.length < Math.max(3, f0s.length * 0.4)) return { ok: false, why: 'pitch' };
  const steady = voiced.slice(Math.floor(voiced.length * 0.3)), f0 = smMedian(steady), midi = 69 + 12 * Math.log2(f0 / 440);
  // a fall (or rise) into the note: the first 30 ms against where it settles
  const cents = f => 1200 * Math.log2(f / f0);
  // two short looks at the pitch soon after the start give how far off it began and how fast it settled
  let penv = 0, pdec = 0.05;
  { const i0 = Math.round(on * SM_STEP * sr), w = Math.round(0.012 * sr), look = ms => { const r = vxYin(x, sr, i0 + Math.round(ms / 1000 * sr), w, tmin, Math.min(tmax, w)); return r ? { t: (ms + 6) / 1000, c: cents(r.f0) } : null; };
    const a = look(4) || look(8), b = a && look(a.t * 1000 + 6);
    if (a && Math.abs(a.c) > 120) {
      const tau = b && Math.sign(b.c) === Math.sign(a.c) && Math.abs(b.c) < Math.abs(a.c) * 0.95 ? (b.t - a.t) / Math.log(a.c / b.c) : 0.015;
      penv = Math.round(Math.max(-24, Math.min(24, a.c * Math.exp(a.t / tau) / 100)) * 2) / 2;
      pdec = Math.max(0.01, Math.min(0.4, tau * 3));
    } }
  // vibrato: how far the settled pitch wanders
  const dev = steady.map(f => cents(f)), vibC = Math.sqrt(dev.reduce((s, d) => s + d * d, 0) / Math.max(1, dev.length));
  // harmonics while the note holds: the average spectrum over its middle
  const N = 8192, win = vxHann(N), mid0 = Math.round((kA + (off - kA) * 0.25) * SM_STEP * sr), mid1 = Math.round((kA + (off - kA) * 0.8) * SM_STEP * sr);
  const acc = new Float64Array(N / 2); let frames = 0;
  for (let i = mid0; i + N <= Math.max(mid1, mid0 + N) && i + N <= x.length && frames < 12; i += N / 2) { const m = vxSpec(x, i, N, win); for (let k = 0; k < N / 2; k++) acc[k] += m[k] * m[k]; frames++; }
  if (!frames) { const m = vxSpec(x, Math.max(0, x.length - N), N, win); for (let k = 0; k < N / 2; k++) acc[k] += m[k] * m[k]; frames = 1; }
  const bin = f => f * N / sr, lvl = f => { const c = bin(f), w = Math.max(2, c * 0.03); let m = 0; for (let k = Math.max(1, Math.floor(c - w)); k <= Math.min(N / 2 - 1, Math.ceil(c + w)); k++) m = Math.max(m, acc[k]); return Math.sqrt(m); };
  const harm = []; for (let h = 1; h <= 24; h++) harm.push(f0 * h < sr * 0.45 ? smDb(lvl(f0 * h)) : null);
  const sub = smDb(lvl(f0 / 2)) - harm[0];
  // noise: energy between the harmonics, 300 Hz .. 10 kHz
  let inH = 0, all = 0;
  for (let k = Math.ceil(bin(300)); k < Math.min(N / 2, bin(10000)); k++) { const f = k * sr / N, h = f / f0, d = Math.abs(h - Math.round(h)) * f0; all += acc[k]; if (d < Math.max(f0 * 0.06, 2.5 * sr / N)) inH += acc[k]; }
  const noisy = all > 0 ? 1 - inH / all : 0;
  // brightness over time, for the filter envelope
  const cen = [];
  for (let k = on; k < off; k += 2) {
    const i = k * H; if (i + 1024 > x.length) break;
    const m = vxSpec(x, i, 1024, vxHann(1024)); let tot = 0, c = 0; for (let b = 1; b < 512; b++) { tot += m[b] * m[b]; c += b * sr / 1024 * m[b] * m[b]; }
    cen.push(tot > 0 ? c / tot : 0);
  }
  // loudness shape
  const seg = (a, b) => smMedian(Array.from(env.subarray(Math.round(kA + (off - kA) * a), Math.max(Math.round(kA + (off - kA) * a) + 1, Math.round(kA + (off - kA) * b)))));
  return { ok: true, sr, f0, midi, on: on * SM_STEP, atk: Math.max(0.002, (kA - on) * SM_STEP - 0.008), peak: pk, env: Array.from(env.subarray(on, off + 1)), kA: kA - on,
    early: seg(0.25, 0.45) / pk, late: seg(0.65, 0.85) / pk, dur, harm, sub, noisy, vibC, penv, pdec, cen };
}

// a 12 dB state-variable low-pass's gain at frequency ratio r = f / fc, with resonance q
const smLp = (r, q) => 1 / Math.sqrt((1 - r * r) ** 2 + (r / q) ** 2);
function smFit(A) {
  if (!A || !A.ok) return A;
  const fr = smFrames(), meas = A.harm, top = Math.max(...meas.filter(v => v != null));
  const use = meas.map((v, i) => v != null && (i + 1) * A.f0 < 12000);
  const kt = Math.pow(A.f0 / 261.6, 0.3);
  let best = null;
  const cuts = []; for (let c = 120; c < 16000; c *= 1.22) cuts.push(c);
  for (const F of fr) {
    for (const ft of [0, 1]) for (const q of [0.7, 1.5, 3, 6]) for (const fc of cuts) {
      // the frame through the filter, compared after lining up the loudest harmonic; harmonics lost under the noise
      // only count when the model would be louder than what was heard
      const mod = []; let mtop = -1e9;
      for (let n = 1; n <= 24; n++) { const r = n * A.f0 / fc, g = ft ? smLp(r, q) * smLp(r, 0.6) : smLp(r, q); const v = F.h[n] + smDb(g); mod.push(v); if (use[n - 1] && v > mtop) mtop = v; }
      let err = 0, cnt = 0;
      for (let n = 0; n < 24; n++) {
        if (!use[n]) continue;
        const a = meas[n] - top, b = mod[n] - mtop;
        if (a < -60) { if (b > -60) { err += Math.min(30, b + 60); cnt++; } continue; }
        err += Math.min(30, Math.abs(a - Math.max(b, -60))); cnt++;
      }
      err /= Math.max(1, cnt);
      // a little in favour of open filters and low resonance when it makes no difference
      err += q * 0.04 + (ft ? 0.05 : 0) + 0.25 * (1 - Math.log(fc / 120) / Math.log(16000 / 120));
      if (!best || err < best.err) best = { err, F, ft, q, fc, mod: mod.map(v => v - mtop) };
    }
  }
  const P = { table: WT_NAMES[best.F.t], scan: Math.round(best.F.j / 15 * 100) / 100, cut: Math.round(best.fc / kt / 10) * 10, res: best.q };
  if (best.ft) P.ftype = 'lp24';
  // loudness: attack, then either a hold (sus) or a fall to silence (a pluck), and a release
  const env = A.env, pk = Math.max(...env), kA = A.kA, hold = A.late > 0.25 && A.late > A.early * 0.6;
  P.atk = Math.round(A.atk * 1000) / 1000;
  let k = kA; while (k < env.length && env[k] > pk * (hold ? A.late + (1 - A.late) * 0.37 : 0.37)) k++;
  const tau = Math.max(0.01, (k - kA) * SM_STEP);
  P.dec = Math.round(Math.min(3, tau * 3) * 100) / 100;
  P.sus = hold ? Math.round(Math.min(1, A.late) * 100) / 100 : 0;
  if (hold) { let j = env.length - 1, start = j; while (start > kA && env[start] < pk * A.late * 0.8) start--; P.rel = Math.round(Math.max(0.03, Math.min(3, (j - start) * SM_STEP * 4 / 3.45)) * 100) / 100; }
  else P.rel = Math.min(P.dec, 0.3);
  // the filter's own movement: brighter at the start than later on
  const cen = A.cen.filter(c => c > 0);
  if (cen.length > 6) {
    const early = Math.max(...cen.slice(0, Math.max(2, Math.round(0.06 / (SM_STEP * 2))))), late = smMedian(cen.slice(Math.floor(cen.length * 0.5)));
    const R = early / Math.max(1, late);
    if (R > 1.25) {
      P.env = Math.round(Math.min(1, (Math.pow(R, 1 / 0.6) - 1) / 10) * 100) / 100;
      let i = 0; while (i < cen.length && cen[i] > late + (early - late) * 0.37) i++;
      P.fdec = Math.round(Math.max(0.02, Math.min(2, i * SM_STEP * 2 * 3)) * 100) / 100;
    } else P.env = 0;
  } else P.env = 0;
  if (A.penv) { P.penv = A.penv; P.pdec = Math.round(A.pdec * 100) / 100; }
  if (A.vibC > 6) P.vib = Math.round(Math.min(60, A.vibC * 1.4));
  if (Math.sqrt(A.noisy) > 0.06) P.noise = Math.round(Math.min(0.6, Math.sqrt(A.noisy) * 1.2) * 100) / 100;
  if (A.sub > -24) P.sub = Math.round(Math.min(1, Math.max(0.05, Math.pow(10, (A.sub + 3) / 20))) * 100) / 100;
  const note = vxNoteName(Math.round(A.midi), false);
  const steps = Math.max(1, Math.min(16, Math.round(A.dur / 0.125)));
  const pat = [note, ...Array(Math.max(0, Math.min(steps, 8) - 1)).fill('_'), ...Array(Math.max(0, 8 - Math.min(steps, 8))).fill('.')].join(' ');
  const order = ['table', 'scan', 'cut', 'res', 'ftype', 'env', 'fdec', 'atk', 'dec', 'sus', 'rel', 'penv', 'pdec', 'vib', 'noise', 'sub'];
  const params = order.filter(k => P[k] != null && !(k === 'env' && !P[k])).map(k => `${k} ${typeof P[k] === 'number' ? bkNumS(P[k]) : P[k]}`).join(' ');
  return { ok: true, note, midi: A.midi, f0: A.f0, P, err: best.err, meas: meas.map(v => v == null ? null : v - top), model: best.mod, pat, code: `match  ${pat} | wt ${params}` };
}
// a number as the code writes it: .5, 1200, -2
function bkNumS(v) { return v >= 100 || v <= -100 ? String(Math.round(v)) : String(+v.toFixed(3)).replace(/^0\./, '.').replace(/^-0\./, '-.'); }
if (typeof module !== 'undefined') module.exports = { smAnalyze, smFit };
