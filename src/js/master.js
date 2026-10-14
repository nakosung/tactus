// ===================== Mastering and the speaker check =====================
// The mastering processor (Mst in SYN_CODE, mst_* in Rust) sits at the very end of the mix, where the DynamicsCompressor
// limiter used to be the last word. Off, it only measures (loudness, true peak, phase) and passes the sound through.
// On (any of target, bands, ceil, monobass on the master line), the classic limiter steps aside and the mix goes
// through its mono bass, three-band compressor, loudness target and true-peak limiter instead.
//   master warm | target -14 bands .4 ceil -1 monobass 120
// The speaker check (Spk, sp_*) comes after everything that is recorded or exported: it changes only what is heard,
// so a mix can be checked on a phone, a car or a club and nothing of it ends up in a take or a file.

var MST_READY = false;
const MST = { node: null, spk: null, on: false, p: new Float32Array(16), sig: '', blocks: [], shorts: [], playing: false, last: null, model: 0 };
const MST_KEYS = ['target', 'bands', 'ceil', 'monobass'];
const MST_DEF = { target: 0, bands: 0.3, ceil: -1, monobass: 0 };
const SPK_NAMES = ['off', 'phone', 'laptop', 'earbuds', 'speaker', 'car', 'tv', 'cube', 'club', 'radio'];
const SPK_ICON = ['🎧', '📱', '💻', '🎵', '🔊', '🚗', '📺', '🟫', '🪩', '📻'];
try { MST.model = Math.max(0, SPK_NAMES.indexOf(localStorage.getItem('tactus-spk') || 'off')); } catch (e) { }

