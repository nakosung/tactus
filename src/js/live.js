// ===================== Live input: the page as an effects box =====================
// A mic or an instrument (through an audio interface) runs through the audio thread, an effects chain (Rust, with a
// JavaScript copy) and straight to the speakers or headphones. The effects are set by an `input` line in the code:
//   input | gate -55 drive .45 amp crunch delay .25 3/16 .35 verb .3
// so they are saved, shared and changed like the rest of the song, and rates and delay times are in bars of the song.
// The path skips the track strips and the master chain: their compressors look ahead (about 6 ms each), and that
// would add to every note.
// How long it takes: what the browser reports (the input's latency, the 128-sample block, the output's), and what was
// measured, a click from the speakers heard on the mic. A click going out and coming back passes the same buffers as
// a note coming in and going out, so the measured round trip is the delay a player hears (less a millisecond for
// each 34 cm of air between speaker and mic).

var LV = { on: false, node: null, out: null, gain: 0.8, ch: 0, devs: [], lvl: { i: 0, o: 0, f: 0 }, code: null, bypass: false, sig: '', dsp: 'js' };
try { Object.assign(LV, JSON.parse(localStorage.getItem('tactus-live') || '{}'), { on: false, node: null, out: null }); LS.dev = LV.dev || null; } catch (e) { }
function lvSave() { try { localStorage.setItem('tactus-live', JSON.stringify({ gain: LV.gain, ch: LV.ch, dev: LS.dev || null })); } catch (e) { } }
const lvEl = id => document.getElementById(id);

