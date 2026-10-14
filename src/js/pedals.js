// ===================== The pedalboard: the input line as blocks =====================
// The live input's effects (`input | gate -55 drive .45 amp crunch delay .25 3/16 .35 verb .3`) drawn as stompboxes in
// the order the sound goes through them, in the block view and in the live panel. A knob or a switch rewrites the
// input line, so the code stays the only source of truth; the line is written back in the chain's order.
// The order is fixed (like a multi-effects unit): a pedal can be added, removed or bypassed, not moved.

const PD_TIMES = [1 / 16, 1 / 8, 3 / 16, 1 / 4, 3 / 8, 1 / 2, 3 / 4, 1, 2, 4, 8];
const PD_FRAC = v => { for (const [n, d] of [[1, 16], [1, 8], [3, 16], [1, 4], [3, 8], [1, 2], [3, 4]]) if (Math.abs(v - n / d) < 1e-4) return n + '/' + d; return bkNumS(v); };
// each pedal: the words of the line it owns, its colour family, and its controls (k: the word, i: which number)
const PD = [
  { id: 'gate', keys: ['gate'], cat: 'dyn', ctl: [{ k: 'gate', i: 0, min: -80, max: -20, step: 1, lbl: 'thr', unit: 'dB' }] },
  { id: 'comp', keys: ['comp'], cat: 'dyn', ctl: [{ k: 'comp', i: 0, lbl: 'amt' }] },
  { id: 'pitch', keys: ['pitch'], cat: 'pitch', ctl: [{ k: 'pitch', i: 0, min: -12, max: 12, step: 1, lbl: 'semi' }, { k: 'pitch', i: 1, lbl: 'mix' }] },
  { id: 'oct', keys: ['oct'], cat: 'pitch', ctl: [{ k: 'oct', i: 0, lbl: 'mix' }] },
  { id: 'harm', keys: ['harm'], cat: 'pitch', ctl: [{ k: 'harm', i: 0, sel: 'harm', lbl: 'steps' }, { k: 'harm', i: 1, lbl: 'mix' }] },
  { id: 'wah', keys: ['wah'], cat: 'filter', ctl: [{ k: 'wah', i: 0, lbl: 'amt' }, { k: 'wah', i: 1, sel: 'wah', lbl: 'rate' }] },
  { id: 'amp', keys: ['drive', 'amp', 'low', 'mid', 'high', 'cab'], cat: 'drive', ctl: [{ k: 'amp', words: ['clean', 'crunch', 'lead', 'fuzz'] }, { k: 'drive', i: 0, lbl: 'drive' }, { k: 'low', i: 0, min: -12, max: 12, step: 0.5, lbl: 'low', unit: 'dB' }, { k: 'mid', i: 0, min: -12, max: 12, step: 0.5, lbl: 'mid', unit: 'dB' }, { k: 'high', i: 0, min: -12, max: 12, step: 0.5, lbl: 'high', unit: 'dB' }, { k: 'cab', words: ['on', 'off'], lbl: 'cab' }] },
  { id: 'chorus', keys: ['chorus'], cat: 'mod', ctl: [{ k: 'chorus', i: 0, lbl: 'amt' }, { k: 'chorus', i: 1, sel: 'time', lbl: 'rate' }] },
  { id: 'flanger', keys: ['flanger'], cat: 'mod', ctl: [{ k: 'flanger', i: 0, lbl: 'amt' }, { k: 'flanger', i: 1, sel: 'time', lbl: 'rate' }] },
  { id: 'phaser', keys: ['phaser'], cat: 'mod', ctl: [{ k: 'phaser', i: 0, lbl: 'amt' }, { k: 'phaser', i: 1, sel: 'time', lbl: 'rate' }] },
  { id: 'trem', keys: ['trem'], cat: 'mod', ctl: [{ k: 'trem', i: 0, lbl: 'amt' }, { k: 'trem', i: 1, sel: 'time', lbl: 'rate' }] },
  { id: 'delay', keys: ['delay'], cat: 'time', ctl: [{ k: 'delay', i: 0, lbl: 'mix' }, { k: 'delay', i: 1, sel: 'time', lbl: 'time' }, { k: 'delay', i: 2, max: 0.95, lbl: 'fb' }, { k: 'delay', words: ['', 'pingpong', 'tape'] }] },
  { id: 'verb', keys: ['verb'], cat: 'time', ctl: [{ k: 'verb', i: 0, lbl: 'mix' }, { k: 'verb', i: 1, lbl: 'size' }] },
  { id: 'level', keys: ['level'], cat: 'dyn', ctl: [{ k: 'level', i: 0, min: -24, max: 12, step: 0.5, lbl: 'level', unit: 'dB' }] },
];
const PD_START = { gate: 'gate -55', comp: 'comp .4', pitch: 'pitch 7 .4', oct: 'oct .5', harm: 'harm 2 .5', wah: 'wah .7', amp: 'drive .45 amp crunch', chorus: 'chorus .5 2', flanger: 'flanger .5 4', phaser: 'phaser .5 2', trem: 'trem .6 1/8', delay: 'delay .3 3/16 .4', verb: 'verb .3 .5', level: 'level 0' };
// what a bypassed pedal was set to, so switching it back on brings its settings back
const PD_OFF = new Map();

