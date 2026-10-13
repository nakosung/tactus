// ===================== Tactus loop station =====================
// Loops are stored as one AudioBuffer per bar, so a bar can play the moment it is complete,
// overdubs replace single bars without touching the rest, and undo is just the previous array.
const LS = {
  slots: [1, 2, 3, 4].map(i => ({ i: i - 1, name: 'loop' + i, sel: 4, bars: 0, bufs: null, prev: null, startC: 0, cps: 138 / 240, cover: -Infinity, nodes: null, srcs: [], waiting: null, peaks: null })),
  source: 'out', speaker: true, latencyMs: 0,
  cap: null, capOn: null, capInput: null, micNode: null, mic: null,
  take: null, msg: null,
  probe: null, cal: null, rtt: null, clap: { speaker: null, phones: null },
};
try { Object.assign(LS, JSON.parse(localStorage.getItem('pulse-cal') || '{}')); } catch (e) { }
function saveCal() { try { localStorage.setItem('pulse-cal', JSON.stringify({ rtt: LS.rtt, clap: LS.clap })); } catch (e) { } }

function slotNodes(slot) {
  if (slot.nodes) return slot.nodes;
  const ctx = S.ctx;
  const n = { in: ctx.createGain(), filt: ctx.createBiquadFilter(), amp: ctx.createGain(), pan: ctx.createStereoPanner(), vol: ctx.createGain() };
  n.filt.type = 'lowpass'; n.filt.frequency.value = 20000; n.filt.Q.value = 0.7;
  n.vol.gain.value = audible(slot.name) ? 1 : 0;
  n.in.connect(n.filt); n.filt.connect(n.amp); n.amp.connect(n.pan); n.pan.connect(n.vol); n.vol.connect(rt(slot.name).input);
  return (slot.nodes = n);
}
function syncLoopVols() {
  if (!S.ctx) return;
  for (const s of LS.slots) if (s.nodes) s.nodes.vol.gain.setTargetAtTime(audible(s.name) ? 1 : 0, S.ctx.currentTime, 0.01);
}

// ---------- capture ----------
const CAP_CODE = `class C extends AudioWorkletProcessor{constructor(){super();this.on=false;this.n=0;this.f=0;this.l=new Float32Array(2048);this.r=new Float32Array(2048);this.port.onmessage=e=>{this.on=e.data;this.n=0;};}
process(ins){const i=ins[0];if(!this.on||!i||!i[0])return true;const L=i[0],R=i[1]||i[0];if(this.n===0)this.f=currentFrame;this.l.set(L,this.n);this.r.set(R,this.n);this.n+=L.length;
if(this.n>=2048){this.port.postMessage({f:this.f,l:this.l.slice(0,this.n),r:this.r.slice(0,this.n)});this.n=0;}return true;}}
registerProcessor('pulse-cap',C);`;
async function ensureCapture() {
  if (LS.cap) return;
  const ctx = S.ctx;
  let node;
  try {
    let ok = false, last;
    for (const url of [URL.createObjectURL(new Blob([CAP_CODE], { type: 'text/javascript' })), 'data:text/javascript;charset=utf-8,' + encodeURIComponent(CAP_CODE)]) {
      try { await ctx.audioWorklet.addModule(url); ok = true; break; } catch (e) { last = e; }
    }
    if (!ok) throw last;
    node = new AudioWorkletNode(ctx, 'pulse-cap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
    node.port.onmessage = e => onChunk(e.data.f, e.data.l, e.data.r);
    LS.capOn = v => node.port.postMessage(v);
  } catch (err) {
    LS.capErr = String(err);
    node = ctx.createScriptProcessor(4096, 2, 2);
    let on = false;
    node.onaudioprocess = e => {
      if (!on) return;
      const b = e.inputBuffer, f = Math.round((e.playbackTime - b.duration) * ctx.sampleRate);
      onChunk(f, b.getChannelData(0).slice(0), b.getChannelData(b.numberOfChannels > 1 ? 1 : 0).slice(0));
    };
    LS.capOn = v => { on = v; };
  }
  const z = ctx.createGain(); z.gain.value = 0; node.connect(z); z.connect(ctx.destination);
  LS.cap = node;
}
function micAllowedByPage() {
  const pp = document.permissionsPolicy || document.featurePolicy;
  try { return pp && pp.allowsFeature ? pp.allowsFeature('microphone') : true; } catch (e) { return true; }
}
async function ensureMic() {
  if (LS.micNode) return 'ok';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !micAllowedByPage()) return 'blocked';
  try {
    LS.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    return e && (e.name === 'SecurityError' || /policy|not allowed by/i.test(e.message || '')) ? 'blocked' : 'denied';
  }
  LS.micNode = S.ctx.createMediaStreamSource(LS.mic);
  return 'ok';
}
function connectCapture(src) {
  if (LS.capInput) { try { LS.capInput.disconnect(LS.cap); } catch (e) { } }
  LS.capInput = src === 'mic' ? LS.micNode : A.clip;
  LS.capInput.connect(LS.cap);
}
function outLat() { return S.ctx.outputLatency || S.ctx.baseLatency || 0.01; }
function compSec(src = LS.source) {
  let base = 0;
  if (src === 'mic') {
    if (LS.speaker) base = LS.clap.speaker ?? (LS.rtt != null ? Math.max(0, LS.rtt - outLat()) + 0.02 : 0.025);
    else base = LS.clap.phones ?? LS.rtt ?? outLat() + 0.012;
  }
  return base + LS.latencyMs / 1000;
}

