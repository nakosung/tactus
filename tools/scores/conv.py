"""MIDI -> Tactus mini-notation. A cycle is built from pieces (src_tick, n_steps); each hand is split into
monophonic voices whose events may be chords (stacked), and the voices are layered with ',' inside the cycle."""
import mido
from collections import defaultdict
NN = ['c', 'c#', 'd', 'eb', 'e', 'f', 'f#', 'g', 'ab', 'a', 'bb', 'b']
def nname(n): return NN[n % 12] + str(n // 12 - 1)
def load(path):
    f = mido.MidiFile(path); out = {}
    for ti, tr in enumerate(f.tracks):
        t = 0; on = defaultdict(list); ns = []
        for m in tr:
            t += m.time
            if m.type == 'note_on' and m.velocity > 0: on[(m.channel, m.note)].append((t, m.velocity))
            elif m.type == 'note_off' or (m.type == 'note_on' and m.velocity == 0):
                k = (m.channel, m.note)
                if on[k]: s, v = on[k].pop(0); ns.append((s, t - s, m.note, v))
        out[ti] = sorted(ns)
    return f.ticks_per_beat, out
def cycle_events(notes, pieces, st, flt=None, tr=0):
    """events as (step, dur_steps, pitch) inside one cycle; pieces = [(src_tick, n_steps)]"""
    ev = []; pos = 0; total = sum(n for _, n in pieces)
    for src, n in pieces:
        for s, d, p, v in notes:
            if src - st / 2 <= s < src + n * st - st / 2:
                if flt and not flt(s, d, p): continue
                k = pos + int(round((s - src) / st))
                dur = max(1, int(round(d / st)))
                ev.append((k, min(dur, total - k), p + tr))
        pos += n
    return ev, total
def voices_of(ev):
    groups = defaultdict(list)
    for k, d, p in ev: groups[(k, d)].append(p)
    chords = sorted(((k, d, sorted(ps)) for (k, d), ps in groups.items()), key=lambda c: (c[0], -max(c[2])))
    vs = []  # each: list of (k, d, pitches)
    for k, d, ps in chords:
        free = [v for v in vs if v[-1][0] + v[-1][1] <= k]
        if free:
            v = min(free, key=lambda v: abs(max(v[-1][2]) - max(ps))); v.append((k, d, ps))
        else:
            # a voice whose note still sounds: cut it short only if it started earlier on this step? never; open a new voice
            vs.append([(k, d, ps)])
    vs.sort(key=lambda v: -sum(max(c[2]) for c in v) / len(v))
    return vs
def tok(ps): return nname(ps[0]) if len(ps) == 1 else '[' + ','.join(nname(p) for p in ps) + ']'
def w(t, n): return t if n == 1 else ((t + ' ' + t if t == '.' else t + ' _') if n == 2 else f'{t}@{n}')
def render_voice(v, total):
    seg = []; pos = 0
    for k, d, ps in v:
        if k > pos: seg.append(('.', k - pos))
        seg.append((tok(ps), d)); pos = k + d
    if pos < total: seg.append(('.', total - pos))
    from math import gcd
    from functools import reduce
    g = reduce(gcd, [n for _, n in seg])   # write quarter notes as quarters, not as four held sixteenths
    return ' '.join(w(t, n // g) for t, n in seg)
def cycle(notes, pieces, st, flt=None, tr=0):
    ev, total = cycle_events(notes, pieces, st, flt, tr)
    if not ev: return '.'
    vs = voices_of(ev)
    parts = [render_voice(v, total) for v in vs]
    if len(parts) == 1 and (' ' not in parts[0] or (parts[0].startswith('[') and parts[0].count('[') == 1 and parts[0].endswith(']'))):
        return parts[0]   # one note or one chord for the whole bar
    return '[' + ', '.join(parts) + ']'
def cycles_of(notes, cycles, st, flt=None, tr=0):
    return [cycle(notes, c, st, flt, tr) for c in cycles]
def join(cs):
    # write the shortest period: a two-bar ground bass needs two entries, not eighteen
    n = len(cs)
    for p in range(1, n + 1):
        if n % p == 0 and all(cs[i] == cs[i % p] for i in range(n)): cs = cs[:p]; break
    return cs[0] if len(cs) == 1 else '<' + ' '.join(cs) + '>'
def line(notes, cycles, st, flt=None, tr=0):
    return join(cycles_of(notes, cycles, st, flt, tr))
