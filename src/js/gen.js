// ===================== Tactus procedural composition =====================
// Generators write ordinary mini-notation from a seed, so everything they make can be read, edited and baked.
//   kick ~beat four | dens .6 evolve 4      lead ~melody | seed 3 bars 4      prog ~gen 4
// A global "seed N" line re-rolls the whole piece; a track's own "seed" offsets just that track.

function rng(a) {
  a = (a | 0) || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const strHash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
function wpick(r, items) { const tot = items.reduce((s, x) => s + x[1], 0); let x = r() * tot; for (const [v, w] of items) { x -= w; if (x <= 0) return v; } return items[items.length - 1][0]; }
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
// metric weight of a step: downbeat 1, beats .8, eighths .55, sixteenths .35
function metric(steps) { return Array.from({ length: steps }, (_, i) => { const x = i / steps * 4; return i === 0 ? 1 : Math.abs(x - Math.round(x)) < 1e-9 ? 0.8 : Math.abs(x * 2 - Math.round(x * 2)) < 1e-9 ? 0.55 : 0.35; }); }
const isCT = d => [0, 2, 4].includes(((d % 7) + 7) % 7);
const isNum = s => /^-?\d+/.test(s);
const trTok = (s, k) => (isNum(s) ? String(parseInt(s, 10) + k) + s.replace(/^-?\d+/, '') : s);

// ---------- drums ----------
const BEAT_ROLE = n => /kick|bd|buk/.test(n) ? 'kick' : /ohat|open|aohat/.test(n) ? 'ohat' : /snare|clap|sd|cp|asnare|handclap|rim|cajon/.test(n) ? 'snare' : /hat|hh|shak|ride|tamb|shake/.test(n) ? 'hat' : 'perc';
const BEAT_STYLES = ['four', 'break', 'half', 'boom', 'trap', 'latin', 'free'];
const BEAT_BASE = {
  four: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', ohat: '..x...x...x...x.' },
  break: { kick: 'x.........x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', ohat: '..............x.' },
  half: { kick: 'x.........x.....', snare: '........x.......', hat: 'x.x.x.x.x.x.x.x.', ohat: '......x.........' },
  boom: { kick: 'x......x..x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', ohat: '..............x.' },
  trap: { kick: 'x......x..x.....', snare: '........x.......', hat: 'xxxxxxxxxxxxxxxx', ohat: '................' },
  latin: { kick: 'x..x..x.x..x..x.', snare: 'x..x..x...x.x...', hat: 'x.xxx.xxx.xxx.xx', ohat: '..x...x...x...x.' },
  free: { kick: 'x...............', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', ohat: '................' },
};
function beatBar(r, role, style, dens) {
  const W = metric(16);
  const base = (BEAT_BASE[style] || BEAT_BASE.four)[role === 'perc' ? 'hat' : role] || '................';
  let s = base.split('').map(c => (c === 'x' ? 'x' : '.'));
  const anchor = s.map(c => c === 'x');
  if (role === 'kick') {
    // extra kicks on weak steps, more of them with density; four-on-the-floor stays sparse
    const p = style === 'four' ? Math.max(0, dens - 0.55) * 0.35 : dens * 0.22;
    for (let i = 1; i < 16; i++) if (s[i] === '.' && W[i] < 0.8 && r() < p) s[i] = 'x';
  } else if (role === 'snare') {
    // ghost notes around the backbeat
    for (let i = 0; i < 16; i++) if (s[i] === '.' && W[i] <= 0.55 && r() < dens * 0.18) s[i] = '.35';
    for (let i = 0; i < 16; i++) if (s[i] === 'x') s[i] = "x'";
  } else if (role === 'hat') {
    if (style !== 'trap' && style !== 'latin') {
      if (dens > 0.68) s = s.map((_, i) => 'x');
      else if (dens < 0.32 && style === 'four') s = base.split('').map(c => (c === 'x' ? 'x' : '.'));
    }
    s = s.map((c, i) => (c === 'x' ? (W[i] >= 0.8 ? 'x' : W[i] >= 0.55 ? "x'" : '.6') : c));
    if (style === 'four') s = s.map((c, i) => (W[i] === 0.55 && c !== '.' ? "x'" : c));
    for (let i = 12; i < 16; i++) if (s[i] !== '.' && r() < dens * 0.12) s[i] = pick(r, ['x:2', 'x:3']);
  } else if (role === 'ohat') {
    for (let i = 0; i < 16; i++) if (s[i] === 'x' && r() < 0.3 - dens * 0.2) s[i] = '.';
  } else {
    // percussion: a rotated euclidean rhythm
    const k = pick(r, dens > 0.6 ? [5, 7, 9] : [3, 5, 7]), rot = Math.floor(r() * 16);
    const hit = j => Math.floor(j * k / 16) !== Math.floor((j - 1) * k / 16);
    s = Array.from({ length: 16 }, (_, i) => (hit((i + rot) % 16) ? 'x' : '.'));
    s = s.map((c, i) => (c === 'x' && W[i] < 0.55 ? '.7' : c));
  }
  return { bar: s, anchor };
}
const GEN = {};
GEN.beat = {
  make(r, c) {
    const style = BEAT_STYLES.includes(c.style) ? c.style : 'four';
    const bars = [];
    const { bar } = beatBar(r, c.role, style, c.dens);
    for (let b = 0; b < c.bars; b++) {
      const v = bar.slice();
      if (b % 2 === 1 && c.role === 'kick' && style !== 'four' && r() < 0.6) { const i = pick(r, [6, 11, 14, 15]); if (v[i] === '.') v[i] = 'x'; }
      // the last bar of the phrase leads into the next one
      if (b === c.bars - 1 && c.bars > 1) {
        if (c.role === 'snare' && r() < 0.5 + c.dens * 0.4) { v[13] = '.4'; v[14] = '.6'; v[15] = "x'"; }
        if (c.role === 'kick' && r() < 0.5) v[14] = 'x';
        if (c.role === 'hat' && r() < 0.5) v[14] = 'x:3';
      }
      bars.push(v);
    }
    return bars;
  },
  mutate(r, bars, c) {
    const b = Math.floor(r() * bars.length), v = bars[b], W = metric(16);
    const i = Math.floor(r() * 16);
    if (W[i] >= 0.8 && c.role !== 'perc') return bars;
    if (c.role === 'kick') v[i] = v[i] === '.' ? 'x' : '.';
    else if (c.role === 'snare') v[i] = v[i] === '.' ? '.35' : v[i] === '.35' ? '.' : v[i];
    else if (c.role === 'hat') v[i] = v[i] === '.' ? '.6' : r() < 0.3 ? 'x:2' : v[i];
    else v[i] = v[i] === '.' ? '.7' : '.';
    return bars;
  },
};

// ---------- melody ----------
function nearCT(r, from, lo, hi, prev) {
  const c = [];
  for (let d = lo; d <= hi; d++) if (isCT(d) && Math.abs(d - from) <= 2) c.push([d, 1 / (1 + Math.abs(d - from)) * (d === prev ? 0.15 : 1)]);
  return c.length ? wpick(r, c) : clampN(from, lo, hi);
}
function motif(r, steps, dens, lo, hi, start) {
  const W = metric(steps);
  let on = W.map((w, i) => (i === 0 ? r() < 0.85 : r() < Math.min(0.92, dens * 1.5 * w + 0.1)));
  if (on.filter(Boolean).length < 2) { on[0] = true; on[steps / 2] = true; }
  let cur = start ?? pick(r, [2, 4, 0, 4, 2]), resting = true;
  const out = [];
  for (let i = 0; i < steps; i++) {
    if (on[i]) {
      if (out.length) if (W[i] >= 0.8) cur = nearCT(r, cur + pick(r, [-1, 1, 2, -2]), lo, hi, cur);
        else { const st = wpick(r, [[1, 3], [-1, 3], [2, 1.2], [-2, 1.2], [0, 0.5]]); cur = cur + st < lo || cur + st > hi ? cur - st : cur + st; }
      else cur = clampN(cur, lo, hi);
      out.push(String(cur)); resting = false;
    } else if (!resting && r() > 0.28 + (1 - dens) * 0.2) out.push('_');
    else { out.push('.'); resting = true; }
  }
  return out;
}
function cadence(r, m, target) {
  const n = m.length, half = n / 2, out = m.slice(0, half);
  // end the phrase on a long note
  out.push(String(target)); for (let i = half + 1; i < n; i++) out.push(i >= n - 1 && r() < 0.5 ? '.' : '_');
  return out;
}
GEN.melody = {
  make(r, c) {
    const steps = c.dens > 0.62 ? 16 : 8, lo = -2, hi = c.range ?? 9;
    const A = motif(r, steps, c.dens, lo, hi), shift = pick(r, [1, 2, -1, 2]);
    const top = Math.max(...A.filter(isNum).map(x => parseInt(x, 10)));
    const sh = top + shift > hi ? -Math.abs(shift) : shift;
    const A2 = r() < 0.55 ? A.map(s => trTok(s, sh)) : motif(r, steps, c.dens, lo, hi, clampN(parseInt(A.find(isNum) || '2', 10) + sh, lo, hi));
    const plan = c.bars <= 1 ? ['A'] : c.bars === 2 ? ['A', 'C'] : c.bars <= 4 ? ['A', 'B', 'A', 'C'].slice(0, c.bars) : ['A', 'B', 'A', 'H', 'A', 'B', 'A2', 'C'];
    return plan.map(p => (p === 'A' ? A.slice() : p === 'B' ? A2.slice() : p === 'A2' ? A.map(s => trTok(s, pick(r, [1, -1]))) : cadence(r, A, p === 'H' ? 4 : pick(r, [0, 0, 7]))));
  },
  mutate(r, bars) {
    const b = Math.floor(r() * Math.max(1, bars.length - 1)), v = bars[b];
    const idx = v.map((s, i) => (isNum(s) ? i : -1)).filter(i => i >= 0);
    if (!idx.length) return bars;
    const i = pick(r, idx);
    if (r() < 0.7) v[i] = trTok(v[i], pick(r, [1, -1, 2, -2]));
    else if (i + 1 < v.length && v[i + 1] === '_') { v[i + 1] = v[i]; v[i] = '.'; }
    return bars;
  },
};

// ---------- bass ----------
const BASS_STYLES = ['sub', 'syncop', 'offbeat', 'roll', 'walk'];
GEN.bass = {
  make(r, c) {
    const style = BASS_STYLES.includes(c.style) ? c.style : c.dens < 0.3 ? 'sub' : c.dens < 0.55 ? 'syncop' : c.dens < 0.8 ? 'offbeat' : 'roll';
    let bar;
    if (style === 'sub') bar = ['0', '_', '_', '_', '_', '_', r() < 0.5 ? '_' : '.', r() < 0.5 ? '0' : '.'];
    else if (style === 'syncop') bar = pick(r, [['0', '_', '.', '0', '.', '.', '4', '.'], ['0', '_', '_', '.', '.', '0', '.', '7'], ['0', '.', '.', '0', '.', '0', '4', '.'], ['0', '_', '.', '.', '0', '.', '2', '.']]);
    else if (style === 'offbeat') bar = ['.', '0', '.', '0', '.', '0', '.', '0'].map((s, i) => (s === '0' && i > 2 && r() < 0.25 ? '7' : s));
    else if (style === 'walk') bar = ['0', String(pick(r, [1, 2])), String(pick(r, [4, 3, 2])), String(pick(r, [6, 5, -1]))];
    else bar = Array.from({ length: 16 }, (_, i) => (i % 4 === 0 ? '0' : wpick(r, [['0', 4], ['7', 1.5], ['.', 1.2 * (1 - c.dens)], ['4', 0.8], ['-1', 0.4]])));
    const bars = [];
    for (let b = 0; b < c.bars; b++) {
      const v = bar.slice();
      if (b === c.bars - 1 && c.bars > 1 && v.length >= 8) { v[v.length - 1] = pick(r, ['-1', '1', '6', '4']); if (v[v.length - 2] === '_') v[v.length - 2] = '.'; }
      bars.push(v);
    }
    return bars;
  },
  mutate(r, bars) {
    const v = bars[Math.floor(r() * bars.length)], i = 1 + Math.floor(r() * (v.length - 1));
    if (isNum(v[i])) v[i] = pick(r, ['0', '7', '4', '.']); else if (v[i] === '.') v[i] = pick(r, ['0', '7']);
    return bars;
  },
};

// ---------- chords & arpeggios ----------
const CHORD_STYLES = ['pad', 'stab', 'comp', 'pulse'];
GEN.chords = {
  make(r, c) {
    const x = c.style === 'tri' || c.tri ? '0^' : '0^7';
    const style = CHORD_STYLES.includes(c.style) ? c.style : c.dens < 0.3 ? 'pad' : c.dens < 0.55 ? 'comp' : c.dens < 0.8 ? 'stab' : 'pulse';
    const T = {
      pad: [['C', '_', '_', '_']],
      stab: [['.', 'C', '.', '.', '.', 'C', '.', '.'], ['.', '.', "C'", '.', '.', 'C', '.', 'C'], ['.', 'C', '.', 'C', '.', '.', "C'", '.']],
      comp: [['C', '_', '.', "C'", '.', '.', '.', '.'], ['.', '.', 'C', '.', '.', "C'", '.', '.'], ['C', '.', '.', '.', '.', '.', "C'", '_']],
      pulse: [["C'", 'C', 'C', 'C', "C'", 'C', 'C', 'C']],
    };
    const a = pick(r, T[style]), b = pick(r, T[style]);
    return Array.from({ length: c.bars }, (_, i) => (i % 2 ? b : a).map(s => s.replace('C', x)));
  },
  mutate(r, bars) {
    const v = bars[Math.floor(r() * bars.length)], i = Math.floor(r() * v.length), on = v.find(s => s !== '.' && s !== '_') || '0^7';
    if (i > 0) v[i] = v[i] === '.' ? on.replace(/'+$/, '') : v[i] === '_' ? v[i] : '.';
    return bars;
  },
};
const ARP_SHAPES = { up: [0, 2, 4, 7], down: [7, 4, 2, 0], updown: [0, 2, 4, 7, 4, 2], alberti: [0, 4, 2, 4], broken: [0, 4, 7, 9, 7, 4], pinky: [0, 7, 4, 7] };
GEN.arp = {
  make(r, c) {
    const steps = c.dens >= 0.5 ? 16 : 8, shape = ARP_SHAPES[c.style] || ARP_SHAPES[pick(r, Object.keys(ARP_SHAPES))], W = metric(steps);
    const bar = Array.from({ length: steps }, (_, i) => (W[i] < 0.55 && r() < (1 - c.dens) * 0.45 ? '.' : String(shape[i % shape.length]) + (W[i] >= 0.8 ? "'" : '')));
    return [bar];
  },
  mutate(r, bars) {
    const v = bars[0], i = Math.floor(r() * v.length);
    v[i] = v[i] === '.' ? pick(r, ['0', '2', '4', '7']) : isNum(v[i]) && r() < 0.5 ? '.' : trTok(v[i], pick(r, [2, -2]));
    return bars;
  },
};
const GEN_KINDS = Object.keys(GEN);

// ---------- chord progressions ----------
const PROG_NEXT = { 0: [[3, 3], [5, 2.5], [1, 2], [4, 2], [2, 0.5]], 1: [[4, 6], [6, 1], [3, 1.5], [0, 0.5]], 2: [[5, 6], [3, 4]], 3: [[4, 4], [0, 2.5], [1, 2], [5, 1.5]], 4: [[0, 5.5], [5, 3], [3, 1.5]], 5: [[3, 3.5], [1, 3.5], [4, 2], [2, 1]], 6: [[0, 7], [2, 3]] };
function genProg(seed, n) {
  for (let tries = 0; tries < 40; tries++) {
    const r = rng(seed * 7919 + tries * 104729 + 11), out = [0];
    while (out.length < n) out.push(wpick(r, PROG_NEXT[out[out.length - 1]]));
    // end on something that pulls back to the tonic, and do not sit on one chord
    if ([4, 3, 6, 1].includes(out[n - 1]) && new Set(out).size >= Math.min(3, n)) return out;
  }
  return [0, 5, 3, 4].slice(0, n);
}

// ---------- turning generators into patterns ----------
const ser = bars => (bars.length === 1 ? bars[0].join(' ') : '<' + bars.map(b => '[' + b.join(' ') + ']').join(' ') + '>');
const numParam = (params, k, d) => (params[k] && params[k].k === 'num' ? params[k].v : d);
// parse "~kind style" → generator description; params carry seed / dens / bars / evolve / range
function genSpec(patSrc, name, inst, params, globalSeed) {
  const m = /^\s*~([a-z]+)\s*([a-z0-9]*)\s*$/.exec(patSrc);
  if (!m) return null;
  const kind = m[1];
  if (!GEN[kind]) throw new PErr(t('genKind', { k: kind, list: GEN_KINDS.map(k => '~' + k).join(' ') }), 0);
  const role = BEAT_ROLE(name.toLowerCase() + ' ' + inst);
  const spec = {
    kind, style: m[2] || '', role, name,
    seed: (strHash(name + '|' + inst + '|' + kind + '|' + (m[2] || '')) ^ Math.imul((globalSeed | 0) + 1, 2654435761)) + Math.round(numParam(params, 'seed', 0)) * 7777,
    dens: clampN(numParam(params, 'dens', kind === 'melody' ? 0.5 : kind === 'beat' ? 0.5 : 0.5), 0, 1),
    bars: clampN(Math.round(numParam(params, 'bars', kind === 'arp' ? 1 : 4)), 1, 8),
    evolve: Math.max(0, Math.round(numParam(params, 'evolve', 0))),
    range: params.range && params.range.k === 'num' ? params.range.v : undefined,
  };
  if (kind === 'arp') spec.bars = 1;
  return spec;
}
function genBars(spec, g) {
  const cache = spec._cache || (spec._cache = new Map());
  if (cache.has(g)) return cache.get(g);
  let bars;
  if (g <= 0) bars = GEN[spec.kind].make(rng(spec.seed), spec);
  else {
    // each generation is the previous one with a small change, so the part drifts instead of jumping
    bars = genBars(spec, g - 1).map(b => b.slice());
    const r = rng(spec.seed * 31 + g * 977);
    const k = 1 + (r() < 0.35 ? 1 : 0);
    for (let i = 0; i < k; i++) bars = GEN[spec.kind].mutate(r, bars, spec);
  }
  cache.set(g, bars);
  if (cache.size > 256) cache.delete(cache.keys().next().value);
  return bars;
}
const genText = (spec, g) => ser(genBars(spec, g));
function genPattern(spec, loc) {
  const pats = new Map();
  const patFor = g => {
    if (!pats.has(g)) {
      const p = parseMini(genText(spec, g), 0);
      pats.set(g, mapEv(p, ev => ({ ...ev, loc })));
      if (pats.size > 64) pats.delete(pats.keys().next().value);
    }
    return pats.get(g);
  };
  if (!spec.evolve) return patFor(0);
  return pat((b, e) => {
    const out = [];
    for (let n = Math.floor(b); n < e; n++) {
      const g = Math.max(0, Math.floor(n / spec.evolve));
      out.push(...patFor(g).q(Math.max(b, n), Math.min(e, n + 1)));
    }
    return out;
  });
}
const genAt = (spec, c) => (spec.evolve ? Math.max(0, Math.floor(c / spec.evolve)) : 0);

// ---------- whole songs ----------
const COMPOSE_STYLES = {
  house: { bpm: [120, 126], keys: ['A minor', 'F minor', 'D dorian', 'G minor', 'C minor', 'E dorian'], swing: [0.06, 0.14], master: 'default', form: 'club',
    tracks: [['kick', '~beat four', ''], ['clap', '~beat four', '| gain .55 verb .2 human .15'], ['hat', '~beat four', '| gain .45 human .2 evolve 4'], ['ohat', '~beat four', '| gain .28'],
      ['bass', '~bass offbeat', '| cut 900 res 4 duck .6'], ['stab', '~chords stab', '| oct 3 cut k1(500,4000) env .4 dec .3 delay .3 verb .3 duck .5 gain .42'],
      ['lead', '~melody', '| bell oct 5 dens .45 evolve 8 delay .35 verb .4 gain .28'], ['pad', '0^7', '| gain .18 atk .8 rel 1.5 verb .6 duck .7']] },
  techno: { bpm: [128, 134], keys: ['F# phrygian', 'A minor', 'E phrygian', 'D minor', 'G minor'], swing: [0, 0], master: 'loud', form: 'club',
    tracks: [['kick', '~beat four', '| gain 1.1 tune .9'], ['hat', '~beat four', '| gain .4 dens .8 evolve 4'], ['ohat', '~beat four', '| gain .3 dec .7'], ['perc', '~beat', '| tom tune 1.4 gain .3 pan -.3 delay .2 evolve 8'],
      ['acid', '~bass roll', '| cut k1(200,2500) res 14 env .9 dec .14 delay .2 duck .3 evolve 4'], ['drone', '0/4', '| pad oct 2 gain .18 cut 600 atk 2 rel 3 verb .8'], ['clap', '~beat four', '| gain .4 verb .3']] },
  dnb: { bpm: [170, 176], keys: ['F minor', 'E minor', 'G minor', 'D minor'], swing: [0, 0], master: 'default', form: 'club',
    tracks: [['kick', '~beat break', ''], ['snare', '~beat break', '| gain .85 tune 1.15 verb .15'], ['hat', '~beat break', '| gain .32 dens .8 human .25 evolve 4'], ['perc', '~beat', '| shaker gain .25 pan .3'],
      ['reese', '~bass sub', '| supersaw oct 1 cut k1(250,2000) res 3 detune 38 shape .45 gain .65 duck .5'], ['pad', '~chords pad', '| gain .2 atk 1.5 rel 2.5 verb .7 duck .3'],
      ['bell', '~melody', '| oct 5 dens .4 evolve 8 gain .24 delay .45 verb .5']] },
  lofi: { bpm: [76, 88], keys: ['F major', 'Eb major', 'D dorian', 'A minor', 'Bb major'], swing: [0.22, 0.32], master: 'warm', form: 'loop',
    tracks: [['kick', '~beat boom', '| gain .9 tune .85 dec .8'], ['snare', '~beat boom', '| gain .55 tune .85 verb .25 dec 1.3 nudge 14 human .3'], ['hat', '~beat boom', '| gain .3 dens .4 dec .8 human .4'],
      ['bass', '~bass syncop', '| sine oct 2 gain .8'], ['keys', '~chords comp', '| oct 3 cut k1(1200,7000) gain .38 verb .3 shape .1 drop2 human .3'],
      ['lead', '~melody', '| vibes oct 5 dens .35 evolve 8 gain .3 delay .3 verb .3 human .3']] },
  trance: { bpm: [136, 140], keys: ['A minor', 'F# minor', 'C minor', 'E minor'], swing: [0, 0], master: 'default', form: 'club',
    tracks: [['kick', '~beat four', ''], ['hat', '~beat four', '| gain .45 pan .25 human .2'], ['clap', '~beat four', '| gain .55 verb .25'],
      ['bass', '~bass roll', '| cut 600 res 5 duck .8 dens .7'], ['arp', '~arp', '| cut k1(300,6000) res 9 delay .35 duck .5 dens .8 evolve 8'],
      ['pad', '0^', '| gain .32 duck .9 verb .7'], ['lead', '~melody', '| oct 5 dens .55 evolve 16 cut 6000 delay .3 verb .4 gain .4']] },
  synthwave: { bpm: [100, 112], keys: ['E minor', 'A minor', 'D minor', 'F# minor'], swing: [0, 0], master: 'default', form: 'song',
    tracks: [['kick', '~beat four', '| gain 1'], ['snare', '~beat half', '| gain .7 verb .6 dec 1.5'], ['hat', '~beat four', '| gain .3 human .2'],
      ['bass', '~bass offbeat', '| saw oct 1 cut k2(400,2000) env .5 dec .15 res 3 duck .4'], ['arp', '~arp up', '| oct 4 cut k1(600,5000) delay .3 gain .32'],
      ['pad', '~chords pad', '| gain .28 verb .6 duck .4'], ['lead', '~melody', '| supersaw oct 4 dens .5 evolve 8 cut 2600 atk .04 delay .35 verb .5 gain .38']] },
  ambient: { bpm: [64, 80], keys: ['Eb pyeongjo', 'D lydian', 'A minor', 'C major', 'F lydian'], swing: [0, 0], master: 'open', form: 'drift',
    tracks: [['pad', '~chords pad', '| gain .3 atk 2.5 rel 4 verb .85 bars 2'], ['bell', '~melody', '| kalimba oct 5 dens .25 evolve 4 gain .4 delay .5 verb .6 human .4'],
      ['harp', '~arp broken', '| oct 4 dens .3 gain .25 verb .6 delay .3 evolve 8'], ['bass', '~bass sub', '| sine oct 2 gain .4 atk .3 rel 1'],
      ['air', '~beat', '| shaker gain .12 dens .3 pan .4 evolve 4'], ['drone', '0/4', '| pad oct 2 gain .14 atk 3 rel 4 verb .9']] },
  jazz: { bpm: [120, 150], keys: ['C major', 'F major', 'Bb major', 'D dorian'], swing: [0, 0], master: 'open', form: 'jazz', prog: '<1 4 0 5>',
    tracks: [['ride', '[x _ _] [x\' _ x] [x _ _] [x\' _ x]', '| aride gain .3 pan .2 human .3'], ['foot', '. x . x', '| ahat gain .45 vel .6 dec .4'],
      ['brush', '~beat', '| asnare gain .3 vel .5 dens .3 human .4 evolve 2'], ['bass', '~bass walk', '| zither oct 2 bright .22 dec 1.2 gain 3 hpf 30 human .2 evolve 2'],
      ['comp', '~chords comp', '| piano oct 4 gain .34 rel .25 drop2 human .3 evolve 4'], ['vibes', '~melody', '| oct 5 dens .55 evolve 4 gain .34 delay .2 verb .3 human .3']] },
};
const COMPOSE_LIST = Object.keys(COMPOSE_STYLES);
// sections: which tracks play and how the change sounds; lengths vary with the seed
function composeForm(r, form, names) {
  const has = n => names.includes(n), pickNames = (...xs) => xs.filter(has);
  const drums = names.filter(n => /kick|snare|clap|hat|perc|ride|foot|brush|air/.test(n));
  const harm = names.filter(n => /pad|stab|keys|chord|comp|drone|arp|harp/.test(n));
  const lead = names.filter(n => /lead|bell|vibes|sax/.test(n));
  const bass = names.filter(n => /bass|reese|acid|sub/.test(n));
  const L = (a, b) => pick(r, [a, b]);
  if (form === 'drift') return { scenes: [['dawn', [...harm.slice(0, 1), 'drone'].filter(has), []], ['flow', [...harm, ...bass, ...lead], ['swell']], ['glow', ['all'], []], ['fade', [...harm, ...lead], ['down']]], song: [['dawn', 8], ['flow', L(8, 16)], ['glow', 16], ['flow', 8], ['fade', 8]] };
  if (form === 'jazz') return { scenes: [['intro', pickNames('ride', 'foot', 'bass', 'comp'), []], ['head', ['all'], ['fill']], ['solo', ['all'], ['fill']], ['trade', pickNames('ride', 'foot', 'brush', 'bass'), []]], song: [['intro', 4], ['head', 8], ['solo', L(8, 16)], ['trade', 4], ['head', 8]] };
  if (form === 'loop') return { scenes: [['intro', harm, []], ['beat', [...drums, ...bass, ...harm], ['pause']], ['full', ['all'], []], ['break', [...harm, ...lead], ['filter']]], song: [['intro', 4], ['beat', 8], ['full', L(8, 16)], ['break', 8], ['full', 16]] };
  const groove = [...drums.filter(n => !/clap|snare/.test(n) || form === 'song'), ...bass];
  return {
    scenes: [['intro', [...drums.filter(n => /kick|hat/.test(n)), ...harm.slice(-1)], []], ['groove', groove, ['fill']], ['build', [...drums.filter(n => /hat|clap|snare/.test(n)), ...harm, ...lead.slice(0, 1)], ['riser']],
      ['drop', ['all'], ['pause']], ['break', [...harm, ...lead], ['filter', 'down']], ['outro', [...drums.filter(n => /kick|hat/.test(n)), ...bass], []]],
    song: [['intro', L(8, 16)], ['groove', L(8, 16)], ['build', L(4, 8)], ['drop', 16], ['break', 8], ['build', 4], ['drop', 16], ['outro', 8]],
  };
}
function composeSong(style, seed, lang) {
  const S0 = COMPOSE_STYLES[style] || COMPOSE_STYLES.house, r = rng(seed * 131 + strHash(style));
  const bpm = Math.round(S0.bpm[0] + r() * (S0.bpm[1] - S0.bpm[0]));
  const key = pick(r, S0.keys), sw = S0.swing[1] ? Math.round((S0.swing[0] + r() * (S0.swing[1] - S0.swing[0])) * 100) / 100 : 0;
  const names = S0.tracks.map(x => x[0]), w = Math.max(...names.map(n => n.length)) + 1;
  const pw = Math.max(...S0.tracks.map(x => x[1].length)) + 2;
  const head = lang === 'ko'
    ? `// 자동 작곡 · ${style} · seed ${seed}\n// seed 숫자에 커서를 두고 Alt+↑↓ 하면 곡 전체가 바뀌어요. ~로 시작하는 줄은 생성기예요: dens(밀도) evolve(N마디마다 조금씩 변함)\n// 마음에 드는 줄은 Ctrl+B로 굳혀서 직접 고칠 수 있어요`
    : `// Composed · ${style} · seed ${seed}\n// Put the caret on the seed number and press Alt+↑↓ to re-roll the whole piece. Lines starting with ~ are generators: dens (density), evolve (changes a little every N bars)\n// Like a line? Ctrl+B bakes it into plain notes you can edit`;
  const lines = [head, `bpm ${bpm}`, `key ${key}`, `seed ${seed}`, S0.prog ? `prog ${S0.prog}` : `prog ~gen ${pick(r, [4, 4, 8])}`];
  if (sw) lines.push(`swing ${sw}`);
  if (S0.master !== 'default') lines.push(`master ${S0.master}`);
  lines.push('');
  for (const [n, p, par] of S0.tracks) lines.push((n.padEnd(w) + p).padEnd(w + pw) + par);
  lines.push('');
  const f = composeForm(r, S0.form, names), sw2 = Math.max(...f.scenes.map(s => s[0].length)) + 1;
  for (const [n, tr, fx] of f.scenes) lines.push(`scene ${n.padEnd(sw2)}${[...new Set(tr)].join(' ')}${fx.length ? ' ' + fx.join(' ') : ''}`);
  lines.push('song ' + f.song.map(([n, b]) => `${n}:${b}`).join(' '));
  return lines.join('\n') + '\n';
}