// ---------- the line ----------
function pdLineIndex() { return srcEl.value.split('\n').findIndex(l => /^\s*input\b/.test(l)); }
function pdParams() { try { const r = compile(srcEl.value); return r.input ? r.input.params : null; } catch (e) { return null; } }
function pdTok(p) {
  const tm = ['wah', 'chorus', 'flanger', 'phaser', 'trem'].includes(p.k) ? 1 : p.k === 'delay' ? 1 : -1;
  return [p.k, ...p.v.map((v, i) => i === tm ? PD_FRAC(v) : bkNumS(v)), ...(p.w ? [p.w] : [])].join(' ');
}
// the line again, in the chain's order, keeping a comment at its end
function pdWrite(params, live) {
  const lines = srcEl.value.split('\n'), i = pdLineIndex();
  const order = PD.flatMap(p => p.keys).filter(k => params[k]);
  const body = order.map(k => pdTok(params[k])).join(' ');
  const old = i >= 0 ? lines[i] : '', cm = /\s*\/\/.*$/.exec(old);
  const line = 'input | ' + body + (cm ? cm[0] : '');
  if (i >= 0) { if (lines[i] === line) return; lines[i] = line; }
  else { let at = 0; while (at < lines.length && /^\s*(\/\/|bpm\b|key\b|scale\b|prog\b|swing\b|master\b|space\b|$)/.test(lines[at])) at++; lines.splice(at, 0, line); }
  srcEl.value = lines.join('\n');
  try { localStorage.setItem('pulse-src', srcEl.value); } catch (e) { }
  render(); evaluate('bar');
  if (!live) pdRefresh();
}
function pdAdd(id) {
  const params = pdParams() || {}, back = PD_OFF.get(id);
  const add = back || compile('input | ' + PD_START[id]).input.params;
  for (const k in add) params[k] = add[k];
  PD_OFF.delete(id); pdWrite(params);
}
function pdRemove(id, keep) {
  const params = pdParams(); if (!params) return;
  const pd = PD.find(p => p.id === id), saved = {};
  for (const k of pd.keys) if (params[k]) { saved[k] = params[k]; delete params[k]; }
  if (keep) PD_OFF.set(id, saved); else PD_OFF.delete(id);
  pdWrite(params);
}

