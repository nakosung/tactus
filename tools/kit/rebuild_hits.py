# Rebuild only the hit (unpitched) samples of the kit: brighter crash, tom velocity layers, higher MP3 quality.
import os, sys, json, base64, subprocess
import numpy as np
OLD = os.path.dirname(os.path.abspath(__file__)) + '/'
KIT = os.path.join(OLD, '..', '..', 'src', 'js', 'kit.js')
src = open(OLD + 'build_kit.py').read()
exec(src[:src.index('PITCHED = {')].replace("os.path.dirname(os.path.abspath(__file__))", repr(OLD.rstrip('/'))))
def encode_hq(x):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    # VBR quality 2 keeps the top octave (LAME low-pass ~19-20 kHz instead of ~16.5 kHz at q6)
    return subprocess.run(['ffmpeg', '-v', 'error', '-f', 's16le', '-ar', str(SR), '-ac', '1', '-i', '-', '-c:a', 'libmp3lame', '-q:a', '2', '-f', 'mp3', '-'], input=pcm, capture_output=True, check=True).stdout
HLAYERS = {
    'asnare': [(['Snare2_HitSN_v3_rr1_Mid.wav'], 0), (['Snare2_HitSN_v9_rr1_Mid.wav'], 2)],
    'ahat':   [(['HiHat_HitC_v1_rr1_Mid.wav'], 0), (['HiHat_HitC_v4_rr1_Mid.wav'], 2)],
    'conga':  [(['Conga_HitN_v1_rr1_Sum.wav'], 0)],
    # toms get soft and hard hits, so fills grow in tone and not only in level
    'atom':   [(['TomH_HitS_v2_rr1_Mid.wav'], 0), (['TomH_HitS_v4_rr1_Mid.wav'], 2)],
    'afloor': [(['TomL_HitS_v2_rr1_Mid.wav'], 0), (['TomL_HitS_v4_rr1_Mid.wav'], 2)],
    'acrash': [(['susCymb2_hit_f1.wav'], 0)],
}
HITS = {
    'asnare':   (['Snare2_HitSN_v5_rr1_Mid.wav', 'Snare2_HitSN_v5_rr2_Mid.wav'], 0.7, 0.2),
    'ahat':     (['HiHat_HitC_v3_rr1_Mid.wav', 'HiHat_HitC_v3_rr2_Mid.wav'], 0.3, 0.1),
    'aohat':    (['HiHat_HitO_rr1_Mid.wav'], 1.1, 0.4),
    'atom':     (['TomH_HitS_v3_rr1_Mid.wav', 'TomH_HitS_v3_rr2_Mid.wav'], 0.9, 0.3),
    'afloor':   (['TomL_HitS_v3_rr1_Mid.wav', 'TomL_HitS_v3_rr2_Mid.wav'], 1.0, 0.3),
    'aride':    (['susCymb2_hit_stick_mf1.wav'], 2.0, 0.8),
    # was susCymb1_hit_f1, a soft-mallet hit with almost nothing above 8 kHz; this one is struck hard
    'acrash':   (['susCymb2_hit_fff1.wav'], 3.6, 1.6),
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
kjs = open(KIT).read()
head, body = kjs.split('const KIT_DATA = ', 1)
kit = json.loads(body.strip().rstrip(';'))
before = sum(len(json.dumps(kit[n])) for n in HITS)
for name, (paths, dur, fade) in HITS.items():
    ent = {'p': 0, 's': []}
    # each layer is normalized on its own; the hit's velocity sets the level
    groups = [(pick_hits(lp, dur, fade), layer) for lp, layer in [(paths, 1)] + HLAYERS.get(name, [])]
    for xs, layer in groups:
        if not xs: print('missing layer', name, layer); continue
        peak = max(np.abs(x).max() for x in xs)
        for x in xs:
            e = base64.b64encode(encode_hq(x / peak * 0.89)).decode()
            ent['s'].append(e if layer == 1 else [e, layer])
    kit[name] = ent
after = sum(len(json.dumps(kit[n])) for n in HITS)
open(KIT, 'w').write(head + 'const KIT_DATA = ' + json.dumps(kit, separators=(',', ':')) + ';\n')
print('hits base64 before %.0f KB, after %.0f KB' % (before / 1024, after / 1024))