// ---------- takes ----------
async function recToggle(i) {
  const slot = LS.slots[i];
  initAudio(); S.ctx.resume();
  const tk = LS.take;
  if (tk && tk.slot === slot) {
    if (S.lastC < tk.startC) return cancelTake();
    if (!tk.overdub) { // finish early: loop length becomes the bars recorded so far
      const nb = Math.max(1, Math.ceil(S.lastC - 1e-6) - tk.startC);
      if (nb < tk.bars) { tk.bars = nb; tk.endC = tk.startC + nb; scheduleOutRestore(tk); }
    }
    return;
  }
  if (tk || VX.take) return;
  if (LS.source === 'mic') {
    const r = await ensureMic();
    if (r !== 'ok') { LS.source = 'out'; loopMsg(t(r === 'blocked' ? 'micBlocked' : 'micDenied'), 'bad', 6000); renderLoops(); }
  }
  await ensureCapture();
  if (!S.playing) togglePlay(true);
  const overdub = !!slot.bufs && LS.source === 'mic';
  const bars = overdub ? slot.bars : slot.sel;
  const startC = Math.ceil(S.lastC + 0.5 - 1e-6);
  const cps = overdub ? slot.cps : S.cps, sr = S.ctx.sampleRate;
  const barFrames = Math.round(sr / cps);
  const take = {
    slot, startC, endC: startC + bars, bars, overdub, src: LS.source, cps, barFrames,
    f0: Math.round((timeOf(startC) + compSec()) * sr),
    L: new Float32Array(bars * barFrames), R: new Float32Array(bars * barFrames),
    newBufs: [], done: 0, silent: LS.source === 'mic' && LS.speaker,
  };
  if (overdub) { take.oldBufs = slot.bufs; slot.bufs = slot.bufs.slice(); }
  connectCapture(take.src);
  LS.capOn(true);
  if (take.silent) {
    const g = A.out.gain, t0 = timeOf(startC);
    g.cancelScheduledValues(S.ctx.currentTime); g.setValueAtTime(g.value, S.ctx.currentTime);
    g.setTargetAtTime(0, t0, 0.004);
    scheduleOutRestore(take);
  }
  LS.take = take;
  renderLoops();
}
function scheduleOutRestore(tk) {
  if (!tk.silent) return;
  const g = A.out.gain, te = timeOf(tk.endC);
  g.cancelScheduledValues(Math.max(S.ctx.currentTime, timeOf(tk.startC) + 0.03));
  g.setTargetAtTime(OUT_GAIN, te, 0.004);
}
function cancelTake() {
  const tk = LS.take; if (!tk) return;
  LS.take = null; if (LS.capOn) LS.capOn(false);
  if (tk.overdub) tk.slot.bufs = tk.oldBufs;
  if (tk.silent && S.ctx) { const g = A.out.gain, now = S.ctx.currentTime; g.cancelScheduledValues(now); g.setTargetAtTime(OUT_GAIN, now, 0.01); }
  renderLoops();
}
function onChunk(f, l, r) {
  const pr = LS.probe;
  if (pr) {
    const a = Math.max(f, pr.f0), b = Math.min(f + l.length, pr.f0 + pr.L.length);
    if (b > a) pr.L.set(l.subarray(a - f, b - f), a - pr.f0);
  }
  if (VX.take) vxChunk(f, l);
  const tk = LS.take; if (!tk) return;
  const total = tk.bars * tk.barFrames;
  const a = Math.max(f, tk.f0), b = Math.min(f + l.length, tk.f0 + total);
  if (b > a) { tk.L.set(l.subarray(a - f, b - f), a - tk.f0); tk.R.set(r.subarray(a - f, b - f), a - tk.f0); }
  const got = Math.min(f + l.length, tk.f0 + total) - tk.f0;
  while (tk.done < tk.bars && got >= (tk.done + 1) * tk.barFrames) { finishBar(tk, tk.done); tk.done++; }
  if (tk.done >= tk.bars) endTake(tk);
}
function makeBuf(L, R, off, n) {
  const b = S.ctx.createBuffer(2, n, S.ctx.sampleRate);
  b.copyToChannel(L.subarray(off, off + n), 0); b.copyToChannel(R.subarray(off, off + n), 1);
  return b;
}
function finishBar(tk, k) {
  const fr = tk.barFrames, off = k * fr;
  // tiny fades at the bar edges keep seams click-free
  const fade = Math.min(64, fr >> 4);
  for (let i = 0; i < fade; i++) { const g = i / fade; tk.L[off + i] *= g; tk.R[off + i] *= g; tk.L[off + fr - 1 - i] *= g; tk.R[off + fr - 1 - i] *= g; }
  const slot = tk.slot;
  if (tk.overdub) {
    const idx = mod(tk.startC + k - slot.startC, slot.bars), old = slot.bufs[idx];
    const n = old.length, nb = S.ctx.createBuffer(2, n, S.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const o = old.getChannelData(ch), src = ch ? tk.R : tk.L, d = new Float32Array(n);
      for (let i = 0; i < n; i++) d[i] = o[i] + (i < fr ? src[off + i] : 0);
      nb.copyToChannel(d, ch);
    }
    slot.bufs[idx] = nb;
  } else tk.newBufs[k] = makeBuf(tk.L, tk.R, off, fr);
  catchUp(slot);
}
function endTake(tk) {
  LS.take = null; LS.capOn(false);
  const slot = tk.slot;
  if (!tk.overdub) {
    slot.prev = slot.bufs ? { bufs: slot.bufs, startC: slot.startC, bars: slot.bars, cps: slot.cps } : null;
    slot.bufs = tk.newBufs; slot.startC = tk.startC; slot.bars = tk.bars; slot.cps = tk.cps;
  } else slot.prev = { bufs: tk.oldBufs, startC: slot.startC, bars: slot.bars, cps: slot.cps };
  slot.peaks = null;
  loopMsg(t(tk.overdub ? 'overdubDone' : 'slotFull', { name: slot.name }), 'ok');
  renderLoops();
}
function undoSlot(i) {
  const slot = LS.slots[i];
  if (LS.take && LS.take.slot === slot) return cancelTake();
  const p = slot.prev; if (!p) return;
  slot.prev = null; slot.bufs = p.bufs; slot.startC = p.startC; slot.bars = p.bars; slot.cps = p.cps; slot.peaks = null;
  stopSlotSources(slot, S.ctx ? S.ctx.currentTime + 0.01 : 0);
  slot.cover = Math.ceil(S.lastC - 1e-6);
  loopMsg(t('undone', { name: slot.name }), 'ok');
  renderLoops();
}
function clearSlot(i) {
  const slot = LS.slots[i];
  if (LS.take && LS.take.slot === slot) cancelTake();
  if (slot.bufs) slot.prev = { bufs: slot.bufs, startC: slot.startC, bars: slot.bars, cps: slot.cps };
  slot.bufs = null; slot.bars = 0; slot.peaks = null;
  stopSlotSources(slot, S.ctx ? S.ctx.currentTime + 0.01 : 0);
  renderLoops();
}
function stopSlotSources(slot, when) {
  for (const s of slot.srcs) { try { s.src.stop(when); } catch (e) { } }
  slot.srcs = [];
}

