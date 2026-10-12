// ===================== Tactus sample instruments (built-in VCSL kit, CC0) =====================
// Pitched instruments play the nearest recorded note, re-pitched; hits rotate through their recordings.
const KIT = { bufs: {}, ready: false, loading: null };
const SAMPLE_PITCHED = new Set(['upright', 'piano', 'vibes', 'harp', 'sax', 'dantranh', 'harpsi', 'marimba', 'kalimba']);
const SAMPLE_HITS = new Set(['asnare', 'ahat', 'aohat', 'atom', 'afloor', 'aride', 'acrash', 'handclap', 'conga', 'bongo', 'cajon', 'cajonslap', 'tamb', 'shake', 'claves', 'cowbell', 'woodblock', 'triangle', 'agogo', 'framedrum', 'darbuka', 'gong', 'kung', 'deok', 'buk', 'buktak', 'jing', 'kkwaeng', 'kkwaengm']);
function b64buf(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
// decoded MP3 may carry encoder padding: start each sample at its first real sound
function onsetOf(buf) {
  const d = buf.getChannelData(0); let pk = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > pk) pk = a; }
  const thr = pk * 0.02;
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > thr) return Math.max(0, i / buf.sampleRate - 0.002);
  return 0;
}
function loadKit() {
  buildUpright();
  if (KIT.loading || typeof KIT_DATA === 'undefined') return KIT.loading;
  KIT.loading = (async () => {
    const jobs = [];
    for (const [name, d] of Object.entries(KIT_DATA)) {
      const slot = KIT.bufs[name] = { p: d.p, list: [], rr: 0 };
      d.s.forEach((e, k) => {
        // pitched: [midi, b64, layer]; hits: b64 (layer 1) or [b64, layer]. Layer 0 soft, 1 normal, 2 hard
        const b64 = d.p ? e[1] : typeof e === 'string' ? e : e[0];
        const layer = d.p ? (e[2] ?? 1) : typeof e === 'string' ? 1 : e[1];
        jobs.push(S.ctx.decodeAudioData(b64buf(b64)).then(buf => {
          const item = { buf, off: onsetOf(buf), midi: d.p ? e[0] : null, layer };
          if (d.p) slot.list.push(item); else slot.list[k] = item;
        }).catch(() => { }));
      });
    }
    await Promise.all(jobs);
    for (const k in KIT.bufs) { const s = KIT.bufs[k]; if (s.p) s.list.sort((a, b) => a.midi - b.midi); else s.list = s.list.filter(Boolean); s.rr = 0; }
    KIT.ready = true;
  })();
  return KIT.loading;
}
// velocity picks the recorded layer: soft hits are a different sound, not just quieter
const layerOf = vel => (vel < 0.75 ? 0 : vel < 1.2 ? 1 : 2);
function layerPool(list, vel) {
  const want = layerOf(vel);
  let pool = list.filter(x => x.layer === want);
  if (!pool.length) pool = list.filter(x => x.layer === 1);
  return pool.length ? pool : list;
}
// softer notes are darker too
// a softer hit is a little darker. Only for quiet hits: from about 0.8 up the sample plays as recorded
// (instruments with velocity layers already change tone between layers).
function velTone(ctx, node, vel, t) {
  const v = Math.min(1, vel);
  if (v >= 0.8) return node;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.7;
  f.frequency.setValueAtTime(3000 + 17000 * Math.pow(v / 0.8, 2), t);
  node.connect(f); return f;
}
// the kit's toms were recorded far from the stick, so their attack is soft; a short filtered click puts it back
const HIT_CLICK = { atom: 3400, afloor: 2800 };
function stickClick(ctx, t, vel, freq, out) {
  const n = ctx.createBufferSource(); n.buffer = A.noise;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.2;
  const g = ctx.createGain(), a = 0.22 * Math.min(1.2, vel);
  g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.012);
  n.connect(bp).connect(g).connect(out);
  n.start(t, Math.random() * 1.5); n.stop(t + 0.02);
}
function playSampleHit(inst, t, vel, P, out) {
  const k = KIT.bufs[inst];
  if (!k || !k.list.length) return;
  const pool = layerPool(k.list, vel), s = pool[k.rr++ % pool.length];
  const ctx = S.ctx, amp = P.gain * vel;
  if (amp < 0.002) return;
  const rate = Math.max(0.25, Math.min(4, P.tune || 1));
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = s.buf; src.playbackRate.value = rate;
  const full = (s.buf.duration - s.off) / rate, d = full * Math.min(1, Math.max(0.05, P.dec));
  g.gain.setValueAtTime(amp, t);
  if (P.dec < 1) { g.gain.setValueAtTime(amp, t + d * 0.6); g.gain.linearRampToValueAtTime(0, t + d); }
  let node = velTone(ctx, src, vel, t);
  if (P.cut && P.cut < 18000) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = P.cut; f.Q.value = Math.max(0.1, P.res || 0.7); node.connect(f); node = f; }
  const dest = panTo(out, P.pan);
  node.connect(g).connect(dest);
  if (HIT_CLICK[inst] && A.noise) stickClick(ctx, t, vel, HIT_CLICK[inst] * Math.sqrt(rate), dest);
  src.start(t, s.off); src.stop(t + d + 0.02);
}
// ---------- upright bass: a plucked double bass, synthesized when the kit loads ----------
// Each note is a sum of string partials: slightly stretched (string stiffness), shaped by where the finger
// plucks (about a fifth of the string), by the body's resonances (air ~62 Hz, top plate ~108 and ~210 Hz),
// and by a two-stage decay: a quick drop after the pluck, then a long ring that dies faster for high partials.
// A short low thump is the finger leaving the string. Ten pitches x two strengths, made in small batches.
const UPRIGHT_NOTES = [28, 31, 34, 37, 40, 43, 46, 49, 52, 55];
function uprightNote(ctx, midi, hard) {
  const sr = ctx.sampleRate, f0 = 440 * Math.pow(2, (midi - 69) / 12), n = Math.round(2.6 * sr), out = new Float32Array(n);
  const body = f => (0.25 + 1 / (1 + ((f - 62) / 9) ** 2) + 0.7 / (1 + ((f - 108) / 16) ** 2) + 0.5 / (1 + ((f - 210) / 35) ** 2) + 0.35 / (1 + ((f - 420) / 80) ** 2))
    / (1 + (f / 1400) ** 2) * f * f / (f * f + 45 * 45);
  const Tbase = Math.min(3.2, 2.6 * Math.pow(55 / f0, 0.3)), beta = 0.19, B = 6e-5;
  let seed = midi * 977 + (hard ? 13 : 0); const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 1; k <= 40; k++) {
    const fk = k * f0 * Math.sqrt(1 + B * k * k);
    if (fk > 6000) break;
    const amp = Math.abs(Math.sin(Math.PI * k * beta)) / Math.pow(k, 1.25) * Math.exp(-k / (5 + 9 * hard)) * body(fk);
    if (amp < 1e-5) continue;
    const T60 = Tbase / (1 + 0.28 * (k - 1)), w = k === 1 ? 0.35 : 0.6;
    const dSlow = Math.exp(-6.9078 / (T60 * sr)), dFast = Math.exp(-6.9078 / (0.18 * sr));
    // a rotating phasor instead of sin() per sample
    const th = 2 * Math.PI * fk / sr, cw = Math.cos(th), sw = Math.sin(th), p0 = rnd() * 2 * Math.PI;
    let c = Math.cos(p0), s = Math.sin(p0), eS = amp * (1 - w), eF = amp * w;
    for (let i = 0; i < n; i++) {
      out[i] += s * (eS + eF);
      const c2 = c * cw - s * sw; s = s * cw + c * sw; c = c2;
      eS *= dSlow; eF *= dFast;
      if (eS + eF < 1e-7) break;
    }
  }
  // the finger leaving the string
  let lp = 0; const a = Math.exp(-2 * Math.PI * 700 / sr), nt = Math.round(0.03 * sr);
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(out[i]));
  for (let i = 0; i < nt; i++) { lp = (1 - a) * (rnd() * 2 - 1) + a * lp; out[i] += lp * pk * (0.5 + hard) * Math.exp(-i / (0.006 * sr)); }
  // a 2 ms attack and a short fade at the end
  for (let i = 0; i < n; i++) { if (i < sr * 0.002) out[i] *= i / (sr * 0.002); if (i > n - sr * 0.3) out[i] *= (n - i) / (sr * 0.3); }
  pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(out[i]));
  const buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = out[i] / pk * 0.89;
  return buf;
}
function buildUpright() {
  if (KIT.bufs.upright || !S.ctx) return;
  const slot = KIT.bufs.upright = { p: 1, list: [], rr: 0 }, jobs = [];
  // middle of the range first: that is where walking lines live
  for (const m of [37, 40, 34, 43, 31, 46, 28, 49, 52, 55]) for (const L of [1, 0]) jobs.push([m, L]);
  const step = () => {
    for (let k = 0; k < 2 && jobs.length; k++) {
      const [m, L] = jobs.shift();
      slot.list.push({ buf: uprightNote(S.ctx, m, L ? 0.6 : 0), off: 0, midi: m, layer: L });
    }
    slot.list.sort((a, b) => a.midi - b.midi);
    if (jobs.length) setTimeout(step, 0);
  };
  step();
}
function playSamplePitched(inst, midi, t, dur, P, vel, out) {
  const k = KIT.bufs[inst];
  if (!k || !k.list.length) return null;
  const pool = layerPool(k.list, vel);
  let s = pool[0];
  for (const x of pool) if (Math.abs(x.midi - midi) < Math.abs(s.midi - midi)) s = x;
  const ctx = S.ctx, def = INST[inst], peak = P.gain * vel * (def ? def.lvl : 1);
  if (peak < 0.001) return null;
  const rate = Math.pow(2, (midi - s.midi) / 12);
  const atk = Math.max(0.002, P.atk), rel = Math.max(0.03, P.rel);
  const natural = t + (s.buf.duration - s.off) / rate;
  const tOff = t + Math.max(dur, 0.03), tEnd = Math.min(natural, tOff + rel * 3);
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = s.buf; src.playbackRate.value = rate; src.detune.value = (Math.random() - 0.5) * 4;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + atk);
  if (tOff < natural) g.gain.setTargetAtTime(0, tOff, rel / 4);
  const filters = [];
  let node = velTone(ctx, src, vel, t);
  if (P.cut < 18000) {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = Math.max(0.1, P.res);
    if (P.env > 0) { f.frequency.setValueAtTime(Math.min(18000, P.cut * (1 + P.env * 10)), t); f.frequency.setTargetAtTime(P.cut, t + 0.002, Math.max(0.01, P.dec) / 3); }
    else f.frequency.setValueAtTime(P.cut, t);
    node.connect(f); node = f; filters.push(f);
  }
  node.connect(g).connect(panTo(out, P.pan));
  if (P.vib > 0) {
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 5 + Math.random() * 0.8;
    lg.gain.setValueAtTime(0, t); lg.gain.setValueAtTime(0, t + 0.18); lg.gain.linearRampToValueAtTime(P.vib, t + 0.55);
    lfo.connect(lg).connect(src.detune); lfo.start(t); lfo.stop(tEnd + 0.05);
  }
  src.start(t, s.off); src.stop(tEnd + 0.05);
  src.onended = () => { try { g.disconnect(); } catch (e) { } };
  return { filters, kt: 1, tEnd };
}