// ---------- drawing ----------
const pdT = (k, f) => { const v = t(k); return v === k ? f : v; };
function pdTimeLabel(v) { return pdT('pdt_' + PD_FRAC(v).replace('/', '_'), v >= 1 ? t('pdBars', { n: bkNumS(v) }) : PD_FRAC(v)); }
function pdHarmLabel(n) { const a = Math.abs(n) + 1; return t(n > 0 ? 'pdHarmUp' : 'pdHarmDown', { n: a, o: a === 2 ? '2nd' : a === 3 ? '3rd' : a + 'th' }); }
function pdCtlHTML(pd, c, params) {
  const p = params[c.k];
  if (c.words) {
    const cur = p ? p.w || '' : c.k === 'amp' ? 'crunch' : c.k === 'cab' ? 'on' : '';
    return `<span class="pd-words seg" role="group" aria-label="${esc(pdT('pdc_' + (c.lbl || c.k), c.k))}">${c.words.map(w => `<button data-pdw="${c.k}" data-w="${w}" aria-pressed="${w === cur}">${esc(pdT('pdw_' + (w || 'normal'), w || '—'))}</button>`).join('')}</span>`;
  }
  const v = p ? p.v[c.i] : (INPUT_FX[c.k].d || [])[c.i] ?? 0, lbl = esc(pdT('pdc_' + c.lbl, c.lbl));
  if (c.sel) {
    const opts = c.sel === 'harm' ? [-7, -5, -4, -2, 2, 4, 5, 7].map(n => [n, pdHarmLabel(n)])
      : (c.sel === 'wah' ? [[0, t('pdWahLevel')]] : []).concat(PD_TIMES.map(x => [x, pdTimeLabel(x)]));
    if (!opts.some(o => Math.abs(o[0] - v) < 1e-4)) opts.push([v, c.sel === 'harm' ? pdHarmLabel(v) : pdTimeLabel(v)]);
    return `<label class="pd-sel"><span>${lbl}</span><select data-pdk="${c.k}" data-pdi="${c.i}">${opts.map(([x, l]) => `<option value="${x}"${Math.abs(x - v) < 1e-4 ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  }
  const min = c.min ?? 0, max = c.max ?? 1, step = c.step ?? 0.01;
  return `<label class="pd-knob"><span>${lbl}</span><input type="range" data-pdk="${c.k}" data-pdi="${c.i}" min="${min}" max="${max}" step="${step}" value="${v}"><output>${bkNumS(v)}${c.unit ? ' ' + c.unit : ''}</output></label>`;
}
function pdHTML(where) {
  const params = pdParams();
  if (!params) return `<section class="pd-board empty" data-pd-board="${where}"><p class="bk-why">${esc(t('pdNone'))}</p><button class="bk-add" data-pd-new="1">${esc(t('pdNew'))}</button></section>`;
  const on = PD.filter(p => p.keys.some(k => params[k])), off = PD.filter(p => !p.keys.some(k => params[k]));
  const live = typeof LV !== 'undefined' && LV && LV.on && !LV.bypass;
  // the live panel is narrow: the chain as switches, and the knobs in the block view
  if (where === 'live') {
    const chips = PD.filter(p => p.keys.some(k => params[k]) || PD_OFF.has(p.id)).map(p => { const off = PD_OFF.has(p.id); return `<button class="pd-chip" data-cat="${p.cat}" data-pd-${off ? 'on' : 'off'}="${p.id}" aria-pressed="${!off}" title="${esc(t(off ? 'pdOn' : 'pdBypassOne'))}"><i class="pd-led${live && !off ? ' on' : ''}"></i>${esc(t('pd_' + p.id))}</button>`; });
    return `<section class="pd-board compact" data-pd-board="live"><div class="pd-chips">${chips.join('<i class="pd-arrow" aria-hidden="true"></i>') || `<span class="bk-why">${esc(t('pdEmpty'))}</span>`}</div><button class="bk-link" data-pd-open="1">${esc(t('pdOpen'))}</button></section>`;
  }
  const pedals = on.map(pd => `<div class="pd" data-pd="${pd.id}" data-cat="${pd.cat}">
      <div class="pd-top"><i class="pd-led${live ? ' on' : ''}" aria-hidden="true"></i><b>${esc(t('pd_' + pd.id))}</b><button class="pd-x" data-pd-del="${pd.id}" aria-label="${esc(t('pdDel'))} ${esc(t('pd_' + pd.id))}" title="${esc(t('pdDel'))}">×</button></div>
      <div class="pd-ctls">${pd.ctl.map(c => pdCtlHTML(pd, c, params)).join('')}</div>
      <button class="pd-foot" data-pd-off="${pd.id}" title="${esc(t('pdBypassOne'))}" aria-label="${esc(t('pdBypassOne'))} ${esc(t('pd_' + pd.id))}"></button>
    </div>`);
  const offs = [...PD_OFF.keys()].map(id => `<div class="pd off" data-pd="${id}" data-cat="${PD.find(p => p.id === id).cat}"><div class="pd-top"><i class="pd-led" aria-hidden="true"></i><b>${esc(t('pd_' + id))}</b></div><p class="pd-offn">${esc(t('pdOff'))}</p><button class="pd-foot" data-pd-on="${id}" aria-label="${esc(t('pdOn'))} ${esc(t('pd_' + id))}" title="${esc(t('pdOn'))}"></button></div>`);
  const chain = [`<span class="pd-io">${esc(t('pdIn'))}</span>`, ...pedals, ...offs, `<span class="pd-io">${esc(t('pdOut'))}</span>`].join('<i class="pd-arrow" aria-hidden="true"></i>');
  const add = off.filter(p => !PD_OFF.has(p.id));
  return `<section class="pd-board" data-pd-board="${where}">
    <div class="pd-chain">${chain}</div>
    ${add.length ? `<div class="pd-add"><b>${esc(t('pdAdd'))}</b>${add.map(p => `<button class="bk-add" data-pd-add="${p.id}" data-cat="${p.cat}">${esc(t('pd_' + p.id))}</button>`).join('')}</div>` : ''}
  </section>`;
}
// redraw the boards that are on screen, unless a knob is being turned in one
function pdRefresh() {
  // the live panel draws before this file has run: wait for it
  if (!PD_READY || PD.drag) return;
  document.querySelectorAll('[data-pd-host]').forEach(h => { h.innerHTML = pdHTML(h.dataset.pdHost); });
}

// ---------- turning the knobs ----------
function pdSet(k, i, v, live) {
  const params = pdParams(); if (!params || !params[k]) return;
  params[k].v[i] = v; pdWrite(params, live);
}
function pdInit() {
  document.addEventListener('input', e => {
    const s = e.target; if (!s.matches('.pd-board input[type=range][data-pdk]')) return;
    PD.drag = true; if (typeof BK !== 'undefined') BK.busy = true;
    const v = +s.value, c = PD.flatMap(p => p.ctl).find(c => c.k === s.dataset.pdk && c.i === +s.dataset.pdi);
    s.nextElementSibling.textContent = bkNumS(v) + (c && c.unit ? ' ' + c.unit : '');
    pdSet(s.dataset.pdk, +s.dataset.pdi, v, true);
  });
  document.addEventListener('change', e => {
    const s = e.target; if (!s.closest || !s.closest('.pd-board')) return;
    if (s.matches('select[data-pdk]')) pdSet(s.dataset.pdk, +s.dataset.pdi, +s.value);
    if (s.matches('input[type=range][data-pdk]')) { PD.drag = false; if (typeof BK !== 'undefined') BK.busy = false; pdRefresh(); }
  });
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.pd-board button'); if (!b) return;
    if (b.dataset.pdNew) { pdWrite({}); return; }
    if (b.dataset.pdOpen) { if (document.body.classList.contains('mob')) mobTab('blocks'); else bkView(BK.view === 'code' ? 'split' : BK.view); requestAnimationFrame(() => { const el = document.querySelector('.bk-fx'); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }); return; }
    if (b.dataset.pdAdd) { pdAdd(b.dataset.pdAdd); return; }
    if (b.dataset.pdDel) { pdRemove(b.dataset.pdDel, false); return; }
    if (b.dataset.pdOff) { pdRemove(b.dataset.pdOff, true); return; }
    if (b.dataset.pdOn) { pdAdd(b.dataset.pdOn); return; }
    if (b.dataset.pdw) {
      const params = pdParams() || {}, k = b.dataset.pdw, w = b.dataset.w;
      if (k === 'cab') { params.cab = { k: 'cab', v: [], w }; }
      else if (k === 'amp') { params.amp = { k: 'amp', v: [], w }; if (!params.drive) params.drive = { k: 'drive', v: [0.45], w: null }; }
      else if (params[k]) params[k].w = w || null;
      pdWrite(params);
    }
  });
}
var PD_READY = true;
pdInit();
pdRefresh();
