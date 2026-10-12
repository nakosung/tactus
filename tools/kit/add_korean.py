# Run from korean/ after kr_synth.py and kkw_synth.py: encodes their WAVs into src/js/kit.js
import json, base64, subprocess, wave, numpy as np, glob, os
KIT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'js', 'kit.js')
def enc(path):
    return subprocess.run(['ffmpeg','-v','error','-i',path,'-c:a','libmp3lame','-q:a','2','-f','mp3','-'],capture_output=True,check=True).stdout
# instrument -> [(file, layer)]
SETS = {
  'kung':    [('kung_0',0),('kung_1',1),('kung_2',1),('kung_3',2)],
  'deok':    [('deok_0',0),('deok_1',1),('deok_2',1),('deok_3',2)],
  'buk':     [('buk_0',0),('buk_1',1),('buk_2',1),('buk_3',2)],
  'buktak':  [('buktak_0',1)],
  'jing':    [('jing_0',0),('jing_1',1),('jing_2',1)],
  'kkwaeng': [('kkwaeng_0',0),('kkwaeng_1',1),('kkwaeng_2',1)],
  'kkwaengm':[('kkwaengm_0',1),('kkwaengm_1',1)],
}
kjs=open(KIT).read(); head, body = kjs.split('const KIT_DATA = ',1); kit=json.loads(body.strip().rstrip(';'))
tot=0
for name, items in SETS.items():
    ent={'p':0,'s':[]}
    for f, layer in items:
        b=base64.b64encode(enc(f+'.wav')).decode(); tot+=len(b)
        ent['s'].append(b if layer==1 else [b, layer])
    kit[name]=ent
c = '// kung deok buk buktak jing kkwaeng kkwaengm: synthesized for Tactus from physical models (tactus/korean/), CC0\n'
head = head if c in head else head.rstrip('\n') + '\n' + c
open(KIT,'w').write(head + 'const KIT_DATA = ' + json.dumps(kit, separators=(',',':')) + ';\n')
print('added %.0f KB' % (tot/1024))
