// ===================== Live input: the page as an effects box =====================
// A mic or an instrument (through an audio interface) runs through the audio thread and straight to the speakers or
// headphones. This first step has no effects yet: it is the path the effects will sit on, and a way to see how long
// the trip takes on this device, which decides whether playing through it feels live.
// The path skips the track strips and the master chain: their compressors look ahead (about 6 ms each), and that
// would add to every note.
// How long it takes: what the browser reports (the input's latency, the 128-sample block, the output's), and what was
// measured, a click from the speakers heard on the mic. A click going out and coming back passes the same buffers as
// a note coming in and going out, so the measured round trip is the delay a player hears (less a millisecond for
// each 34 cm of air between speaker and mic).

const LV = { on: false, node: null, out: null, gain: 0.8, ch: 0, devs: [], lvl: { i: 0, o: 0 } };
try { Object.assign(LV, JSON.parse(localStorage.getItem('tactus-live') || '{}'), { on: false, node: null, out: null }); LS.dev = LV.dev || null; } catch (e) { }
function lvSave() { try { localStorage.setItem('tactus-live', JSON.stringify({ gain: LV.gain, ch: LV.ch, dev: LS.dev || null })); } catch (e) { } }
const lvEl = id => document.getElementById(id);

async function lvStart() {
  initAudio(); await S.ctx.resume();
  const r = await ensureMic();
  if (r !== 'ok') { lvSay(t(r === 'blocked' ? 'micBlocked' : 'micDenied'), 'bad'); return; }
  if (!(await ensureSynthWorklet())) { lvSay(t('lvNoWorklet'), 'bad'); return; }
  if (!LV.node) {
    LV.node = new AudioWorkletNode(S.ctx, 'tactus-live', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'discrete' });
    LV.node.port.onmessage = e => { LV.lvl = e.data; lvMeter(); };
    // straight to the output: no strip, no master (see the top)
    LV.out = S.ctx.createGain(); LV.node.connect(LV.out); LV.out.connect(S.ctx.destination);
  }
  LS.micNode.connect(LV.node); LV.src = LS.micNode;
  LV.node.port.postMessage({ ch: LV.ch, gain: LV.gain, on: true });
  LV.on = true; lvDevices(); lvRender();
  // on speakers the mic hears what it plays, and it can howl: say so
  lvSay(t(LS.speaker ? 'lvSpeakerWarn' : 'lvOn'), LS.speaker ? 'bad' : 'ok');
}
function lvStop() {
  if (LV.node) { LV.node.port.postMessage({ on: false }); if (LV.src) { try { LV.src.disconnect(LV.node); } catch (e) { } } }
  LV.on = false; LV.src = null; lvRender(); lvSay('', '');
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

// ---------- the panel ----------
function lvSay(m, cls) { const el = lvEl('lvMsg'); if (el) { el.textContent = m; el.className = 'note vxmsg ' + (cls || ''); } }
function lvMeter() {
  const a = lvEl('lvMi'), b = lvEl('lvMo'); if (!a) return;
  const w = v => Math.max(0, Math.min(1, 1 + (20 * Math.log10(v + 1e-6)) / 60));   // -60..0 dBFS
  a.style.transform = `scaleX(${w(LV.lvl.i)})`; b.style.transform = `scaleX(${w(LV.lvl.o)})`;
  a.parentElement.classList.toggle('hot', LV.lvl.i > 0.9); b.parentElement.classList.toggle('hot', LV.lvl.o > 0.98);
}
function lvRender() {
  const btn = lvEl('lvOn'); if (!btn) return;
  btn.textContent = t(LV.on ? 'lvStop' : 'lvStart'); btn.classList.toggle('on', LV.on); btn.setAttribute('aria-pressed', LV.on);
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
}
function lvInit() {
  if (!lvEl('lvBox')) return;
  lvEl('lvOn').addEventListener('click', () => LV.on ? lvStop() : lvStart());
  lvEl('lvGain').addEventListener('input', e => { LV.gain = +e.target.value; if (LV.node) LV.node.port.postMessage({ gain: LV.gain }); lvSave(); lvRender(); });
  lvEl('lvCh').addEventListener('click', e => { const b = e.target.closest('[data-ch]'); if (!b) return; LV.ch = +b.dataset.ch; if (LV.node) LV.node.port.postMessage({ ch: LV.ch }); lvSave(); lvRender(); });
  lvEl('lvDev').addEventListener('focus', lvDevices);
  lvEl('lvDev').addEventListener('change', e => lvDevice(e.target.value));
  lvEl('lvMeasBtn').addEventListener('click', lvMeasure);
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', lvDevices);
  lvRender();
}
lvInit();