// ---------- latency calibration ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
function click(time, freq = 2000, amp = 0.9) {
  const o = S.ctx.createOscillator(), g = S.ctx.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, time); g.gain.linearRampToValueAtTime(amp, time + 0.0005); g.gain.exponentialRampToValueAtTime(0.0001, time + 0.012);
  o.connect(g).connect(S.ctx.destination); o.start(time); o.stop(time + 0.02);
}
// first threshold crossing after each reference time; returns delays in seconds
function findOnsets(pr, sr, refs, from, to, preRoll) {
  const L = pr.L;
  const noiseN = Math.max(64, Math.floor(preRoll * sr));
  const ab = Array.from(L.subarray(0, noiseN), Math.abs).sort((x, y) => x - y);
  const noise = ab[Math.floor(ab.length * 0.9)] || 0;
  let peak = 0; for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]));
  const thr = Math.max(noise * 6, peak * 0.25, 0.01);
  const out = [];
  for (const tr of refs) {
    const s = Math.round(tr * sr) - pr.f0 + Math.round(from * sr), e = Math.round(tr * sr) - pr.f0 + Math.round(to * sr);
    for (let i = Math.max(0, s); i < Math.min(L.length, e); i++) if (Math.abs(L[i]) > thr) { out.push((i + pr.f0) / sr - tr); break; }
  }
  return out;
}
function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
async function calPrepare() {
  initAudio(); await S.ctx.resume();
  if (LS.take || LS.cal) return false;
  const r = await ensureMic();
  if (r !== 'ok') { loopMsg(t(r === 'blocked' ? 'micBlocked' : 'micDenied'), 'bad', 7000); return false; }
  await ensureCapture();
  if (S.playing) togglePlay(false);
  connectCapture('mic'); LS.capOn(true);
  return true;
}
function calFinish() { LS.probe = null; LS.cal = null; if (!LS.take) LS.capOn(false); renderLoops(); }
async function calibrateAuto() {
  if (!(await calPrepare())) return;
  const sr = S.ctx.sampleRate, now = S.ctx.currentTime, t0 = now + 0.5, gap = 0.3, n = 8;
  LS.probe = { f0: Math.round(now * sr), L: new Float32Array(Math.ceil((0.5 + gap * n + 0.6) * sr)) };
  LS.cal = { kind: 'auto', t0, beat: gap, n, count: 0 };
  const refs = []; for (let k = 0; k < n; k++) { refs.push(t0 + k * gap); click(t0 + k * gap); }
  await sleep((0.5 + gap * n + 0.7) * 1000);
  const d = findOnsets(LS.probe, sr, refs, 0, 0.25, 0.4);
  calFinish();
  const ok = d.length >= 6 && Math.max(...d) - Math.min(...d) < 0.008;
  if (!ok) { loopMsg(t('calFail'), 'bad', 8000); return; }
  LS.rtt = median(d); LS.latencyMs = 0; $('#latency').value = 0; saveCal();
  loopMsg(t('calDone', { ms: Math.round(LS.rtt * 1000) }), 'ok', 5000);
  renderLoops();
}
async function calibrateClap() {
  if (!(await calPrepare())) return;
  const sr = S.ctx.sampleRate, now = S.ctx.currentTime, beat = 0.6, count = 4, n = 8, t0 = now + 0.6;
  LS.probe = { f0: Math.round(now * sr), L: new Float32Array(Math.ceil((0.6 + beat * (count + n) + 0.8) * sr)) };
  LS.cal = { kind: 'clap', t0, beat, n, count };
  for (let k = 0; k < count + n; k++) if (!LS.speaker || k < count) click(t0 + k * beat, k % 4 ? 1500 : 2200, LS.speaker ? 0.25 : 0.6);
  await sleep((0.6 + beat * (count + n) + 0.8) * 1000);
  const refs = []; for (let k = count; k < count + n; k++) refs.push(t0 + k * beat);
  const d = findOnsets(LS.probe, sr, refs, -0.2, 0.35, 0.5);
  calFinish();
  if (d.length < 5) { loopMsg(t('clapFail'), 'bad', 7000); return; }
  const v = Math.max(0, median(d));
  LS.clap[LS.speaker ? 'speaker' : 'phones'] = v; LS.latencyMs = 0; $('#latency').value = 0; saveCal();
  loopMsg(t('clapDone', { ms: Math.round(v * 1000), mode: t(LS.speaker ? 'modeSpeaker' : 'modePhones') }), 'ok', 5000);
  renderLoops();
}

