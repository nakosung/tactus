// ===================== Block view =====================
// The same song as cards, for people who would rather tap than type (and children first of all). The code stays the
// one source of truth: every card is drawn from a line of code, and every tap rewrites only the part of that line it
// touched (the pattern, one value or one rule after |), so comments, spacing and everything else survive.
//   drums      16 steps to tap or paint, one page per bar when the bars differ (<[...] [...]>)
//   melodies   a lane per note of the song's scale; tap to place a note, drag right to hold it
//   stickers   one slider per sound setting (loudness, echo, space, brightness, crunch)
//   rules      every N bars, sometimes, now and then skip, left and right, echo, faster or slower: blocks that change
//              how the pattern plays (the grid shows the pattern before them, so writing it back never applies a
//              rule twice)
//   phrases    let A = ... is a piece made once and used many times (a variable); a track written as $A $A $B shows
//              those pieces in order
//   chords     the prog line as chord tiles; scenes and the song as switches and a train of parts
// A pattern the grid cannot hold as written (chords in one track, ~generators, finer than 16ths, nested turns) is
// shown as its code, with a way to jump to that line. The key and tempo shown are the code's, not the ones playing
// (a change waits for the next bar to be heard, but the cards follow the code at once).

// var, not const: evaluate() in ui.js asks for a redraw, and the first evaluate runs before this file does
var BK = { view: 'code', busy: false, items: [], drag: null, flashLine: -1, step: -1, timer: 0, raf: 0, pages: new Map(), minBars: new Map(), key: { root: 9, scale: 'minor' }, prog: null, song: null, scenes: [] };
const BK_STEPS = 16, BK_MAXBARS = 16;
const BK_STICKERS = [
  { k: 'gain', min: 0, max: 1.2, step: 0.01, def: 0.8 },
  { k: 'delay', min: 0, max: 1, step: 0.01, def: 0.3 },
  { k: 'verb', min: 0, max: 1, step: 0.01, def: 0.3 },
  { k: 'cut', min: 100, max: 12000, step: 1, def: 2000, log: true },
  { k: 'shape', min: 0, max: 1, step: 0.01, def: 0.3 },
];
// what can be added from the palette, with the pattern it starts with
const BK_PALETTE = [
  ['kick', 'x x x x'], ['snare', '. x . x'], ['clap', '. x . x'], ['hat', '. x . x . x . x'], ['ohat', '. . . x . . . x'], ['rim', '. . . . . . x . . . x . . . . .'],
  ['bass', '0 . 0 4 . 0 3 .'], ['piano', '0 2 4 7 4 2 0 _'], ['pluck', '4 . 2 . 0 . 2 .'], ['bell', '7 . 4 . 2 . 0 .'], ['marimba', '0 4 7 4 0 4 7 9'], ['flute', '4 _ 2 _ 0 _ _ _'], ['pad', '0 _ _ _ 4 _ _ _'], ['acid', '0 0 7 0 3 0 10 0'],
];
const BK_ICON = inst => isHit(inst) ? '🥁' : /bass|acid|upright/.test(inst) ? '🎸' : /piano|epiano|harpsi/.test(inst) ? '🎹' : /sax/.test(inst) ? '🎷' : /bowed|string/.test(inst) ? '🎻' : /bell|vibes|marimba|kalimba|plate/.test(inst) ? '🔔' : /flute|choir/.test(inst) ? '🎵' : /harp|pluck|zither|dantranh/.test(inst) ? '🪕' : '🎛️';
const bkName = inst => { const k = 'bi_' + inst, v = t(k); return v === k ? inst : v; };
const bkT = (k, fb) => { const v = t(k); return v === k ? fb : v; };
const bkHue = s => TRACK_COLORS[[...s].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % TRACK_COLORS.length];