async function lvStart(demo) {
  initAudio(); await S.ctx.resume();
  if (!demo) { const r = await ensureMic(); if (r !== 'ok') { lvSay(t(r === 'blocked' ? 'micBlocked' : 'micDenied'), 'bad'); return; } }
  if (!(await ensureSynthWorklet())) { lvSay(t('lvNoWorklet'), 'bad'); return; }
  if (!LV.node) {
    LV.node = new AudioWorkletNode(S.ctx, 'tactus-live', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'discrete' });
    LV.node.port.onmessage = e => {
      const d = e.data;
      if (d.t === 'wasm-ok') { LV.dsp = 'wasm'; lvRender(); return; }
      if (d.t === 'wasm-fail') { console.warn('Rust effects unavailable, using JS:', d.err); return; }
      LV.lvl = d; lvMeter();
    };
    dspModule().then(m => { if (m && LV.node) LV.node.port.postMessage({ t: 'wasm', bytes: m.slice().buffer }); });
    // straight to the output: no strip, no master (see the top)
    LV.out = S.ctx.createGain(); LV.node.connect(LV.out); LV.out.connect(S.ctx.destination);
  }
  if (LV.src) { try { LV.src.disconnect(LV.node); } catch (e) { } if (LV.src.stop) try { LV.src.stop(); } catch (e) { } }
  if (demo) {
    // a guitar riff made here, looped in time with the song, in place of the mic
    const src = S.ctx.createBufferSource(); src.buffer = lvRiff(); src.loop = true;
    const at = S.playing ? timeOf(Math.ceil(S.lastC - 1e-6)) : S.ctx.currentTime + 0.05;
    src.connect(LV.node); src.start(at); LV.src = src;
  } else { LS.micNode.connect(LV.node); LV.src = LS.micNode; }
  LV.demo = !!demo;
  LV.node.port.postMessage({ ch: LV.ch, gain: LV.gain, on: true });
  LV.sig = ''; lvSend();
  LV.on = true; if (!demo) lvDevices(); lvRender();
  // on speakers the mic hears what it plays, and it can howl: say so
  lvSay(t(demo ? 'lvDemoOn' : LS.speaker ? 'lvSpeakerWarn' : 'lvOn'), demo || !LS.speaker ? 'ok' : 'bad');
}
function lvStop() {
  if (LV.node) { LV.node.port.postMessage({ on: false }); if (LV.src) { try { LV.src.disconnect(LV.node); } catch (e) { } if (LV.src.stop) try { LV.src.stop(); } catch (e) { } } }
  LV.on = false; LV.src = null; LV.demo = false; lvRender(); lvSay('', '');
}
// another input (an audio interface): reopen the mic on it, and move whatever was listening to the old one
async function lvDevice(id) {
  LS.dev = id || null; lvSave();
  const was = LV.on, cap = LS.capInput === LS.micNode;
  if (LV.on) lvStop();
  if (LS.mic) { LS.mic.getTracks().forEach(tr => tr.stop()); LS.mic = null; }
  if (LS.micNode) { try { LS.micNode.disconnect(); } catch (e) { } LS.micNode = null; }
  if (was) await lvStart();
  else { const r = await ensureMic(); if (r !== 'ok') return; }
  if (cap && LS.cap) connectCapture('mic');
  lvRender();
}
async function lvDevices() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    LV.devs = all.filter(d => d.kind === 'audioinput');
  } catch (e) { LV.devs = []; }
  lvRender();
}
// two bars of a plucked guitar (Karplus-Strong) in the song's key and tempo: single notes, then a strummed chord,
// so the effects can be heard, and stacked, without an instrument plugged in
function lvRiff() {
  const sr = S.ctx.sampleRate, bpm = S.bpm || 120, step = 60 / bpm / 4, n = Math.round(step * 32 * sr);
  const buf = S.ctx.createBuffer(1, n, sr), x = buf.getChannelData(0), root = 36 + ((S.root || 0) % 12 + 12) % 12;
  const sc = SCALES[S.scale] || SCALES.minor, deg = d => root + 12 * Math.floor(d / sc.length) + sc[((d % sc.length) + sc.length) % sc.length];
  const notes = [[0, 7, 2], [2, 9, 2], [4, 11, 1], [6, 9, 1], [7, 7, 1], [8, 4, 2], [10, 5, 2], [12, 7, 4], [16, 0, 0], [16.15, 4, 0], [16.3, 7, 0], [16.45, 10, 0], [20, 7, 2], [22, 6, 2], [24, 4, 2], [26, 2, 2], [28, 0, 4]];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const [s, d, len] of notes) {
    const f = 440 * Math.pow(2, (deg(d) - 69) / 12), P = Math.max(2, Math.round(sr / f)), ring = new Float32Array(P);
    for (let i = 0; i < P; i++) ring[i] = rnd() * 2 - 1;
    const a = Math.round(s * step * sr), end = Math.min(n, a + Math.round((len ? len * step * 1.8 : 8 * step) * sr) + 2000);
    let p = 0, prev = 0;
    for (let i = a; i < end; i++) {
      const v = ring[p], nv = 0.5 * (v + ring[(p + 1) % P]) * 0.996; ring[p] = nv; p = (p + 1) % P;
      const fade = i > end - 2000 ? (end - i) / 2000 : 1, y = v - prev * 0.2; prev = v;
      x[i] += y * 0.22 * fade;
    }
  }
  return buf;
}
// the delay as the browser reports it, in ms: the input's, one block, the output's
function lvReported() {
  if (!S.ctx) return null;
  const tr = LS.mic && LS.mic.getAudioTracks()[0], st = tr && tr.getSettings ? tr.getSettings() : {};
  const inp = typeof st.latency === 'number' ? st.latency : null, blk = 128 / S.ctx.sampleRate, out = (S.ctx.outputLatency || 0) + (S.ctx.baseLatency || 0);
  return { inp, blk, out, sum: (inp || 0) + blk + out, sr: S.ctx.sampleRate };
}
async function lvMeasure() {
  if (LV.on) lvStop();
  await calibrateAuto();
  lvRender();
}

