// ===================== Tactus audio-thread synths (AudioWorklet) =====================
// zither: Karplus-Strong plucked string (gayageum, koto, harp). acid: TB-303 style mono voice with
// a saturating 4-pole ladder filter, slide (glide into the next note) and accent. mono: an analog mono bass,
// two detuned saws (or squares) and a square sub into the same kind of ladder, with an ADSR and glide.
// Events carry an exact sample frame, so timing is sample-accurate. The voices run in Rust compiled to
// WebAssembly (dsp/src/lib.rs); the JavaScript voices below are the fallback when WASM is unavailable,
// and if worklets can't load at all, both fall back to the WebAudio voices.
const SYN_CODE = `
const TAU = Math.PI * 2;
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
function th(x) { if (x > 3) return 1; if (x < -3) return -1; const x2 = x * x; return x * (27 + x2) / (27 + 9 * x2); }
// ---- the synth engine (mirrors vs_* in dsp/src/lib.rs: same helpers, same order of operations) ----
const UNI = 7, VS_N = 12, WT_T = 8, WT_F = 16, WT_M = 7, WT_N = 1024;
const sinp = x => { x = x - TAU * Math.floor(x / TAU + 0.5); if (x > Math.PI / 2) x = Math.PI - x; else if (x < -Math.PI / 2) x = -Math.PI - x; const x2 = x * x; return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880))))); };
const tanp = x => sinp(x) / sinp(x + Math.PI / 2);
const exp2p = x => { x = Math.max(-1000, Math.min(1000, x)); const i = Math.floor(x), f = x - i; const p = 1 + f * (0.6931471805599453 + f * (0.2402265069591007 + f * (0.05550410866482158 + f * (0.009618129107628477 + f * (0.0013333558146428443 + f * 0.00015403530393381606))))); return p * Math.pow(2, i); };
const expp = x => exp2p(x * 1.4426950408889634);
const sawb = (ph, dt) => 2 * ph - 1 - blep(ph, dt);
const fracd = x => x - Math.floor(x);
const pulseb = (ph, pw, dt) => sawb(ph, dt) - sawb(fracd(ph - pw), dt) - (2 * pw - 1);
const lfoWave = (shape, ph, held) => shape === 1 ? 1 - 4 * Math.abs(ph - 0.5) : shape === 2 ? 2 * ph - 1 : shape === 3 ? 1 - 2 * ph : shape === 4 ? (ph < 0.5 ? 1 : -1) : shape === 5 ? held : sinp(TAU * ph);
const SV = [0, 0, 0];
function svf(s, x, g, k) {
  const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
  const v3 = x - s[1], v1 = a1 * s[0] + a2 * v3, v2 = s[1] + a2 * s[0] + a3 * v3;
  s[0] = 2 * v1 - s[0]; s[1] = 2 * v2 - s[1];
  SV[0] = v2; SV[1] = v1; SV[2] = x - k * v1 - v2; return SV;
}
const VOWEL_F = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]];
function vsFresh() {
  return { on: false, gate: false, off: 0, start: 0, kind: 0, f: 110, target: 110, gk: 1, ph: new Float64Array(UNI), ph2: new Float64Array(UNI), fbm: new Float64Array(UNI), phs: 0, phr: 0,
    nv: 1, rat: new Float64Array(UNI).fill(1), gl: new Float64Array(UNI).fill(1), gr: new Float64Array(UNI).fill(1), amp: 0, attack: false, ainc: 0.01, dk: 0.001, sus: 0.5, rk: 0.01,
    fe: 0, fatt: false, finc: 1, fdk: 0.001, fsus: 0, frk: 0.01, pe: 0, pdk: 0.99, penv: 0, cut: 1000, kt: 1, res: 0.7, env: 0, ftype: 0, drive: 0,
    sub: 0, noise: 0, wave: 0, pw: 0.5, sync: 1, ring: 0, table: 0, scan: 0, fm: 0, ratio: 1, fb: 0, fme: 1, fmdk: 1, vowel: -1, gain: 0,
    sl: [0, 0], sl2: [0, 0], sr: [0, 0], sr2: [0, 0], yl: [0, 0, 0, 0], yr: [0, 0, 0, 0], vl: [[0, 0], [0, 0], [0, 0]], vr: [[0, 0], [0, 0], [0, 0]],
    lfo: [{ tgt: 0, inc: 0, ph: 0, shape: 0, depth: 0, held: 0 }, { tgt: 0, inc: 0, ph: 0, shape: 0, depth: 0, held: 0 }] };
}
class Syn extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = []; this.ks = []; this.ac = null; this.x = null;
    this.vs = Array.from({ length: VS_N }, vsFresh); this.vseed = ((Math.random() * 4294967295) >>> 0) | 1; this.vsM = new Float64Array(10); this.vsOut = [0, 0]; this.wt = null; this.vsDur = 0;
    this.port.onmessage = e => {
      const m = e.data;
      if (m.t === 'wasm') {
        try {
          const x = new WebAssembly.Instance(new WebAssembly.Module(m.bytes), {}).exports;
          x.init(sampleRate, (Math.random() * 4294967295) >>> 0);
          this.oL = new Float32Array(x.memory.buffer, x.out_l(), 128); this.oR = new Float32Array(x.memory.buffer, x.out_r(), 128);
          this.pb = new Float32Array(x.memory.buffer, x.vs_params(), 96);
          if (this.wt) new Float32Array(x.memory.buffer, x.wt_ptr(), x.wt_len()).set(this.wt);
          this.x = x; this.port.postMessage({ t: 'wasm-ok' });
        } catch (err) { this.port.postMessage({ t: 'wasm-fail', err: String(err) }); }
        return;
      }
      if (m.t === 'end') { this.dead = true; return; }
      if (m.t === 'wt') { this.wt = m.data; if (this.x) new Float32Array(this.x.memory.buffer, this.x.wt_ptr(), this.x.wt_len()).set(m.data); return; }
      if (m.t === 'seed') { this.vseed = m.seed | 1; if (this.x) this.x.vs_seed(m.seed); this.vs = Array.from({ length: VS_N }, vsFresh); return; }
      if (m.t === 'live') {
        if (this.x) { this.x.live(m.cut != null ? m.cut : -1, m.res != null ? m.res : -1); return; }
        for (const v of [this.ac, this.mo]) if (v) { if (m.cut != null) v.cut = m.cut; if (m.res != null) v.k = Math.min(3.9, m.res / 4); }
        return;
      }
      this.q.push(m); this.q.sort((a, b) => a.frame - b.frame);
    };
  }
  ksOn(m) {
    const sr = sampleRate, period = sr / m.f, n = Math.ceil(period * 1.04) + 4;
    const buf = new Float32Array(n), a = 0.12 + 0.85 * m.bright;
    let y = 0, mean = 0;
    for (let i = 0; i < n; i++) { y += a * ((Math.random() * 2 - 1) - y); buf[i] = y; mean += y; }
    mean /= n; let pk = 0;
    for (let i = 0; i < n; i++) { buf[i] -= mean; pk = Math.max(pk, Math.abs(buf[i])); }
    for (let i = 0; i < n; i++) buf[i] /= pk || 1;
    const p = (Math.max(-1, Math.min(1, m.pan)) + 1) * Math.PI / 4;
    if (this.ks.length >= 16) this.ks.shift();
    this.ks.push({ buf, n, w: 0, base: period - 0.5, prev: 0, amp: m.gain, pl: Math.cos(p), pr: Math.sin(p),
      g: Math.pow(10, -3 / (Math.max(0.05, m.t60) * m.f)), gRel: Math.pow(10, -3 / (0.15 * m.f)),
      off: m.frame + m.dur, start: m.frame, vib: m.vib || 0, ph: Math.random() * TAU, rate: (5 + Math.random()) / sr, life: m.frame + m.dur + Math.round(sr * Math.min(m.t60, 6)) });
  }
  acOn(m) {
    let v = this.ac;
    if (!v) v = this.ac = { ph: 0, f: m.f, target: m.f, y0: 0, y1: 0, y2: 0, y3: 0, fenv: 0, amp: 0, gate: false, off: 0 };
    const legato = v.gate && m.frame <= v.off + 64;
    v.slide = legato || (m.slide && v.amp > 0.001);
    v.target = m.f;
    if (!v.slide) { v.f = m.f; v.fenv = 1; }
    if (m.acc) v.fenv = Math.min(1.8, v.fenv + 0.7);
    v.gate = true; v.off = m.frame + m.dur;
    v.cut = m.cut; v.k = Math.min(3.9, m.res / 4); v.env = m.env; v.acc = m.acc;
    v.dec = Math.exp(-1 / (Math.max(0.02, m.dec) * (m.acc ? 0.6 : 1) * sampleRate));
    v.gain = m.gain; v.wave = m.wave; v.drive = 1 + m.drive * 3;
  }
  moOn(m) {
    const sr = sampleRate;
    // a fresh voice after silence, as the Rust voice starts one
    if (!this.mo || !this.mo.on) this.mo = { on: true, ph: 0, ph2: 0, phs: 0, f: m.f, target: m.f, gk: 1, y0: 0, y1: 0, y2: 0, y3: 0, fenv: 0, fd: 0.999, amp: 0, attack: false, gate: false, off: 0 };
    const v = this.mo, sounding = v.amp > 1e-4;
    v.target = m.f;
    if (m.glide > 0 && sounding) v.gk = 1 - Math.exp(-1 / (m.glide / 3 * sr)); else { v.f = m.f; v.gk = 1; }
    v.gate = true; v.off = m.frame + m.dur; v.attack = true; v.fenv = 1;
    const dec = Math.max(0.01, m.dec);
    v.ainc = 1 / (Math.max(0.002, m.atk) * sr); v.dk = 1 - Math.exp(-1 / (dec / 3 * sr)); v.fd = Math.exp(-1 / (dec / 3 * sr));
    v.rk = 1 - Math.exp(-1 / (Math.max(0.02, m.rel) / 4 * sr)); v.sus = Math.max(0, Math.min(1, m.sus));
    v.cut = m.cut; v.kt = m.kt; v.k = Math.min(3.9, m.res / 4); v.env = m.env;
    v.gain = m.gain; v.wave = Math.max(0, Math.min(1, m.wave)); v.sub = Math.max(0, Math.min(1, m.sub)); v.det = m.det; v.drive = 1 + m.drive * 3;
  }
  rndd() { let s = this.vseed; s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; this.vseed = s; return s / 4294967296; }
  vsOn(p, frame) {
    const sr = sampleRate, q = i => p[i], mono = q(34) > 0, vs = this.vs;
    let slot = 0;
    if (!mono) { let score = Infinity; vs.forEach((v, i) => { const sc = !v.on ? -1 : !v.gate ? v.amp : 10 + (frame - v.start) * -1e-9; if (sc < score) { score = sc; slot = i; } }); }
    let v = vs[slot];
    const sounding = v.on && v.amp > 1e-4, f = q(0);
    if (!(mono && v.on)) { v = vs[slot] = vsFresh(); v.on = true; v.f = f; for (let u = 0; u < UNI; u++) { v.ph[u] = this.rndd(); v.ph2[u] = 0; } }
    v.kind = q(1) | 0; v.target = f;
    const glide = q(33);
    if (mono && glide > 0 && sounding) v.gk = 1 - expp(-1 / (glide / 3 * sr)); else { v.f = f; v.gk = 1; }
    v.gate = true; v.off = frame + this.vsDur; v.start = frame; v.attack = true;
    v.gain = q(2);
    const dec = Math.max(0.01, q(5));
    v.ainc = 1 / (Math.max(0.002, q(4)) * sr); v.dk = 1 - expp(-1 / (dec / 3 * sr)); v.sus = Math.max(0, Math.min(1, q(6)));
    v.rk = 1 - expp(-1 / (Math.max(0.02, q(7)) / 4 * sr));
    v.cut = q(8); v.kt = q(9); v.res = q(10); v.env = q(11);
    const fatk = q(12), fdec = Math.max(0.01, q(13));
    v.fatt = fatk > 0; v.finc = fatk > 0 ? 1 / (fatk * sr) : 1; v.fe = fatk > 0 ? 0 : 1;
    v.fdk = 1 - expp(-1 / (fdec / 3 * sr)); v.fsus = Math.max(0, Math.min(1, q(14))); v.frk = v.rk;
    v.ftype = q(15) | 0; v.drive = Math.max(0, q(16));
    v.penv = q(17); v.pe = 1; v.pdk = expp(-1 / (Math.max(0.002, q(18)) / 3 * sr));
    v.nv = Math.max(1, Math.min(UNI, q(19) | 0));
    v.sub = q(20); v.noise = q(21); v.wave = Math.max(0, Math.min(1, q(22))); v.pw = Math.max(0.02, Math.min(0.98, q(23))); v.sync = Math.max(1, q(24)); v.ring = Math.max(0, Math.min(1, q(25)));
    v.table = Math.min(WT_T - 1, q(26) | 0); v.scan = q(27);
    v.fm = q(28); v.ratio = Math.max(0.01, q(29)); v.fb = Math.max(0, Math.min(1, q(30)));
    const fmdec = q(31); v.fme = 1; v.fmdk = fmdec > 0 ? expp(-1 / (fmdec / 3 * sr)) : 1;
    v.vowel = q(32);
    for (let k = 0; k < 2; k++) { const b = 36 + k * 5; v.lfo[k] = { tgt: q(b) | 0, inc: q(b + 1) / sr, ph: q(b + 2), shape: q(b + 3) | 0, depth: q(b + 4), held: this.rndd() * 2 - 1 }; }
    for (let u = 0; u < UNI; u++) { v.rat[u] = q(46 + u); v.gl[u] = q(53 + u); v.gr[u] = q(60 + u); }
  }
  wtRead(t, scan, ph, f) {
    const w = this.wt, sr = sampleRate; if (!w) return 0;
    const ok = 0.45 * sr / Math.max(1, f); let mip = 0;
    while (mip < WT_M - 1 && (512 >> mip) > ok) mip++;
    const pos = Math.max(0, Math.min(1, scan)) * (WT_F - 1); let fi = Math.floor(pos); if (fi > WT_F - 2) fi = WT_F - 2;
    const ff = pos - fi, b0 = ((t * WT_F + fi) * WT_M + mip) * WT_N, b1 = ((t * WT_F + fi + 1) * WT_M + mip) * WT_N;
    const x = ph * WT_N, i0 = Math.floor(x) & (WT_N - 1), fr = x - Math.floor(x), i1 = (i0 + 1) & (WT_N - 1);
    const a = w[b0 + i0] + (w[b0 + i1] - w[b0 + i0]) * fr, b = w[b1 + i0] + (w[b1 + i1] - w[b1 + i0]) * fr;
    return a + (b - a) * ff;
  }
  vsSample(fr, out) {
    const sr = sampleRate; let L = 0, R = 0;
    for (const v of this.vs) {
      if (!v.on) continue;
      if (v.gate && fr >= v.off) v.gate = false;
      const m = this.vsM; m.fill(0);
      for (let k = 0; k < 2; k++) {
        const lf = v.lfo[k]; if (lf.tgt === 0) continue;
        lf.ph += lf.inc;
        if (lf.ph >= 1) { lf.ph -= 1; if (lf.shape === 5) lf.held = this.rndd() * 2 - 1; }
        if (lf.tgt < 10) m[lf.tgt] += lf.depth * lfoWave(lf.shape, lf.ph, lf.held);
      }
      v.f += (v.target - v.f) * v.gk;
      v.pe *= v.pdk;
      const fc0 = v.f * exp2p(v.penv * v.pe / 12 + m[3] / 1200);
      const scan = v.scan + m[4], pw = Math.max(0.02, Math.min(0.98, v.pw + m[5])), sync = Math.max(1, v.sync + m[8]);
      const idx = (v.fm + m[6]) * v.fme; v.fme *= v.fmdk;
      let xl = 0, xr = 0;
      for (let u = 0; u < v.nv; u++) {
        const fu = fc0 * v.rat[u], dt = fu / sr;
        let o;
        if (v.kind === 1) { v.ph[u] += dt; if (v.ph[u] >= 1) v.ph[u] -= 1; o = this.wtRead(v.table, scan, v.ph[u], fu); }
        else if (v.kind === 2) {
          v.ph2[u] += dt * v.ratio; if (v.ph2[u] >= 1) v.ph2[u] -= 1;
          const mo = sinp(TAU * v.ph2[u] + v.fb * Math.PI * v.fbm[u]); v.fbm[u] = mo;
          v.ph[u] += dt; if (v.ph[u] >= 1) v.ph[u] -= 1;
          o = sinp(TAU * v.ph[u] + idx * mo);
        } else {
          v.ph[u] += dt;
          const wrapped = v.ph[u] >= 1; if (wrapped) v.ph[u] -= 1;
          if (sync > 1) {
            const ds = dt * sync;
            v.ph2[u] += ds; if (v.ph2[u] >= 1) v.ph2[u] -= Math.floor(v.ph2[u]);
            if (wrapped) v.ph2[u] = fracd(v.ph[u] * sync);
            o = (1 - v.wave) * sawb(v.ph2[u], ds) + v.wave * pulseb(v.ph2[u], pw, ds);
          } else o = (1 - v.wave) * sawb(v.ph[u], dt) + v.wave * pulseb(v.ph[u], pw, dt);
        }
        xl += o * v.gl[u]; xr += o * v.gr[u];
      }
      if (v.ring > 0) { v.phr += fc0 * v.ratio / sr; if (v.phr >= 1) v.phr -= 1; const rm = (1 - v.ring) + v.ring * sinp(TAU * v.phr); xl *= rm; xr *= rm; }
      if (v.sub > 0) { const ds = fc0 * 0.5 / sr; v.phs += ds; if (v.phs >= 1) v.phs -= 1; const o = v.sub * 0.5 * pulseb(v.phs, 0.5, ds); xl += o; xr += o; }
      const nz = v.noise + m[9];
      if (nz > 0) { const o = nz * 0.6 * (this.rndd() * 2 - 1); xl += o; xr += o; }
      if (v.fatt) { v.fe += v.finc; if (v.fe >= 1) { v.fe = 1; v.fatt = false; } }
      else if (v.gate) v.fe += (v.fsus - v.fe) * v.fdk; else v.fe -= v.fe * v.frk;
      const fc = Math.max(30, Math.min(sr * 0.42, v.cut * v.kt * (1 + v.env * 10 * v.fe) + m[1]));
      const res = Math.max(0.05, v.res + m[2]);
      if (v.drive > 0) { const g = 1 + v.drive * 3, c = 1 / (1 + v.drive); xl = th(xl * g) * c; xr = th(xr * g) * c; }
      let yl, yr;
      if (v.ftype === 2) {
        const g = 1 - expp(-TAU * fc / sr), k = Math.min(3.9, res / 4);
        const ch = (y, x) => { x = th(x * 0.8 - k * y[3]); let t0 = th(y[0]); y[0] += g * (x - t0); t0 = th(y[0]); let t1 = th(y[1]); y[1] += g * (t0 - t1); t1 = th(y[1]); let t2 = th(y[2]); y[2] += g * (t1 - t2); t2 = th(y[2]); const t3 = th(y[3]); y[3] += g * (t2 - t3); return y[3] * (1 + k * 0.35) * 1.25; };
        yl = ch(v.yl, xl); yr = ch(v.yr, xr);
      } else {
        const g = tanp(Math.PI * fc / sr), k = 1 / Math.max(0.5, res);
        const a = svf(v.sl, xl, g, k), l1 = a[0], b1 = a[1], h1 = a[2];
        const c = svf(v.sr, xr, g, k), r1 = c[0], rb1 = c[1], rh1 = c[2];
        if (v.ftype === 1) { const k2 = 1 / 0.6; yl = svf(v.sl2, l1, g, k2)[0]; yr = svf(v.sr2, r1, g, k2)[0]; }
        else if (v.ftype === 3) { yl = h1; yr = rh1; }
        else if (v.ftype === 4) { yl = b1 * k; yr = rb1 * k; }
        else if (v.ftype === 5) { yl = l1 + h1; yr = r1 + rh1; }
        else { yl = l1; yr = r1; }
      }
      let ol = yl, or = yr;
      const vw = v.vowel >= 0 ? Math.max(0, Math.min(4, v.vowel + m[7])) : -1;
      if (vw >= 0) {
        const i = Math.min(3, Math.floor(vw)), f = vw - i; let al = 0, ar = 0;
        for (let k = 0; k < 3; k++) {
          const ff = VOWEL_F[i][k] * (1 - f) + VOWEL_F[i + 1][k] * f, g = tanp(Math.PI * Math.min(ff, sr * 0.42) / sr), kk = 1 / [6, 9, 11][k], a = [1, 0.5, 0.25][k];
          al += a * svf(v.vl[k], yl, g, kk)[1] * kk; ar += a * svf(v.vr[k], yr, g, kk)[1] * kk;
        }
        ol = al * 3.4; or = ar * 3.4;
      }
      if (v.gate) { if (v.attack) { v.amp += v.ainc; if (v.amp >= 1) { v.amp = 1; v.attack = false; } } else v.amp += (v.sus - v.amp) * v.dk; }
      else v.amp -= v.amp * v.rk;
      const amp = v.amp * v.gain;
      L += ol * amp; R += or * amp;
      if (!v.gate && v.amp < 1e-5 && fr > v.off + 4800) v.on = false;
    }
    out[0] = L; out[1] = R;
  }
  process(_, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], N = L.length, sr = sampleRate;
    if (this.x) {
      // Rust/WASM path: render up to each event's exact sample, apply it, continue
      const x = this.x, oL = this.oL, oR = this.oR, base = currentFrame, q = this.q;
      let pos = 0;
      while (pos < N) {
        const next = q.length ? Math.max(pos, Math.min(N, q[0].frame - base)) : N;
        if (next > pos) { x.render(next - pos); for (let i = pos, j = 0; i < next; i++, j++) { L[i] = oL[j]; R[i] = oR[j]; } pos = next; }
        while (q.length && q[0].frame <= base + pos) {
          const m = q.shift();
          if (m.kind === 'ks') x.ks_on(m.f, m.gain, m.pan, m.bright, m.t60, m.vib || 0, m.dur);
          else if (m.kind === 'vs') { this.pb.set(m.p); x.vs_on(m.dur); }
          else if (m.kind === 'mono') x.mono_on(m.f, m.dur, m.cut, m.kt, m.res, m.env, m.dec, m.atk, m.sus, m.rel, m.gain, m.wave, m.sub, m.det, m.drive, m.glide);
          else x.acid_on(m.f, m.dur, m.slide ? 1 : 0, m.acc ? 1 : 0, m.cut, m.res, m.env, m.dec, m.gain, m.wave, m.drive);
        }
      }
      return true;
    }
    const glide = 1 - Math.exp(-1 / (0.055 * sr)), aAtk = 1 - Math.exp(-1 / (0.002 * sr)), aRel = 1 - Math.exp(-1 / (0.008 * sr));
    const fmax = sr * 0.42;
    for (let i = 0; i < N; i++) {
      const fr = currentFrame + i;
      while (this.q.length && this.q[0].frame <= fr) { const m = this.q.shift(); if (m.kind === 'ks') this.ksOn(m); else if (m.kind === 'vs') { this.vsDur = m.dur; this.vsOn(m.p, m.frame); } else if (m.kind === 'mono') this.moOn(m); else this.acOn(m); }
      let l = 0, r = 0;
      for (const v of this.ks) {
        let d = v.base;
        if (v.vib) {
          const age = (fr - v.start) / sr, depth = v.vib * Math.min(1, Math.max(0, (age - 0.2) / 0.4));
          v.ph += TAU * v.rate; d = v.base * Math.pow(2, -depth * Math.sin(v.ph) / 1200);
        }
        let rd = v.w - d; while (rd < 0) rd += v.n;
        const i0 = rd | 0, f = rd - i0, i1 = i0 + 1 === v.n ? 0 : i0 + 1;
        const y = v.buf[i0] * (1 - f) + v.buf[i1] * f;
        const s = 0.5 * (y + v.prev); v.prev = y;
        const sv = s * (fr >= v.off ? v.gRel : v.g); v.buf[v.w] = sv > -1e-20 && sv < 1e-20 ? 0 : sv;
        v.w = v.w + 1 === v.n ? 0 : v.w + 1;
        const o = y * v.amp; l += o * v.pl; r += o * v.pr;
      }
      const v = this.ac;
      if (v) {
        if (v.gate && fr >= v.off) v.gate = false;
        if (v.slide) v.f += (v.target - v.f) * glide;
        const dt = v.f / sr;
        v.ph += dt; if (v.ph >= 1) v.ph -= 1;
        let osc;
        if (v.wave > 0.5) { let p2 = v.ph + 0.5; if (p2 >= 1) p2 -= 1; osc = (v.ph < 0.5 ? 1 : -1) + blep(v.ph, dt) - blep(p2, dt); }
        else osc = 2 * v.ph - 1 - blep(v.ph, dt);
        v.fenv *= v.dec;
        const fc = Math.min(fmax, Math.max(30, v.cut * (1 + v.env * 8 * v.fenv)));
        const g = 1 - Math.exp(-TAU * fc / sr), k = v.k;
        const x = th(osc * v.drive * 0.8 - k * v.y3);
        v.y0 += g * (x - th(v.y0)); v.y1 += g * (th(v.y0) - th(v.y1)); v.y2 += g * (th(v.y1) - th(v.y2)); v.y3 += g * (th(v.y2) - th(v.y3));
        const target = v.gate ? (v.acc ? 1.35 : 1) : 0;
        v.amp += (target - v.amp) * (v.gate ? aAtk : aRel);
        const o = v.y3 * v.amp * v.gain * (1 + k * 0.35);
        l += o; r += o;
      }
      const m = this.mo;
      if (m && m.on) {
        if (m.gate && fr >= m.off) m.gate = false;
        m.f += (m.target - m.f) * m.gk;
        const dt = m.f / sr, dt2 = dt * m.det, dts = dt * 0.5;
        m.ph += dt; if (m.ph >= 1) m.ph -= 1;
        m.ph2 += dt2; if (m.ph2 >= 1) m.ph2 -= 1;
        m.phs += dts; if (m.phs >= 1) m.phs -= 1;
        const sq = (ph, d) => { let p2 = ph + 0.5; if (p2 >= 1) p2 -= 1; return (ph < 0.5 ? 1 : -1) + blep(ph, d) - blep(p2, d); };
        let osc = 0;
        if (m.wave < 1) osc += (1 - m.wave) * (0.62 * (2 * m.ph - 1 - blep(m.ph, dt)) + 0.32 * (2 * m.ph2 - 1 - blep(m.ph2, dt2)));
        if (m.wave > 0) osc += m.wave * (0.5 * sq(m.ph, dt) + 0.25 * sq(m.ph2, dt2));
        if (m.sub > 0) osc += m.sub * 0.22 * sq(m.phs, dts);
        m.fenv *= m.fd;
        const fc = Math.min(fmax, Math.max(30, m.cut * m.kt * (1 + m.env * 10 * m.fenv)));
        const g = 1 - Math.exp(-TAU * fc / sr), k = m.k;
        const x = th(osc * m.drive * 0.8 - k * m.y3);
        m.y0 += g * (x - th(m.y0)); m.y1 += g * (th(m.y0) - th(m.y1)); m.y2 += g * (th(m.y1) - th(m.y2)); m.y3 += g * (th(m.y2) - th(m.y3));
        if (m.gate) { if (m.attack) { m.amp += m.ainc; if (m.amp >= 1) { m.amp = 1; m.attack = false; } } else m.amp += (m.sus - m.amp) * m.dk; }
        else m.amp -= m.amp * m.rk;
        const o = m.y3 * m.amp * m.gain * (1 + k * 0.35);
        l += o; r += o;
        if (!m.gate && m.amp < 1e-5 && fr > m.off + sr) m.on = false;
      }
      this.vsSample(fr, this.vsOut); l += this.vsOut[0]; r += this.vsOut[1];
      L[i] = l; R[i] = r;
    }
    if (this.ks.length) this.ks = this.ks.filter(v => v.life > currentFrame);
    return !this.dead;
  }
}
registerProcessor('pulse-synth', Syn);
// at the head of every channel strip: a NaN or Infinity from any voice becomes silence here, before it can reach a
// filter (a biquad that takes in a NaN keeps it in its state and stays silent until the page reloads)
class Guard extends AudioWorkletProcessor {
  constructor() { super(); this.t = -1e9; }
  process(ins, outs) {
    const i = ins[0], o = outs[0];
    if (!i || !i.length) return true;
    let bad = 0;
    for (let c = 0; c < o.length; c++) {
      const a = i[c] || i[0], b = o[c];
      for (let k = 0; k < b.length; k++) { const v = a[k]; if (v - v !== 0 || v > 64 || v < -64) { b[k] = 0; bad++; } else b[k] = v; }
    }
    if (bad && currentFrame - this.t > sampleRate) { this.t = currentFrame; this.port.postMessage(bad); }
    return true;
  }
}
registerProcessor('tactus-guard', Guard);
// ---- live effects (mirrors fx_* in dsp/src/lib.rs: same helpers, same order of operations) ----
// One mono input, a fixed chain, stereo out. Nothing in it looks ahead, so it adds no delay of its own:
// gate, compressor, pitch voices (shift, octave down, a harmony in the song's key), wah, drive into a tone stack and a
// speaker cabinet, chorus, flanger, phaser, tremolo, delay, reverb, output level.
// Rates are in bars of the song (c is the song position in bars, cps the bars per second), so tremolo and delay follow
// the tempo and line up with the beat while the song plays.
const FX_N = 48, FX_PR = 8192, FX_TB = 512;
const FX_FDN = [31.7, 37.1, 41.1, 43.7, 47.9, 53.3, 59.9, 67.1];
const fxR = x => Math.floor(x + 0.5);
const fxDb = db => exp2p(db * 0.16609640474436813);
function fxBiq(b, kind, f, q, db, sr) {
  // RBJ cookbook: 0 low-pass, 1 high-pass, 2 peaking, 3 low shelf, 4 high shelf; b = [b0 b1 b2 a1 a2 x1 x2 y1 y2]
  const w = TAU * f / sr, cw = sinp(w + Math.PI / 2), sw = sinp(w), al = sw / (2 * q), A = exp2p(db * 0.08304820237218406);
  let b0, b1, b2, a0, a1, a2;
  if (kind === 0) { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (kind === 1) { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (kind === 2) { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
  else {
    const s2 = 2 * Math.sqrt(A) * al, sg = kind === 3 ? -1 : 1;
    b0 = A * ((A + 1) - sg * (A - 1) * cw + s2); b1 = 2 * sg * A * ((A - 1) - sg * (A + 1) * cw); b2 = A * ((A + 1) - sg * (A - 1) * cw - s2);
    a0 = (A + 1) + sg * (A - 1) * cw + s2; a1 = -2 * sg * ((A - 1) + sg * (A + 1) * cw); a2 = (A + 1) + sg * (A - 1) * cw - s2;
  }
  b[0] = b0 / a0; b[1] = b1 / a0; b[2] = b2 / a0; b[3] = a1 / a0; b[4] = a2 / a0;
}
function fxBq(b, x) { const y = b[0] * x + b[1] * b[5] + b[2] * b[6] - b[3] * b[7] - b[4] * b[8]; b[6] = b[5]; b[5] = x; b[8] = b[7]; b[7] = y; return y; }
// read a ring at a fractional distance behind the write position, linearly
function fxRead(buf, mask, w, d) { const p = w - d, i = Math.floor(p), f = p - i; return buf[(i - 1) & mask] * (1 - f) + buf[i & mask] * f; }
class Fx {
  constructor(sr) {
    this.sr = sr; this.p = new Float32Array(FX_N);
    this.dl = 1; while (this.dl < sr * 2 + 8) this.dl <<= 1;
    this.dL = new Float32Array(this.dl); this.dR = new Float32Array(this.dl);
    this.cL = new Float32Array(4096); this.cR = new Float32Array(4096); this.fL = new Float32Array(2048); this.fR = new Float32Array(2048);
    this.pr = new Float32Array(FX_PR); this.tb = new Float32Array(FX_TB);
    this.rl = 1; while (this.rl < sr * 0.075) this.rl <<= 1;
    this.rv = Array.from({ length: 8 }, () => new Float32Array(this.rl)); this.ap = [new Float32Array(1024), new Float32Array(1024)];
    this.bq = Array.from({ length: 12 }, () => new Float64Array(9));
    this.reset();
  }
  reset() {
    this.genv = 0; this.gg = 0; this.gopen = false; this.ce = 0; this.cg = 0;
    this.prw = 0; this.ps = [0, 0.33, 0.66]; this.tbw = 0; this.dacc = 0; this.dn = 0; this.tk = 0; this.tf = 0; this.hs = 0;
    this.we = 0; this.ws = [0, 0]; this.xp = 0; this.hp = 0; this.hpx = 0;
    this.cw = 0; this.fw = 0; this.fbL = 0; this.fbR = 0; this.phL = new Float64Array(6); this.phR = new Float64Array(6); this.pfL = 0; this.pfR = 0;
    this.dw = 0; this.dt = -1; this.lpL = 0; this.lpR = 0;
    this.rw = 0; this.rz = new Float64Array(8); this.rlen = new Int32Array(8); this.rsize = -1; this.rg = new Float64Array(8); this.apw = 0;
    for (const a of [this.dL, this.dR, this.cL, this.cR, this.fL, this.fR, this.pr, this.tb, ...this.rv, ...this.ap]) a.fill(0);
    for (const b of this.bq) b.fill(0);
  }
  // the pitch of the input, every 256 samples, on a copy taken down to about 12 kHz (a small YIN)
  track() {
    const D = Math.max(1, fxR(this.sr / 12000)), dsr = this.sr / D, tmin = Math.max(2, Math.floor(dsr / 900)), tmax = Math.min(220, Math.floor(dsr / 55)), W = 256;
    const tb = this.tb, w0 = this.tbw - W - tmax;
    let e = 0; for (let j = 0; j < W; j++) { const v = tb[(w0 + j) & (FX_TB - 1)]; e += v * v; }
    if (e < W * 1e-6) { this.tf = 0; return; }
    let sum = 0, best = -1, bv = 1, prev = 1, pprev = 1;
    const d = this.dd || (this.dd = new Float64Array(tmax + 2));
    for (let t = 1; t <= tmax + 1; t++) {
      let s = 0; for (let j = 0; j < W; j++) { const a = tb[(w0 + j) & (FX_TB - 1)] - tb[(w0 + j + t) & (FX_TB - 1)]; s += a * a; }
      sum += s; d[t] = sum > 0 ? s * t / sum : 1;
    }
    for (let t = tmin; t <= tmax; t++) { if (d[t] < 0.15 && d[t] <= d[t + 1]) { best = t; bv = d[t]; break; } }
    if (best < 0) { this.tf = 0; return; }
    const a = d[best - 1], b = d[best], c = d[best + 1], den = a - 2 * b + c, sh = den !== 0 ? 0.5 * (a - c) / den : 0;
    this.tf = dsr / (best + Math.max(-0.5, Math.min(0.5, sh)));
    // a harmony in the key: the heard note's place in the scale, moved by the asked number of scale steps
    const P = this.p, H = fxR(P[27]);
    if (H !== 0) {
      const root = fxR(P[30]), mask = fxR(P[31]) || 2741, m = 69 + 12 * Math.log2(this.tf / 440), n = fxR(m);
      const sc = []; for (let k = 0; k < 12; k++) if (mask & (1 << k)) sc.push(k);
      let pc = ((n - root) % 12 + 12) % 12, k = sc.length - 1; for (let j = 0; j < sc.length; j++) if (sc[j] <= pc) k = j;
      const L = sc.length, kt = k + H, o = Math.floor(kt / L);
      this.hs = sc[((kt % L) + L) % L] + 12 * o - sc[k];
    }
  }
  // a voice shifted by r (a ratio) from the pitch ring: two taps sweeping a 40 ms window, crossfaded
  shift(i, r, W) {
    let ph = this.ps[i] + (1 - r) / W; ph -= Math.floor(ph); this.ps[i] = ph;
    let p2 = ph + 0.5; p2 -= Math.floor(p2);
    const a = fxRead(this.pr, FX_PR - 1, this.prw, ph * W + 1), b = fxRead(this.pr, FX_PR - 1, this.prw, p2 * W + 1);
    return a * (1 - Math.abs(2 * ph - 1)) + b * (1 - Math.abs(2 * p2 - 1));
  }
  process(inp, oL, oR, n, c0, cps) {
    const P = this.p, sr = this.sr, bq = this.bq;
    const kA1 = 1 - expp(-1 / (0.001 * sr)), kR80 = 1 - expp(-1 / (0.08 * sr)), gRel = expp(-1 / (0.05 * sr)), kD = 1 - expp(-1 / (0.01 * sr));
    const kA3 = 1 - expp(-1 / (0.003 * sr)), kR120 = 1 - expp(-1 / (0.12 * sr)), kA2 = 1 - expp(-1 / (0.002 * sr)), kR60 = 1 - expp(-1 / (0.06 * sr));
    const gate = P[0] < 0, thr = fxDb(P[0]);
    const ca = P[1], cthr = -10 - 30 * ca, crat = 1 + 7 * ca, cmk = -cthr * (1 - 1 / crat) * 0.5;
    const W = Math.min(fxR(0.04 * sr), FX_PR - 8);
    const r0 = exp2p(P[24] / 12), r1 = 0.5, track = P[27] !== 0 || P[32] > 0;
    const drive = P[4], at = Math.max(0, Math.min(3, fxR(P[5]))), G = 1 + drive * [4, 18, 60, 160][at] , dgain = [1, 0.9, 0.6, 0.4][at] * exp2p(-[0.85, 0.75, 0.6, 0.45][at] * Math.log2(G));
    const hpk = 1 - expp(-TAU * [20, 90, 150, 40][at] / sr);
    const tone = P[6] !== 0 || P[7] !== 0 || P[8] !== 0, cab = P[9] > 0.5 || (P[9] < 0 && drive > 0);
    if (drive > 0) { fxBiq(bq[0], 0, 0.11 * 4 * sr, 0.54, 0, 4 * sr); fxBiq(bq[1], 0, 0.11 * 4 * sr, 1.31, 0, 4 * sr); }
    if (tone) { fxBiq(bq[2], 3, 120, 0.707, P[6], sr); fxBiq(bq[3], 2, 750, 0.8, P[7], sr); fxBiq(bq[4], 4, 3200, 0.707, P[8], sr); }
    if (cab) { fxBiq(bq[5], 1, 80, 0.707, 0, sr); fxBiq(bq[6], 2, 2000, 1, 4, sr); fxBiq(bq[7], 0, 5000, 0.9, 0, sr); fxBiq(bq[8], 0, 6500, 0.6, 0, sr); }
    const dc = cps > 0 ? cps : 0.5, dT = Math.max(1, Math.min(this.dl - 8, P[19] / dc * sr)), dfb = Math.max(0, Math.min(0.95, P[20])), dmode = fxR(P[21]);
    const dlk = 1 - expp(-TAU * (dmode === 2 ? 2800 : 7000) / sr);
    if (this.dt < 0) this.dt = dT;
    if (P[22] > 0 && P[23] !== this.rsize) {
      this.rsize = P[23]; const rt = 0.5 + 4.5 * P[23];
      for (let i = 0; i < 8; i++) { this.rlen[i] = Math.min(this.rl - 2, fxR(FX_FDN[i] * (0.35 + 0.65 * P[23]) * sr / 1000)); this.rg[i] = exp2p(-3 * this.rlen[i] / (rt * sr) * 3.321928094887362); }
    }
    const rdk = 1 - expp(-TAU * 4500 / sr), ap1 = fxR(142 * sr / 48000), ap2 = fxR(379 * sr / 48000);
    const lvl = fxDb(P[29]), dcb = cps / sr;
    let cb = c0;
    for (let k = 0; k < n; k++) {
      let x = inp[k];
      // gate: opens above the threshold, closes 6 dB under it
      if (gate) {
        const ax = Math.abs(x); this.genv = ax > this.genv ? ax : this.genv * gRel;
        if (this.genv > thr) this.gopen = true; else if (this.genv < thr * 0.5) this.gopen = false;
        const tg = this.gopen ? 1 : 0; this.gg += (tg - this.gg) * (tg > this.gg ? kA1 : kR80); x *= this.gg;
      }
      // compressor: an RMS detector, the gain worked out in dB, half the reduction given back
      if (ca > 0) {
        this.ce += (x * x - this.ce) * kD;
        const lev = 3.0102999566398116 * Math.log2(this.ce + 1e-12), gr = lev > cthr ? (cthr - lev) * (1 - 1 / crat) : 0;
        this.cg += (gr - this.cg) * (gr < this.cg ? kA3 : kR120); x *= fxDb(this.cg + cmk);
      }
      // pitch voices, from a ring of what came in
      this.pr[this.prw & (FX_PR - 1)] = x; this.prw++;
      if (track) {
        this.dacc += x; if (++this.dn >= Math.max(1, fxR(sr / 12000))) { this.tb[this.tbw & (FX_TB - 1)] = this.dacc / this.dn; this.tbw++; this.dacc = 0; this.dn = 0; if (++this.tk >= 64) { this.tk = 0; this.track(); } }
      }
      let s = x;
      if (P[25] > 0) s += this.shift(0, r0, W) * P[25];
      if (P[26] > 0) s += this.shift(1, r1, W) * P[26];
      if (P[27] !== 0 && P[28] > 0) s += this.shift(2, exp2p(this.hs / 12), W) * P[28];
      // wah: a band-pass swept by how loud it is, or by the song's beat
      if (P[2] > 0) {
        let ctl;
        if (P[3] > 0) { const ph = cb / P[3]; ctl = 0.5 - 0.5 * sinp(TAU * (ph - Math.floor(ph)) + Math.PI / 2); }
        else { const as = Math.abs(s); this.we += (as - this.we) * (as > this.we ? kA2 : kR60); ctl = Math.min(1, this.we * 8); }
        const g = tanp(Math.PI * 350 * exp2p(2.6 * ctl) / sr), kk = 0.25, a1 = 1 / (1 + g * (g + kk)), a2 = g * a1, a3 = g * a2;
        const v3 = s - this.ws[1], v1 = a1 * this.ws[0] + a2 * v3, v2 = this.ws[1] + a2 * this.ws[0] + a3 * v3;
        this.ws[0] = 2 * v1 - this.ws[0]; this.ws[1] = 2 * v2 - this.ws[1];
        s += (v1 * 1.8 - s) * P[2];
      }
      // drive: four times the rate through the curve, so the overtones it makes do not fold back down
      if (drive > 0) {
        this.hp += (s - this.hp) * hpk; const xin = s - this.hp;
        let y = 0;
        for (let j = 1; j <= 4; j++) {
          const v = (this.xp + (xin - this.xp) * j / 4) * G;
          const sh = at === 0 ? th(v) : at === 1 ? th(v + 0.3) - th(0.3) : at === 2 ? th(1.5 * th(v)) : (v > 1 ? 1 : v < -1 ? -1 : v);
          y = fxBq(bq[1], fxBq(bq[0], sh));
        }
        this.xp = xin; s = y * dgain;
      }
      if (tone) s = fxBq(bq[4], fxBq(bq[3], fxBq(bq[2], s)));
      if (cab) s = fxBq(bq[8], fxBq(bq[7], fxBq(bq[6], fxBq(bq[5], s))));
      let l = s, r = s;
      // chorus: two voices 6 to 18 ms behind, swaying in opposite directions
      if (P[10] > 0) {
        this.cL[this.cw & 4095] = l; this.cR[this.cw & 4095] = r; this.cw++;
        const ph = cb / (P[11] || 2), u = TAU * (ph - Math.floor(ph)), dl = (0.012 + 0.006 * sinp(u)) * sr, dr = (0.012 + 0.006 * sinp(u + Math.PI)) * sr;
        const wl = fxRead(this.cL, 4095, this.cw, dl), wr = fxRead(this.cR, 4095, this.cw, dr), m = P[10];
        l = l * (1 - 0.3 * m) + wl * 0.7 * m; r = r * (1 - 0.3 * m) + wr * 0.7 * m;
      }
      // flanger: a short delay with feedback, swept from under a millisecond to about five
      if (P[12] > 0) {
        const ph = cb / (P[13] || 4), u = TAU * (ph - Math.floor(ph)), d = (0.0006 + 0.004 * (0.5 - 0.5 * sinp(u + Math.PI / 2))) * sr;
        const wl = fxRead(this.fL, 2047, this.fw, d), wr = fxRead(this.fR, 2047, this.fw, d * 1.07);
        this.fL[this.fw & 2047] = l + wl * 0.6; this.fR[this.fw & 2047] = r + wr * 0.6; this.fw++;
        const m = P[12]; l = (l + wl * m) / (1 + 0.5 * m); r = (r + wr * m) / (1 + 0.5 * m);
      }
      // phaser: six all-passes swept between 300 Hz and 2 kHz, a quarter turn apart on each side
      if (P[14] > 0) {
        const ph = cb / (P[15] || 2), u = TAU * (ph - Math.floor(ph)), m = P[14];
        for (let side = 0; side < 2; side++) {
          const st = side ? this.phR : this.phL, ctl = 0.5 - 0.5 * sinp(u + (side ? Math.PI : Math.PI / 2)), t = tanp(Math.PI * 300 * exp2p(2.7 * ctl) / sr), a = (t - 1) / (t + 1);
          let v = (side ? r : l) + 0.5 * (side ? this.pfR : this.pfL);
          for (let j = 0; j < 6; j++) { const y = a * v + st[j]; st[j] = v - a * y; v = y; }
          if (side) { this.pfR = v; r = (r * (1 - 0.5 * m) + v * 0.5 * m) * (1 + 0.35 * m); } else { this.pfL = v; l = (l * (1 - 0.5 * m) + v * 0.5 * m) * (1 + 0.35 * m); }
        }
      }
      // tremolo, on the beat
      if (P[16] > 0) { const ph = cb / (P[17] || 0.125), g = 1 - P[16] * (0.5 - 0.5 * sinp(TAU * (ph - Math.floor(ph)) + Math.PI / 2)); l *= g; r *= g; }
      // delay: the time in bars of the song; a tempo change slides the time over about a tenth of a second
      if (P[18] > 0) {
        this.dt += (dT - this.dt) * 0.0002;
        const m = this.dl - 1, wl = fxRead(this.dL, m, this.dw, this.dt), wr = fxRead(this.dR, m, this.dw, this.dt);
        this.lpL += (wl - this.lpL) * dlk; this.lpR += (wr - this.lpR) * dlk;
        let fl = this.lpL, fr = this.lpR; if (dmode === 2) { fl = th(fl * 1.2) / 1.2; fr = th(fr * 1.2) / 1.2; }
        if (dmode === 1) { this.dL[this.dw & m] = (l + r) * 0.5 + fr * dfb; this.dR[this.dw & m] = fl * dfb; }
        else { this.dL[this.dw & m] = l + fl * dfb; this.dR[this.dw & m] = r + fr * dfb; }
        this.dw++; l += wl * P[18]; r += wr * P[18];
      } else this.dt = dT;
      // reverb: two all-passes to smear the attack, then eight delay lines mixed back into each other
      if (P[22] > 0) {
        let v = (l + r) * 0.15;
        for (let q = 0; q < 2; q++) { const b = this.ap[q], L = q ? ap2 : ap1, y = b[(this.apw - L) & 1023]; const u = v + 0.6 * y; b[this.apw & 1023] = u; v = y - 0.6 * u; }
        this.apw++;
        const z = this.rz, mk = this.rl - 1; let sum = 0;
        for (let i = 0; i < 8; i++) { const y = this.rv[i][(this.rw - this.rlen[i]) & mk]; z[i] += (y - z[i]) * rdk; sum += z[i]; }
        for (let i = 0; i < 8; i++) this.rv[i][this.rw & mk] = v + (z[i] - 0.25 * sum) * this.rg[i];
        this.rw++;
        l += (z[0] + z[2] + z[4] + z[6]) * 0.6 * P[22]; r += (z[1] + z[3] + z[5] + z[7]) * 0.6 * P[22];
      }
      oL[k] = l * lvl; oR[k] = r * lvl;
      cb += dcb;
    }
  }
}
// live input: the mic or an instrument through the audio thread and straight out, inside the same 128-sample block it
// came in (so it adds no delay of its own). Picks a channel (an interface's input 1 or 2), sets the level, runs the
// effects (Rust when it loaded, else the class above), and keeps what goes out under 0 dBFS with a soft curve. Sends
// the peaks in and out and the tuner's pitch about 40 times a second.
class Live extends AudioWorkletProcessor {
  constructor() {
    super(); this.ch = 0; this.gain = 1; this.g = 1; this.on = true; this.pi = 0; this.po = 0; this.n = 0;
    this.fx = new Fx(sampleRate); this.x = null; this.mono = new Float32Array(128); this.oL = new Float32Array(128); this.oR = new Float32Array(128);
    this.pos = { c0: 0, t0: 0, cps: 0.5 }; this.bad = 0;
    this.port.onmessage = e => {
      const d = e.data;
      if (d.t === 'wasm') {
        try {
          const x = new WebAssembly.Instance(new WebAssembly.Module(d.bytes), {}).exports;
          if (!x.fx_init(sampleRate)) throw new Error('memory');
          this.x = x; this.xv();
          new Float32Array(x.memory.buffer, x.fx_params(), FX_N).set(this.fx.p);
          this.port.postMessage({ t: 'wasm-ok' });
        } catch (err) { this.port.postMessage({ t: 'wasm-fail', err: String(err) }); }
        return;
      }
      if (d.t === 'fx') { this.fx.p.set(d.p); if (this.x) { this.xv(); this.xp.set(d.p); } return; }
      if (d.t === 'pos') { this.pos = d; return; }
      if (d.t === 'reset') { this.fx.reset(); if (this.x) this.x.fx_reset(); return; }
      if (d.ch != null) this.ch = d.ch; if (d.gain != null) this.gain = d.gain; if (d.on != null) this.on = d.on;
    };
  }
  // views into the module's memory, made again if the memory grew
  xv() { const x = this.x, b = x.memory.buffer; if (this.xb === b) return; this.xb = b; this.xp = new Float32Array(b, x.fx_params(), FX_N); this.xi = new Float32Array(b, x.fx_in(), 128); this.xl = new Float32Array(b, x.fx_out_l(), 128); this.xr = new Float32Array(b, x.fx_out_r(), 128); }
  process(ins, outs) {
    const i = ins[0], o = outs[0];
    if (!o || !o.length) return true;
    const n = o[0].length, L = i && i[0], R = i && (i[1] || i[0]), mono = this.mono;
    for (let k = 0; k < n; k++) {
      // the level glides, so a slider never clicks
      this.g += ((this.on ? this.gain : 0) - this.g) * 0.002;
      const a = L ? L[k] : 0, b = R ? R[k] : 0, x = this.ch === 1 ? a : this.ch === 2 ? b : (L && R && L !== R ? (a + b) * 0.5 : a);
      const ax = x < 0 ? -x : x; if (ax > this.pi) this.pi = ax;
      mono[k] = x * this.g;
    }
    const ps = this.pos, c0 = ps.c0 + (currentTime - ps.t0) * ps.cps;
    let oL = this.oL, oR = this.oR;
    if (this.x) { this.xv(); this.xi.set(mono.subarray(0, n)); this.x.fx_process(n, c0, ps.cps); oL = this.xl; oR = this.xr; }
    else this.fx.process(mono, oL, oR, n, c0, ps.cps);
    const oc = o.length > 1 ? o[1] : null;
    for (let k = 0; k < n; k++) {
      for (let s = 0; s < 2; s++) {
        let y = s ? oR[k] : oL[k];
        if (y - y !== 0) { y = 0; this.bad++; }
        y = y > 1.5 ? 1 : y < -1.5 ? -1 : y - (4 / 27) * y * y * y;
        const ay = y < 0 ? -y : y; if (ay > this.po) this.po = ay;
        if (s === 0) o[0][k] = y; else if (oc) oc[k] = y;
      }
    }
    // a broken sample (NaN) means a state went bad: start the effects over
    if (this.bad) { this.bad = 0; this.fx.reset(); if (this.x) this.x.fx_reset(); }
    if ((this.n += n) >= 1152) { this.port.postMessage({ i: this.pi, o: this.po, f: this.x ? this.x.fx_tuner() : this.fx.tf }); this.pi = this.po = 0; this.n = 0; }
    return true;
  }
}
registerProcessor('tactus-live', Live);
`;
const WK = { ok: null, loading: null, mod: null, dsp: 'js' };
// decode the Rust DSP once; each worklet node compiles its own instance from these bytes
// (browsers do not pass compiled modules into the audio thread, so the bytes travel instead)
async function dspModule() {
  if (WK.mod !== null) return WK.mod;
  try {
    if (typeof DSP_WASM_B64 === 'undefined' || typeof WebAssembly === 'undefined' || /[?&]dsp=js\b/.test(location.search)) throw new Error('off');
    const bin = atob(DSP_WASM_B64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    if (!WebAssembly.validate(u)) throw new Error('invalid');
    WK.mod = u;
  } catch (e) { WK.mod = false; }
  return WK.mod;
}
function ensureSynthWorklet() {
  if (WK.loading) return WK.loading;
  WK.loading = (async () => {
    const urls = [URL.createObjectURL(new Blob([SYN_CODE], { type: 'text/javascript' })), 'data:text/javascript;charset=utf-8,' + encodeURIComponent(SYN_CODE)];
    dspModule();
    for (const u of urls) { try { await S.ctx.audioWorklet.addModule(u); WK.ok = true; dspProbe(); for (const r of S.rt.values()) stripGuard(r); return true; } catch (e) { } }
    WK.ok = false; return false;
  })();
  return WK.loading;
}
// load the Rust module once at start, so the header can say which DSP is running before any Rust voice plays
async function dspProbe() {
  const m = await dspModule(); if (!m) return;
  try {
    const node = new AudioWorkletNode(S.ctx, 'pulse-synth', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    node.port.onmessage = e => {
      if (e.data.t === 'wasm-ok') { WK.dsp = 'wasm'; S.dirty = true; }
      else if (e.data.t === 'wasm-fail') console.warn('Rust DSP unavailable, using JS voices:', e.data.err);
      node.port.postMessage({ t: 'end' }); node.port.onmessage = null;
    };
    node.port.postMessage({ t: 'wasm', bytes: m.slice().buffer });
  } catch (e) { }
}
function wkNode(name) {
  const r = rt(name);
  if (!r.wk) {
    r.wk = new AudioWorkletNode(S.ctx, 'pulse-synth', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    r.wk.connect(r.input);
    const node = r.wk;
    node.port.onmessage = e => { if (e.data.t === 'wasm-ok') { WK.dsp = 'wasm'; S.dirty = true; } else if (e.data.t === 'wasm-fail') console.warn('Rust DSP unavailable, using JS voices:', e.data.err); };
    dspModule().then(m => { if (m) node.port.postMessage({ t: 'wasm', bytes: m.slice().buffer }); });
  }
  return r.wk;
}
// ---------- the synth engine's notes ----------
// One parameter block per note (its layout matches vs_on in dsp/src/lib.rs). The unison spread, the pans and the lfo
// phases are worked out here, once, so the Rust and JavaScript voices get the very same numbers.
const VS_KIND = { analog: 0, wt: 1, fmsynth: 2 };
const VS_LFO = { cut: 1, res: 2, pitch: 3, scan: 4, pw: 5, fm: 6, vowel: 7, sync: 8, noise: 9 };
const VS_SHAPE = { sine: 0, tri: 1, saw: 2, ramp: 3, square: 4, rand: 5 };
const VS_GAIN = { analog: 0.33, wt: 0.26, fmsynth: 0.3 };
const VS_FTYPE = { analog: 1, wt: 0, fmsynth: 0 };
function vsBlock(inst, midi, P, vel) {
  const p = new Float32Array(96), f = mtof(midi), cps = S.cps || (S.bpm || 120) / 240;
  p[0] = f; p[1] = VS_KIND[inst]; p[2] = P.gain * VS_GAIN[inst];
  p[4] = P.atk; p[5] = P.dec; p[6] = P.sus; p[7] = P.rel;
  p[8] = Math.max(30, Math.min(18000, P.cut)); p[9] = Math.pow(f / 261.6, 0.3) * (0.62 + 0.38 * Math.min(1.6, vel));
  p[10] = P.res; p[11] = P.env; p[12] = P.fatk || 0; p[13] = P.fdec > 0 ? P.fdec : P.dec; p[14] = P.fsus || 0;
  p[15] = P.ftype >= 0 ? Math.round(P.ftype) : VS_FTYPE[inst]; p[16] = (P.drive || 0) + (P.shape || 0);
  p[17] = P.penv || 0; p[18] = P.pdec; p[19] = Math.max(1, Math.min(7, Math.round(P.voices || 1)));
  p[20] = P.sub || 0; p[21] = P.noise || 0; p[22] = P.wave || 0; p[23] = P.pw; p[24] = P.sync; p[25] = P.ring || 0;
  p[26] = Math.round(P.table || 0); p[27] = P.scan || 0; p[28] = P.fm; p[29] = P.ratio; p[30] = P.feed || 0; p[31] = P.fmdec || 0;
  p[32] = P.vowel; p[33] = P.glide || 0; p[34] = P.glide > 0 ? 1 : 0;
  // two lfos on the voice (the channel's gain, pan, lpf and hpf lfos run on the strip instead)
  const lf = (P._lfos || []).filter(l => VS_LFO[l.target]).slice(0, 2);
  lf.forEach((l, k) => { const b = 36 + k * 5, x = (P._c || 0) / l.per; p[b] = VS_LFO[l.target]; p[b + 1] = cps / l.per; p[b + 2] = x - Math.floor(x); p[b + 3] = VS_SHAPE[l.shape] || 0; p[b + 4] = l.depth; });
  const n = p[19], W = Math.max(0, Math.min(1, P.width ?? 0.6));
  for (let u = 0; u < 7; u++) {
    const x = n > 1 ? u / (n - 1) - 0.5 : 0, pos = Math.max(-1, Math.min(1, (P.pan || 0) + x * 2 * W)), ang = (pos + 1) * Math.PI / 4;
    p[46 + u] = Math.pow(2, (P.detune || 0) * x / 1200); p[53 + u] = Math.cos(ang) * Math.SQRT2 / Math.sqrt(n); p[60 + u] = Math.sin(ang) * Math.SQRT2 / Math.sqrt(n);
  }
  return p;
}
// the mono bass's level against its WebAudio fallback (measured: same RMS on the same line)
const MONO_GAIN = 0.65;
// returns true when the worklet took the note
function wkPlay(def, notes, time, dur, P) {
  if (!WK.ok || (def.inst !== 'acid' && def.inst !== 'zither' && def.inst !== 'mono' && !(def.inst in VS_KIND))) return false;
  const sr = S.ctx.sampleRate, frame = Math.round(time * sr), dFr = Math.max(1, Math.round(dur * sr));
  const node = wkNode(def.name);
  if (def.inst in VS_KIND) {
    const r = rt(def.name);
    if (!r.wtSent) { r.wtSent = true; node.port.postMessage({ t: 'wt', data: wtBuild() }); }
    const vel = P._vel ?? 1;
    // with glide the voice is mono: one note at a time, the lowest of a chord
    const ns = P.glide > 0 ? [Math.min(...notes)] : notes;
    for (const m of ns) node.port.postMessage({ kind: 'vs', frame, dur: dFr, p: vsBlock(def.inst, m, P, vel) });
  } else if (def.inst === 'mono') {
    // one note at a time: a chord gives its lowest note. The cut tracks the key and the velocity as the WebAudio voices do
    // (× 1.4: a ladder sounds darker than the WebAudio filters at the same cut; measured against the bass this voice was made from)
    const midi = Math.min(...notes), f = mtof(midi), vel = P._vel ?? 1, kt = 1.4 * Math.pow(f / 261.6, 0.3) * (0.62 + 0.38 * Math.min(1.6, vel));
    node.port.postMessage({ kind: 'mono', frame, dur: dFr, f, cut: Math.max(40, Math.min(18000, P.cut)), kt, res: P.res, env: P.env, dec: P.dec, atk: P.atk, sus: P.sus, rel: P.rel,
      gain: P.gain * MONO_GAIN, wave: P.wave || 0, sub: P.sub || 0, det: Math.pow(2, (P.detune || 0) / 1200), drive: (P.drive || 0) + (P.shape || 0), glide: Math.max(0, Math.min(2, P.glide || 0)) });
  } else if (def.inst === 'acid') {
    node.port.postMessage({ kind: 'acid', frame, dur: dFr, f: mtof(notes[notes.length - 1]), slide: P.slide > 0.5, acc: P.acc > 0.5,
      cut: Math.max(40, P.cut), res: P.res, env: P.env, dec: P.dec, gain: P.gain * 0.27, wave: P.wave || 0, drive: (P.drive || 0) + (P.shape || 0) });
  } else {
    for (const m of notes) node.port.postMessage({ kind: 'ks', frame, dur: dFr, f: mtof(m), gain: P.gain * 1.3, pan: P.pan, bright: Math.max(0, Math.min(1, P.bright)), t60: P.dec, vib: P.vib });
  }
  return true;
}
// sounding WebAudio voices per track, so a knob turn reaches notes that are already ringing
function registerVoice(r, v) {
  if (!v) return;
  const now = S.ctx.currentTime;
  r.voices = (r.voices || []).filter(x => x.tEnd > now);
  r.voices.push(v);
}
function liveKnob(i) {
  if (!S.ctx || !S.playing) return;
  const now = S.ctx.currentTime, s = transport(now);
  for (const name of S.order) {
    const def = S.tracks.get(name);
    if (!def || def.kind !== 'synth') continue;
    const pc = def.params.cut, pr = def.params.res;
    const hitCut = pc && pc.k === 'knob' && pc.i === i, hitRes = pr && pr.k === 'knob' && pr.i === i;
    if (!hitCut && !hitRes) continue;
    const r = S.rt.get(name); if (!r) continue;
    const cut = hitCut ? valueAt(pc, s, 'cut') : null, res = hitRes ? valueAt(pr, s, 'res') : null;
    if (r.wk) r.wk.port.postMessage({ t: 'live', cut, res });
    r.voices = (r.voices || []).filter(v => v.tEnd > now);
    for (const v of r.voices) v.filters.forEach((fl, k) => {
      if (cut != null) { fl.frequency.cancelScheduledValues(now); fl.frequency.setTargetAtTime(Math.max(40, Math.min(18000, cut * v.kt)), now, 0.025); }
      if (res != null && k === 0) { fl.Q.cancelScheduledValues(now); fl.Q.setTargetAtTime(Math.max(0.1, res), now, 0.025); }
    });
  }
}