// ---------- reading a line ----------
// split a line into the parts a card can change: head, pattern, params after |, comment ("let A =" is a head too)
function bkSplit(text) {
  const ci = commentAt(text), code = ci >= 0 ? text.slice(0, ci) : text, comment = ci >= 0 ? text.slice(ci) : '';
  const lm = /^(\s*let\s+([A-Za-z_]\w*)\s*=\s*)/.exec(code);
  if (lm) return { head: lm[1], name: lm[2], pat: code.slice(lm[1].length), params: null, comment, let: true };
  const m = HEAD_RE.exec(code); if (!m) return null;
  const rest = code.slice(m[0].length), bar = rest.indexOf('|');
  return { head: m[0], name: m[2], pat: bar >= 0 ? rest.slice(0, bar) : rest, params: bar >= 0 ? rest.slice(bar + 1) : null, comment };
}
function bkJoin(p) {
  let s = p.head + p.pat;
  if (p.params != null) s += '|' + p.params;
  if (p.comment) s += (/\s$/.test(s) ? '' : ' ') + p.comment;
  return s;
}
// the pattern as steps, 16 per bar, one bar or a few that repeat (the bars of <[...] [...]>); null when it does not fit
function bkGrid(patSrc, kind) {
  const src = patSrc.trim();
  if (!src || /[~$]/.test(src)) return null;
  // x? (a hit that plays now and then) is random, so the bars would differ: read it as its own value instead
  let pat; try { pat = parseMini(kind === 'drum' ? src.replace(/([xX])\?(?![.\d])/g, 'q') : src, 0); } catch (e) { return null; }
  const bar = c => pat.q(c, c + 1).filter(e => e.v !== '~' && e.s >= c - 1e-9 && e.s < c + 1 - 1e-9);
  const sig = c => bar(c).map(e => `${e.v}@${((e.s - c) * BK_STEPS).toFixed(3)}+${(e.d * BK_STEPS).toFixed(3)}`).join(' ');
  const sigs = Array.from({ length: 32 }, (_, c) => sig(c));
  const bars = [1, 2, 3, 4, 6, 8, 12, 16].find(P => sigs.every((s, c) => s === sigs[c % P]));
  if (!bars) return null;
  const tok = Array(bars * BK_STEPS).fill('.');
  for (let b = 0; b < bars; b++) for (const e of bar(b)) {
    const k = (e.s - b) * BK_STEPS, len = e.d * BK_STEPS;
    if (Math.abs(k - Math.round(k)) > 1e-6 || k < 0 || k >= BK_STEPS) return null;
    const i = b * BK_STEPS + Math.round(k);
    if (tok[i] !== '.') return null;   // two at once: a chord
    if (kind === 'drum') { if (!/^[xXq]$/.test(e.v)) return null; tok[i] = e.v === 'q' ? 'x?' : e.v; }
    else {
      if (!/^(-?\d+|[a-g][#b]?\d)$/.test(e.v)) return null;
      if (Math.abs(len - Math.round(len)) > 1e-6) return null;
      tok[i] = e.v;
      for (let j = 1; j < Math.round(len) && Math.round(k) + j < BK_STEPS; j++) tok[i + j] = '_';
    }
  }
  return { tok, bars };
}
// a value after | as a plain number, or null if it is something else (a knob, a sweep, a pattern)
function bkParam(params, k) {
  if (params == null) return undefined;
  const m = new RegExp(`(^|\\s)${k}\\s+(\\S+)`).exec(params);
  if (!m) return undefined;
  return /^-?(\d+\.?\d*|\.\d+)$/.test(m[2]) ? +m[2] : null;
}
const bkNum = v => v >= 100 ? String(Math.round(v)) : String(+v.toFixed(2)).replace(/^0\./, '.').replace(/^-0\./, '-.');
function bkSetParam(params, k, v) {
  const s = bkNum(v);
  if (params == null) return ` ${k} ${s}`;
  const re = new RegExp(`(^|\\s)(${k}\\s+)(\\S+)`);
  return re.test(params) ? params.replace(re, (m, a, b) => a + b + s) : params.replace(/\s*$/, '') + ` ${k} ${s}`;
}

// ---------- rules after | ----------
// The rules a child can use as blocks; anything else written there is shown as code and left alone.
const BK_FNRE = '(rev|inv|(?:fast|slow|ply)\\s+\\d+|[+-]\\d+)';
const BK_RULES = [
  { type: 'every', re: new RegExp(`\\bevery\\s+(\\d+)\\s+${BK_FNRE}`, 'g'), make: m => ({ n: +m[1], fn: m[2].replace(/\s+/g, ' ') }), text: r => `every ${r.n} ${r.fn}`, add: 'every 4 rev' },
  { type: 'chance', re: new RegExp(`\\b(sometimes|often|rarely)(?:\\s+(0?\\.\\d+|1))?\\s+${BK_FNRE}`, 'g'), make: m => ({ w: m[1], p: m[2] || null, fn: m[3].replace(/\s+/g, ' ') }), text: r => `${r.w}${r.p ? ' ' + r.p : ''} ${r.fn}`, add: 'sometimes fast 2' },
  { type: 'degrade', re: /\bdegrade(?:\s+(0?\.\d+))?/g, make: m => ({ p: m[1] || null }), text: r => `degrade${r.p ? ' ' + r.p : ''}`, add: 'degrade .3' },
  { type: 'jux', re: new RegExp(`\\bjux\\s+${BK_FNRE}`, 'g'), make: m => ({ fn: m[1].replace(/\s+/g, ' ') }), text: r => `jux ${r.fn}`, add: 'jux rev' },
  { type: 'echo', re: /\becho\s+(\d+)\s+(\d+\/\d+|[\d.]+)(?:\s+(0?\.\d+))?/g, make: m => ({ src: m[0] }), text: r => r.src, add: 'echo 3 1/8 .5' },
  { type: 'speed', re: /\b(fast|slow)\s+(\d+(?:\.\d+)?)/g, make: m => ({ w: m[1], k: m[2] }), text: r => `${r.w} ${r.k}`, add: 'fast 2' },
];
const BK_OTHER = /\b(off|superimpose|chunk|iter|palindrome|struct|mask|scramble|shuffle)\b/g;
function bkRules(params) {
  if (params == null) return [];
  const out = [], used = [];
  const free = (a, b) => used.every(([x, y]) => b <= x || a >= y);
  for (const R of BK_RULES) {
    R.re.lastIndex = 0; let m;
    while ((m = R.re.exec(params))) { const a = m.index, b = a + m[0].length; if (free(a, b)) { used.push([a, b]); out.push({ type: R.type, a, b, ...R.make(m) }); } }
  }
  BK_OTHER.lastIndex = 0; let m;
  while ((m = BK_OTHER.exec(params))) if (free(m.index, m.index + m[0].length)) out.push({ type: 'other', w: m[1], a: m.index, b: m.index + m[0].length });
  return out.sort((x, y) => x.a - y.a);
}
function bkRuleText(r) { return BK_RULES.find(R => R.type === r.type).text(r); }
function bkReplace(params, r, txt) {
  if (txt) return params.slice(0, r.a) + txt + params.slice(r.b);
  const s = (params.slice(0, r.a).replace(/\s+$/, '') + ' ' + params.slice(r.b).replace(/^\s+/, '')).replace(/\s+$/, '');
  return s.trim() ? s : null;
}
const BK_FNS = ['rev', 'fast 2', 'slow 2', 'ply 2', 'inv', '+7', '-7'];
const bkFnLabel = fn => ({ rev: t('bkf_rev'), 'fast 2': t('bkf_fast'), 'slow 2': t('bkf_slow'), 'ply 2': t('bkf_ply'), inv: t('bkf_inv'), '+7': t('bkf_up'), '-7': t('bkf_down') }[fn] || fn);
function bkFnSelect(fn, melodic) {
  const list = BK_FNS.filter(f => melodic || !['inv', '+7', '-7'].includes(f));
  if (!list.includes(fn)) list.push(fn);
  return `<select data-rf="fn" aria-label="${esc(t('bkRuleFn'))}">${list.map(f => `<option value="${esc(f)}"${f === fn ? ' selected' : ''}>${esc(bkFnLabel(f))}</option>`).join('')}</select>`;
}
function bkRuleHTML(r, j, melodic) {
  const x = `<button class="bk-rx" data-rx="${j}" aria-label="${esc(t('bkRuleDel'))}">×</button>`;
  let inner;
  if (r.type === 'every') inner = `<select data-rf="n" aria-label="${esc(t('bkRuleN'))}">${[2, 3, 4, 8, ...(![2, 3, 4, 8].includes(r.n) ? [r.n] : [])].map(n => `<option value="${n}"${n === r.n ? ' selected' : ''}>${n}</option>`).join('')}</select><span>${esc(t('bkr_every'))}</span>${bkFnSelect(r.fn, melodic)}`;
  else if (r.type === 'chance') inner = `<select data-rf="w" aria-label="${esc(t('bkRuleHow'))}">${['sometimes', 'often', 'rarely'].map(w => `<option value="${w}"${w === r.w ? ' selected' : ''}>${esc(t('bkc_' + w))}</option>`).join('')}</select>${bkFnSelect(r.fn, melodic)}`;
  else if (r.type === 'degrade') inner = `<span>${esc(t('bkr_degrade'))}</span>`;
  else if (r.type === 'jux') inner = `<span>${esc(t('bkr_jux'))}</span>${bkFnSelect(r.fn, melodic)}`;
  else if (r.type === 'echo') inner = `<span>${esc(t('bkr_echo'))}</span>`;
  else if (r.type === 'speed') inner = `<select data-rf="sp" aria-label="${esc(t('bkr_speed'))}">${['fast 2', 'fast 4', 'slow 2', ...(['fast 2', 'fast 4', 'slow 2'].includes(r.w + ' ' + r.k) ? [] : [r.w + ' ' + r.k])].map(v => `<option value="${v}"${v === r.w + ' ' + r.k ? ' selected' : ''}>${esc(t(v.startsWith('fast') ? 'bks2_fast' : 'bks2_slow', { k: v.split(' ')[1] }))}</option>`).join('')}</select>`;
  else return `<span class="bk-rule code" title="${esc(t('bkRuleCode'))}"><code>${esc(r.w)}</code></span>`;
  return `<span class="bk-rule" data-r="${j}">${inner}${x}</span>`;
}

// ---------- chords (the prog line) ----------
function bkChordList(key) {
  const sc = SCALES[key.scale] || SCALES.major, n = sc.length, flat = vxFlatKey(key.root, key.scale), out = [];
  for (let d = 0; d < n; d++) {
    const iv = k => sc[(d + k) % n] + 12 * Math.floor((d + k) / n) - sc[d];
    const third = iv(2), fifth = iv(4);
    const q = third === 4 && fifth === 7 ? '' : third === 3 && fifth === 7 ? 'm' : third === 3 && fifth === 6 ? 'dim' : third === 4 && fifth === 8 ? 'aug' : '';
    const nm = vxNoteName(key.root + sc[d], flat).replace(/-?\d+$/, '');
    out.push({ deg: String(d), name: nm[0].toUpperCase() + nm.slice(1) + q });
  }
  return out;
}
function bkProg(lines) {
  const i = lines.findIndex(l => /^\s*prog\b/.test(stripComment(l))); if (i < 0) return { i: -1 };
  const code = stripComment(lines[i]), rest = code.replace(/^\s*prog\s*/, '');
  const m = /^<\s*([^<>\[\]~,]+?)\s*>\s*$/.exec(rest.trim()) || /^([^\s<>\[\]~,]+)$/.exec(rest.trim());
  if (!m) return { i, code: rest.trim() };
  const toks = m[1].split(/\s+/);
  if (!toks.every(v => /^-?\d+$/.test(v) || /^[A-G][#b]?[A-Za-z0-9#+°]*$/.test(v))) return { i, code: rest.trim() };
  return { i, toks, names: toks.some(v => /^[A-G]/.test(v)) };
}
function bkWriteProg(toks) {
  const lines = srcEl.value.split('\n'), P = bkProg(lines), body = toks.length > 1 ? `<${toks.join(' ')}>` : toks[0];
  if (P.i < 0) {
    const k = lines.findIndex(l => /^\s*(key|bpm)\b/.test(l));
    lines.splice(k >= 0 ? k + 1 : 0, 0, `prog ${body}`); BK.flashLine = k >= 0 ? k + 1 : 0;
  } else {
    const ci = commentAt(lines[P.i]), comment = ci >= 0 ? lines[P.i].slice(ci) : '', lead = /^(\s*prog\s+)/.exec(lines[P.i]);
    lines[P.i] = (lead ? lead[1] : 'prog ') + body + (comment ? '          ' + comment : ''); BK.flashLine = P.i;
  }
  srcEl.value = lines.join('\n'); bkApply();
}

// ---------- scenes and the song ----------
const BK_SCENE_RE = /^(\s*scene\s+\S+)(\s*)([^|]*?)(\s*\|.*)?$/;
function bkSceneToggle(li, track, on) {
  const lines = srcEl.value.split('\n'), text = lines[li], ci = commentAt(text), code = ci >= 0 ? text.slice(0, ci) : text, comment = ci >= 0 ? text.slice(ci) : '';
  const m = BK_SCENE_RE.exec(code); if (!m) return;
  let w = m[3].split(/\s+/).filter(Boolean);
  if (w.includes('all')) w = on ? w.filter(x => x !== '-' + track) : (w.includes('-' + track) ? w : [...w, '-' + track]);
  else w = on ? (w.includes(track) ? w : [...w, track]) : w.filter(x => x !== track);
  lines[li] = m[1] + ' ' + w.join(' ') + (m[4] || '') + (comment ? ' ' + comment : '');
  srcEl.value = lines.join('\n'); BK.flashLine = li; bkApply();
}
function bkWriteSong(parts, li) {
  const lines = srcEl.value.split('\n'), body = parts.map(p => `${p.name}:${p.bars}`).join(' ');
  if (li < 0) { lines.push(`song ${body}`); BK.flashLine = lines.length - 1; }
  else { const ci = commentAt(lines[li]), comment = ci >= 0 ? lines[li].slice(ci) : ''; lines[li] = `song ${body}` + (comment ? ' ' + comment : ''); BK.flashLine = li; }
  srcEl.value = lines.join('\n'); bkApply();
}
function bkSceneAdd(tracks) {
  const names = new Set(BK.scenes.map(s => s.name));
  let k = 0, nm; do { nm = 'abcdefghijklmnopqrstuvwxyz'[k % 26] + (k >= 26 ? Math.floor(k / 26) : ''); k++; } while (names.has(nm));
  const lines = srcEl.value.split('\n');
  let at = lines.findIndex(l => /^\s*song\b/.test(l)); if (at < 0) at = lines.length;
  if (at === lines.length && lines[at - 1] && lines[at - 1].trim() && !BK.scenes.length) lines.push(''), at++;
  lines.splice(at, 0, `scene ${nm.padEnd(6)} ${tracks.join(' ')}`);
  srcEl.value = lines.join('\n'); BK.flashLine = at; bkApply();
}
function bkSceneDel(sc) {
  const orig = srcEl.value; let lines = orig.split('\n');
  lines.splice(sc.line, 1);
  lines = lines.map(l => { if (!/^\s*song\b/.test(l)) return l; const ci = commentAt(l), code = ci >= 0 ? l.slice(0, ci) : l; const parts = code.replace(/^\s*song\s*/, '').split(/\s+/).filter(p => p && p.split(':')[0] !== sc.name); return parts.length ? 'song ' + parts.join(' ') + (ci >= 0 ? ' ' + l.slice(ci) : '') : null; }).filter(l => l !== null);
  srcEl.value = lines.join('\n'); bkApply();
  shareToast(t('bkDeleted', { n: sc.name }), t('bkUndo'), () => { srcEl.value = orig; bkApply(); });
}

// ---------- writing back ----------
function bkWrite(i, fn, opts = {}) {
  const lines = srcEl.value.split('\n'), p = bkSplit(lines[i] || ''); if (!p) return;
  const before = lines[i];
  fn(p);
  lines[i] = bkJoin(p);
  if (lines[i] === before) return;
  srcEl.value = lines.join('\n');
  BK.flashLine = i;
  bkApply(opts.live);
}
// apply the code: evaluate at the next bar (as typing would), redraw the code, and the cards unless a drag is on
function bkApply(live) {
  try { localStorage.setItem('pulse-src', srcEl.value); } catch (e) { }
  render(); evaluate('bar'); buildPresets();
  if (BK.flashLine >= 0) { const el = hlEl.children[BK.flashLine]; if (el) { el.classList.remove('bk-flash'); void el.offsetWidth; el.classList.add('bk-flash'); } BK.flashLine = -1; }
  if (!live) bkSoon();
}
// one redraw per frame, whoever asks (evaluate asks after every change of code)
function bkSoon() {
  if (!BK || BK.view === 'code' || BK.raf) return;
  BK.raf = requestAnimationFrame(() => { BK.raf = 0; if (!BK.busy) bkRender(); });
}
// keep the spacing of an aligned column: the new pattern takes the old one's width when it fits
function bkFit(old, pat, more) {
  const lead = /^\s*/.exec(old)[0], width = old.length;
  const s = (lead || ' ') + pat;
  if (!more) return s;   // nothing after the pattern: no padding to keep
  return s.length + 1 <= width ? s.padEnd(width) : s + ' ';
}
// the bars of a top-level <a b c>, as written (so bars nobody touched keep their own spelling)
function bkItems(src) {
  const s = src.trim(); if (!s.startsWith('<') || !s.endsWith('>')) return null;
  const body = s.slice(1, -1), out = []; let depth = 0, cur = '';
  for (const ch of body) {
    if ('[<{('.includes(ch)) depth++; else if (']>})'.includes(ch)) depth--;
    if (depth < 0) return null;
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur), cur = ''; } else cur += ch;
  }
  if (depth) return null;
  if (cur) out.push(cur);
  return out;
}
const bkBarTok = (L, b) => L.tok.slice(b * BK_STEPS, (b + 1) * BK_STEPS);
// a bar that repeats a shorter figure is written as the figure and a count: [0 2 4 7]*4, x*8
function bkRepeat(s) {
  const w = s.split(' '), n = w.length;
  for (let q = 1; q < n; q++) {
    if (n % q || w[0] === '_') continue;
    if (w.every((v, j) => v === w[j % q])) return q === 1 ? `${w[0]}*${n}` : `[${w.slice(0, q).join(' ')}]*${n / q}`;
  }
  return s;
}
// write the pattern back: only the bars that changed are rewritten; the rest stay as they were written
function bkPatternOf(L) {
  const mel = L.kind !== 'drum', fresh = b => bkRepeat(vxBar(bkBarTok(L, b), mel));
  const bs = Array.from({ length: L.bars }, (_, b) => L.items && L.items.length === L.bars && L.items[b] != null && L.orig[b] === bkBarTok(L, b).join(' ') ? L.items[b] : fresh(b));
  if (bs.every(s => s === bs[0]) && !(L.items && L.items.length === L.bars && L.bars > 1)) return bs[0];
  return `<${bs.map(s => /\s/.test(s) && !/^\[[^\]]*\]$/.test(s) ? `[${s}]` : s).join(' ')}>`;
}
function bkWritePat(L, live = true) { bkWrite(L.i, p => { p.pat = p.let ? bkPatternOf(L) : bkFit(p.pat, bkPatternOf(L), p.params != null); }, { live }); }
// the grid of a line, with what bkPatternOf needs to keep untouched bars as written
function bkLoad(L, src, kind) {
  const g = bkGrid(src, kind); if (!g) return false;
  let tok = g.tok, bars = g.bars;
  const items = bkItems(src);
  // a pattern written as <a b c d> where the bars repeat still shows as its written bars
  if (items && items.length > bars && items.length <= BK_MAXBARS && items.length % bars === 0) { tok = Array.from({ length: items.length / bars }, () => tok).flat(); bars = items.length; }
  // bars added here that are still copies of others
  const want = BK.minBars.get(L.key) || 0;
  if (want > bars && want % bars === 0) { tok = Array.from({ length: want / bars }, () => tok).flat(); bars = want; }
  L.tok = tok; L.bars = bars; L.items = items && items.length === bars ? items : null;
  L.orig = Array.from({ length: bars }, (_, b) => bkBarTok(L, b).join(' '));
  L.page = Math.min(BK.pages.get(L.key) || 0, bars - 1);
  return true;
}

// ---------- the board ----------
const boardEl = document.getElementById('board');
function bkScaleRows(tokens, mode, oct) {
  // rows: the notes of the song's scale that the melody uses, with room above and below
  const key = BK.key, sc = (SCALES[key.scale] || SCALES.major), n = sc.length;
  if (mode === 'deg') {
    const ds = tokens.filter(v => /^-?\d+$/.test(v)).map(Number);
    let lo = ds.length ? Math.min(...ds) - 1 : -1, hi = ds.length ? Math.max(...ds) + 2 : n + 1;
    if (hi - lo < n + 1) { const add = n + 1 - (hi - lo); lo -= Math.floor(add / 2); hi += Math.ceil(add / 2); }
    hi = Math.min(hi, lo + 15);
    return Array.from({ length: hi - lo + 1 }, (_, j) => hi - j).map(d => ({ v: String(d), midi: key.root + 12 * (oct + 1) + sc[mod(d, n)] + 12 * Math.floor(d / n) }));
  }
  // a note the code spells its own way (g#5 in F major) keeps that spelling, so the lane and the code agree
  const spelled = new Map(); for (const v of tokens) if (/^[a-g]/.test(v)) spelled.set(atomNotes(v, 0, 'major', 4, 0)[0], v);
  const ms = [...spelled.keys()];
  const lo = (ms.length ? Math.min(...ms) : 57) - 2, hi = (ms.length ? Math.max(...ms) : 69) + 3, rows = [], flat = vxFlatKey(key.root, key.scale);
  for (let m = hi; m >= lo; m--) if (sc.includes(mod(m - key.root, 12)) || spelled.has(m)) rows.push({ v: spelled.get(m) || vxNoteName(m, flat), midi: m, own: spelled.get(m) });
  return rows.slice(0, 16);
}
// note names as the key spells them (G# in A major, Ab in F minor)
const bkLabel = midi => { const s = vxNoteName(midi, vxFlatKey(BK.key.root, BK.key.scale)); return s[0].toUpperCase() + s.slice(1); };
function bkOwn(tok) { const own = []; let cur = null; tok.forEach((v, k) => { if (v === '_' && cur) own[k] = cur; else if (v !== '.' && v !== '_') { cur = v; own[k] = v; } else { cur = null; own[k] = null; } }); return own; }
function bkGridHTML(L, p, def) {
  const pg = L.page, off = pg * BK_STEPS, tok = L.tok.slice(off, off + BK_STEPS);
  const tabs = `<div class="bk-bars" role="group" aria-label="${esc(t('bkBar'))}">${Array.from({ length: L.bars }, (_, b) => `<button class="bk-bar${b === pg ? ' sel' : ''}" data-bar="${b}" aria-pressed="${b === pg}">${b + 1}</button>`).join('')}${L.bars < BK_MAXBARS ? `<button class="bk-bar add" data-act="baradd" title="${esc(t('bkBarAdd'))}" aria-label="${esc(t('bkBarAdd'))}">+</button>` : ''}${L.bars > 1 ? `<button class="bk-bar del" data-act="bardel" title="${esc(t('bkBarDel'))}" aria-label="${esc(t('bkBarDel'))}">−</button>` : ''}<span class="bk-barlbl">${esc(t('bkBar'))}</span></div>`;
  if (L.kind === 'drum') return tabs + `<div class="bk-steps">${tok.map((v, k) => `<button class="bk-cell${v !== '.' ? ' on' : ''}${v === 'X' ? ' acc' : ''}${v === 'x?' ? ' maybe' : ''}" data-k="${k}" aria-label="${k + 1}${v === 'x?' ? ' ' + esc(t('bkMaybe')) : ''}" aria-pressed="${v !== '.'}" title="${esc(t('bkTapHint'))}"></button>`).join('')}</div>`;
  // the octave the track really plays in, so the lane's note names are true
  const oct = Math.round((p && bkParam(p.params, 'oct')) ?? (def && INST[def.inst] && INST[def.inst].oct) ?? 4);
  const mode = L.tok.some(v => /^[a-g]/.test(v)) ? 'name' : 'deg', rows = bkScaleRows(L.tok, mode, oct), own = bkOwn(tok);
  L.mode = mode;
  return tabs + `<div class="bk-lane">` + rows.map(row => `<div class="bk-row" data-v="${esc(row.v)}"><span class="bk-note">${row.own ? row.own[0].toUpperCase() + row.own.slice(1) : bkLabel(row.midi)}</span>${tok.map((v, k) => {
    const hit = own[k] === row.v, start = hit && tok[k] !== '_';
    return `<button class="bk-cell${hit ? ' on' : ''}${start ? ' start' : ''}" data-k="${k}" aria-label="${bkLabel(row.midi)} ${k + 1}" aria-pressed="${hit}"></button>`;
  }).join('')}</div>`).join('') + `</div>`;
}
function bkRender() {
  if (!boardEl || BK.view === 'code') return;
  const text = srcEl.value, r = compile(text), lines = text.split('\n'), cards = [];
  // the code's key and tempo, which may be waiting for the next bar to be heard
  BK.key = { root: r.key ? r.key.root : S.root, scale: r.scale || (r.key ? r.key.scale : S.scale) };
  const bpm = Math.round(r.bpm || S.bpm);
  let other = 0;
  BK.items = [];
  // where each phrase is used
  const uses = new Map();
  for (const [n, d] of r.tracks) { const p = bkSplit(lines[d.line]); if (p) for (const m of p.pat.matchAll(/\$([A-Za-z_]\w*)/g)) { if (!uses.has(m[1])) uses.set(m[1], []); if (!uses.get(m[1]).some(u => u.name === n)) uses.get(m[1]).push({ name: n, def: d }); } }
  const phrases = [...uses.keys()];
  lines.forEach((ln, i) => {
    const p = bkSplit(ln);
    if (p && p.let) {
      // a phrase: a piece made once and used many times
      const us = uses.get(p.name) || [], d0 = us[0] && us[0].def, kind = d0 ? d0.kind : /x/i.test(p.pat) ? 'drum' : 'synth';
      const key = '$' + p.name, L = { i, name: p.name, key, kind, phrase: true, inst: d0 ? d0.inst : kind === 'drum' ? 'kick' : 'piano' };
      const g = bkLoad(L, p.pat, kind);
      BK.items.push(L);
      const body = g ? bkGridHTML(L, null, d0) : `<div class="bk-chip"><code>${esc(p.pat.trim())}</code><button class="bk-link" data-act="goto">${esc(t('bkInCode'))}</button></div>`;
      cards.push(`<article class="bk-card phrase" data-i="${i}" style="--tc:${bkHue(p.name)}">
        <header><span class="bk-ico" aria-hidden="true">🧩</span><span class="bk-nm"><b>$${esc(p.name)}</b><small>${esc(t('bkPhrase'))}</small></span><small class="bk-use">${esc(us.length ? t('bkPhraseUse', { list: us.map(u => u.name).join(', ') }) : t('bkPhraseNone'))}</small></header>
        ${r.errors.get(i) ? `<p class="bk-err">${esc(r.errors.get(i).msg)}</p>` : ''}${body}<p class="bk-why">${esc(t('bkPhraseHint'))}</p></article>`);
      return;
    }
    const name = r.lineNames.get(i), def = name && r.tracks.get(name);
    const err = r.errors.get(i);
    if (!def || def.line !== i) { if (stripComment(ln).trim() && !/^\s*(bpm|key|scale|swing|prog|scene|song|let)\b/.test(ln)) other++; return; }
    const kind = def.kind, key = name, L = { i, name, key, inst: def.inst, kind };
    const ci = r.order.indexOf(name), col = TRACK_COLORS[(ci < 0 ? 0 : ci) % TRACK_COLORS.length];
    BK.items.push(L);
    let body;
    const train = /^\s*(?:<\s*((?:\$[A-Za-z_]\w*\s*)+)>|(\$[A-Za-z_]\w*))\s*$/.exec(p.pat);
    if (train && kind !== 'loop') {
      // a track made of phrases, in order: the pieces as blocks
      L.train = (train[1] || train[2]).trim().split(/\s+/).map(s => s.slice(1));
      body = `<div class="bk-train" role="group" aria-label="${esc(t('bkTrainOf'))}">${L.train.map((n, j) => `<span class="bk-piece" style="--pc:${bkHue(n)}"><select data-piece="${j}" aria-label="${esc(t('bkPhrase'))} ${j + 1}">${[...new Set([...phrases, n])].map(x => `<option value="${esc(x)}"${x === n ? ' selected' : ''}>$${esc(x)}</option>`).join('')}</select>${L.train.length > 1 ? `<button class="bk-rx" data-pdel="${j}" aria-label="${esc(t('bkRuleDel'))}">×</button>` : ''}</span>`).join('')}<button class="bk-bar add" data-act="padd" aria-label="${esc(t('bkPhAdd'))}" title="${esc(t('bkPhAdd'))}">+</button></div>`;
    } else {
      if (kind !== 'loop' && bkLoad(L, p.pat, kind)) body = bkGridHTML(L, p, def);
      else body = `<div class="bk-chip"><code>${esc(p.pat.trim() || '—')}</code><button class="bk-link" data-act="goto">${esc(t('bkInCode'))}</button></div><p class="bk-why">${esc(t('bkComplex'))}</p>`;
    }
    const stickers = BK_STICKERS.map(s => ({ ...s, v: bkParam(p.params, s.k) })).filter(s => s.v !== undefined);
    const st = stickers.map(s => s.v === null
      ? `<span class="bk-stk code" title="${esc(t('bkStickerCode'))}"><b>${esc(t('bks_' + s.k))}</b><code>${esc(s.k)}</code></span>`
      : `<label class="bk-stk"><b>${esc(t('bks_' + s.k))}</b><input type="range" data-k="${s.k}" min="${s.log ? Math.log(s.min) : s.min}" max="${s.log ? Math.log(s.max) : s.max}" step="${s.log ? 0.01 : s.step}" value="${s.log ? Math.log(Math.max(s.min, s.v)) : s.v}"><code>${esc(s.k)} ${s.v}</code></label>`).join('');
    const missing = BK_STICKERS.filter(s => !stickers.some(x => x.k === s.k));
    L.rules = bkRules(p.params);
    const rules = L.rules.map((x, j) => bkRuleHTML(x, j, kind !== 'drum')).join('');
    const ruleAdd = `<select class="bk-addrule" data-act="rule" aria-label="${esc(t('bkAddRule'))}"><option value="">${esc(t('bkAddRule'))}</option>${BK_RULES.map(R => `<option value="${R.type}">${esc(t('bkr_' + R.type + '_opt'))}</option>`).join('')}</select>`;
    const m = S.muted.has(name), so = S.solo.has(name);
    cards.push(`<article class="bk-card${err ? ' bad' : ''}${m ? ' muted' : ''}${L.rules.length ? ' ruled' : ''}" data-i="${i}" style="--tc:${col}">
      <header><span class="bk-ico" aria-hidden="true">${BK_ICON(def.inst)}</span><span class="bk-nm"><b>${esc(name)}</b><small>${esc(bkName(def.inst))}</small></span>
        <button class="bk-tg${m ? ' on' : ''}" data-act="mute" aria-pressed="${m}" title="${esc(t('bkMute'))}">M</button><button class="bk-tg${so ? ' on' : ''}" data-act="solo" aria-pressed="${so}" title="${esc(t('bkSolo'))}">S</button><button class="bk-x" data-act="del" title="${esc(t('bkDel'))}" aria-label="${esc(t('bkDel'))} ${esc(name)}">×</button></header>
      ${err ? `<p class="bk-err">${esc(err.msg)}</p>` : ''}${body}
      <div class="bk-rules" title="${esc(t('bkRuleHint'))}">${rules}${ruleAdd}</div>
      <div class="bk-stks">${st}${missing.length ? `<span class="bk-addstk"><select data-act="stk" aria-label="${esc(t('bkAddSticker'))}"><option value="">${esc(t('bkAddSticker'))}</option>${missing.map(s => `<option value="${s.k}">${esc(t('bks_' + s.k))}</option>`).join('')}</select></span>` : ''}</div>
    </article>`);
  });
  // the top: tempo, key note, mood (bright, sad, or any other scale), chords
  const sc = BK.key.scale, roots = NOTE_NAMES.map((n, k) => `<option value="${k}"${k === BK.key.root ? ' selected' : ''}>${n}</option>`).join('');
  const moods = ['major', 'minor'].map(s => `<button class="bk-mood" data-scale="${s}" aria-pressed="${s === sc}">${esc(t('bkm_' + s))}</button>`).join('');
  const scales = Object.keys(SCALES).map(s => `<option value="${s}"${s === sc ? ' selected' : ''}>${esc(bkT('bkm_' + s, s))}</option>`).join('');
  const P = bkProg(lines), chords = bkChordList(BK.key);
  BK.prog = P;
  let chordRow;
  if (P.i < 0) chordRow = `<button class="bk-add" data-act="prognew">${esc(t('bkChordNew'))}</button>`;
  else if (!P.toks) chordRow = `<div class="bk-chip"><code>${esc(P.code)}</code><button class="bk-link" data-goto="${P.i}">${esc(t('bkInCode'))}</button></div>`;
  else chordRow = P.toks.map((v, j) => {
    const opts = chords.map(c => P.names ? c.name : c.deg);
    const list = [...chords.map(c => ({ v: P.names ? c.name : c.deg, l: c.name })), ...(opts.includes(v) ? [] : [{ v, l: /^-?\d+$/.test(v) ? (chords[mod(+v, chords.length)] || {}).name || v : v }])];
    return `<span class="bk-chord" data-j="${j}"><select data-chord="${j}" aria-label="${esc(t('bkChords'))} ${j + 1}">${list.map(o => `<option value="${esc(o.v)}"${o.v === v ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select>${P.toks.length > 1 ? `<button class="bk-rx" data-cdel="${j}" aria-label="${esc(t('bkRuleDel'))}">×</button>` : ''}</span>`;
  }).join('') + (P.toks.length < 16 ? `<button class="bk-bar add" data-act="chordadd" title="${esc(t('bkChordAdd'))}" aria-label="${esc(t('bkChordAdd'))}">+</button>` : '');
  // scenes and the song
  BK.scenes = [...r.scenes.values()].sort((a, b) => a.line - b.line); BK.song = r.song;
  const tracks = r.order;
  const sceneRows = BK.scenes.map(s => `<div class="bk-scene" data-scene="${esc(s.name)}"><b>${esc(s.name)}</b><span class="bk-sw">${tracks.map(n => { const on = s.all ? !s.exc.has(n) : s.inc.has(n); return `<button class="bk-tr${on ? ' on' : ''}" data-tr="${esc(n)}" aria-pressed="${on}">${esc(n)}</button>`; }).join('')}${[...s.fx].map(f => `<em>${esc(f)}</em>`).join('')}</span><button class="bk-rx" data-sdel="${esc(s.name)}" aria-label="${esc(t('bkSceneDel'))} ${esc(s.name)}">×</button></div>`).join('');
  const parts = r.song ? r.song.parts : [];
  const train = parts.map((pt, j) => `<span class="bk-car" data-car="${j}" style="--pc:${bkHue(pt.name)}"><select data-cf="name" aria-label="${esc(t('bkScenes'))}">${BK.scenes.map(s => `<option${s.name === pt.name ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select><select data-cf="bars" aria-label="${esc(t('bkBar'))}">${[...new Set([1, 2, 4, 8, 12, 16, 24, 32, pt.bars])].sort((a, b) => a - b).map(n => `<option value="${n}"${n === pt.bars ? ' selected' : ''}>${esc(t('bkBarsN', { n }))}</option>`).join('')}</select><span class="bk-carbtn"><button data-cmv="-1" aria-label="${esc(t('bkLeft'))}" ${j ? '' : 'disabled'}>◀</button><button data-cmv="1" aria-label="${esc(t('bkRight'))}" ${j < parts.length - 1 ? '' : 'disabled'}>▶</button><button data-cdel2="${j}" aria-label="${esc(t('bkRuleDel'))}">×</button></span></span>`).join('');
  const songBox = `<section class="bk-song"><h3>${esc(t('bkSong'))}</h3><p class="bk-why">${esc(t('bkSongHint'))}</p>
      ${sceneRows}<div class="bk-row2"><button class="bk-add" data-act="sceneadd">${esc(t('bkSceneAdd'))}</button></div>
      ${BK.scenes.length ? (r.song ? `<div class="bk-trainrow"><b>${esc(t('bkTrain'))}</b>${train}<button class="bk-bar add" data-act="caradd" aria-label="${esc(t('bkCarAdd'))}" title="${esc(t('bkCarAdd'))}">+</button></div>` : `<button class="bk-add" data-act="songnew">${esc(t('bkSongNew'))}</button>`) : ''}</section>`;
  boardEl.innerHTML = `<div class="bk-top">
      <label class="bk-tempo"><span aria-hidden="true">🐢</span><input type="range" id="bkBpm" min="60" max="180" step="1" value="${bpm}" aria-label="${esc(t('bkTempo'))}"><span aria-hidden="true">🐇</span><b>${bpm}</b></label>
      <span class="bk-key"><select id="bkRoot" aria-label="${esc(t('bkRoot'))}">${roots}</select><span class="seg">${moods}</span><select id="bkScale" aria-label="${esc(t('bkScale'))}">${scales}</select></span>
    </div>
    <div class="bk-chords"><b>${esc(t('bkChords'))}</b>${chordRow}</div>
    <div class="bk-cards">${cards.join('') || `<p class="bk-empty">${esc(t('bkEmpty'))}</p>`}</div>
    <div class="bk-pal"><b>${esc(t('bkAdd'))}</b>${BK_PALETTE.map(([n]) => `<button class="bk-add" data-add="${n}"><span aria-hidden="true">${BK_ICON(n)}</span>${esc(bkName(n))}</button>`).join('')}</div>
    ${songBox}
    ${other ? `<p class="bk-other">${esc(t('bkOther', { n: other }))}</p>` : ''}`;
  BK.step = -1; BK.nowSig = '';
}

// ---------- taps ----------
function bkLine(el) { const c = el.closest('.bk-card'); return c ? BK.items.find(l => l.i === +c.dataset.i) : null; }
// a drum step is off, on, or now and then (x?)
function bkSetDrum(L, k, v) {
  const j = L.page * BK_STEPS + k, tok = L.tok.slice(); tok[j] = v === 'x' && tok[j] === 'X' ? 'X' : v;
  L.tok = tok; bkWritePat(L);
}
const bkPaintDrum = (cell, v) => { cell.classList.toggle('on', v !== '.'); cell.classList.toggle('maybe', v === 'x?'); cell.setAttribute('aria-pressed', v !== '.'); };
function bkSetNote(L, k, v, len) {
  // edits stay inside the bar on show; a note cannot hold past the bar's end
  const off = L.page * BK_STEPS, bar = L.tok.slice(off, off + BK_STEPS);
  if (bar[k] !== '.' && bar[k] !== '_') { bar[k] = '.'; for (let j = k + 1; j < BK_STEPS && bar[j] === '_'; j++) bar[j] = '.'; }
  else if (bar[k] === '_') bar[k] = '.';
  if (v != null) {
    bar[k] = v;
    for (let j = 1; j < len && k + j < BK_STEPS; j++) { const w = bar[k + j]; bar[k + j] = '_'; if (w !== '.' && w !== '_') for (let q = k + j + 1; q < BK_STEPS && bar[q] === '_'; q++) bar[q] = '.'; }
    for (let q = k + Math.max(1, len); q < BK_STEPS && bar[q] === '_'; q++) bar[q] = '.';
  }
  const tok = L.tok.slice(); tok.splice(off, BK_STEPS, ...bar);
  L.tok = tok; bkWritePat(L);
}
function bkPaintMel(card, L) {
  // redraw one lane from L.tok without rebuilding the board (a drag is on)
  const off = L.page * BK_STEPS, tok = L.tok.slice(off, off + BK_STEPS), own = bkOwn(tok);
  card.querySelectorAll('.bk-row').forEach(row => row.querySelectorAll('.bk-cell').forEach(c => { const k = +c.dataset.k, hit = own[k] === row.dataset.v; c.classList.toggle('on', hit); c.classList.toggle('start', hit && tok[k] !== '_'); c.setAttribute('aria-pressed', hit); }));
}
function bkRuleEdit(L, j, field, value) {
  const r = L.rules[j]; if (!r) return;
  const nr = { ...r };
  if (field === 'n') nr.n = +value; else if (field === 'fn') nr.fn = value; else if (field === 'w') nr.w = value;
  else if (field === 'sp') { const [w, k] = value.split(' '); nr.w = w; nr.k = k; }
  bkWrite(L.i, p => { p.params = bkReplace(p.params, r, bkRuleText(nr)); });
}
function bkInit() {
  if (!boardEl) return;
  boardEl.addEventListener('pointerdown', e => {
    const cell = e.target.closest('.bk-cell'); if (!cell || e.button > 0) return;
    const L = bkLine(cell); if (!L || !L.tok) return;
    e.preventDefault(); BK.busy = true;
    const k = +cell.dataset.k;
    if (L.kind === 'drum') {
      const was = L.tok[L.page * BK_STEPS + k], v = was === '.' ? 'x' : was === 'x?' ? '.' : 'x?';
      BK.drag = { L, kind: 'drum', v, done: new Set([k]) };
      bkPaintDrum(cell, v); bkSetDrum(L, k, v);
    } else {
      const row = cell.closest('.bk-row'), v = row.dataset.v, starts = L.tok[L.page * BK_STEPS + k] === v;
      if (starts) { bkSetNote(L, k, null); BK.drag = null; }
      else { bkSetNote(L, k, v, 1); BK.drag = { L, kind: 'mel', k, v, len: 1 }; }
      bkPaintMel(cell.closest('.bk-card'), L);
    }
    boardEl.setPointerCapture && boardEl.setPointerCapture(e.pointerId);
  });
  boardEl.addEventListener('pointermove', e => {
    const d = BK.drag; if (!d) return;
    const el = document.elementFromPoint(e.clientX, e.clientY), cell = el && el.closest && el.closest('.bk-cell');
    if (!cell || bkLine(cell) !== d.L) return;
    const k = +cell.dataset.k;
    if (d.kind === 'drum') {
      if (d.done.has(k)) return; d.done.add(k);
      bkPaintDrum(cell, d.v); bkSetDrum(d.L, k, d.v);
    } else if (k >= d.k && k - d.k + 1 !== d.len) {
      d.len = k - d.k + 1; bkSetNote(d.L, d.k, d.v, d.len); bkPaintMel(cell.closest('.bk-card'), d.L);
    }
  });
  const end = () => { if (!BK.busy) return; BK.drag = null; BK.busy = false; bkRender(); };
  boardEl.addEventListener('pointerup', end); boardEl.addEventListener('pointercancel', end);
  boardEl.addEventListener('input', e => {
    const s = e.target;
    if (s.id === 'bkBpm') { s.parentElement.querySelector('b').textContent = s.value; BK.busy = true; return; }
    if (s.type !== 'range') return;
    const L = bkLine(s), spec = BK_STICKERS.find(x => x.k === s.dataset.k); if (!L || !spec) return;
    const v = spec.log ? Math.exp(+s.value) : +s.value;
    s.nextElementSibling.textContent = `${spec.k} ${v >= 100 ? Math.round(v) : +v.toFixed(2)}`;
    BK.busy = true; bkWrite(L.i, p => { p.params = bkSetParam(p.params, spec.k, v); }, { live: true });
  });
  boardEl.addEventListener('change', e => {
    const s = e.target;
    if (s.id === 'bkBpm') { BK.busy = false; writeBpm(+s.value); evaluate('bar'); bkRender(); return; }
    if (s.id === 'bkRoot') { bkKey(+s.value, BK.key.scale); return; }
    if (s.id === 'bkScale') { bkKey(BK.key.root, s.value); return; }
    if (s.dataset.chord != null) { const toks = BK.prog.toks.slice(); toks[+s.dataset.chord] = s.value; bkWriteProg(toks); return; }
    if (s.dataset.cf) {
      const j = +s.closest('.bk-car').dataset.car, parts = BK.song.parts.map(p => ({ name: p.name, bars: p.bars }));
      if (s.dataset.cf === 'name') parts[j].name = s.value; else parts[j].bars = +s.value;
      bkWriteSong(parts, BK.song.line); return;
    }
    const L = bkLine(s);
    if (L && s.dataset.piece != null) { const tr = L.train.slice(); tr[+s.dataset.piece] = s.value; bkWriteTrain(L, tr); return; }
    if (L && s.dataset.rf) { bkRuleEdit(L, +s.closest('.bk-rule').dataset.r, s.dataset.rf, s.value); return; }
    if (L && s.dataset.act === 'rule' && s.value) { const R = BK_RULES.find(x => x.type === s.value); let add = R.add; if (L.kind === 'drum' && /rev$/.test(add) && R.type === 'every') add = 'every 4 fast 2'; bkWrite(L.i, p => { p.params = (p.params == null ? ' ' : p.params.replace(/\s*$/, '') + ' ') + add; }); return; }
    if (L && s.dataset.act === 'stk' && s.value) { const spec = BK_STICKERS.find(x => x.k === s.value); if (spec) bkWrite(L.i, p => { p.params = bkSetParam(p.params, spec.k, spec.def); }); return; }
    if (s.type === 'range') { BK.busy = false; bkRender(); }
  });
  boardEl.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.add) { bkAdd(b.dataset.add); return; }
    if (b.dataset.scale) { bkKey(BK.key.root, b.dataset.scale); return; }
    if (b.dataset.goto != null) { bkGoto(+b.dataset.goto); return; }
    if (b.dataset.act === 'prognew') { const ch = bkChordList(BK.key), n = ch.length; bkWriteProg(n >= 7 ? ['0', '3', '4', '0'] : ['0', String(Math.min(3, n - 1)), '0', String(Math.min(2, n - 1))]); return; }
    if (b.dataset.act === 'chordadd') { const toks = BK.prog.toks.slice(); toks.push(toks[toks.length - 1]); bkWriteProg(toks); return; }
    if (b.dataset.cdel != null) { const toks = BK.prog.toks.slice(); toks.splice(+b.dataset.cdel, 1); bkWriteProg(toks); return; }
    if (b.dataset.tr) { const sc = BK.scenes.find(x => x.name === b.closest('.bk-scene').dataset.scene); bkSceneToggle(sc.line, b.dataset.tr, !b.classList.contains('on')); return; }
    if (b.dataset.sdel) { bkSceneDel(BK.scenes.find(x => x.name === b.dataset.sdel)); return; }
    if (b.dataset.act === 'sceneadd') { bkSceneAdd(BK.items.filter(x => !x.phrase).map(x => x.name)); return; }
    if (b.dataset.act === 'songnew') { bkWriteSong(BK.scenes.map(s => ({ name: s.name, bars: 8 })), -1); return; }
    if (b.dataset.act === 'caradd') { const ps = BK.song.parts.map(p => ({ name: p.name, bars: p.bars })); ps.push({ ...ps[ps.length - 1] }); bkWriteSong(ps, BK.song.line); return; }
    if (b.dataset.cmv) { const j = +b.closest('.bk-car').dataset.car, d = +b.dataset.cmv, ps = BK.song.parts.map(p => ({ name: p.name, bars: p.bars })); [ps[j], ps[j + d]] = [ps[j + d], ps[j]]; bkWriteSong(ps, BK.song.line); return; }
    if (b.dataset.cdel2 != null) { const ps = BK.song.parts.map(p => ({ name: p.name, bars: p.bars })); ps.splice(+b.dataset.cdel2, 1); if (ps.length) bkWriteSong(ps, BK.song.line); else { const lines = srcEl.value.split('\n'); lines.splice(BK.song.line, 1); srcEl.value = lines.join('\n'); bkApply(); } return; }
    const L = bkLine(b); if (!L) return;
    if (b.dataset.bar != null) { L.page = +b.dataset.bar; BK.pages.set(L.key, L.page); bkRender(); return; }
    if (b.dataset.act === 'baradd') {
      // a copy of the bar on show goes at the end; until it differs the code needs no change, so the card remembers it
      const bar = bkBarTok(L, L.page);
      L.tok = [...L.tok, ...bar]; L.orig.push(null); if (L.items) L.items.push(null); L.bars++;
      L.page = L.bars - 1; BK.pages.set(L.key, L.page); BK.minBars.set(L.key, L.bars);
      bkWritePat(L, false); bkSoon(); return;
    }
    if (b.dataset.act === 'bardel') {
      const pg = L.page;
      L.tok = L.tok.filter((_, j) => Math.floor(j / BK_STEPS) !== pg); L.orig.splice(pg, 1); if (L.items) L.items.splice(pg, 1); L.bars--;
      L.page = Math.max(0, pg - 1); BK.pages.set(L.key, L.page); BK.minBars.set(L.key, L.bars);
      bkWritePat(L, false); bkSoon(); return;
    }
    if (b.dataset.rx != null) { const r = L.rules[+b.dataset.rx]; bkWrite(L.i, p => { p.params = bkReplace(p.params, r, ''); }); return; }
    if (b.dataset.pdel != null) { const tr = L.train.slice(); tr.splice(+b.dataset.pdel, 1); bkWriteTrain(L, tr); return; }
    if (b.dataset.act === 'padd') { bkWriteTrain(L, [...L.train, L.train[L.train.length - 1]]); return; }
    if (b.dataset.act === 'mute') { toggleSet(S.muted, L.name); syncLoopVols(); render(); bkRender(); }
    else if (b.dataset.act === 'solo') { toggleSet(S.solo, L.name); syncLoopVols(); render(); bkRender(); }
    else if (b.dataset.act === 'del') bkDelete(L);
    else if (b.dataset.act === 'goto') bkGoto(L.i);
  });
  document.querySelectorAll('#viewbar [data-view]').forEach(b => b.addEventListener('click', () => bkView(b.dataset.view)));
  srcEl.addEventListener('input', () => { clearTimeout(BK.timer); BK.timer = setTimeout(() => { if (!BK.busy) bkRender(); }, 300); });
  let v = 'code'; try { v = localStorage.getItem('tactus-view') || 'code'; } catch (e) { }
  bkView(v, false);
}
function bkWriteTrain(L, names) {
  bkWrite(L.i, p => { const s = names.length > 1 ? `<${names.map(n => '$' + n).join(' ')}>` : '$' + names[0]; p.pat = bkFit(p.pat, s, p.params != null); });
}
function bkKey(root, scale) {
  const name = `${NOTE_NAMES[root]} ${scale}`, v = srcEl.value, re = /^(\s*key\s+)([^\n/]*?)(\s*(\/\/.*)?)$/m;
  // a separate scale line would win over the key's scale: it follows the choice too
  let s = re.test(v) ? v.replace(re, (m, a, b, c) => a + name + c) : (/^\s*bpm\b.*$/m.test(v) ? v.replace(/^(\s*bpm\b.*)$/m, `$1\nkey ${name}`) : `key ${name}\n` + v);
  s = s.replace(/^(\s*scale\s+)(\S+)/m, (m, a) => a + scale);
  srcEl.value = s;
  bkApply();
}
// a new line goes after the last track, before scenes and the song; scenes that list their tracks get it too
function codeAddTrack(name, line) {
  let lines = srcEl.value.split('\n');
  let at = lines.length; for (let j = lines.length - 1; j >= 0; j--) if (/^\s*(scene|song)\b/.test(lines[j])) at = j; else if (lines[j].trim() && !/^\s*\/\//.test(lines[j])) break;
  while (at > 0 && !lines[at - 1].trim()) at--;
  lines.splice(at, 0, line);
  lines = lines.map(l => {
    const m = /^(\s*scene\s+\S+\s+)([^|]*?)(\s*\|.*)?$/.exec(l);
    if (!m || /\ball\b/.test(m[2]) || new RegExp(`\\b${name}\\b`).test(m[2])) return l;
    return m[1] + m[2] + ' ' + name + (m[3] || '');
  });
  srcEl.value = lines.join('\n');
  return at;
}
function bkAdd(inst) {
  const [, pat] = BK_PALETTE.find(p => p[0] === inst);
  const taken = new Set(srcEl.value.split('\n').map(l => (HEAD_RE.exec(l) || [])[2]).filter(Boolean));
  let name = inst, n = 2; while (taken.has(name)) name = inst + n++;
  const at = codeAddTrack(name, `${name.padEnd(6)} ${pat}${name !== inst ? ' | ' + inst : ''}`);
  BK.flashLine = at;
  bkApply();
  requestAnimationFrame(() => { const card = boardEl.querySelector(`.bk-card[data-i="${at}"]`); if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
}
function bkDelete(L) {
  const orig = srcEl.value, lines = orig.split('\n');
  lines.splice(L.i, 1);
  // scenes that named it would point at nothing
  srcEl.value = lines.map(l => { const m = /^(\s*scene\s+\S+\s+)([^|]*?)(\s*\|.*)?$/.exec(l); return m ? m[1] + m[2].split(/\s+/).filter(w => w !== L.name && w !== '-' + L.name).join(' ') + (m[3] || '') : l; }).join('\n');
  bkApply();
  shareToast(t('bkDeleted', { n: L.name }), t('bkUndo'), () => { srcEl.value = orig; bkApply(); });
}
function bkGoto(i) {
  bkView('split');
  const lines = srcEl.value.split('\n'), pos = lines.slice(0, i).reduce((a, l) => a + l.length + 1, 0);
  srcEl.focus(); srcEl.setSelectionRange(pos, pos + lines[i].length);
  srcEl.scrollTop = Math.max(0, i * lineH - srcEl.clientHeight / 3);
}
function bkView(v, save = true) {
  if (!['code', 'blocks', 'split'].includes(v)) v = 'code';
  BK.view = v;
  const views = document.getElementById('views');
  views.dataset.view = v;
  document.querySelector('.editor').hidden = v === 'blocks';
  boardEl.hidden = v === 'code';
  document.querySelectorAll('#viewbar [data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === v));
  if (save) try { localStorage.setItem('tactus-view', v); } catch (e) { }
  if (v !== 'blocks') requestAnimationFrame(() => { measure(); render(); });
  bkRender();
}
// the playhead: the step being played lights up its column, on the bar page that is playing; the chord, the scene and
// the song part playing light up too
function bkTick(c) {
  if (BK.view === 'code' || !boardEl) return;
  const k = c < 0 ? -1 : Math.floor(mod(c, 1) * BK_STEPS), pb = c < 0 ? -1 : Math.floor(c - patOrigin(c) + 1e-9);
  const cur = c >= 0 ? sceneNameAt(c) : null, sig = `${k}|${pb}|${cur ? cur.name + (cur.part ? S.song.parts.indexOf(cur.part) : '') : ''}`;
  if (sig === BK.nowSig) return;
  BK.nowSig = sig;
  boardEl.querySelectorAll('.ph, .now').forEach(x => x.classList.remove('ph', 'now'));
  if (k < 0) return;
  for (const L of BK.items) {
    if (!L.tok) continue;
    const card = boardEl.querySelector(`.bk-card[data-i="${L.i}"]`); if (!card) continue;
    const bar = mod(pb, L.bars);
    if (L.bars > 1) { const tab = card.querySelector(`.bk-bar[data-bar="${bar}"]`); if (tab) tab.classList.add('now'); }
    if (bar === L.page) card.querySelectorAll(`.bk-cell[data-k="${k}"]`).forEach(x => x.classList.add('ph'));
  }
  if (BK.prog && BK.prog.toks) { const ch = boardEl.querySelector(`.bk-chord[data-j="${mod(pb, BK.prog.toks.length)}"]`); if (ch) ch.classList.add('now'); }
  if (cur) {
    const row = boardEl.querySelector(`.bk-scene[data-scene="${CSS.escape(cur.name)}"]`); if (row) row.classList.add('now');
    if (cur.part && S.song) { const car = boardEl.querySelector(`.bk-car[data-car="${S.song.parts.indexOf(cur.part)}"]`); if (car) car.classList.add('now'); }
  }
}
bkInit();