// ---------- the effects, from the code ----------
// the input line as the block of numbers both effect engines read (the layout is FP in dsp/src/lib.rs)
const LV_AMPS = ['clean', 'crunch', 'lead', 'fuzz'];
function lvBlock(fx) {
  const p = new Float32Array(48); p[9] = -1;
  const v = (k, i) => fx[k] ? fx[k].v[i] : 0;
  if (fx.gate) p[0] = -Math.abs(v('gate', 0)) || -50;
  p[1] = v('comp', 0); p[2] = v('wah', 0); p[3] = v('wah', 1);
  p[4] = fx.drive ? v('drive', 0) : fx.amp ? 0.5 : 0; p[5] = fx.amp ? Math.max(0, LV_AMPS.indexOf(fx.amp.w)) : 1;
  p[6] = v('low', 0); p[7] = v('mid', 0); p[8] = v('high', 0); if (fx.cab) p[9] = fx.cab.w === 'off' ? 0 : 1;
  p[10] = v('chorus', 0); p[11] = v('chorus', 1); p[12] = v('flanger', 0); p[13] = v('flanger', 1); p[14] = v('phaser', 0); p[15] = v('phaser', 1);
  p[16] = v('trem', 0); p[17] = v('trem', 1);
  p[18] = v('delay', 0); p[19] = v('delay', 1); p[20] = v('delay', 2); p[21] = fx.delay ? ({ pingpong: 1, tape: 2 })[fx.delay.w] || 0 : 0;
  p[22] = v('verb', 0); p[23] = v('verb', 1); p[24] = v('pitch', 0); p[25] = fx.pitch ? v('pitch', 1) : 0; p[26] = v('oct', 0);
  p[27] = v('harm', 0); p[28] = fx.harm ? v('harm', 1) : 0; p[29] = v('level', 0);
  // the song's key, for the harmony: its root and a bit for each note of the scale
  p[30] = S.root || 0; p[31] = (SCALES[S.scale] || SCALES.major).reduce((m, k) => m | (1 << k), 0); p[32] = 1;
  return p;
}
function lvSend() {
  if (!LV.node) return;
  const p = lvBlock(LV.bypass || !LV.code ? {} : LV.code.params), sig = Array.from(p).join(',');
  if (sig === LV.sig) return;
  LV.sig = sig; LV.node.port.postMessage({ t: 'fx', p });
}
// called by evaluate with each compile of the code
function lvApplyCode(r) { if (!LV) return; LV.code = r.input || null; lvSend(); lvRender(); }
// called by the animation loop: keep the effects' clock on the song's (or on a free one at its tempo when stopped)
function lvTick(now) {
  if (!LV || !LV.node || !LV.on) return;
  const pos = S.playing ? { c0: S.c0, t0: S.t0, cps: S.cps } : { c0: 0, t0: LV.free || (LV.free = now), cps: (S.bpm || 120) / 240 };
  if (S.playing) LV.free = 0;
  const sig = pos.c0 + ',' + pos.t0 + ',' + pos.cps;
  if (sig !== LV.posSig) { LV.posSig = sig; LV.node.port.postMessage({ t: 'pos', ...pos }); }
  // the key may change with the song: the harmony follows
  lvSend();
}
// ready-made sounds: each writes the input line (or replaces it)
const LV_PATCHES = {
  clean: 'comp .4 chorus .3 2 verb .25',
  crunch: 'gate -55 drive .45 amp crunch mid 2 delay .2 3/16 .3 verb .2',
  lead: 'gate -55 comp .3 drive .7 amp lead high 2 delay .3 3/16 .45 pingpong verb .3',
  fuzz: 'gate -50 drive .8 amp fuzz low 3 phaser .4 2',
  wah: 'gate -55 wah .8 1/4 drive .4 amp crunch',
  space: 'comp .3 chorus .4 2 delay .45 3/8 .6 tape verb .6 .9',
  vocal: 'gate -60 comp .5 high 3 delay .2 1/4 .3 verb .35 .6',
  octave: 'gate -55 oct .6 drive .3 amp crunch',
  harmony: 'comp .3 harm 2 .5 verb .3',
};
function lvPatch(name) {
  const line = 'input | ' + LV_PATCHES[name], lines = srcEl.value.split('\n');
  const i = lines.findIndex(l => /^\s*input\b/.test(l));
  if (i >= 0) lines[i] = line;
  else { let at = 0; while (at < lines.length && /^\s*(\/\/|bpm\b|key\b|scale\b|prog\b|swing\b|master\b|space\b|$)/.test(lines[at])) at++; lines.splice(at, 0, line); }
  srcEl.value = lines.join('\n'); render(); evaluate('bar');
  LV.bypass = false; lvSend(); lvRender();
}