// called once the worklets are in: the master goes between the mix and the output, the speaker after the analyser
async function mstAttach() {
  if (MST.node || !S.ctx || !WK.ok) return;
  const ctx = S.ctx;
  try {
    MST.node = new AudioWorkletNode(ctx, 'tactus-master', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
    MST.spk = new AudioWorkletNode(ctx, 'tactus-speaker', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
  } catch (e) { MST.node = MST.spk = null; return; }
  MST.node.port.onmessage = e => { if (e.data.m) mstMeter(e.data.m); };
  dspModule().then(m => { if (m) { MST.node.port.postMessage({ t: 'wasm', bytes: m.slice().buffer }); MST.spk.port.postMessage({ t: 'wasm', bytes: m.slice().buffer }); } });
  // the classic path (limiter, safety curve) and the direct one both feed the master; one of them is open
  A.mIn = ctx.createGain(); A.cls = ctx.createGain(); A.dir = ctx.createGain(); A.dir.gain.value = 0;
  A.safe.disconnect(A.fin); A.safe.connect(A.cls); A.cls.connect(A.mIn); A.satOut.connect(A.dir); A.dir.connect(A.mIn);
  A.mIn.connect(MST.node); MST.node.connect(A.fin);
  A.an.disconnect(ctx.destination); A.an.connect(MST.spk); MST.spk.connect(ctx.destination);
  MST_READY = true;
  MST.sig = ''; mstSync(0, ctx.currentTime);
  spkSet(MST.model, false);
}
// the master line's values at song position s: mastering is on when any of its words is written
function mstSync(s, time) {
  if (!MST_READY) return;
  const mp = S.masterParams || {}, on = MST_KEYS.some(k => mp[k] != null), v = k => { const x = mp[k] != null ? valueAt(mp[k], s, k) : null; return x == null ? MST_DEF[k] : x; };
  const p = MST.p;
  p[0] = on ? 1 : 0; p[1] = clamp(v('bands'), 0, 1); p[2] = clamp(v('target'), -40, 0); p[3] = clamp(v('ceil'), -12, 0); p[4] = clamp(v('monobass'), 0, 400); p[5] = 0; p[6] = 60;
  const sig = Array.from(p).join(',');
  if (sig === MST.sig) return;
  MST.sig = sig; MST.node.port.postMessage({ t: 'p', p: p.slice() });
  if (on !== MST.on) {
    MST.on = on;
    const t0 = Math.max(S.ctx.currentTime, time || 0);
    A.cls.gain.setTargetAtTime(on ? 0 : 1, t0, 0.01); A.dir.gain.setTargetAtTime(on ? 1 : 0, t0, 0.01);
  }
  mstDraw();
}

// ---------- what was measured ----------
// Every 100 ms: momentary (400 ms) and short-term (3 s) loudness. Integrated loudness and loudness range follow
// BS.1770 / EBU R 128 from the blocks since the music started (a new play starts them over).
const lufsOf = pw => pw > 0 ? -0.691 + 10 * Math.log10(pw) : -Infinity;
function mstMeter(m) {
  if (S.playing && !MST.playing) { MST.blocks = []; MST.shorts = []; }
  MST.playing = S.playing;
  if (S.playing) { MST.blocks.push(m[0]); if (MST.blocks.length % 10 === 0) MST.shorts.push(m[1]); if (MST.blocks.length > 72000) MST.blocks.splice(0, 36000); }
  const den = Math.sqrt(m[9] * m[10]);
  MST.last = { M: lufsOf(m[0]), S: lufsOf(m[1]), tp: m[2] > 0 ? 20 * Math.log10(m[2]) : -Infinity, gr: 20 * Math.log10(Math.max(1e-6, m[3])), bands: [m[4], m[5], m[6]].map(g => 20 * Math.log10(Math.max(1e-6, g))), auto: m[7], corr: den > 1e-12 ? m[8] / den : null };
  MST.peakTp = Math.max(MST.peakTp ?? -Infinity, MST.last.tp);
  mstDraw();
}
function mstIntegrated() {
  const abs = MST.blocks.filter(p => lufsOf(p) > -70); if (!abs.length) return null;
  const rel = lufsOf(abs.reduce((a, b) => a + b, 0) / abs.length) - 10, g = abs.filter(p => lufsOf(p) > rel);
  return g.length ? lufsOf(g.reduce((a, b) => a + b, 0) / g.length) : null;
}
function mstRange() {
  const abs = MST.shorts.filter(p => lufsOf(p) > -70); if (abs.length < 3) return null;
  const rel = lufsOf(abs.reduce((a, b) => a + b, 0) / abs.length) - 20, v = abs.filter(p => lufsOf(p) > rel).map(lufsOf).sort((a, b) => a - b);
  if (v.length < 3) return null;
  const q = f => v[Math.min(v.length - 1, Math.floor(f * (v.length - 1)))];
  return q(0.95) - q(0.1);
}

// ---------- the panel ----------
const mstEl = document.getElementById('mstBox'), spkEl = document.getElementById('spkBox');
const fmtDb = (v, d = 1) => v == null || !isFinite(v) ? '—' : (v > 0 && d >= 0 ? '+' : '') + v.toFixed(d);
function mstRender() {
  if (!mstEl) return;
  const mp = S.masterParams || {}, on = MST_KEYS.some(k => mp[k] != null), num = k => { const v = mp[k]; return v && v.k === 'num' ? v.v : null; };
  const tgt = on ? num('target') ?? MST_DEF.target : null;
  const tgts = [[null, t('mstOff')], [-16, '-16'], [-14, '-14'], [-11, '-11'], [-9, '-9']];
  const cur = !on ? null : tgts.some(x => x[0] === tgt) ? tgt : 'x';
  const sl = (k, min, max, step, val, fmt) => {
    const raw = mp[k], moving = raw && raw.k !== 'num';
    return `<label class="mst-sl${moving ? ' ro' : ''}"><b>${esc(t('mst_' + k))}</b><input type="range" data-mk="${k}" min="${min}" max="${max}" step="${step}" value="${val}"${on && !moving ? '' : ' disabled'}><output>${esc(moving ? t('mstMoving') : fmt(val))}</output></label>`;
  };
  mstEl.innerHTML = `<div class="mst-lcd" aria-live="off">
      <div class="mst-big"><output id="mstS">—</output><small>LUFS · ${esc(t('mstShort'))}</small></div>
      <div class="mst-bar" aria-hidden="true"><i class="mst-m" id="mstMbar"></i><i class="mst-s" id="mstSbar"></i>${tgt ? `<i class="mst-t" style="left:${((tgt + 36) / 36 * 100).toFixed(1)}%"></i>` : ''}<span class="mst-scale"><span>-36</span><span>-24</span><span>-12</span><span>0</span></span></div>
      <dl class="mst-nums">
        <div><dt>${esc(t('mstMom'))}</dt><dd id="mstM">—</dd></div><div><dt>${esc(t('mstInt'))}</dt><dd id="mstI">—</dd></div><div><dt>LRA</dt><dd id="mstR">—</dd></div>
        <div><dt>${esc(t('mstTp'))}</dt><dd id="mstTp">—</dd></div><div><dt>${esc(t('mstGr'))}</dt><dd id="mstGr">—</dd></div><div><dt>${esc(t('mstCorr'))}</dt><dd id="mstC">—</dd></div>
      </dl>
      <div class="mst-bands${on ? '' : ' off'}" aria-hidden="true">${['low', 'mid', 'high'].map((b, j) => `<span><i id="mstB${j}"></i><small>${esc(t('mstB_' + b))}</small></span>`).join('')}<span class="mst-auto"><small>${esc(t('mstAuto'))}</small><b id="mstA">—</b></span></div>
    </div>
    <div class="mst-row"><span class="mst-lbl">${esc(t('mstTarget'))}</span><span class="seg" role="group" aria-label="${esc(t('mstTarget'))}">${tgts.map(([v, l]) => `<button data-mt-t="${v == null ? 'off' : v}" aria-pressed="${cur === v}" title="${esc(v == null ? t('mstOffT') : t('mstT' + -v))}">${esc(l)}</button>`).join('')}${cur === 'x' ? `<button aria-pressed="true" disabled>${esc(String(tgt))}</button>` : ''}</span></div>
    <p class="note">${esc(on ? (tgt ? t('mstHintT', { v: tgt }) : t('mstHintOn')) : t('mstHintOff'))}</p>
    <div class="mst-sls">
      ${sl('bands', 0, 1, 0.05, num('bands') ?? MST_DEF.bands, v => (+v).toFixed(2))}
      ${sl('monobass', 0, 250, 10, num('monobass') ?? MST_DEF.monobass, v => +v ? `${Math.round(v)} Hz` : t('mstNone'))}
      ${sl('ceil', -3, 0, 0.1, num('ceil') ?? MST_DEF.ceil, v => `${(+v).toFixed(1)} dBTP`)}
    </div>
    <div class="row-btns"><button class="btn ghost" id="mstReset">${esc(t('mstReset'))}</button><button class="btn ghost" id="mstCode">${esc(t('mstCode'))}</button></div>`;
  spkRender();
  mstDraw();
}
function spkRender() {
  if (!spkEl) return;
  spkEl.innerHTML = `<div class="spk-grid" role="radiogroup" aria-label="${esc(t('spkTitle'))}">${SPK_NAMES.map((n, j) => `<button role="radio" data-spk="${j}" aria-checked="${MST.model === j}"${!MST_READY && j ? ' disabled' : ''}><span aria-hidden="true">${SPK_ICON[j]}</span>${esc(t('spk_' + n))}</button>`).join('')}</div>`;
  const badge = document.getElementById('spkCell');
  if (badge) { badge.hidden = !MST.model; const o = badge.querySelector('output'); if (o) o.innerHTML = MST.model ? `<span class="spki" aria-hidden="true">${SPK_ICON[MST.model]}</span><span class="spkn">${esc(t('spk_' + SPK_NAMES[MST.model]))}</span>` : ''; badge.setAttribute('aria-label', MST.model ? t('spkCellTitle') + ' · ' + t('spk_' + SPK_NAMES[MST.model]) : ''); }
}
function mstDraw() {
  const L = MST.last, $o = id => document.getElementById(id);
  const lcd = document.getElementById('lufsOut'); if (lcd) lcd.textContent = L && S.playing && isFinite(L.S) ? L.S.toFixed(1) : '—';
  if (!mstEl || mstEl.offsetParent === null || !L) return;
  const pct = v => Math.max(0, Math.min(100, (v + 36) / 36 * 100)).toFixed(1) + '%';
  $o('mstS').textContent = isFinite(L.S) ? L.S.toFixed(1) : '—';
  $o('mstMbar').style.width = isFinite(L.M) ? pct(L.M) : '0%'; $o('mstSbar').style.left = isFinite(L.S) ? pct(L.S) : '-10px';
  $o('mstM').textContent = isFinite(L.M) ? L.M.toFixed(1) : '—';
  const I = mstIntegrated(), R = mstRange();
  $o('mstI').textContent = I == null ? '—' : I.toFixed(1); $o('mstR').textContent = R == null ? '—' : R.toFixed(1);
  const tp = $o('mstTp'); tp.textContent = fmtDb(MST.peakTp); tp.classList.toggle('hot', MST.peakTp > -0.1);
  $o('mstGr').textContent = MST.on ? fmtDb(L.gr) : '—';
  $o('mstC').textContent = L.corr == null ? '—' : L.corr.toFixed(2);
  L.bands.forEach((g, j) => { const b = $o('mstB' + j); if (b) b.style.height = Math.min(100, -g / 12 * 100).toFixed(0) + '%'; });
  $o('mstA').textContent = MST.on && MST.p[2] < 0 ? fmtDb(L.auto) + ' dB' : '—';
}
// the master line, changed in place (or added after the song's first lines): set(k, v) or set(k, null) to take it out
function mstWrite(ch) {
  const lines = srcEl.value.split('\n');
  let i = lines.findIndex(l => /^\s*master\b/.test(l)), added = false;
  if (i < 0) {
    if (Object.values(ch).every(v => v == null)) return;
    let at = 0; for (let j = 0; j < lines.length; j++) { if (/^\s*(bpm|key|scale|prog|swing|space|seed)\b/.test(lines[j])) at = j + 1; else if (lines[j].trim() && !/^\s*\/\//.test(lines[j])) break; }
    lines.splice(at, 0, 'master'); i = at; added = true;
  }
  const p = bkSplit(lines[i]); if (!p) return;
  for (const [k, v] of Object.entries(ch)) {
    if (v == null) { if (p.params != null) p.params = p.params.replace(new RegExp(`\\s*(^|\\s)${k}\\s+\\S+`), ''); }
    else p.params = bkSetParam(p.params, k, v);
  }
  if (p.params != null && !p.params.trim()) p.params = null;
  if (!p.pat.trim() && p.params == null && !p.comment) lines.splice(i, 1);
  else { if (!p.pat.trim() && p.params != null) p.pat = ' '; lines[i] = bkJoin(p); }
  srcEl.value = lines.join('\n');
  try { localStorage.setItem('pulse-src', srcEl.value); } catch (e) { }
  render(); evaluate('bar');
}
function mstTarget(v) {
  const mp = S.masterParams || {};
  if (v === 'off') { mstWrite({ target: null, bands: null, ceil: null, monobass: null }); return; }
  mstWrite({ target: v, ...(mp.bands ? {} : { bands: MST_DEF.bands }), ...(mp.ceil ? {} : { ceil: MST_DEF.ceil }) });
}
function spkSet(j, save = true) {
  MST.model = j;
  if (save) try { localStorage.setItem('tactus-spk', SPK_NAMES[j]); } catch (e) { }
  if (MST.spk) MST.spk.port.postMessage({ model: j });
  spkRender();
}
if (mstEl) {
  mstEl.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mtT) { initAudio(); mstTarget(b.dataset.mtT === 'off' ? 'off' : +b.dataset.mtT); return; }
    if (b.id === 'mstReset') { MST.blocks = []; MST.shorts = []; MST.peakTp = -Infinity; mstDraw(); return; }
    if (b.id === 'mstCode') { const i = srcEl.value.split('\n').findIndex(l => /^\s*master\b/.test(l)); if (i >= 0 && typeof bkGoto === 'function') { bkView('code'); bkGoto(i); } }
  });
  mstEl.addEventListener('input', e => { const s = e.target; if (!s.dataset.mk) return; const o = s.parentElement.querySelector('output'); const v = +s.value; o.textContent = s.dataset.mk === 'monobass' ? (v ? `${v} Hz` : t('mstNone')) : s.dataset.mk === 'ceil' ? `${v.toFixed(1)} dBTP` : v.toFixed(2); });
  mstEl.addEventListener('change', e => { const s = e.target; if (!s.dataset.mk) return; mstWrite({ [s.dataset.mk]: +s.value }); });
}
if (spkEl) spkEl.addEventListener('click', e => { const b = e.target.closest('[data-spk]'); if (!b || b.disabled) return; initAudio(); spkSet(+b.dataset.spk); });
{ const cell = document.getElementById('spkCell'); if (cell) cell.addEventListener('click', () => spkSet(0)); }
mstRender();