// ---------- playback ----------
function slotView(slot, c) {
  const tk = LS.take;
  if (tk && tk.slot === slot && !tk.overdub && c >= tk.startC - EPS) {
    if (c < tk.endC - EPS) return null;
    return { bufs: tk.newBufs, startC: tk.startC, bars: tk.bars, cps: tk.cps };
  }
  return slot.bufs ? slot : null;
}
function loopParams(def, s) {
  const P = Object.assign({}, BASE, { gain: 1, cut: 20000, res: 0.7, slices: 8 });
  if (def) for (const k in def.params) { const x = valueAt(def.params[k], s, k); if (x !== null) P[k] = x; }
  return P;
}
function playBuf(dest, buf, time, offset, dur, rate, fade) {
  const ctx = S.ctx, src = ctx.createBufferSource();
  src.buffer = buf; src.playbackRate.value = rate;
  if (fade) {
    const g = ctx.createGain(), real = dur / rate;
    g.gain.setValueAtTime(0, time); g.gain.linearRampToValueAtTime(1, time + 0.003);
    g.gain.setValueAtTime(1, Math.max(time + 0.004, time + real - 0.004)); g.gain.linearRampToValueAtTime(0, time + real);
    src.connect(g).connect(dest);
  } else src.connect(dest);
  src.start(time, Math.max(0, offset), Math.max(0.005, dur));
  return src;
}
function playRegion(slot, from, to, atC, pdef, fade) {
  const v = slotView(slot, from);
  if (!v) return;
  if (!activeIn(sceneAt(atC), slot.name)) return;
  const pos = mod(from - v.startC, v.bars);
  let bi = Math.floor(pos + 1e-9); if (bi >= v.bars) bi = 0;
  const within = Math.max(0, pos - bi);
  const time = timeOf(atC), now = S.ctx.currentTime;
  const buf = v.bufs[bi];
  if (!buf) { slot.waiting = { bi, barC: atC - within, view: v }; return; }
  if (time < now - 0.02) return;
  const nodes = slotNodes(slot), r = rt(slot.name);
  const P = loopParams(pdef, from);
  nodes.filt.frequency.setValueAtTime(Math.max(40, Math.min(20000, P.cut)), time);
  nodes.filt.Q.setValueAtTime(Math.max(0.1, P.res), time);
  nodes.amp.gain.setValueAtTime(Math.max(0, P.gain), time);
  nodes.pan.pan.setValueAtTime(Math.max(-1, Math.min(1, P.pan)), time);
  stripAt(r, P, time);
  const rate = S.cps / v.cps, bs = buf.duration;
  const src = playBuf(nodes.in, buf, time, within * bs, (to - from) * bs, rate, fade);
  slot.srcs.push({ src, end: timeOf(atC + (to - from)) });
  if (slot.srcs.length > 24) slot.srcs = slot.srcs.filter(s => s.end > now);
  slot.lastPlay = { time, pos: bi + within, bars: v.bars };
  if (pdef) S.vis.push({ time, id: '', line: pdef.line });
}
function catchUp(slot) {
  const w = slot.waiting; if (!w || !S.playing) return;
  const buf = w.view.bufs[w.bi]; if (!buf) return;
  slot.waiting = null;
  const now = S.ctx.currentTime, t0 = now + 0.02, barStart = timeOf(w.barC), barEnd = timeOf(w.barC + 1);
  if (t0 > barEnd - 0.05) return;
  const rate = S.cps / w.view.cps, offset = Math.max(0, (t0 - barStart) * rate);
  const src = playBuf(slotNodes(slot).in, buf, Math.max(t0, barStart), offset, buf.duration - offset, rate, true);
  slot.srcs.push({ src, end: barEnd });
}
function loopUsers(slot) {
  let chop = false, pdef = null;
  for (const n of S.order) { const d = S.tracks.get(n); if (d && d.inst === slot.name) { if (d.chop) chop = true; else pdef = d; } }
  return { chop, pdef };
}
function playLoops(pa, pb, off) {
  for (const slot of LS.slots) {
    if (!slot.bufs && !(LS.take && LS.take.slot === slot)) continue;
    const { chop, pdef } = loopUsers(slot);
    if (chop) continue;
    if (off === 0) {
      let c = Math.max(pa, slot.cover);
      while (c < pb - EPS) { const end = Math.floor(c + EPS) + 1; playRegion(slot, c, end, c, pdef, c % 1 > EPS); c = end; }
      slot.cover = Math.max(slot.cover, c);
    } else playRegion(slot, pa, pb, pa + off, pdef, true);
  }
}
function stutterCut(T0) {
  const when = timeOf(T0);
  for (const slot of LS.slots) {
    for (const s of slot.srcs) if (s.end > when + 0.002) { try { s.src.stop(when); } catch (e) { } }
    slot.cover = Math.min(slot.cover, T0);
  }
}
function playChop(def, ev, time, dur, P) {
  const slot = LS.slots[+def.inst.slice(4) - 1];
  if (!slot || !slot.bufs) return;
  const slices = Math.max(1, Math.round(P.slices || 8)), sl = slot.bars / slices;
  let idx = /^-?\d+$/.test(ev.v) ? mod(+ev.v, slices) : Math.floor(mod(ev.s - slot.startC, slot.bars) / sl + 1e-9) % slices;
  const p = idx * sl, bi = Math.floor(p + 1e-9) % slot.bars, within = p - Math.floor(p + 1e-9);
  const buf = slot.bufs[bi]; if (!buf) return;
  const rate = S.cps / slot.cps, bs = buf.duration;
  const len = Math.min(sl, 1 - within) * bs, play = Math.min(len, dur * rate);
  const ctx = S.ctx, f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'lowpass'; f.frequency.value = Math.max(40, Math.min(20000, P.cut)); f.Q.value = Math.max(0.1, P.res);
  g.gain.value = Math.max(0, P.gain) * (audible(slot.name) ? 1 : 0);
  f.connect(g).connect(panTo(rt(def.name).input, P.pan));
  playBuf(f, buf, time, within * bs, play, rate, true);
}
function resetLoops() {
  for (const s of LS.slots) { stopSlotSources(s, S.ctx ? S.ctx.currentTime : 0); s.cover = -Infinity; s.waiting = null; }
}

