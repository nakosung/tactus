"""Select, download and prepare a compact CC0 kit from VCSL for embedding in Tactus.
Writes out/kit.js; then run rebuild_hits.py (percussion) and add_korean.py (Korean percussion) on src/js/kit.js.
Pitched instruments: notes are verified by measuring the fundamental, not just trusting file names."""
import re, os, sys, json, base64, subprocess, urllib.parse, urllib.request
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
FILES = [l.strip() for l in open(os.path.join(HERE, 'files.txt'))]
RAW = 'https://raw.githubusercontent.com/sgossner/VCSL/master/'
DL = os.path.join(HERE, 'dl'); OUT = os.path.join(HERE, 'out'); os.makedirs(DL, exist_ok=True); os.makedirs(OUT, exist_ok=True)
SR = 44100
NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}

def name_midi(fn):
    m = re.search(r'(?<![A-Za-z])([A-G])(#?)(-?\d)(?!\d)', os.path.basename(fn))
    if not m: return None
    return 12 * (int(m.group(3)) + 1) + NOTE[m.group(1)] + (1 if m.group(2) else 0)

def fetch(path):
    local = os.path.join(DL, path.replace('/', '__'))
    if not os.path.exists(local):
        url = RAW + urllib.parse.quote(path)
        with urllib.request.urlopen(url, timeout=60) as r, open(local, 'wb') as f: f.write(r.read())
    return local

def load(local):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', local, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()

def measure_midi(x):
    # fundamental by autocorrelation on a steady window after the attack
    st = int(0.08 * SR); seg = x[st:st + 8192]
    if len(seg) < 4096 or np.abs(seg).max() < 1e-4: return None
    seg = seg - seg.mean()
    c = np.correlate(seg, seg, 'full')[len(seg) - 1:]
    lo, hi = int(SR / 2100), int(SR / 27)
    c[:lo] = 0
    lag = lo + int(np.argmax(c[lo:hi]))
    if c[lag] <= 0: return None
    return 69 + 12 * np.log2((SR / lag) / 440)

def prep(x, dur, fade):
    a = np.abs(x); thr = max(a.max() * 0.004, 1e-5)
    i0 = max(0, int(np.argmax(a > thr)) - int(0.002 * SR))
    x = x[i0:i0 + int(dur * SR)].copy()
    f = min(len(x), int(fade * SR))
    if f > 0: x[-f:] *= np.linspace(1, 0, f) ** 2
    return x

def encode(x):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    mp3 = subprocess.run(['ffmpeg', '-v', 'error', '-f', 's16le', '-ar', str(SR), '-ac', '1', '-i', '-', '-c:a', 'libmp3lame', '-q:a', '6', '-f', 'mp3', '-'],
                         input=pcm, capture_output=True, check=True).stdout
    return mp3

def pick_pitched(folder, must, dur, fade, spacing=3, lo=24, hi=100):
    cands = [f for f in FILES if f.startswith(folder) and f.endswith('.wav') and all(s in f for s in must)]
    by = {}
    for f in cands:
        n = name_midi(f)
        if n is not None and lo <= n <= hi and n not in by: by[n] = f
    chosen, last = [], -99
    for n in sorted(by):
        if n - last >= spacing: chosen.append(n); last = n
    loaded = [(n, load(fetch(by[n]))) for n in chosen]
    # file names in some VCSL folders are an octave off: use the instrument's majority measured octave offset
    votes = {}
    for n, x in loaded:
        m = measure_midi(x)
        if m is None: continue
        o = round((m - n) / 12) * 12
        if abs(m - (n + o)) < 0.7: votes[o] = votes.get(o, 0) + 1
    off = max(votes, key=votes.get) if votes else 0
    return [(n + off, prep(x, dur, fade), by[n], off) for n, x in loaded]

def pick_hits(paths, dur, fade):
    res = []
    for p in paths:
        hits = [f for f in FILES if f.endswith('/' + p) or f.endswith(p)]
        if not hits: print('MISSING', p); continue
        res.append(prep(load(fetch(hits[0])), dur, fade))
    return res

