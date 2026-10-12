"""Print the Tactus lines for the example songs transcribed from Mutopia scores (run render.sh first).

The arrangement around these lines (instruments, drums, scenes) is written by hand in src/js/presets.js."""
import conv
from conv import load, line
SHARP = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']
FLAT = ['c', 'c#', 'd', 'eb', 'e', 'f', 'f#', 'g', 'ab', 'a', 'bb', 'b']
out = {}

# ---- Für Elise: two 3/8 bars per cycle (12 sixteenths); A A (B A') (B A''), last bar swapped for the first ending
conv.NN = SHARP
tpb, T = load('fur_Elise_WoO59_u.midi')
M = lambda k: 192 + (k - 1) * 576
cyc = [[(M(2 * c + 1), 6), (M(2 * c + 2) if c < 21 else M(8), 6)] for c in range(22)]
bassN = [(s, 6 * 96, p, v) for s, d, p, v in T[2] if p < 50 and (s - 192) % 576 == 0]
out['elise'] = dict(rh=line(T[1], cyc, 96), lh=line(T[2], cyc, 96), bass=line(bassN, cyc, 96))

# ---- Gymnopédie No. 1: one 3/4 bar per cycle (6 eighths), bars 1-39, split into melody, chords and bass
tpb, T = load('gymnopedie_1_u.midi')
from collections import Counter
allN = sorted(T[1] + T[2]); q = lambda x: int(round(x / 192))
cnt = Counter((q(s), q(d)) for s, d, p, v in allN if p >= 48)
onsets = Counter(q(s) for s, d, p, v in allN if p >= 48)
chordOn = {k for (k, d), c in cnt.items() if c >= 2}
# a chord tone the melody also holds is played again by the MIDI; it belongs to the chord
role = lambda s, d, p: 'bass' if p < 48 else ('chord' if cnt[(q(s), q(d))] >= 2 or (p < 69 and q(s) in chordOn) else 'mel')
cyc = [[((k - 1) * 1152, 6)] for k in range(1, 40)]
g = {r: conv.cycles_of(allN, cyc, 192, lambda s, d, p, r=r: role(s, d, p) == r) for r in ('mel', 'chord', 'bass')}
print('gym mel 9-12 before', g['mel'][8:12], g['chord'][8:12])
g['mel'][8:12] = ['f#4', '.', '.', '.']   # bars 9-12: one F# tied over four bars, as in the score
out['gymno'] = {r: conv.join(v) for r, v in g.items()}

# ---- The Entertainer: two 2/4 bars per cycle (16 sixteenths); A strain (2nd ending into B), B strain (2nd ending back to A)
conv.NN = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'ab', 'a', 'bb', 'b']
tpb, T = load('entertainer_u.midi')
M = lambda k: (k - 1) * 768
bars = list(range(5, 20)) + [36] + list(range(53, 69))
cyc = [[(M(bars[2 * c]), 8), (M(bars[2 * c + 1]), 8)] for c in range(len(bars) // 2)]
# bass: the lowest note of each "oom" (beats 1 and 2 of the left hand)
groups = {}
for s, d, p, v in T[2]:
    if s % 384 == 0: groups.setdefault(s, []).append((s, d, p, v))
oom = [min(g, key=lambda n: n[2]) for g in groups.values()]
oom = [n for n in oom if n[2] < 52]
out['rag'] = dict(rh=line(T[1], cyc, 96), lh=line(T[2], cyc, 96), bass=line(oom, cyc, 96))

# ---- In the Hall of the Mountain King: the 16-bar theme (B minor twice, then F#), one bar per cycle in eighths
conv.NN = SHARP
tpb, T = load('Dans_l_antre_du_roi_de_la_montagne_u.midi')
M = lambda k: (k - 1) * 1536
th = [[(M(k), 8)] for k in [6, 7, 8, 9, 6, 7, 8, 9, 14, 15, 16, 17, 14, 15, 16, 17]]
bs = [[(M(k), 8)] for k in [2, 3, 4, 5, 2, 3, 4, 5, 10, 11, 12, 13, 10, 11, 12, 13]]
out['mountain'] = dict(theme=line(T[1], th, 192, lambda s, d, p: p >= 45), lead=line(T[1], th, 192, lambda s, d, p: p >= 45, tr=24),
                       bass=line(T[2], bs, 192, tr=12))

# ---- Canon in D: one bar per cycle (16 sixteenths), bars 1-18
tpb, T = load('canon3.midi')
cyc = [[((k - 1) * 1536, 16)] for k in range(1, 19)]
out['canon'] = dict(v1=line(T[1], cyc, 96), v2=line(T[2], cyc, 96), v3=line(T[3], cyc, 96), cello=line(T[4], cyc, 96))
import json; json.dump(out, open('lines.json', 'w'), indent=1)   # read by hand when updating presets.js
for k, v in out.items():
    for n, l in v.items(): print(k, n, len(l), l[:160])