// ---------- import ----------
async function loadIntoSlot(i, file) {
  initAudio();
  const slot = LS.slots[i];
  let buf;
  try { buf = await S.ctx.decodeAudioData(await file.arrayBuffer()); } catch (e) { loopMsg(t('decodeFail'), 'bad'); return; }
  const dur = buf.duration, bars = Math.max(1, Math.round(dur * S.cps));
  const fr = Math.floor(buf.length / bars), L = buf.getChannelData(0), R = buf.getChannelData(buf.numberOfChannels > 1 ? 1 : 0);
  if (LS.take && LS.take.slot === slot) cancelTake();
  if (slot.bufs) slot.prev = { bufs: slot.bufs, startC: slot.startC, bars: slot.bars, cps: slot.cps };
  slot.bufs = []; for (let k = 0; k < bars; k++) slot.bufs.push(makeBuf(L, R, k * fr, fr));
  slot.bars = bars; slot.cps = buf.sampleRate / fr; slot.startC = 0; slot.peaks = null;
  stopSlotSources(slot, S.ctx.currentTime);
  slot.cover = S.playing ? Math.ceil(S.lastC - 1e-6) : -Infinity;
  loopMsg(t('loaded', { name: slot.name, bars }), 'ok');
  renderLoops();
}

// ---------- export (.zip of WAVs + code) ----------
function wav(bufs) {
  const sr = bufs[0].sampleRate, n = bufs.reduce((a, b) => a + b.length, 0);
  const out = new DataView(new ArrayBuffer(44 + n * 4));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); out.setUint16(22, 2, true); out.setUint32(24, sr, true); out.setUint32(28, sr * 4, true);
  out.setUint16(32, 4, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * 4, true);
  let o = 44;
  for (const b of bufs) {
    const l = b.getChannelData(0), r = b.getChannelData(1);
    for (let i = 0; i < b.length; i++) {
      out.setInt16(o, Math.max(-1, Math.min(1, l[i])) * 0x7fff, true);
      out.setInt16(o + 2, Math.max(-1, Math.min(1, r[i])) * 0x7fff, true); o += 4;
    }
  }
  return new Uint8Array(out.buffer);
}
const CRC = (() => { const tb = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tb[n] = c >>> 0; } return tb; })();
function crc32(d) { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zip(files) {
  const parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true);
    h.setUint32(18, sz, true); h.setUint32(22, sz, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true);
    c.setUint32(20, sz, true); c.setUint32(24, sz, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + sz;
  }
  const cs = central.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cs, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}
async function exportZip() {
  const files = [];
  for (const s of LS.slots) if (s.bufs && s.bufs.every(Boolean)) files.push({ name: `${s.name}-${s.bars}bars-${Math.round(s.cps * 240)}bpm.wav`, data: wav(s.bufs) });
  if (!files.length) { loopMsg(t('exportNone'), 'bad'); return; }
  files.push({ name: 'pattern.txt', data: new TextEncoder().encode(srcEl.value) });
  const blob = zip(files), filename = 'tactus-loops.zip';
  let dl = null;
  try { dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { dl = null; }
  if (dl) {
    try { await dl.save({ filename, data: blob }); loopMsg(t('exported'), 'ok'); }
    catch (e) { if (e && e.code !== 'declined') loopMsg(t('exportFail', { m: e.message || e.code }), 'bad'); }
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  loopMsg(t('exported'), 'ok');
}