// ---------- the panel ----------
function lvSay(m, cls) { const el = lvEl('lvMsg'); if (el) { el.textContent = m; el.className = 'note vxmsg ' + (cls || ''); } }
function lvMeter() {
  const a = lvEl('lvMi'), b = lvEl('lvMo'); if (!a) return;
  // the tuner: the note heard and how far off it is
  const tu = lvEl('lvTune'), f = LV.lvl.f;
  if (tu) { if (f > 0) { const m = 69 + 12 * Math.log2(f / 440), n = Math.round(m), ct = Math.round((m - n) * 100); tu.innerHTML = `<b>${vxNoteName(n, false)}</b> <span class="${Math.abs(ct) <= 5 ? 'ok' : ''}">${ct >= 0 ? '+' : ''}${ct}¢</span>`; tu.style.setProperty('--ct', ct / 50); } else tu.innerHTML = '<b>–</b>'; }
  const w = v => Math.max(0, Math.min(1, 1 + (20 * Math.log10(v + 1e-6)) / 60));   // -60..0 dBFS
  a.style.transform = `scaleX(${w(LV.lvl.i)})`; b.style.transform = `scaleX(${w(LV.lvl.o)})`;
  a.parentElement.classList.toggle('hot', LV.lvl.i > 0.9); b.parentElement.classList.toggle('hot', LV.lvl.o > 0.98);
}
function lvRender() {
  const btn = lvEl('lvOn'); if (!btn) return;
  btn.textContent = t(LV.on && !LV.demo ? 'lvStop' : 'lvStart'); btn.classList.toggle('on', LV.on && !LV.demo); btn.setAttribute('aria-pressed', LV.on && !LV.demo);
  const db = lvEl('lvDemo'); db.textContent = t(LV.on && LV.demo ? 'lvDemoStop' : 'lvDemo'); db.setAttribute('aria-pressed', !!(LV.on && LV.demo));
  lvEl('lvGain').value = LV.gain; lvEl('lvGainV').textContent = `${(20 * Math.log10(Math.max(1e-4, LV.gain))).toFixed(1)} dB`;
  document.querySelectorAll('#lvCh button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.ch === LV.ch));
  const sel = lvEl('lvDev');
  if (LV.devs.length) sel.innerHTML = `<option value="">${esc(t('lvDevDefault'))}</option>` + LV.devs.map((d, k) => `<option value="${esc(d.deviceId)}"${d.deviceId === LS.dev ? ' selected' : ''}>${esc(d.label || t('lvDevN', { n: k + 1 }))}</option>`).join('');
  // the delay: reported and measured
  const r = lvReported(), ms = v => (v * 1000).toFixed(1);
  lvEl('lvRep').textContent = r ? t('lvRep', { inp: r.inp == null ? '?' : ms(r.inp), blk: ms(r.blk), out: ms(r.out), sum: ms(r.sum), sr: r.sr / 1000 }) : t('lvRepNone');
  const m = LS.rtt;
  lvEl('lvMeas').innerHTML = m != null ? `<b>${Math.round(m * 1000)} ms</b> <span>${esc(t(m < 0.012 ? 'lvFeelTight' : m < 0.022 ? 'lvFeelOk' : m < 0.04 ? 'lvFeelSpace' : 'lvFeelSlow'))}</span>` : esc(t('lvMeasNone'));
  lvEl('lvMeasBtn').disabled = !!LS.cal;
  const c = lvEl('lvCode'), line = LV.code ? srcEl.value.split('\n')[LV.code.line] : '';
  c.textContent = line ? line.trim() : t('lvNoCode'); c.classList.toggle('none', !line);
  lvEl('lvBypass').setAttribute('aria-pressed', LV.bypass); lvEl('lvBypass').hidden = !line;
  lvEl('lvDsp').textContent = LV.on ? (LV.dsp === 'wasm' ? 'Rust DSP' : 'JS') : '';
  pdRefresh();
  document.querySelectorAll('#lvPatches [data-p]').forEach(b => b.setAttribute('aria-pressed', !!line && line.trim() === 'input | ' + LV_PATCHES[b.dataset.p]));
}
function lvInit() {
  if (!lvEl('lvBox')) return;
  try { LV.code = compile(srcEl.value).input || null; } catch (e) { }
  lvEl('lvOn').addEventListener('click', () => LV.on && !LV.demo ? lvStop() : lvStart());
  lvEl('lvDemo').addEventListener('click', () => LV.on && LV.demo ? lvStop() : lvStart(true));
  lvEl('lvGain').addEventListener('input', e => { LV.gain = +e.target.value; if (LV.node) LV.node.port.postMessage({ gain: LV.gain }); lvSave(); lvRender(); });
  lvEl('lvCh').addEventListener('click', e => { const b = e.target.closest('[data-ch]'); if (!b) return; LV.ch = +b.dataset.ch; if (LV.node) LV.node.port.postMessage({ ch: LV.ch }); lvSave(); lvRender(); });
  lvEl('lvDev').addEventListener('focus', lvDevices);
  lvEl('lvDev').addEventListener('change', e => lvDevice(e.target.value));
  lvEl('lvMeasBtn').addEventListener('click', lvMeasure);
  lvEl('lvPatches').innerHTML = Object.keys(LV_PATCHES).map(k => `<button class="chip" data-p="${k}" data-i18n="lvp_${k}" title="input | ${esc(LV_PATCHES[k])}">${esc(t('lvp_' + k))}</button>`).join('');
  lvEl('lvPatches').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) lvPatch(b.dataset.p); });
  lvEl('lvBypass').addEventListener('click', () => { LV.bypass = !LV.bypass; lvSend(); lvRender(); });
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', lvDevices);
  lvRender();
}
lvInit();
