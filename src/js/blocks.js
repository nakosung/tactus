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
var BK = { picks: [], view: 'code', busy: false, items: [], drag: null, flashLine: -1, step: -1, timer: 0, raf: 0, pages: new Map(), minBars: new Map(), brush: 1, sel: null, lastLen: new Map(), rowSpan: new Map(), clicks: (() => { try { return localStorage.getItem('tactus-bkclick') !== '0'; } catch (e) { return true; } })(), key: { root: 9, scale: 'minor' }, prog: null, song: null, scenes: [], synOpen: new Set(), unfold: new Set() };
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
  if (p.params != null) s += (/\s$/.test(s) ? '' : ' ') + '|' + p.params;
  if (p.comment) s += (/\s$/.test(s) ? '' : ' ') + p.comment;
  return s;
}
// What a melodic step can hold, as written: a degree (3), a chord on a degree (3^ is the triad built on 3, 3^7 adds
// the seventh), a note name (e5), a named chord (Am7), or several of these struck together (3,5 written [3,5]);
// a trailing ' is an accent. Degrees and note names make two kinds of lane, so a pattern uses one or the other.
const BK_DEG_RE = /^-?\d+(\^(7|9)?)?'*$/, BK_NAME_RE = /^[a-g][#b]?\d'*$/;
const bkAtomMode = a => BK_DEG_RE.test(a) ? 'deg' : BK_NAME_RE.test(a) || parseChord(a.replace(/'+$/, '')) ? 'name' : null;
// the pattern as 16 steps per bar, one bar or a few that repeat (the bars of <[...] [...]>); null when it does not fit.
// A drum line is a value per step (x, X, x?, or a number for how hard). A melody is a list of notes, each with its
// start step, its length in steps and its written value ("3^", "c5", "Am7'"); notes may overlap and differ in length.
function bkGrid(patSrc, kind) {
  const src = patSrc.trim();
  if (!src || /[~$]/.test(src)) return null;
  // x? (a hit that plays now and then) is random, so the bars would differ: read it as its own value instead
  let pat; try { pat = parseMini(kind === 'drum' ? src.replace(/([xX])\?(?![.\d])/g, 'q') : src, 0); } catch (e) { return null; }
  const bar = c => pat.q(c, c + 1).filter(e => e.v !== '~' && e.s >= c - 1e-9 && e.s < c + 1 - 1e-9);
  const sig = c => bar(c).map(e => `${e.v}@${((e.s - c) * BK_STEPS).toFixed(3)}+${(e.d * BK_STEPS).toFixed(3)}`).sort().join(' ');
  const sigs = Array.from({ length: 32 }, (_, c) => sig(c));
  const bars = [1, 2, 3, 4, 6, 8, 12, 16].find(P => sigs.every((s, c) => s === sigs[c % P]));
  if (!bars) return null;
  const drum = kind === 'drum', tok = drum ? Array(bars * BK_STEPS).fill('.') : null, notes = [];
  let lane = drum ? 'drum' : null;
  for (let b = 0; b < bars; b++) {
    for (const e of bar(b)) {
      const k = (e.s - b) * BK_STEPS, len = e.d * BK_STEPS, kk = Math.round(k), i = b * BK_STEPS + kk;
      if (Math.abs(k - kk) > 1e-6 || kk < 0 || kk >= BK_STEPS) return null;
      if (drum) {
        if (tok[i] !== '.' || !/^([xXq]|\d*\.?\d+)$/.test(e.v)) return null;   // two hits on one step, or something else
        tok[i] = e.v === 'q' ? 'x?' : e.v; continue;
      }
      // a note that holds into the next bar (<0^ 3^>/2) is code
      if (Math.abs(len - Math.round(len)) > 1e-6 || kk + Math.round(len) > BK_STEPS) return null;
      const m = bkAtomMode(e.v); if (!m || (lane && lane !== m)) return null; lane = m;
      notes.push({ s: i, len: Math.round(len), v: e.v });
    }
  }
  return drum ? { tok, bars, lane } : { notes, bars, lane: lane || 'deg' };
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
    const nm = vxNoteName(key.root + sc[d], flat).replace(/-?\d+$/, ''), R = nm[0].toUpperCase() + nm.slice(1), sev = n >= 7 ? iv(6) : 0;
    const q7 = q === '' ? (sev === 11 ? 'maj7' : '7') : q === 'm' ? (sev === 11 ? 'mM7' : 'm7') : q === 'dim' ? (sev === 9 ? 'dim7' : 'm7b5') : '7#5';
    out.push({ deg: String(d), name: R + q, seventh: R + q7 });
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
const bkInBar = (o, b) => Math.floor(o.s / BK_STEPS) === b;
// what a bar holds, to tell a bar that was edited from one that was not
const bkSig = (L, b) => L.tok ? bkBarTok(L, b).join(' ') : L.notes.filter(o => bkInBar(o, b)).map(o => `${o.s - b * BK_STEPS}+${o.len}:${o.v}`).sort().join(' ');
// a bar that repeats a shorter figure is written as the figure and a count: [0 2 4 7]*4, x*8
function bkRepeat(s) {
  const w = s.split(' '), n = w.length;
  for (let q = 1; q < n; q++) {
    if (n % q || w[0] === '_') continue;
    if (w.every((v, j) => v === w[j % q])) return q === 1 ? `${w[0]}*${n}` : `[${w.slice(0, q).join(' ')}]*${n / q}`;
  }
  return s;
}
// one bar of a melody. Notes that start and end together share a step ([c5,e5]); notes that overlap otherwise go on
// lines of their own, stacked: [c5 _ _ _ e5 _ _ _, g4 _ _ _ _ _ _ _]
function bkMelBar(L, b) {
  const groups = new Map();
  for (const o of L.notes) if (bkInBar(o, b)) { const k = o.s - b * BK_STEPS, id = k + '|' + o.len; if (!groups.has(id)) groups.set(id, { k, len: o.len, vs: [] }); groups.get(id).vs.push(o.v); }
  const voices = [];
  for (const g of [...groups.values()].sort((x, y) => x.k - y.k || y.len - x.len)) {
    let v = voices.find(v => v.end <= g.k); if (!v) voices.push(v = { end: 0, tok: Array(BK_STEPS).fill('.') });
    v.tok[g.k] = g.vs.join(','); for (let j = 1; j < g.len; j++) v.tok[g.k + j] = '_'; v.end = g.k + g.len;
  }
  if (!voices.length) voices.push({ tok: Array(BK_STEPS).fill('.') });
  const ss = voices.map(v => bkRepeat(vxBar(v.tok.map(x => x.includes(',') ? `[${x}]` : x), true)));
  return ss.length === 1 ? ss[0] : `[${ss.join(', ')}]`;
}
// write the pattern back: only the bars that changed are rewritten; the rest stay as they were written
function bkPatternOf(L) {
  const fresh = b => L.tok ? bkRepeat(vxBar(bkBarTok(L, b), false)) : bkMelBar(L, b);
  const bs = Array.from({ length: L.bars }, (_, b) => L.items && L.items.length === L.bars && L.items[b] != null && L.orig[b] === bkSig(L, b) ? L.items[b] : fresh(b));
  if (bs.every(s => s === bs[0]) && !(L.items && L.items.length === L.bars && L.bars > 1)) return bs[0];
  return `<${bs.map(s => /\s/.test(s) && !/^\[[^\]]*\]$/.test(s) ? `[${s}]` : s).join(' ')}>`;
}
function bkWritePat(L, live = true) { if (L.notes) bkSelKeep(L); bkWrite(L.i, p => { p.pat = p.let ? bkPatternOf(L) : bkFit(p.pat, bkPatternOf(L), p.params != null); }, { live }); }
// the grid of a line, with what bkPatternOf needs to keep untouched bars as written
function bkLoad(L, src, kind) {
  const g = bkGrid(src, kind); if (!g) return false;
  let tok = g.tok, notes = g.notes, bars = g.bars;
  const rep = n => { if (tok) tok = Array.from({ length: n }, () => tok).flat(); else notes = Array.from({ length: n }, (_, c) => notes.map(o => ({ ...o, s: o.s + c * bars * BK_STEPS }))).flat(); bars *= n; };
  const items = bkItems(src);
  // a pattern written as <a b c d> where the bars repeat still shows as its written bars
  if (items && items.length > bars && items.length <= BK_MAXBARS && items.length % bars === 0) rep(items.length / bars);
  // bars added here that are still copies of others
  const want = BK.minBars.get(L.key) || 0;
  if (want > bars && want % bars === 0) rep(want / bars);
  L.grid = true; L.tok = tok; L.notes = notes; L.bars = bars; L.lane = g.lane; L.mode = g.lane === 'drum' ? null : g.lane; L.items = items && items.length === bars ? items : null;
  L.orig = Array.from({ length: bars }, (_, b) => bkSig(L, b));
  L.page = Math.min(BK.pages.get(L.key) || 0, bars - 1);
  if (notes) bkSelLoad(L);
  return true;
}

// ---------- the selection (notes of one lane) ----------
// Kept as the notes themselves (start, length, value), so it survives the code being read again after an edit.
const bkNoteSig = o => `${o.s}|${o.len}|${o.v}`;
const bkSelOf = L => BK.sel && BK.sel.key === L.key ? BK.sel.set : new Set();
function bkSelSet(L, ids) { BK.sel = ids.length ? { key: L.key, set: new Set(ids), sigs: ids.map(j => bkNoteSig(L.notes[j])) } : null; }
function bkSelKeep(L) { if (BK.sel && BK.sel.key === L.key) BK.sel.sigs = [...BK.sel.set].filter(j => L.notes[j]).map(j => bkNoteSig(L.notes[j])); }
function bkSelLoad(L) {
  if (!BK.sel || BK.sel.key !== L.key) return;
  const want = BK.sel.sigs.slice(), set = new Set();
  L.notes.forEach((o, j) => { const q = want.indexOf(bkNoteSig(o)); if (q >= 0) { set.add(j); want.splice(q, 1); } });
  BK.sel.set = set;
}

// ---------- the board ----------
const boardEl = document.getElementById('board');
// The lane's rows. A degree lane counts in degrees of the song's scale; a note-name lane counts in MIDI notes and shows
// the scale's notes, plus any note the code spells its own way (g#5 in F major keeps that spelling, so lane and code agree).
// The span stays put once shown (only growing when a note goes past it), so adding a note never moves the rows under
// the pointer: about two octaves around the notes.
function bkScaleRows(L, nums) {
  const key = BK.key, sc = (SCALES[key.scale] || SCALES.major), n = sc.length, deg = L.mode === 'deg';
  const want = deg ? 15 : 25, most = deg ? 22 : 37;   // degrees, or semitones (about 15 notes of a 7-note scale)
  const lo0 = nums.length ? Math.min(...nums) : (deg ? 0 : 60), hi0 = nums.length ? Math.max(...nums) : (deg ? n : 72);
  let sp = BK.rowSpan.get(L.key + L.mode);
  if (sp && (lo0 < sp.lo || hi0 > sp.hi)) sp = Math.max(hi0, sp.hi) - Math.min(lo0, sp.lo) < most ? { lo: Math.min(lo0, sp.lo), hi: Math.max(hi0, sp.hi) } : null;
  if (!sp) { const lo = Math.floor((lo0 + hi0) / 2 - (want - 1) / 2); sp = { lo: Math.min(lo, lo0), hi: Math.max(lo + want - 1, hi0) }; }
  BK.rowSpan.set(L.key + L.mode, sp);
  if (deg) return Array.from({ length: sp.hi - sp.lo + 1 }, (_, j) => sp.hi - j).map(d => ({ n: d, midi: key.root + 12 * (L.oct + 1) + sc[mod(d, n)] + 12 * Math.floor(d / n) }));
  const rows = [];
  for (let m = sp.hi; m >= sp.lo; m--) if (sc.includes(mod(m - key.root, 12)) || L.spell.has(m)) rows.push({ n: m, midi: m, own: L.spell.get(m) });
  return rows;
}
// one written atom as the numbers it sounds: degrees in a degree lane, MIDI notes in a note-name lane (the chord
// tones as the engine builds them: 3^ is 3 5 7, Am7 sits in the track's octave)
function bkAtom(a, L) {
  const s = a.replace(/'+$/, '');
  if (L.mode === 'deg') {
    const m = /^(-?\d+)(\^(7|9)?)?$/.exec(s); if (!m) return [];
    const d = +m[1]; return !m[2] ? [d] : [d, d + 2, d + 4, ...(m[3] ? [d + 6] : []), ...(m[3] === '9' ? [d + 8] : [])];
  }
  return atomNotes(s, 0, 'major', BK_NAME_RE.test(s) ? 4 : L.oct, 0) || [];
}
const bkSpell = (L, m) => (L.spell && L.spell.get(m)) || vxNoteName(m, vxFlatKey(BK.key.root, BK.key.scale));
const bkAcc = v => (/'+$/.exec(v) || [''])[0];
// a chord written as one value (3^, Am7): its notes belong together and move as one
const bkIsChord = v => { const s = v.replace(/'+$/, ''); return /\^/.test(s) || (!BK_NAME_RE.test(s) && !/^-?\d+$/.test(s) && !!parseChord(s)); };
// a note of the key moved by some steps of the scale (a note outside the scale keeps its distance to the one below)
function bkScaleMove(m, dd) {
  const sc = SCALES[BK.key.scale] || SCALES.major, n = sc.length, at = x => BK.key.root + sc[mod(x, n)] + 12 * Math.floor(x / n);
  let D = Math.floor((m - BK.key.root) / 12) * n; while (at(D + 1) <= m) D++; while (at(D) > m) D--;
  return at(D + dd) + (m - at(D));
}
// a value moved up or down the lane by some rows (dr > 0 is down), or null when it would leave the lane. A chord
// moves as one: a degree chord moves its degree (3^ becomes 4^), a named chord moves its root and keeps its kind
function bkShiftV(L, v, dr, rows) {
  if (!dr) return v;
  const acc = bkAcc(v), s = v.slice(0, v.length - acc.length), at = new Map(rows.map((r, j) => [r.n, j]));
  if (L.mode === 'deg') { const m = /^(-?\d+)(.*)$/.exec(s), w = `${+m[1] - dr}${m[2]}`; return bkAtom(w, L).every(n => at.has(n)) ? w + acc : null; }
  const j = at.get(bkAtom(s, L)[0]), r = j == null ? null : rows[j + dr]; if (!r) return null;
  return BK_NAME_RE.test(s) ? bkSpell(L, r.n) + acc : bkLabel(r.n).replace(/-?\d+$/, '') + s.replace(/^[A-G][#b]?/, '') + acc;
}
// a new note from a row, or with the chord brush a chord built on it: d^ on a degree, the key's chord on a note
// (a named chord sits in the track's octave, wherever it was put)
function bkBrushVal(L, n) {
  if (BK.brush < 3) return L.mode === 'deg' ? String(n) : bkSpell(L, n);
  const q = BK.brush === 4 ? '7' : '';
  if (L.mode === 'deg') return `${n}^${q}`;
  const c = bkChordList(BK.key).find(c => mod(atomNotes(c.name, 0, 'major', 4, 0)[0] - n, 12) === 0);
  return c ? (q ? c.seventh : c.name) : bkLabel(n).replace(/-?\d+$/, '') + q;
}
// the length a new note takes: the last one set here, or the lane's most common
function bkDefLen(L) {
  if (BK.lastLen.has(L.key)) return BK.lastLen.get(L.key);
  const c = new Map(); for (const o of L.notes) c.set(o.len, (c.get(o.len) || 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] || 2;
}
// note names as the key spells them (G# in A major, Ab in F minor)
const bkLabel = midi => { const s = vxNoteName(midi, vxFlatKey(BK.key.root, BK.key.scale)); return s[0].toUpperCase() + s.slice(1); };
// a chord step's name: with no chord progression, the chord of the key (3^ in C major is F); with one, a Roman
// numeral, since the chord then moves with the progression
const BK_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
function bkChordLabel(v) {
  const s = v.replace(/'+$/, ''), m = /^(-?\d+)\^(\d*)$/.exec(s); if (!m) return s;
  const n = (SCALES[BK.key.scale] || SCALES.major).length, d = +m[1], q = m[2];
  if (BK.prog && BK.prog.i >= 0) return BK_ROMAN[mod(d, n)] + (d < 0 ? '↓' : d >= n ? '↑' : '') + ({ '7': '⁷', '9': '⁹' }[q] || q);
  const c = bkChordList(BK.key)[mod(d, n)]; return q ? c.seventh + (q === '9' ? '(9)' : '') : c.name;
}
// what a chord step can become: the key's chords on each degree, as triads and sevenths, in the octave it is in
function bkChordOpts(L, v) {
  const acc = (/'+$/.exec(v) || [''])[0], ch = bkChordList(BK.key), out = [];
  if (L.mode === 'deg') {
    const d0 = +/^-?\d+/.exec(v)[0], base = d0 - mod(d0, ch.length);
    ch.forEach((c, j) => { for (const q of ['', '7']) { const w = `${base + j}^${q}${acc}`; out.push({ v: w, l: bkChordLabel(w) }); } });
  } else for (const c of ch) for (const nm of [c.name, c.seventh]) out.push({ v: nm + acc, l: nm });
  if (!out.some(o => o.v === v)) out.push({ v, l: bkChordLabel(v) });
  return out;
}
// one quiet "+" per card, for everything that can be added to it: a rule, a sticker, another bar
function bkMoreMenu(L, missing) {
  const g = (label, opts) => opts.length ? `<optgroup label="${esc(label)}">${opts.join('')}</optgroup>` : '';
  const rules = missing ? BK_RULES.map(R => `<option value="r:${R.type}">${esc(t('bkr_' + R.type + '_opt'))}</option>`) : [];
  const sts = missing ? missing.map(x => `<option value="s:${x.k}">${esc(t('bks_' + x.k))}</option>`) : [];
  const bar = L.grid && L.bars < BK_MAXBARS ? [`<option value="bar">${esc(t('bkBarAdd'))}</option>`] : [];
  if (!rules.length && !sts.length && !bar.length) return '';
  return `<select class="bk-more" data-act="more" aria-label="${esc(t('bkMore'))}"><option value="">＋ ${esc(t('bkMore'))}</option>${g(t('bkRules'), rules)}${g(t('bkStickers'), sts)}${g(t('bkBars'), bar)}</select>`;
}
// ---------- pick buttons and their menu ----------
// A chord, a phrase piece, a song part's scene or length: a button that opens a short list. (A native select opens
// the moment the mouse goes down, which leaves no room for the drag that moves the item.)
function bkPick(cls, label, aria, opts, cur, apply) {
  const id = BK.picks.length; BK.picks.push({ opts, cur, apply });
  return `<button class="bk-pick ${cls}" data-pick="${id}" aria-haspopup="listbox" aria-label="${esc(aria)}">${esc(label)}</button>`;
}
function bkMenuClose() { const m = document.getElementById('bkMenu'); if (m) m.remove(); document.removeEventListener('pointerdown', bkMenuOutside, true); }
function bkMenuOutside(e) { const m = document.getElementById('bkMenu'); if (m && !m.contains(e.target)) bkMenuClose(); }
function bkMenu(btn) {
  bkMenuClose();
  const P = BK.picks[+btn.dataset.pick]; if (!P) return;
  const m = document.createElement('div'); m.id = 'bkMenu'; m.className = 'bk-menu'; m.setAttribute('role', 'listbox');
  m.innerHTML = P.opts.map(o => `<button role="option" data-v="${esc(o.v)}" aria-selected="${o.v === P.cur}">${esc(o.l)}</button>`).join('');
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + 'px';
  m.style.top = (r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
  m.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { bkClick('on'); bkMenuClose(); P.apply(b.dataset.v); } });
  m.addEventListener('keydown', e => {
    const bs = [...m.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
    if (e.key === 'Escape') { bkMenuClose(); btn.focus(); }
    else if (/^Arrow(Down|Up)$/.test(e.key)) { e.preventDefault(); bs[Math.max(0, Math.min(bs.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus(); }
  });
  (m.querySelector('[aria-selected="true"]') || m.querySelector('button')).focus();
  setTimeout(() => document.addEventListener('pointerdown', bkMenuOutside, true));
}
function bkGridHTML(L, p, def) {
  const pg = L.page, off = pg * BK_STEPS;
  const tabs = L.bars < 2 ? '' : `<div class="bk-bars" role="group" aria-label="${esc(t('bkBar'))}">${Array.from({ length: L.bars }, (_, b) => `<button class="bk-bar${b === pg ? ' sel' : ''}" data-bar="${b}" aria-pressed="${b === pg}">${b + 1}</button>`).join('')}${L.bars < BK_MAXBARS ? `<button class="bk-bar add" data-act="baradd" title="${esc(t('bkBarAdd'))}" aria-label="${esc(t('bkBarAdd'))}">+</button>` : ''}${L.bars > 1 ? `<button class="bk-bar del" data-act="bardel" title="${esc(t('bkBarDel'))}" aria-label="${esc(t('bkBarDel'))}">−</button>` : ''}<span class="bk-barlbl">${esc(t('bkBar'))}</span></div>`;
  if (L.kind === 'drum') {
    const tok = L.tok.slice(off, off + BK_STEPS);
    return tabs + `<div class="bk-steps">${tok.map((v, k) => `<button class="bk-cell${v !== '.' ? ' on' : ''}${v === 'X' ? ' acc' : ''}${v === 'x?' ? ' maybe' : ''}" data-k="${k}" aria-label="${k + 1}${v === 'x?' ? ' ' + esc(t('bkMaybe')) : ''}" aria-pressed="${v !== '.'}" title="${esc(t('bkTapHint'))}"></button>`).join('')}</div>` + bkVelHTML(L, new Set(tok.map((v, k) => v !== '.' ? k : -1)));
  }
  // the octave the track really plays in, so the lane's note names (and where a named chord sits) are true
  L.oct = Math.round((p && bkParam(p.params, 'oct')) ?? (def && INST[def.inst] && INST[def.inst].oct) ?? 4);
  L.spell = new Map();
  if (L.mode === 'name') for (const o of L.notes) { const s = o.v.replace(/'+$/, ''); if (BK_NAME_RE.test(s)) L.spell.set(atomNotes(s, 0, 'major', 4, 0)[0], s); }
  // rows hold still while a drag is on, so the lane does not move under the pointer
  const rows = BK.drag && BK.drag.L === L && BK.drag.rows ? BK.drag.rows : bkScaleRows(L, [...new Set(L.notes.flatMap(o => bkAtom(o.v, L)))]);
  L.rows = rows;
  const sel = bkSelOf(L);
  const selbar = sel.size ? `<span class="bk-selbar" role="group"><b>${esc(t('bkSelN', { n: sel.size }))}</b><button data-act="seldup">${esc(t('bkSelDup'))}</button><button data-act="seldel">${esc(t('bkSelDel'))}</button><button data-act="selnone" aria-label="${esc(t('bkSelNone'))}" title="${esc(t('bkSelNone'))}">✕</button></span>` : '';
  // a new note can be one note or a chord built on it (the "brush")
  const brush = `<span class="bk-brush" role="radiogroup" aria-label="${esc(t('bkBrush'))}" title="${esc(t('bkBrushHint'))}">${[1, 3, 4].map(z => `<button role="radio" data-brush="${z}" aria-checked="${BK.brush === z}">${esc(t('bkBrush' + z))}</button>`).join('')}</span>`;
  // a chord written as one value gets its name above its notes, to swap for another chord, split into notes, or take out
  const chs = [];
  L.notes.forEach((o, j) => {
    if (o.s < off || o.s >= off + BK_STEPS || !bkIsChord(o.v)) return;
    const k = o.s - off, opts = [...bkChordOpts(L, o.v), { v: '\u0001loose', l: t('bkUnbind') }];
    chs.push(`<span class="bk-chl" style="grid-column:${k + 2} / span ${o.len}">${bkPick('chl', bkChordLabel(o.v), t('bkChordPick') + ' ' + (k + 1), opts, o.v, val => bkChordSet(L, j, val))}<button class="bk-rx" data-chdel="${j}" aria-label="${esc(t('bkRuleDel'))}">×</button></span>`);
  });
  const follow = chs.length && L.mode === 'deg' && BK.prog && BK.prog.i >= 0 ? `<p class="bk-why">${esc(t('bkSymFollow'))}</p>` : '';
  const onsets = new Set(L.notes.filter(o => o.s >= off && o.s < off + BK_STEPS).map(o => o.s - off));
  return `<div class="bk-tools">${tabs}${selbar}${brush}</div><div class="bk-roll" tabindex="0" aria-label="${esc(t('bkRollHint'))}" title="${esc(t('bkRollHint'))}">`
    + (chs.length ? `<div class="bk-row bk-chrow"><span></span>${chs.join('')}</div>` : '') + bkRollHTML(L, rows) + bkVelHTML(L, onsets) + `</div>` + follow;
}
// the piano roll: the rows' cells underneath, each note one block over the steps it holds. The notes of a chord
// written as one value are joined by a line, the root solid and the others lighter; a handle on a note's right
// end sets its length.
function bkRollHTML(L, rows) {
  const off = L.page * BK_STEPS, at = new Map(rows.map((r, j) => [r.n, j])), sel = bkSelOf(L);
  let h = '';
  rows.forEach((row, r) => {
    h += `<span class="bk-note" style="grid-area:${r + 1}/1">${esc(row.own ? row.own[0].toUpperCase() + row.own.slice(1) : bkLabel(row.midi))}</span>`;
    for (let k = 0; k < BK_STEPS; k++) h += `<i class="bk-c${(k >> 2) & 1 ? ' b' : ''}" style="grid-area:${r + 1}/${k + 2}" data-k="${k}" data-r="${r}"></i>`;
  });
  L.notes.forEach((o, j) => {
    if (o.s < off || o.s >= off + BK_STEPS) return;
    const k = o.s - off, ns = bkAtom(o.v, L), ch = bkIsChord(o.v), rs = ns.map(n => at.get(n)).filter(r => r != null);
    if (!rs.length) return;
    const cls = `bk-nt${ch ? ' ch' : ''}${sel.has(j) ? ' sel' : ''}${bkAcc(o.v) ? ' acc' : ''}`;
    if (ch && rs.length > 1) h += `<em class="bk-chln" style="grid-row:${Math.min(...rs) + 1}/${Math.max(...rs) + 2};grid-column:${k + 2}"></em>`;
    ns.forEach((n, q) => { const r = at.get(n); if (r != null) h += `<b class="${cls}${ch && q ? ' ghost' : ''}" style="grid-row:${r + 1};grid-column:${k + 2}/span ${o.len}" data-o="${j}" data-s="${o.s}" data-len="${o.len}" title="${esc(o.v)}"><i class="rs" data-rs="${j}"></i></b>`; });
  });
  const d = BK.drag;
  if (d && d.L === L && d.marq) { const [k0, k1, r0, r1] = d.marq; h += `<span class="bk-marq" style="grid-area:${r0 + 1}/${k0 + 2}/${r1 + 2}/${k1 + 3}"></span>`; }
  return `<div class="bk-pr" style="grid-template-rows:repeat(${rows.length},17px)">${h}</div>`;
}
// how hard each step plays: the vel value of the line, drawn as bars under the steps (taller is louder)
function bkVelHTML(L, onsets) {
  if (!L.pp) return '';
  const vv = bkVelRead(L), drum = L.kind === 'drum' ? ' drum' : '', lbl = drum ? '' : `<span class="bk-vlbl">${esc(t('bkVel'))}</span>`;
  if (!vv) return `<div class="bk-vel ro${drum}">${lbl}<span class="bk-vro">${esc(t('bkVelCode'))}</span></div>`;
  return `<div class="bk-vel${drum}" data-vel="1" title="${esc(t('bkVelHint'))}" aria-label="${esc(t('bkVel'))}">${lbl}${vv[L.page].map((v, k) => `<span class="bk-vb${onsets.has(k) ? ' on' : ''}" data-k="${k}"><i style="height:${Math.round(Math.max(0.04, Math.min(1, v)) * 100)}%"></i></span>`).join('')}</div>`;
}
// redraw one card's grid without rebuilding the board (a drag is on)
function bkFocusRoll() { if (!BK.focusRoll) return; const L = BK.items.find(x => x.key === BK.focusRoll), el = L && boardEl.querySelector(`.bk-card[data-i="${L.i}"] .bk-roll`); if (el) el.focus({ preventScroll: true }); }
function bkRedraw(L) { const box = boardEl.querySelector(`.bk-card[data-i="${L.i}"] .bk-gridbox`); if (box) box.innerHTML = bkGridHTML(L, L.pp, L.def); }

// ---------- velocity (the vel value) ----------
// a value after | as written, brackets and all: vel [1 .5]*8
function bkParamSpan(params, k) {
  if (params == null) return null;
  const m = new RegExp(`(^|\\s)${k}\\s+`).exec(params); if (!m) return null;
  const i = m.index + m[0].length; let j = i, depth = 0;
  for (; j < params.length; j++) { const ch = params[j]; if ('[<('.includes(ch)) depth++; else if (']>)'.includes(ch)) depth--; else if (/\s/.test(ch) && depth <= 0) break; }
  return { a: m.index + m[1].length, b: j, raw: params.slice(i, j) };
}
const BK_NUM = /^-?(\d+\.?\d*|\.\d+)$/;
// for each bar of the line, the 16 steps' vel; null when vel is something the lane cannot show (a knob, random)
function bkVelRead(L) {
  const sp = bkParamSpan(L.pp && L.pp.params, 'vel'), fill = v => Array.from({ length: L.bars }, () => Array(BK_STEPS).fill(v));
  if (!sp) return fill(1);
  if (BK_NUM.test(sp.raw)) return fill(+sp.raw);
  let pat; try { pat = parseMini(sp.raw, 0); } catch (e) { return null; }
  const out = [];
  for (let b = 0; b < L.bars; b++) {
    // the value in force at each step (a query returns what starts in it, so look back for long values)
    const evs = pat.q(b - 8, b + 1).filter(e => e.v !== '~'), row = [];
    for (let k = 0; k < BK_STEPS; k++) { const c = b + k / BK_STEPS + 1e-6, e = evs.find(e => e.s <= c && c < e.s + e.d); if (!e || !BK_NUM.test(e.v)) return null; row.push(+e.v); }
    out.push(row);
  }
  return out;
}
// steps' vel written back as short as it goes: one number, a figure that repeats, or a value per step
function bkVelText(vals) {
  const bar = row => {
    let w = row.map(v => bkNum(Math.round(v * 100) / 100));
    while (w.length > 1 && w.length % 2 === 0 && w.every((x, j) => j % 2 || x === w[j + 1])) w = w.filter((_, j) => j % 2 === 0);
    return w.length === 1 ? w[0] : bkRepeat(w.join(' '));
  };
  const bs = vals.map(bar), wrap = s => /\s/.test(s) && !/^\[[^\]]*\]$/.test(s) ? `[${s}]` : s;
  if (bs.every(s => s === bs[0])) return bs[0] === '1' ? null : wrap(bs[0]);
  return `<${bs.map(wrap).join(' ')}>`;
}
function bkVelWrite(L, vals, live) {
  const txt = bkVelText(vals);
  bkWrite(L.i, p => {
    const sp = bkParamSpan(p.params, 'vel');
    if (txt == null) { if (sp) { const r = (p.params.slice(0, sp.a).replace(/\s+$/, '') + ' ' + p.params.slice(sp.b).replace(/^\s+/, '')).replace(/\s+$/, ''); p.params = r.trim() ? r : null; } }
    else if (sp) p.params = p.params.slice(0, sp.a) + 'vel ' + txt + p.params.slice(sp.b);
    else p.params = (p.params == null ? ' ' : p.params.replace(/\s*$/, '') + ' ') + 'vel ' + txt;
  }, { live });
}
function bkRender() {
  if (!boardEl || BK.view === 'code') return;
  const text = srcEl.value, r = compile(text), lines = text.split('\n'), cards = [];
  // the code's key and tempo, which may be waiting for the next bar to be heard
  BK.key = { root: r.key ? r.key.root : S.root, scale: r.scale || (r.key ? r.key.scale : S.scale) };
  const bpm = Math.round(r.bpm || S.bpm);
  let other = 0;
  BK.items = []; BK.picks = []; bkMenuClose();
  // where each phrase is used
  const uses = new Map();
  for (const [n, d] of r.tracks) { const p = bkSplit(lines[d.line]); if (p) for (const m of p.pat.matchAll(/\$([A-Za-z_]\w*)/g)) { if (!uses.has(m[1])) uses.set(m[1], []); if (!uses.get(m[1]).some(u => u.name === n)) uses.get(m[1]).push({ name: n, def: d }); } }
  const phrases = [...uses.keys()];
  lines.forEach((ln, i) => {
    const p = bkSplit(ln);
    if (p && p.let) {
      // a phrase: a piece made once and used many times
      const us = uses.get(p.name) || [], d0 = us[0] && us[0].def, kind = d0 ? d0.kind : /x/i.test(p.pat) ? 'drum' : 'synth';
      const key = '$' + p.name, L = { i, name: p.name, key, kind, phrase: true, inst: d0 ? d0.inst : kind === 'drum' ? 'kick' : 'piano', def: d0, pp: null };
      const g = bkLoad(L, p.pat, kind);
      BK.items.push(L);
      const body = g ? `<div class="bk-gridbox">${bkGridHTML(L, null, d0)}</div>` : `<div class="bk-chip"><code>${esc(p.pat.trim())}</code><button class="bk-link" data-act="goto">${esc(t('bkInCode'))}</button></div>`;
      cards.push(`<article class="bk-card phrase" data-i="${i}" data-sort="card" style="--tc:${bkHue(p.name)}">
        <header><span class="bk-ico" aria-hidden="true">🧩</span><span class="bk-nm"><b>$${esc(p.name)}</b><small>${esc(t('bkPhrase'))}</small></span><small class="bk-use">${esc(us.length ? t('bkPhraseUse', { list: us.map(u => u.name).join(', ') }) : t('bkPhraseNone'))}</small></header>
        ${r.errors.get(i) ? `<p class="bk-err">${esc(r.errors.get(i).msg)}</p>` : ''}${body}<div class="bk-foot"><p class="bk-why">${esc(t('bkPhraseHint'))}</p>${L.grid ? bkMoreMenu(L, null) : ''}</div></article>`);
      return;
    }
    const name = r.lineNames.get(i), def = name && r.tracks.get(name);
    const err = r.errors.get(i);
    if (!def || def.line !== i) { if (stripComment(ln).trim() && !/^\s*(bpm|key|scale|swing|prog|scene|song|let)\b/.test(ln)) other++; return; }
    const kind = def.kind, key = name, L = { i, name, key, inst: def.inst, kind, def, pp: p };
    const ci = r.order.indexOf(name), col = TRACK_COLORS[(ci < 0 ? 0 : ci) % TRACK_COLORS.length];
    BK.items.push(L);
    let body;
    const train = /^\s*(?:<\s*((?:\$[A-Za-z_]\w*\s*)+)>|(\$[A-Za-z_]\w*))\s*$/.exec(p.pat);
    if (train && kind !== 'loop') {
      // a track made of phrases, in order: the pieces as blocks
      L.train = (train[1] || train[2]).trim().split(/\s+/).map(s => s.slice(1));
      body = `<div class="bk-train" role="group" aria-label="${esc(t('bkTrainOf'))}">${L.train.map((n, j) => `<span class="bk-piece" data-sort="piece" style="--pc:${bkHue(n)}">${bkPick('piece', '$' + n, t('bkPhrase') + ' ' + (j + 1), [...new Set([...phrases, n])].map(x => ({ v: x, l: '$' + x })), n, val => { const tr = L.train.slice(); tr[j] = val; bkWriteTrain(L, tr); })}${L.train.length > 1 ? `<button class="bk-rx" data-pdel="${j}" aria-label="${esc(t('bkRuleDel'))}">×</button>` : ''}</span>`).join('')}<button class="bk-bar add" data-act="padd" aria-label="${esc(t('bkPhAdd'))}" title="${esc(t('bkPhAdd'))}">+</button></div>`;
    } else {
      if (kind !== 'loop' && bkLoad(L, p.pat, kind)) body = `<div class="bk-gridbox">${bkGridHTML(L, p, def)}</div>`;
      else body = `<div class="bk-chip"><code>${esc(p.pat.trim() || '—')}</code><button class="bk-link" data-act="goto">${esc(t('bkInCode'))}</button></div><p class="bk-why">${esc(t('bkComplex'))}</p>`;
    }
    const stickers = BK_STICKERS.map(s => ({ ...s, v: bkParam(p.params, s.k) })).filter(s => s.v !== undefined);
    const st = stickers.map(s => s.v === null
      ? `<span class="bk-stk code" title="${esc(t('bkStickerCode'))}"><b>${esc(t('bks_' + s.k))}</b><code>${esc(s.k)}</code></span>`
      : `<label class="bk-stk"><b>${esc(t('bks_' + s.k))}</b><input type="range" data-k="${s.k}" min="${s.log ? Math.log(s.min) : s.min}" max="${s.log ? Math.log(s.max) : s.max}" step="${s.log ? 0.01 : s.step}" value="${s.log ? Math.log(Math.max(s.min, s.v)) : s.v}"><code>${esc(s.k)} ${s.v}</code></label>`).join('');
    const missing = BK_STICKERS.filter(s => !stickers.some(x => x.k === s.k));
    L.rules = bkRules(p.params);
    const rules = L.rules.map((x, j) => bkRuleHTML(x, j, kind !== 'drum')).join('');
    const more = bkMoreMenu(L, missing);
    const syn = kind !== 'drum' && kind !== 'loop' && SYNTHS.includes(def.inst), synOpen = syn && BK.synOpen.has(name);
    const synBtn = syn ? `<button class="bk-synbtn" data-act="syn" aria-expanded="${synOpen}">〰 ${esc(t('bkSyn'))}</button>` : '';
    const m = S.muted.has(name), so = S.solo.has(name);
    // on a phone the cards are folded to their name row; one tap opens a card
    const fold = document.body.classList.contains('mob') && !BK.unfold.has(name);
    cards.push(`<article class="bk-card${fold ? ' fold' : ''}${err ? ' bad' : ''}${m ? ' muted' : ''}${L.rules.length ? ' ruled' : ''}" data-i="${i}" data-sort="card" style="--tc:${col}">
      <header><span class="bk-ico" aria-hidden="true">${BK_ICON(def.inst)}</span><span class="bk-nm"><b>${esc(name)}</b><small>${esc(bkName(def.inst))}</small></span>
        <button class="bk-fold" data-act="fold" aria-expanded="${!fold}" aria-label="${esc(t(fold ? 'bkUnfold' : 'bkFold'))} ${esc(name)}">${fold ? '▸' : '▾'}</button><button class="bk-tg${m ? ' on' : ''}" data-act="mute" aria-pressed="${m}" title="${esc(t('bkMute'))}">M</button><button class="bk-tg${so ? ' on' : ''}" data-act="solo" aria-pressed="${so}" title="${esc(t('bkSolo'))}">S</button><button class="bk-x" data-act="del" title="${esc(t('bkDel'))}" aria-label="${esc(t('bkDel'))} ${esc(name)}">×</button></header>
      ${err ? `<p class="bk-err">${esc(err.msg)}</p>` : ''}${body}${synOpen ? bkSynHTML(L) : ''}
      <div class="bk-foot">${synBtn}${rules ? `<span class="bk-rules" title="${esc(t('bkRuleHint'))}">${rules}</span>` : ''}${st}${more}</div>
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
    return `<span class="bk-chord" data-j="${j}" data-sort="chord">${bkPick('chord', (list.find(o => o.v === v) || { l: v }).l, t('bkChords') + ' ' + (j + 1), list, v, val => { const toks = BK.prog.toks.slice(); toks[j] = val; bkWriteProg(toks); })}${P.toks.length > 1 ? `<button class="bk-rx" data-cdel="${j}" aria-label="${esc(t('bkRuleDel'))}">×</button>` : ''}</span>`;
  }).join('') + (P.toks.length < 16 ? `<button class="bk-bar add" data-act="chordadd" title="${esc(t('bkChordAdd'))}" aria-label="${esc(t('bkChordAdd'))}">+</button>` : '');
  // scenes and the song
  BK.scenes = [...r.scenes.values()].sort((a, b) => a.line - b.line); BK.song = r.song;
  const tracks = r.order;
  const sceneRows = BK.scenes.map(s => `<div class="bk-scene" data-scene="${esc(s.name)}"><b>${esc(s.name)}</b><span class="bk-sw">${tracks.map(n => { const on = s.all ? !s.exc.has(n) : s.inc.has(n); return `<button class="bk-tr${on ? ' on' : ''}" data-tr="${esc(n)}" aria-pressed="${on}">${esc(n)}</button>`; }).join('')}${[...s.fx].map(f => `<em>${esc(f)}</em>`).join('')}</span><button class="bk-rx" data-sdel="${esc(s.name)}" aria-label="${esc(t('bkSceneDel'))} ${esc(s.name)}">×</button></div>`).join('');
  const parts = r.song ? r.song.parts : [];
  const train = parts.map((pt, j) => `<span class="bk-car" data-car="${j}" data-sort="car" style="--pc:${bkHue(pt.name)};width:${Math.min(320, 150 + pt.bars * 4)}px">${bkPick('carname', pt.name, t('bkScenes'), BK.scenes.map(s => ({ v: s.name, l: s.name })), pt.name, val => { const ps = parts.map(p => ({ name: p.name, bars: p.bars })); ps[j].name = val; bkWriteSong(ps, BK.song.line); })}<span class="bk-carbars" data-bars="${pt.bars}">${bkPick('carbars', t('bkBarsN', { n: pt.bars }), t('bkBar'), [...new Set([1, 2, 4, 8, 12, 16, 24, 32, pt.bars])].sort((a, b) => a - b).map(n => ({ v: String(n), l: t('bkBarsN', { n }) })), String(pt.bars), val => { const ps = parts.map(p => ({ name: p.name, bars: p.bars })); ps[j].bars = +val; bkWriteSong(ps, BK.song.line); })}</span><button class="bk-rx" data-cdel2="${j}" aria-label="${esc(t('bkRuleDel'))}">×</button><span class="bk-car-rs" title="${esc(t('bkCarResize'))}" aria-hidden="true"></span></span>`).join('');
  const songBox = `<section class="bk-song"><h3>${esc(t('bkSong'))}</h3><p class="bk-why">${esc(t('bkSongHint'))}</p>
      ${sceneRows}<div class="bk-row2"><button class="bk-add" data-act="sceneadd">${esc(t('bkSceneAdd'))}</button></div>
      ${BK.scenes.length ? (r.song ? `<div class="bk-trainrow"><b>${esc(t('bkTrain'))}</b>${train}<button class="bk-bar add" data-act="caradd" aria-label="${esc(t('bkCarAdd'))}" title="${esc(t('bkCarAdd'))}">+</button></div>` : `<button class="bk-add" data-act="songnew">${esc(t('bkSongNew'))}</button>`) : ''}</section>`;
  boardEl.innerHTML = `<p class="bk-hint">${esc(t('bkHint'))}</p><div class="bk-top">
      <label class="bk-tempo"><span aria-hidden="true">🐢</span><input type="range" id="bkBpm" min="60" max="180" step="1" value="${bpm}" aria-label="${esc(t('bkTempo'))}"><span aria-hidden="true">🐇</span><b>${bpm}</b></label>
      <span class="bk-key"><select id="bkRoot" aria-label="${esc(t('bkRoot'))}">${roots}</select><span class="seg">${moods}</span><select id="bkScale" aria-label="${esc(t('bkScale'))}">${scales}</select></span>
      <button class="bk-snd" data-act="clicks" aria-pressed="${BK.clicks}" title="${esc(t('bkClicks'))}" aria-label="${esc(t('bkClicks'))}">${BK.clicks ? '🔊' : '🔈'}</button>
    </div>
    <div class="bk-chords"><b>${esc(t('bkChords'))}</b>${chordRow}</div>
    <div class="bk-cards">${cards.join('') || `<p class="bk-empty">${esc(t('bkEmpty'))}</p>`}</div>
    <div class="bk-pal"><b>${esc(t('bkAdd'))}</b>${BK_PALETTE.map(([n]) => `<button class="bk-add" data-add="${n}"><span aria-hidden="true">${BK_ICON(n)}</span>${esc(bkName(n))}</button>`).join('')}</div>
    ${songBox}
    ${other ? `<p class="bk-other">${esc(t('bkOther', { n: other }))}</p>` : ''}`;
  BK.step = -1; BK.nowSig = '';
  for (const L of BK.items) if (L.syn) bkSynDraw(L);
  bkFocusRoll();
}

// ---------- drag to reorder ----------
// Each sortable item carries data-sort (its kind) and a ⠿ handle. While dragging, the item it is over is marked; on
// release the order is written to the code (cards move their line; chords, pieces and song parts their place).
const bkBuzz = () => { try { navigator.vibrate && navigator.vibrate(12); } catch (e) { } };
// lift an armed item: it floats, and the next moves pick the place it goes to
function bkLift(arm) {
  const item = arm.item, box = item.parentElement, kind = item.dataset.sort;
  const items = [...box.children].filter(x => x.dataset && x.dataset.sort === kind);
  if (items.length < 2) { BK.drag = null; return; }
  bkClick('lift');
  BK.busy = true; BK.drag = { kind: 'sort', sort: kind, box, items, from: items.indexOf(item), to: items.indexOf(item), item };
  item.classList.add('sorting'); bkBuzz();
  try { boardEl.setPointerCapture(arm.id); } catch (e) { }
  if (document.activeElement && item.contains(document.activeElement)) document.activeElement.blur();
}
function bkSortMove(e) {
  const d = BK.drag, el = document.elementFromPoint(e.clientX, e.clientY), over = el && el.closest && el.closest(`[data-sort="${d.sort}"]`);
  if (!over || !d.items.includes(over)) return;
  d.to = d.items.indexOf(over);
  d.items.forEach(x => x.classList.toggle('drop-before', x === over && d.to < d.from));
  d.items.forEach(x => x.classList.toggle('drop-after', x === over && d.to > d.from));
}
function bkSortEnd(d) {
  d.items.forEach(x => x.classList.remove('sorting', 'drop-before', 'drop-after'));
  // the release of a lift is not a tap: the click it makes (on a select or a button) is swallowed
  if (d.kind === 'sort') { BK.noClick = performance.now() + 350; bkClick('drop'); }
  if (d.to === d.from) return;
  const move = arr => { const a = arr.slice(), [x] = a.splice(d.from, 1); a.splice(d.to, 0, x); return a; };
  if (d.sort === 'car') bkWriteSong(move(BK.song.parts.map(p => ({ name: p.name, bars: p.bars }))), BK.song.line);
  else if (d.sort === 'chord') bkWriteProg(move(BK.prog.toks));
  else if (d.sort === 'piece') { const L = bkLine(d.item); if (L) bkWriteTrain(L, move(L.train)); }
  else if (d.sort === 'card') {
    // a card's line moves next to the line of the card it was dropped on
    const lines = srcEl.value.split('\n'), a = +d.item.dataset.i, b = +d.items[d.to].dataset.i;
    const [ln] = lines.splice(a, 1);
    lines.splice(b, 0, ln);   // after the target when moving down (it shifted up by one), before it when moving up
    srcEl.value = lines.join('\n'); BK.flashLine = b; bkApply();
  }
}

// ---------- hearing it ----------
// Stopped, the roll plays like a keyboard: a note sounds when it is pressed and keeps sounding while held (up to a
// few seconds), and lets go with a short release when the pointer does. Each sounding goes through its own gain, so
// a new one never cuts the last off mid-sound: dragging a note to another pitch releases the old pitch over ~0.1 s
// while the new one starts (the way a hand slides along keys). Chords and several chosen notes sound together.
// Playing, the loop itself plays the change at the next bar, so nothing extra sounds.
const BK_AUD = new Set();
// press: what = [{ v, s }] (the value and its step in the line, so the step's vel applies), steps = the note's length
function bkPress(L, what, steps = 1) {
  if (!BK.clicks || !L || !L.def || S.playing || !what.length) return null;
  initAudio(); S.ctx.resume();
  // the line as it is now (a vel just changed in the code is already in S.tracks when stopped)
  const now0 = S.tracks.get(L.def.name), base = now0 && now0.line === L.def.line ? now0 : L.def, def = { ...base, name: '__pv' };
  if (!KIT.ready && (SAMPLE_PITCHED.has(def.inst) || SAMPLE_HITS.has(def.inst))) { const l = loadKit(); if (l) l.then(() => bkRelease(bkPress(L, what, steps))); return null; }
  for (const a of BK_AUD) bkRelease(a, true);
  const ctx = S.ctx, now = ctx.currentTime, cps = (S.bpm || 120) / 240, t0 = now + 0.02, r = pvStrip();
  const g = ctx.createGain(); g.connect(r.input);
  // scheduled long, and the release ends it sooner; a worklet voice (acid, mono, the engine) cannot be faded from here,
  // so it gets the note's own length instead
  const wk = WK.ok && ['acid', 'zither', 'mono', 'analog', 'wt', 'fmsynth'].includes(def.inst);
  const r2 = { ...r, input: g }, hold = wk ? Math.min(1, Math.max(steps / BK_STEPS, 0.22 * cps)) : Math.min(4, 3 * cps);
  try { for (const w of what.slice(0, 8)) pvPlayEvent(def, { v: w.v, s: w.s || 0, d: hold, loc: {} }, t0, cps, w.s || 0, r2, g); } catch (err) { }
  const a = { g, t0, min: Math.max(0.2, Math.min(0.8, steps / BK_STEPS / cps)) };
  BK_AUD.add(a); return a;
}
// let go: after at least the note's own length (so a quick tap still sounds like the note), or now when another takes over
function bkRelease(a, now) {
  if (!a || a.done) return; a.done = true; BK_AUD.delete(a);
  const t = Math.max(S.ctx.currentTime, now ? 0 : a.t0 + a.min);
  a.g.gain.setTargetAtTime(0, t, now ? 0.05 : 0.07);   // a slide overlaps the next pitch a little, so a slow-starting pad does not dip
  setTimeout(() => { try { a.g.disconnect(); } catch (e) { } }, (t - S.ctx.currentTime + 0.6) * 1000);
}
const bkHear = (L, v, steps = 1, s = 0) => bkRelease(bkPress(L, [{ v, s }], steps));
const bkWhat = (L, ids) => ids.map(j => L.notes[j]).filter(Boolean).map(o => ({ v: o.v, s: o.s / BK_STEPS }));
// a small sound for a press, in the skin's character: a light tick, a relay click, a bubble. Straight to the speakers,
// so it never lands in a recording; quieter while the music plays. The speaker button on the board turns it off.
function bkClick(kind = 'tap') {
  if (!BK.clicks || BK.view === 'code') return;
  try { initAudio(); } catch (e) { return; }
  const ctx = S.ctx; if (ctx.state !== 'running') ctx.resume();
  const skin = typeof skinNow === 'function' ? skinNow() : 'field', at = ctx.currentTime + 0.004;
  const f0 = { tap: 1, on: 1.25, off: 0.72, lift: 0.6, drop: 0.85 }[kind] || 1;
  const voice = { field: { type: 'triangle', f: 1800, to: 0.55, len: 0.035 }, studio: { type: 'square', f: 900, to: 0.5, len: 0.022 }, pop: { type: 'sine', f: 700, to: 1.9, len: 0.07 } }[skin] || { type: 'triangle', f: 1800, to: 0.55, len: 0.035 };
  const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(), lvl = (S.playing ? 0.025 : 0.05) * (skin === 'studio' ? 0.5 : 1);
  lp.type = 'lowpass'; lp.frequency.value = 6000;
  o.type = voice.type; o.frequency.setValueAtTime(voice.f * f0, at); o.frequency.exponentialRampToValueAtTime(voice.f * f0 * voice.to, at + voice.len);
  g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(lvl, at + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, at + voice.len + 0.02);
  o.connect(lp); lp.connect(g); g.connect(ctx.destination); o.start(at); o.stop(at + voice.len + 0.04);
}

// ---------- taps ----------
function bkLine(el) { const c = el.closest('.bk-card'); return c ? BK.items.find(l => l.i === +c.dataset.i) : null; }
// a drum step is off, on, or now and then (x?)
function bkSetDrum(L, k, v) {
  const j = L.page * BK_STEPS + k, tok = L.tok.slice(); tok[j] = v === 'x' && tok[j] === 'X' ? 'X' : v;
  L.tok = tok; bkWritePat(L);
}
const bkPaintDrum = (cell, v) => { cell.classList.toggle('on', v !== '.'); cell.classList.toggle('maybe', v === 'x?'); cell.setAttribute('aria-pressed', v !== '.'); };
// ---------- the piano roll's gestures ----------
// Tap an empty step: a note (or a chord, with the chord brush). Tap a note: it is chosen; tap it again: it goes.
// Drag a note: it moves (Alt: a copy moves); its right end: its length. Drag from an empty spot: a box chooses notes.
// Chosen notes move together, and the keyboard works on them too.
function bkGeom(L) {
  const box = boardEl.querySelector(`.bk-card[data-i="${L.i}"] .bk-pr`); if (!box) return null;
  return { cs: [...box.querySelectorAll('.bk-c[data-r="0"]')].map(c => c.getBoundingClientRect()), rs: [...box.querySelectorAll('.bk-c[data-k="0"]')].map(c => c.getBoundingClientRect()) };
}
const bkColAt = (g, x) => { let k = 0; g.cs.forEach((c, j) => { if (x >= c.left - 1.5) k = j; }); return k; };
const bkRowAt = (g, y) => { let r = 0; g.rs.forEach((c, j) => { if (y >= c.top - 1) r = j; }); return r; };
// notes moved by dk steps and dr rows, kept inside the bar and the lane (a move that would leave it goes as far as it can)
function bkMoved(L, base, ids, dk, dr, rows) {
  const off = L.page * BK_STEPS;
  for (const j of ids) { const o = base[j], k = o.s - off; dk = Math.max(dk, -k); dk = Math.min(dk, BK_STEPS - o.len - k); }
  for (; dr; dr -= Math.sign(dr)) if (ids.every(j => bkShiftV(L, base[j].v, dr, rows) != null)) break;
  return { dk, dr, out: ids.map(j => ({ ...base[j], s: base[j].s + dk, v: bkShiftV(L, base[j].v, dr, rows) })) };
}
function bkNotesPut(L, notes, sel) { L.notes = notes; bkSelSet(L, sel); bkWritePat(L); }
function bkRollDown(e, L, t0) {
  const g = bkGeom(L); if (!g) return;
  e.preventDefault(); BK.busy = true;
  const k = bkColAt(g, e.clientX), r = bkRowAt(g, e.clientY), base = L.notes.map(o => ({ ...o })), sel = bkSelOf(L), rows = L.rows;
  const rs = t0.closest('[data-rs]'), nt = t0.closest('.bk-nt'), at = { x0: e.clientX, y0: e.clientY };
  if (rs) {
    const j = +rs.dataset.rs; if (!sel.has(j)) bkSelSet(L, [j]);
    BK.drag = { kind: 'nlen', L, j, ids: [...bkSelOf(L)], base, g, rows, k0: k };
  } else if (nt) {
    const j = +nt.dataset.o;
    if (e.shiftKey) { const s2 = new Set(sel); if (s2.has(j)) s2.delete(j); else s2.add(j); bkSelSet(L, [...s2]); bkRedraw(L); BK.busy = false; return; }
    const again = sel.has(j) && sel.size === 1;
    if (!sel.has(j)) bkSelSet(L, [j]);
    const ids = [...bkSelOf(L)];
    BK.drag = { kind: 'nmove', L, j, ids, base, g, rows, k0: k, r0: r, ...at, copy: e.altKey, moved: false, again, dk: 0, dr: 0, aud: bkPress(L, bkWhat(L, ids), L.notes[j].len) };
    bkRedraw(L);
  } else {
    // an empty step sounds the note it would put in, at once; a drag turns it into a box instead and the sound lets go
    const row = rows[r], aud = row && !e.shiftKey ? bkPress(L, [{ v: bkBrushVal(L, row.n), s: (L.page * BK_STEPS + k) / BK_STEPS }], bkDefLen(L)) : null;
    BK.drag = { kind: 'marq', L, g, rows, k0: k, r0: r, ...at, started: false, keep: e.shiftKey ? [...sel] : [], aud };
  }
  boardEl.setPointerCapture && boardEl.setPointerCapture(e.pointerId);
}
function bkRollMove(e, d) {
  const L = d.L, off = L.page * BK_STEPS, k = bkColAt(d.g, e.clientX), r = bkRowAt(d.g, e.clientY);
  if (d.kind === 'nlen') {
    const dl = k - d.k0, notes = d.base.map(o => ({ ...o }));
    for (const j of d.ids) { const o = notes[j]; o.len = Math.max(1, Math.min(BK_STEPS - (o.s - off), d.base[j].len + dl)); }
    if (d.ids.every(j => notes[j].len === L.notes[j].len)) return;
    BK.lastLen.set(L.key, notes[d.j].len);
    bkNotesPut(L, notes, d.ids); bkRedraw(L);
  } else if (d.kind === 'nmove') {
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
    d.moved = true;
    const m = bkMoved(L, d.base, d.ids, k - d.k0, r - d.r0, d.rows);
    if (m.dk === d.dk && m.dr === d.dr && d.done) return;
    const pitch = m.dr !== d.dr; d.dk = m.dk; d.dr = m.dr; d.done = true;
    let notes, sel;
    if (d.copy) { notes = [...d.base, ...m.out]; sel = m.out.map((_, q) => d.base.length + q); }
    else { notes = d.base.map(o => ({ ...o })); d.ids.forEach((j, q) => { notes[j] = m.out[q]; }); sel = d.ids; }
    bkNotesPut(L, notes, sel); bkRedraw(L);
    // a new pitch: the old one lets go as the new one starts (all the moved notes, so a chord is heard as a chord)
    if (pitch) { bkRelease(d.aud, true); d.aud = bkPress(L, m.out.map(o => ({ v: o.v, s: o.s / BK_STEPS })), m.out[0].len); }
  } else if (d.kind === 'marq') {
    if (!d.started && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
    if (!d.started) bkRelease(d.aud, true);
    d.started = true;
    const k0 = Math.min(k, d.k0), k1 = Math.max(k, d.k0), r0 = Math.min(r, d.r0), r1 = Math.max(r, d.r0);
    d.marq = [k0, k1, r0, r1];
    const at = new Map(d.rows.map((x, j) => [x.n, j])), ids = new Set(d.keep);
    L.notes.forEach((o, j) => {
      const s = o.s - off; if (s < 0 || s >= BK_STEPS || s > k1 || s + o.len - 1 < k0) return;
      if (bkAtom(o.v, L).some(n => { const q = at.get(n); return q != null && q >= r0 && q <= r1; })) ids.add(j);
    });
    bkSelSet(L, [...ids]); bkRedraw(L);
  }
}
function bkRollEnd(d) {
  const L = d.L, off = L.page * BK_STEPS;
  bkRelease(d.aud);
  if (d.kind === 'nmove' && !d.moved) {
    // a tap on a note: the first chooses it (and plays it), the next takes it out
    if (d.again) { const notes = L.notes.filter((_, j) => j !== d.j); bkNotesPut(L, notes, []); bkClick('off'); }
  } else if (d.kind === 'marq' && !d.started) {
    // a tap on an empty step: a new note there, as long as the last one set (it stays chosen, so a second tap takes it out)
    const row = d.rows[d.r0]; if (!row) return;
    const len = Math.min(bkDefLen(L), BK_STEPS - d.k0), v = bkBrushVal(L, row.n);
    bkNotesPut(L, [...L.notes, { s: off + d.k0, len, v }], [L.notes.length]);
  } else if (d.kind === 'marq') d.marq = null;
}
// the keyboard on a focused roll: Delete, arrows (Shift: a beat or an octave's worth of rows), Ctrl/Cmd+A, Ctrl/Cmd+D, Escape
function bkRollKey(L, e) {
  const sel = [...bkSelOf(L)], mod2 = e.ctrlKey || e.metaKey, off = L.page * BK_STEPS;
  if (e.key === 'Escape') { bkSelSet(L, []); bkRedraw(L); return true; }
  if (mod2 && e.key.toLowerCase() === 'a') { bkSelSet(L, L.notes.map((o, j) => o.s >= off && o.s < off + BK_STEPS ? j : -1).filter(j => j >= 0)); bkRedraw(L); return true; }
  if (!sel.length) return false;
  if (e.key === 'Delete' || e.key === 'Backspace') { bkNotesPut(L, L.notes.filter((_, j) => !sel.includes(j)), []); bkClick('off'); bkRender(); return true; }
  if (mod2 && e.key.toLowerCase() === 'd') { bkDup(L, sel); return true; }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!arrows || mod2) return false;
  const big = e.shiftKey ? (arrows[0] ? 4 : (L.mode === 'deg' ? (SCALES[BK.key.scale] || SCALES.major).length : 7)) : 1;
  const m = bkMoved(L, L.notes, sel, arrows[0] * big, arrows[1] * big, L.rows); if (!m.dk && !m.dr) return true;
  const notes = L.notes.map(o => ({ ...o })); sel.forEach((j, q) => { notes[j] = m.out[q]; });
  bkNotesPut(L, notes, sel); if (m.dr) bkRelease(bkPress(L, m.out.map(o => ({ v: o.v, s: o.s / BK_STEPS })), m.out[0].len)); bkRender(); return true;
}
// a copy of the chosen notes right after them (what does not fit in the bar is left out); the copy is chosen
function bkDup(L, sel) {
  const off = L.page * BK_STEPS, os = sel.map(j => L.notes[j]), a = Math.min(...os.map(o => o.s)), span = Math.max(...os.map(o => o.s + o.len)) - a;
  const add = os.map(o => ({ ...o, s: o.s + span })).filter(o => o.s + o.len <= off + BK_STEPS);
  if (!add.length) return;
  bkNotesPut(L, [...L.notes, ...add], add.map((_, q) => L.notes.length + q)); bkRender();
}
// a chord's label menu: another chord in its place, or its notes on their own
function bkChordSet(L, j, val) {
  const o = L.notes[j]; if (!o) return;
  let notes;
  if (val === '\u0001loose') { const acc = bkAcc(o.v); notes = [...L.notes.filter((_, q) => q !== j), ...bkAtom(o.v, L).map(n => ({ ...o, v: (L.mode === 'deg' ? String(n) : bkSpell(L, n)) + acc }))]; }
  else { notes = L.notes.map((x, q) => q === j ? { ...x, v: val } : x); bkHear(L, val, o.len, o.s / BK_STEPS); }
  bkNotesPut(L, notes, []); bkRender();
}
// velocity: drag over the bars, higher is louder
function bkVelAt(d, e) {
  const el = document.elementFromPoint(e.clientX, e.clientY), vb = el && el.closest && el.closest('.bk-vb');
  if (!vb || vb.parentElement !== d.row) return;
  const k = +vb.dataset.k, rc = vb.getBoundingClientRect(), v = Math.max(0.05, Math.min(1, Math.round((1 - (e.clientY - rc.top) / rc.height) * 20) / 20));
  if (d.vals[d.L.page][k] === v) return;
  d.vals[d.L.page][k] = v; vb.firstElementChild.style.height = Math.round(v * 100) + '%';
  bkVelWrite(d.L, d.vals, true);
  if (vb.classList.contains('on')) {
    const at = d.L.page * BK_STEPS + k;
    if (d.L.tok) bkHear(d.L, d.L.tok[at], 1, at / BK_STEPS);
    else { const os = d.L.notes.filter(o => o.s === at); bkRelease(bkPress(d.L, os.map(o => ({ v: o.v, s: at / BK_STEPS })), os[0] ? os[0].len : 1)); }
  }
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
  // Three gestures, everywhere: a tap does the plain thing, a drag shapes (length sideways, pitch up and down, an
  // edge for a length), and a long press lifts an item to move it (or, on a drum step, makes it "now and then").
  // With a mouse an item also lifts as soon as it is pressed and moved; on touch, moving first scrolls.
  const LONG = 380;
  // every button and list on the board answers with a tick (the cells make their own sound)
  boardEl.addEventListener('pointerdown', e => { if (e.button <= 0 && e.target.closest('button:not(.bk-cell), select')) bkClick('tap'); }, true);
  // the roll keeps the keyboard after a redraw only while it is the one being used
  boardEl.addEventListener('pointerdown', e => { const r = e.target.closest('.bk-roll'), L = r && bkLine(r); BK.focusRoll = L ? L.key : null; }, true);
  boardEl.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const t0 = e.target;
    const crs = t0.closest('.bk-car-rs');
    if (crs) { e.preventDefault(); const car = crs.closest('.bk-car'), lab = car.querySelector('.bk-carbars'); BK.busy = true; BK.drag = { kind: 'carlen', j: +car.dataset.car, x0: e.clientX, b0: +lab.dataset.bars, lab }; boardEl.setPointerCapture(e.pointerId); return; }
    const pr = t0.closest('.bk-pr'), vel = t0.closest('.bk-vel[data-vel]');
    if (pr) { const L = bkLine(pr); if (L && L.notes) bkRollDown(e, L, t0); return; }
    if (vel) {
      const L = bkLine(vel), vals = L && bkVelRead(L); if (!vals) return;
      e.preventDefault(); BK.busy = true; BK.drag = { kind: 'vel', L, vals, row: vel }; bkVelAt(BK.drag, e);
      boardEl.setPointerCapture && boardEl.setPointerCapture(e.pointerId); return;
    }
    const cell = t0.closest('.bk-cell');
    if (!cell) {
      // an item that can move: arm it; a long press (or a mouse drag) lifts it
      const item = t0.closest('[data-sort]');
      if (!item || t0.closest('input[type=range]')) return;
      const arm = { kind: 'arm', item, x0: e.clientX, y0: e.clientY, mouse: e.pointerType === 'mouse', id: e.pointerId };
      arm.timer = setTimeout(() => { if (BK.drag === arm) bkLift(arm); }, LONG);
      BK.drag = arm; return;
    }
    const L = bkLine(cell); if (!L || !L.tok) return;   // a drum step (melodies are the roll above)
    e.preventDefault(); BK.busy = true;
    const k = +cell.dataset.k, card = cell.closest('.bk-card');
    if (L.kind === 'drum') {
      // tap: on or off; hold: now and then
      const was = L.tok[L.page * BK_STEPS + k], v = was === '.' ? 'x' : '.';
      const d = BK.drag = { L, kind: 'drum', v, done: new Set([k]), cell, k };
      d.timer = setTimeout(() => { if (BK.drag !== d || d.done.size > 1) return; const m = was === 'x?' ? 'x' : 'x?'; bkPaintDrum(cell, m); bkSetDrum(L, k, m); bkBuzz(); bkClick('lift'); d.held = true; }, LONG);
      bkPaintDrum(cell, v); bkSetDrum(L, k, v);
      if (v === '.') bkClick('off'); else if (S.playing) bkClick('on'); else bkHear(L, v, 1, (L.page * BK_STEPS + k) / BK_STEPS);
    }
    boardEl.setPointerCapture && boardEl.setPointerCapture(e.pointerId);
  });
  boardEl.addEventListener('pointermove', e => {
    const d = BK.drag; if (!d) return;
    if (d.kind === 'arm') {
      const dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
      if (dist > 6) { clearTimeout(d.timer); if (d.mouse) bkLift(d); else BK.drag = null; }   // touch: a move before the hold is a scroll
      return;
    }
    if (d.kind === 'sort') { bkSortMove(e); return; }
    if (d.kind === 'carlen') {
      // about one step of the usual lengths per 28 pixels
      const steps = [...new Set([1, 2, 4, 8, 12, 16, 24, 32, 48, 64, d.b0])].sort((a, b) => a - b), i0 = steps.indexOf(d.b0);
      const v = steps[Math.max(0, Math.min(steps.length - 1, i0 + Math.round((e.clientX - d.x0) / 28)))];
      d.lab.firstElementChild.textContent = t('bkBarsN', { n: v }); d.v = v; return;
    }
    if (d.kind === 'nlen' || d.kind === 'nmove' || d.kind === 'marq') { bkRollMove(e, d); return; }
    if (d.kind === 'vel') { bkVelAt(d, e); return; }
    const el = document.elementFromPoint(e.clientX, e.clientY), cell = el && el.closest && el.closest('.bk-cell');
    if (!cell || bkLine(cell) !== d.L) return;
    const k = +cell.dataset.k;
    if (d.kind === 'drum') {
      if (d.done.has(k)) return; d.done.add(k); clearTimeout(d.timer);
      bkPaintDrum(cell, d.v); bkSetDrum(d.L, k, d.v);
      if (d.v === '.') bkClick('off'); else bkHear(d.L, d.v, 1, (d.L.page * BK_STEPS + k) / BK_STEPS);
    }
  });
  const end = () => {
    const d = BK.drag;
    if (d && d.kind === 'arm') { clearTimeout(d.timer); BK.drag = null; return; }   // a plain tap: the item's own control acts
    if (!BK.busy) return;
    BK.drag = null; BK.busy = false;
    if (d && d.timer) clearTimeout(d.timer);
    if (d && d.kind === 'sort') bkSortEnd(d);
    else if (d && d.kind === 'carlen' && d.v && d.v !== d.b0) { const ps = BK.song.parts.map(p => ({ name: p.name, bars: p.bars })); ps[d.j].bars = d.v; bkWriteSong(ps, BK.song.line); }
    else if (d && (d.kind === 'nlen' || d.kind === 'nmove' || d.kind === 'marq')) bkRollEnd(d);
    bkRender();
  };
  boardEl.addEventListener('pointerup', end); boardEl.addEventListener('pointercancel', end);
  // the notes of a chord light up together under the pointer, so it shows they move as one
  boardEl.addEventListener('pointerover', e => {
    const nt = e.target.closest && e.target.closest('.bk-nt.ch'), pr = nt && nt.closest('.bk-pr');
    boardEl.querySelectorAll('.bk-nt.hov').forEach(x => x.classList.remove('hov'));
    if (pr) pr.querySelectorAll(`.bk-nt[data-o="${nt.dataset.o}"]`).forEach(x => x.classList.add('hov'));
  });
  // a lifted item must not scroll the page under the finger
  boardEl.addEventListener('click', e => { if (BK.noClick && performance.now() < BK.noClick) { e.stopPropagation(); e.preventDefault(); } }, true);
  boardEl.addEventListener('touchmove', e => { if (BK.drag && BK.drag.kind === 'sort') e.preventDefault(); }, { passive: false });
  // the keyboard: Alt+arrows move a focused item
  boardEl.addEventListener('keydown', e => {
    const roll = e.target.closest && e.target.closest('.bk-roll');
    if (roll && !e.altKey) { const L = bkLine(roll); if (L && L.notes && bkRollKey(L, e)) { e.preventDefault(); BK.focusRoll = L.key; bkFocusRoll(); } return; }
    if (!e.altKey || !/^Arrow/.test(e.key)) return;
    const item = e.target.closest('[data-sort]'); if (!item) return;
    const items = [...item.parentElement.children].filter(x => x.dataset && x.dataset.sort === item.dataset.sort), from = items.indexOf(item);
    const to = from + (/Left|Up/.test(e.key) ? -1 : 1); if (to < 0 || to >= items.length) return;
    e.preventDefault(); bkSortEnd({ sort: item.dataset.sort, items, from, to, item });
  });
  boardEl.addEventListener('input', e => {
    const s = e.target;
    if (s.id === 'bkBpm') { s.parentElement.querySelector('b').textContent = s.value; BK.busy = true; return; }
    if (s.type !== 'range') return;
    if (s.dataset.syn) { const L = bkLine(s); if (!L) return; const k = s.dataset.syn, v = +s.value; s.nextElementSibling.textContent = `${k} ${bkNumS(v)}`; BK.busy = true; bkWrite(L.i, p => { p.params = bkSetParam3(p.params, k, v); }, { live: true }); return; }
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
    const L = bkLine(s);
    if (L && s.dataset.table) { bkWrite(L.i, p => { p.params = bkSetWord(p.params, 'table', s.value); }); bkSynHear(L); return; }
    if (L && s.dataset.rf) { bkRuleEdit(L, +s.closest('.bk-rule').dataset.r, s.dataset.rf, s.value); return; }
    if (L && s.dataset.act === 'more' && s.value) {
      const [kind, what] = s.value.split(':');
      if (kind === 'bar') bkBarAdd(L);
      else if (kind === 'r') { const R = BK_RULES.find(x => x.type === what); let add = R.add; if (L.kind === 'drum' && R.type === 'every') add = 'every 4 fast 2'; bkWrite(L.i, p => { p.params = (p.params == null ? ' ' : p.params.replace(/\s*$/, '') + ' ') + add; }); }
      else { const spec = BK_STICKERS.find(x => x.k === what); if (spec) bkWrite(L.i, p => { p.params = bkSetParam(p.params, spec.k, spec.def); }); }
      return;
    }
    if (s.type === 'range') { BK.busy = false; bkRender(); }
  });
  boardEl.addEventListener('click', e => {
    // a folded card's name row opens it, as its ▸ does
    const nm = !e.target.closest('button') && e.target.closest('.bk-card.fold > header'); if (nm) { const L = bkLine(nm); if (L) { toggleSet(BK.unfold, L.name); bkRender(); } return; }
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pick != null) { bkMenu(b); return; }
    if (b.dataset.act === 'clicks') { BK.clicks = !BK.clicks; try { localStorage.setItem('tactus-bkclick', BK.clicks ? '1' : '0'); } catch (err) { } b.setAttribute('aria-pressed', BK.clicks); b.textContent = BK.clicks ? '🔊' : '🔈'; if (BK.clicks) bkClick('on'); return; }
    if (b.dataset.brush) { BK.brush = +b.dataset.brush; boardEl.querySelectorAll('[data-brush]').forEach(x => x.setAttribute('aria-checked', +x.dataset.brush === BK.brush)); return; }
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
    if (b.dataset.act === 'baradd') { bkBarAdd(L); return; }
    if (b.dataset.act === 'bardel') {
      const pg = L.page;
      if (L.tok) L.tok = L.tok.filter((_, j) => Math.floor(j / BK_STEPS) !== pg);
      else L.notes = L.notes.filter(o => !bkInBar(o, pg)).map(o => o.s > pg * BK_STEPS ? { ...o, s: o.s - BK_STEPS } : o);
      L.orig.splice(pg, 1); if (L.items) L.items.splice(pg, 1); L.bars--;
      L.page = Math.max(0, pg - 1); BK.pages.set(L.key, L.page); BK.minBars.set(L.key, L.bars);
      bkWritePat(L, false); bkSoon(); return;
    }
    if (b.dataset.chdel != null) { bkNotesPut(L, L.notes.filter((_, j) => j !== +b.dataset.chdel), []); bkRender(); return; }
    if (b.dataset.act === 'seldel') { const sel = bkSelOf(L); bkNotesPut(L, L.notes.filter((_, j) => !sel.has(j)), []); bkRender(); return; }
    if (b.dataset.act === 'seldup') { bkDup(L, [...bkSelOf(L)]); return; }
    if (b.dataset.act === 'selnone') { bkSelSet(L, []); bkRedraw(L); return; }
    if (b.dataset.rx != null) { const r = L.rules[+b.dataset.rx]; bkWrite(L.i, p => { p.params = bkReplace(p.params, r, ''); }); return; }
    if (b.dataset.pdel != null) { const tr = L.train.slice(); tr.splice(+b.dataset.pdel, 1); bkWriteTrain(L, tr); return; }
    if (b.dataset.act === 'padd') { bkWriteTrain(L, [...L.train, L.train[L.train.length - 1]]); return; }
    if (b.dataset.act === 'fold') { toggleSet(BK.unfold, L.name); bkRender(); return; }
    if (b.dataset.act === 'syn') { toggleSet(BK.synOpen, L.name); bkRender(); return; }
    if (b.dataset.ft != null) { bkWrite(L.i, p => { p.params = bkSetWord(p.params, 'ftype', b.dataset.ft); }); bkSynHear(L); return; }
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
// a copy of the bar on show goes at the end; until it differs the code needs no change, so the card remembers it
function bkBarAdd(L) {
  if (L.tok) L.tok = [...L.tok, ...bkBarTok(L, L.page)];
  else L.notes = [...L.notes, ...L.notes.filter(o => bkInBar(o, L.page)).map(o => ({ ...o, s: o.s + (L.bars - L.page) * BK_STEPS }))];
  L.orig.push(null); if (L.items) L.items.push(null); L.bars++;
  L.page = L.bars - 1; BK.pages.set(L.key, L.page); BK.minBars.set(L.key, L.bars);
  bkWritePat(L, false); bkSoon();
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
  if (BK.synOpen.size) bkScopes();
  const k = c < 0 ? -1 : Math.floor(mod(c, 1) * BK_STEPS), pb = c < 0 ? -1 : Math.floor(c - patOrigin(c) + 1e-9);
  const cur = c >= 0 ? sceneNameAt(c) : null, sig = `${k}|${pb}|${cur ? cur.name + (cur.part ? S.song.parts.indexOf(cur.part) : '') : ''}`;
  if (sig === BK.nowSig) return;
  BK.nowSig = sig;
  boardEl.querySelectorAll('.ph, .now').forEach(x => x.classList.remove('ph', 'now'));
  if (k < 0) return;
  for (const L of BK.items) {
    if (!L.grid) continue;
    const card = boardEl.querySelector(`.bk-card[data-i="${L.i}"]`); if (!card) continue;
    const bar = mod(pb, L.bars);
    if (L.bars > 1) { const tab = card.querySelector(`.bk-bar[data-bar="${bar}"]`); if (tab) tab.classList.add('now'); }
    if (bar !== L.page) continue;
    card.querySelectorAll(`:is(.bk-cell, .bk-c, .bk-vb)[data-k="${k}"]`).forEach(x => x.classList.add('ph'));
    if (L.notes) { const at = L.page * BK_STEPS + k; card.querySelectorAll('.bk-nt').forEach(x => { const s0 = +x.dataset.s; if (at >= s0 && at < s0 + +x.dataset.len) x.classList.add('ph'); }); }
  }
  if (BK.prog && BK.prog.toks) { const ch = boardEl.querySelector(`.bk-chord[data-j="${mod(pb, BK.prog.toks.length)}"]`); if (ch) ch.classList.add('now'); }
  if (cur) {
    const row = boardEl.querySelector(`.bk-scene[data-scene="${CSS.escape(cur.name)}"]`); if (row) row.classList.add('now');
    if (cur.part && S.song) { const car = boardEl.querySelector(`.bk-car[data-car="${S.song.parts.indexOf(cur.part)}"]`); if (car) car.classList.add('now'); }
  }
}

// ---------- the sound shape: envelope, filter and a scope for a synth track ----------
// Three small drawings on the code screen's colours. Drag the envelope's points (attack, decay and sustain, release) or
// the filter's point (cutoff across, resonance up and down); each drag writes just that value after |, as the stickers
// do. When the music is stopped, letting go plays a note, so the change is heard.
const BK_FT = ['lp', 'lp24', 'ladder', 'hp', 'bp', 'notch'];
const BK_SYN_R = { atk: [0.001, 2], dec: [0.01, 3], rel: [0.01, 3], sus: [0, 1], cut: [60, 16000], res: [0.5, 15] };
function bkSetParam3(params, k, v) {
  const s = bkNumS(v);
  if (params == null) return ` ${k} ${s}`;
  const re = new RegExp(`(^|\\s)(${k}\\s+)(\\S+)`);
  return re.test(params) ? params.replace(re, (m, a, b) => a + b + s) : params.replace(/\s*$/, '') + ` ${k} ${s}`;
}
function bkSetWord(params, k, w) { return bkSetParam3(params, k, 0).replace(new RegExp(`(^|\\s)(${k}\\s+)(\\S+)`), (m, a, b) => a + b + w); }
function bkWord(params, k) { const m = params && new RegExp(`(^|\\s)${k}\\s+(\\S+)`).exec(params); return m ? m[2] : null; }
// what the track plays with: the line's own values, else the instrument's, else the defaults
function bkSynVals(L) {
  const pr = L.pp ? L.pp.params : null, I = INST[L.inst] || {}, o = {};
  for (const k of ['atk', 'dec', 'sus', 'rel', 'cut', 'res', 'env']) { const v = bkParam(pr, k); o[k] = typeof v === 'number' ? v : I[k] != null ? I[k] : BASE[k] != null ? BASE[k] : 0; }
  const ft = bkWord(pr, 'ftype');
  o.ft = BK_FT.includes(ft) ? ft : ['analog', 'mono'].includes(L.inst) ? (L.inst === 'mono' ? 'ladder' : 'lp24') : I.slope === 24 ? 'lp24' : 'lp';
  o.ftSet = BK_FT.includes(ft);
  o.table = bkWord(pr, 'table') || 'basic'; const sc = bkParam(pr, 'scan'); o.scan = typeof sc === 'number' ? sc : 0;
  return o;
}
function bkSynHTML(L) {
  const v = L.syn = bkSynVals(L);
  const fts = BK_FT.map(f => `<button data-ft="${f}" aria-pressed="${f === v.ft}">${f}</button>`).join('');
  const wt = L.inst === 'wt' ? `<label class="bk-synw">${esc(t('bkSynTable'))} <select data-table="1">${WT_NAMES.map(n => `<option${n === v.table ? ' selected' : ''}>${n}</option>`).join('')}</select></label><label class="bk-synw"><input type="range" data-syn="scan" min="0" max="1" step="0.01" value="${v.scan}"><code>scan ${bkNumS(v.scan)}</code></label>` : '';
  return `<div class="bk-syn"><div class="bk-synbox"><canvas class="bk-syncv" data-syncv="1" aria-label="${esc(t('bkSynHint'))}" title="${esc(t('bkSynHint'))}"></canvas><canvas class="bk-synsc" aria-hidden="true"></canvas></div>
    <div class="bk-synrow"><span class="seg bk-ft" role="group" aria-label="${esc(t('bkSynFt'))}">${fts}</span>${wt}<code class="bk-synval"></code></div></div>`;
}
// where things are drawn, in css pixels: the envelope on the left, the filter in the middle, the scope on the right
function bkSynGeo(cv) {
  const w = cv.clientWidth, h = cv.clientHeight, gap = 10, sw = w < 420 ? 0 : Math.min(160, w * 0.2), ew = (w - sw - gap * (sw ? 2 : 1)) * 0.48;
  return { w, h, env: { x: 0, w: ew }, flt: { x: ew + gap, w: w - sw - ew - gap * (sw ? 2 : 1) }, scope: sw ? { x: w - sw, w: sw } : null, top: 10, bot: h - 14 };
}
const bkSq = (v, a, b) => Math.sqrt(Math.max(0, Math.min(1, (v - a) / (b - a))));
function bkEnvPts(v, G) {
  const E = G.env, W = E.w - 12, x0 = E.x + 6, Y = a => G.bot - a * (G.bot - G.top);
  const xa = x0 + W * 0.24 * bkSq(v.atk, 0, 2), xd = xa + W * 0.3 * bkSq(v.dec, 0, 3), xs = xd + W * 0.16, xr = xs + W * 0.3 * bkSq(v.rel, 0, 3);
  return { x0, W, Y, A: [xa, Y(1)], D: [xd, Y(v.sus)], S: [xs, Y(v.sus)], R: [xr, Y(0)] };
}
const BK_FLO = 40, BK_FHI = 18000;
function bkFltX(f, G) { return G.flt.x + Math.log(f / BK_FLO) / Math.log(BK_FHI / BK_FLO) * G.flt.w; }
function bkFltY(db, G) { return G.top + (24 - Math.max(-36, Math.min(24, db))) / 60 * (G.bot - G.top); }
function bkFltDb(ft, r, q) {
  const d = (rr, qq) => Math.sqrt((1 - rr * rr) ** 2 + (rr / qq) ** 2);
  const m = ft === 'hp' ? r * r / d(r, q) : ft === 'bp' ? (r / q) / d(r, q) * q * 0.7 : ft === 'notch' ? Math.abs(1 - r * r) / d(r, q) : ft === 'lp' ? 1 / d(r, q) : 1 / (d(r, q) * d(r, 0.6));
  return 20 * Math.log10(m + 1e-6);
}
function bkSynDraw(L) {
  const card = boardEl.querySelector(`.bk-card[data-i="${L.i}"]`), cv = card && card.querySelector('[data-syncv]'); if (!cv) return;
  const dpr = devicePixelRatio || 1, G = bkSynGeo(cv); cv.width = G.w * dpr; cv.height = G.h * dpr;
  const g = cv.getContext('2d'), cs = getComputedStyle(card), col = k => cs.getPropertyValue(k).trim(), tc = col('--tc') || col('--k-green'), v = L.syn;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, G.w, G.h);
  g.font = `10px ${col('--f-code') || 'monospace'}`; g.lineJoin = 'round';
  const dot = (x, y, on) => { g.beginPath(); g.arc(x, y, on ? 6.5 : 5, 0, 7); g.fillStyle = on ? col('--scr-fg') : tc; g.fill(); g.lineWidth = 2; g.strokeStyle = col('--scr'); g.stroke(); };
  // envelope
  const P = bkEnvPts(v, G); g.fillStyle = col('--scr-faint'); g.fillText('amp', G.env.x + 6, G.h - 3);
  g.beginPath(); g.moveTo(P.x0, P.Y(0)); g.lineTo(...P.A);
  g.bezierCurveTo(P.A[0] + (P.D[0] - P.A[0]) * 0.3, P.D[1], P.D[0] - (P.D[0] - P.A[0]) * 0.4, P.D[1], ...P.D); g.lineTo(...P.S);
  g.bezierCurveTo(P.S[0] + (P.R[0] - P.S[0]) * 0.3, P.R[1], P.R[0] - (P.R[0] - P.S[0]) * 0.5, P.R[1], ...P.R);
  g.lineWidth = 2; g.strokeStyle = tc; g.stroke(); g.lineTo(P.x0, P.Y(0)); g.globalAlpha = 0.18; g.fillStyle = tc; g.fill(); g.globalAlpha = 1;
  const hot = BK.synDrag && BK.synDrag.L === L ? BK.synDrag.h : null;
  dot(...P.A, hot === 'A'); dot(...P.D, hot === 'D'); dot(...P.R, hot === 'R');
  // filter
  g.fillStyle = col('--scr-line'); g.fillRect(G.flt.x, bkFltY(0, G), G.flt.w, 1);
  for (const f of [100, 1000, 10000]) g.fillRect(Math.round(bkFltX(f, G)), G.top, 1, G.bot - G.top);
  g.fillStyle = col('--scr-faint'); g.fillText(v.ft + (v.env > 0 ? ' · env ' + bkNumS(v.env) : ''), G.flt.x + 4, G.h - 3);
  g.beginPath();
  for (let i = 0; i <= 120; i++) { const f = BK_FLO * Math.pow(BK_FHI / BK_FLO, i / 120), x = bkFltX(f, G), y = bkFltY(bkFltDb(v.ft, f / v.cut, v.res), G); i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.lineWidth = 2; g.strokeStyle = tc; g.stroke();
  dot(bkFltX(v.cut, G), bkFltY(20 * Math.log10(v.res), G), hot === 'F');
  // scope frame (the trace is drawn by bkScopes)
  if (G.scope) { g.fillStyle = col('--scr-line'); g.fillRect(G.scope.x, (G.top + G.bot) / 2, G.scope.w, 1); g.fillStyle = col('--scr-faint'); g.fillText(t('bkSynScope'), G.scope.x + 4, G.h - 3); }
  L.synBg = true;
  const val = card.querySelector('.bk-synval');
  if (val) val.textContent = `atk ${bkNumS(v.atk)} dec ${bkNumS(v.dec)} sus ${bkNumS(v.sus)} rel ${bkNumS(v.rel)} · cut ${Math.round(v.cut)} res ${bkNumS(v.res)}`;
}
// the live trace of each open track: its strip's output, lined up on a rising zero crossing so it stands still
function bkScopes() {
  for (const L of BK.items) {
    if (!L.syn || !L.synBg) continue;
    const r = S.rt && S.rt.get(L.name); if (!r || !S.ctx) continue;
    if (!r.scope) { r.scope = S.ctx.createAnalyser(); r.scope.fftSize = 2048; r.duck.connect(r.scope); r.scopeBuf = new Float32Array(2048); }
    const cv = boardEl.querySelector(`.bk-card[data-i="${L.i}"] [data-syncv]`); if (!cv) continue;
    const G = bkSynGeo(cv); if (!G.scope) continue;
    const sc2 = cv.nextElementSibling, dpr = devicePixelRatio || 1, b = r.scopeBuf;
    if (sc2.width !== Math.round(G.w * dpr)) { sc2.width = Math.round(G.w * dpr); sc2.height = Math.round(G.h * dpr); }
    const g = sc2.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(G.scope.x - 2, 0, G.scope.w + 4, G.h);
    r.scope.getFloatTimeDomainData(b);
    let pk = 0; for (let i = 0; i < b.length; i++) pk = Math.max(pk, Math.abs(b[i]));
    if (pk < 1e-4) continue;
    let z = 0; for (let i = 1; i < 1024; i++) if (b[i - 1] <= 0 && b[i] > 0) { z = i; break; }
    const n = 1024, sc = 0.45 / Math.max(0.05, pk), mid = (G.top + G.bot) / 2, hh = G.bot - G.top;
    g.beginPath(); for (let i = 0; i < n; i++) { const x = G.scope.x + i / (n - 1) * G.scope.w, y = mid - b[z + i] * sc * hh; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.lineWidth = 1.5; g.strokeStyle = getComputedStyle(cv.closest('.bk-card')).getPropertyValue('--tc').trim(); g.stroke();
  }
}
function bkSynHit(L, cv, e) {
  const G = bkSynGeo(cv), rc = cv.getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top, v = L.syn, P = bkEnvPts(v, G);
  const hs = [['A', ...P.A], ['D', ...P.D], ['R', ...P.R], ['F', bkFltX(v.cut, G), bkFltY(20 * Math.log10(v.res), G)]];
  let best = null, bd = 22; for (const [h, hx, hy] of hs) { const d = Math.hypot(hx - x, hy - y); if (d < bd) { bd = d; best = h; } }
  // a press anywhere in the filter picture moves its point there
  if (!best && x > G.flt.x && x < G.flt.x + G.flt.w) best = 'F';
  return best && { L, h: best, G, rc, cv };
}
function bkSynMove(d, e) {
  const { L, h, G, rc } = d, x = e.clientX - rc.left, y = e.clientY - rc.top, v = L.syn, P = bkEnvPts(v, G);
  const lim = (k, a) => Math.max(BK_SYN_R[k][0], Math.min(BK_SYN_R[k][1], a)), q3 = a => Math.round(a * 1000) / 1000, q2 = a => Math.round(a * 100) / 100;
  const inv = (px, frac, max) => max * Math.pow(Math.max(0, Math.min(1, px / (P.W * frac))), 2);
  const out = {};
  if (h === 'A') out.atk = q3(lim('atk', inv(x - P.x0, 0.24, 2)));
  if (h === 'D') { out.dec = q2(lim('dec', inv(x - P.A[0], 0.3, 3))); out.sus = q2(lim('sus', (G.bot - y) / (G.bot - G.top))); }
  if (h === 'R') out.rel = q2(lim('rel', inv(x - P.S[0], 0.3, 3)));
  if (h === 'F') {
    const f = BK_FLO * Math.pow(BK_FHI / BK_FLO, (x - G.flt.x) / G.flt.w), db = 24 - (y - G.top) / (G.bot - G.top) * 60;
    out.cut = Math.round(lim('cut', f) / 10) * 10; out.res = q2(lim('res', Math.pow(10, db / 20)));
  }
  Object.assign(v, out); d.moved = true;
  BK.busy = true; bkWrite(L.i, p => { for (const k in out) p.params = bkSetParam3(p.params, k, out[k]); }, { live: true });
  bkSynDraw(L);
}
function bkSynHear(L) {
  const n = L.notes && L.notes.length ? L.notes.find(o => o.v != null) : null;
  setTimeout(() => { const a = bkPress(L, [{ v: n ? n.v : 0, s: 0 }], 4); if (a) bkRelease(a); }, 40);
}
function bkSynInit() {
  boardEl.addEventListener('pointerdown', e => {
    const cv = e.target.closest('[data-syncv]'); if (!cv || e.button > 0) return;
    const L = bkLine(cv); if (!L || !L.syn) return;
    const d = bkSynHit(L, cv, e); if (!d) return;
    e.preventDefault(); cv.setPointerCapture(e.pointerId); BK.synDrag = d; bkSynDraw(L); bkSynMove(d, e);
  });
  boardEl.addEventListener('pointermove', e => { if (BK.synDrag) bkSynMove(BK.synDrag, e); });
  const end = () => { const d = BK.synDrag; if (!d) return; BK.synDrag = null; BK.busy = false; bkRender(); if (d.moved) { const L = BK.items.find(x => x.name === d.L.name); if (L) bkSynHear(L); } };
  boardEl.addEventListener('pointerup', end); boardEl.addEventListener('pointercancel', end);
}
bkInit();
bkSynInit();