PITCHED = {
    'piano':    ('Chordophones/Zithers/Grand Piano, Steinway B/Sus/', ['_vl3_'], 3.4, 0.7, 4, 36, 96),
    'vibes':    ('Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/', ['_v2_'], 3.0, 0.6, 2, 0, 127),
    'harp':     ('Chordophones/Composite Chordophones/Concert Harp/', ['_mf1'], 2.6, 0.6, 4, 36, 96),
    'sax':      ('Aerophones/Reed Aerophones/Tenor Saxophone/Non-Vibrato/', ['_vl3_'], 2.2, 0.35, 3, 0, 127),
    'dantranh': ('Chordophones/Zithers/Dan Tranh/Normal/', ['_f_'], 2.6, 0.6, 2, 0, 127),
    'harpsi':   ('Chordophones/Zithers/Harpsichord, English/Sustains/Normal/', ['_rr1'], 2.2, 0.5, 4, 36, 92),
    'marimba':  ('Idiophones/Struck Idiophones/Marimba/', ['_med_01'], 1.4, 0.3, 2, 0, 127),
    'kalimba':  ('Idiophones/Plucked Idiophones/Kalimba, Tanzania/', [''], 1.6, 0.4, 3, 0, 127),
}
# extra velocity layers: soft (0) and hard (2); the main entry above is layer 1
PLAYERS = {
    'piano': [(['_vl2_'], 0, 6), (['_vl4_'], 2, 6)],
    'vibes': [(['_v1_'], 0, 4)],
    'sax':   [(['_vl2_'], 0, 6)],
}
HLAYERS = {
    'asnare': [(['Snare2_HitSN_v3_rr1_Mid.wav'], 0), (['Snare2_HitSN_v9_rr1_Mid.wav'], 2)],
    'ahat':   [(['HiHat_HitC_v1_rr1_Mid.wav'], 0), (['HiHat_HitC_v4_rr1_Mid.wav'], 2)],
    'conga':  [(['Conga_HitN_v1_rr1_Sum.wav'], 0)],
}
HITS = {
    'asnare':   (['Snare2_HitSN_v5_rr1_Mid.wav', 'Snare2_HitSN_v5_rr2_Mid.wav'], 0.7, 0.2),
    'ahat':     (['HiHat_HitC_v3_rr1_Mid.wav', 'HiHat_HitC_v3_rr2_Mid.wav'], 0.3, 0.1),
    'aohat':    (['HiHat_HitO_rr1_Mid.wav'], 1.1, 0.4),
    'atom':     (['TomH_HitS_v3_rr1_Mid.wav'], 0.9, 0.3),
    'afloor':   (['TomL_HitS_v3_rr1_Mid.wav'], 1.0, 0.3),
    'aride':    (['susCymb2_hit_stick_mf1.wav'], 2.0, 0.8),
    'acrash':   (['susCymb1_hit_f1.wav'], 2.8, 1.2),
    'handclap': (['Clap_rr1.wav', 'Clap_rr2.wav'], 0.5, 0.15),
    'conga':    (['Conga_HitN_v3_rr1_Sum.wav', 'Conga_HitN_v3_rr2_Sum.wav'], 0.7, 0.2),
    'bongo':    (['BongoH_Hit1_v2_rr1_Mid.wav', 'BongoH_Hit1_v2_rr2_Mid.wav'], 0.45, 0.15),
    'cajon':    (['Cajon_hit1_f_rr1.wav', 'Cajon_hit1_f_rr2.wav'], 0.5, 0.15),
    'cajonslap':(['Cajon_hit2_f_rr1.wav', 'Cajon_hit2_f_rr2.wav'], 0.4, 0.12),
    'tamb':     (['Tamb1_Hit_v2_rr1_Mid.wav'], 0.6, 0.2),
    'shake':    (['Mid_ShakerDouble_Down_rr1.wav', 'Mid_ShakerDouble_Up_rr1.wav'], 0.3, 0.08),
    'claves':   (['Claves1_Hit_v2_rr1_Mid.wav'], 0.3, 0.1),
    'cowbell':  (['Cowbell1_Normal_v3_rr1_Mid.wav'], 0.5, 0.2),
    'woodblock':(['wood_click_f_rr1.wav', 'wood_click_f_rr2.wav'], 0.3, 0.1),
    'triangle': (['Triangle1_Hit_v2_rr1_Mid.wav'], 1.6, 0.6),
    'agogo':    (['Agogo_High_v2_rr1_Mid.wav'], 0.6, 0.2),
    'framedrum':(['HDrumL_Hit_v3_rr1_Sum.wav'], 0.9, 0.3),
    'darbuka':  (['Darbuka_1_hit_vl2_rr1.wav', 'Darbuka_1_hit_vl2_rr2.wav'], 0.6, 0.2),
    'gong':     (['gong_mf.wav'], 4.5, 1.8),
}
kit, report, total = {}, [], 0
for name, (folder, must, dur, fade, spacing, lo, hi) in PITCHED.items():
    kit[name] = {'p': 1, 's': []}
    for lmust, layer, lsp in [(must, 1, spacing)] + PLAYERS.get(name, []):
        items = pick_pitched(folder, lmust, dur, fade, lsp, lo, hi)
        if not items: print('NO LAYER', name, lmust); continue
        peak = max(np.abs(x).max() for _, x, _, _ in items)
        for midi, x, src, meas in items:
            b = encode(x / peak * 0.89); total += len(b)
            kit[name]['s'].append([int(midi), base64.b64encode(b).decode(), layer])
            report.append(f'{name:9s} L{layer} {midi:3d} measured {meas}  {os.path.basename(src)}')
    kit[name]['s'].sort(key=lambda e: (e[2], e[0]))
for name, (paths, dur, fade) in HITS.items():
    kit[name] = {'p': 0, 's': []}
    for lpaths, layer in [(paths, 1)] + HLAYERS.get(name, []):
        xs = pick_hits(lpaths, dur, fade)
        if not xs: continue
        peak = max(np.abs(x).max() for x in xs)
        for x in xs:
            b = encode(x / peak * 0.89); total += len(b)
            e = base64.b64encode(b).decode()
            kit[name]['s'].append(e if layer == 1 else [e, layer])
open(os.path.join(OUT, 'kit.js'), 'w').write('// Tactus built-in kit: samples from VCSL (Versilian Community Sample Library), CC0 1.0\nconst KIT_DATA = ' + json.dumps(kit, separators=(',', ':')) + ';\n')
open(os.path.join(OUT, 'report.txt'), 'w').write('\n'.join(report))
print('instruments', len(kit), 'mp3 bytes', total, 'kit.js bytes', os.path.getsize(os.path.join(OUT, 'kit.js')))
