// ===================== Tactus example songs =====================
const PRESETS = [
  {
    id: 'trance', name: 'Trance',
    head: {
      ko: '// Trance — 138 BPM. 한 줄이 한 트랙, 숫자는 스케일 음정 (0 = 지금 코드의 근음)\n// 곡 모드: 맨 아래 song 줄 순서대로 진행. A S D F G H 로 씬을 직접 바꾸면 DJ 모드',
      en: '// Trance — 138 BPM. One line is one track, numbers are scale degrees (0 = root of the current chord)\n// Song mode follows the song line at the bottom. Press A S D F G H to launch scenes yourself',
    },
    body: `bpm 138
key A minor
prog <0 5 2 6>          // Am F C G

kick   x x x x
hat    [. x]*4                          | gain .45 pan .25 human .2 sometimes .12 ply 2
ohat   . . . . . . x .                  | gain .3
clap   . x . x                          | gain .6 verb .25
bass   [. 0 0 0]*4                      | cut 600 res 5 shape k4(0,.7) duck .8
arp    [0' 2 4 7 4' 2 0 2]*2             | cut k1(300,6000) res 9 delay .35 duck .5 iter 4   // iter: each bar starts a step further in
pad    0^                               | gain .35 duck .9 verb k3(.1,.9)
lead   <[4 . 4 2] [2 . 2 0] [4 _ 7 6] [4 _ 2 _]> | oct 5 cut k2(800,8000) delay .3 verb .4 gain .45
// acid  [0 0 7 0]*4?.2                | cut 300~1800/8 res 18 delay .2
// loop1 | gain .9 cut 3000 duck .4
// chop  [0 . 3 x] [2 2 . 5]           | loop1 slices 8 verb .2

scene intro  kick hat pad
scene groove kick hat ohat clap bass arp fill
scene build  hat clap arp pad riser | arp.cut 400>5000
scene drop   all pause
scene break  pad lead arp filter down
scene outro  kick hat bass
song intro:8 groove:8 build:8 drop:16 break:8 build:4 drop:16 outro:8
`,
  },
  {
    id: 'dnb', name: 'Drum & Bass',
    head: {
      ko: '// Drum & Bass — 174 BPM 투스텝. k1로 리스 베이스를 열고, X 빌드업 → 드롭, C로 브레이크 리피트',
      en: '// Drum & Bass — 174 BPM two-step. Open the reese with k1, X to build → drop, C for a break repeat',
    },
    body: `bpm 174
key F minor
prog <0 0 5 3>          // Fm Fm Db Bbm

kick   x . . . . . . . . . x . . . . .
snare  . . . . x . . . . . . . x . . .  | gain .85 tune 1.15 verb .15
ghost  . . . . . . . x . x . . . . . x? | snare gain .22 tune 1.3 pan -.2 human .4
hat    x*16                             | gain .32 vel [1 .4 .7 .4]*4 pan .25 human .25 every 8 ply 2
ohat   . . . . . . . . . . . . . . x .  | gain .25
reese  0 _ _ _ _ _ . 0 _ _ . . <3 5> _ _ . | supersaw oct 1 cut k1(250,2000) res 3 detune 38 shape .45 gain .7 duck .5
sub    0 _ _ _ _ _ . 0 _ _ . . <3 5> _ _ . | oct 1 gain .5 duck .5
pad    0^7                              | gain .22 atk 1.5 rel 2.5 verb k3(.3,.9) duck .3
bell   [. . 4 .] [. 7 . .] [. . 6 .] [4 . . .] | oct 5 gain .16 delay .45 verb .5 cut k2(1500,9000) jux rev   // jux: reversed on the right

scene intro pad bell hat
scene build hat snare pad bell riser
scene drop  all pause
scene roll  kick snare ghost hat reese sub fill
scene break pad bell filter down
song intro:8 build:8 drop:16 roll:8 break:8 build:4 drop:16 intro:8
`,
  },
  {
    id: 'house', name: 'Deep House',
    head: {
      ko: '// Deep House — 124 BPM, 살짝 스윙. k1로 코드 스탭 필터, 3·4번 키로 하이햇 뮤트',
      en: '// Deep House — 124 BPM with a little swing. k1 opens the chord stabs, keys 3 and 4 mute the hats',
    },
    body: `bpm 124
key A minor
prog <0 3>              // Am7 Dm7
swing .12

kick   x x x x
clap   . x . x                          | gain .5 verb .25 nudge 6 human .2
hat    [. x]*4                          | gain .5 pan .15 human .15
shaker x*16                             | gain .3 vel [.35 .95 .55 1]*4 pan -.3 human .3 degrade .1
bass   [. 0 . 0] [. . 0 4]              | cut k2(300,1500) res 4 duck .6
stab   [. . 0^7 .] [. 0^7 . .] . [. . 0^7 .] | oct 3 cut k1(500,4000) res 3 env .5 dec .3 verb .3 duck .5 gain .5 echo 3 3/16 .45   // dub echoes of each stab
pad    0^7                              | gain .2 atk .8 rel 1.5 verb .6 duck .7
bell   <. [. . 4 .] . [. 6 . 4]>        | oct 5 gain .2 delay .5 verb k3(.2,.8) pan perlin(-.6,.6,4)

scene intro  kick hat shaker
scene groove kick clap hat shaker bass
scene main   all fill
scene break  pad stab bell shaker filter down
scene build  kick hat shaker stab riser
song intro:8 groove:8 main:16 break:8 build:4 main:16 groove:8
`,
  },
  {
    id: 'techno', name: 'Techno',
    head: {
      ko: '// Techno — 130 BPM 프리기안 애시드. k1 애시드 필터, k4 디스토션, V로 스터터',
      en: '// Techno — 130 BPM phrygian acid. k1 is the acid filter, k4 distortion, V to stutter',
    },
    body: `bpm 130
key F# phrygian
master loud

kick   x x x x                          | gain 1.1 dec 1.4 tune .9
hat    x*16                             | gain [.4 .15 .25 .15]*4
ohat   [. x]*4                          | gain .3 dec .7
rim    x(3,8,2)                         | gain .35 delay .35 pan .3 sometimes .2 ply 2
perc   {x . . x . x . . x . . x .}%16  | tom tune 1.4 gain .3 pan -.3 delay .2
acid   [0 0 7 0] [3 0 1 0] [0 7 0 10] [0 1 0 3] | cut k1(200,2500) res 14 env .9 dec .14 slide [0 0 1 0 0 1 0 0]*2 acc [1 0 0 1 0 0 1 0]*2 delay .2 duck .3 shape k4(0,.6) every 8 rev chunk 4 +7   // chunk: one quarter an octave up, moving each bar
drone  0/4                              | pad oct 2 gain .2 cut 600 atk 2 rel 3 verb .8
// clap . . . x?.3                      | gain .4 verb .4

scene intro  kick drone rim
scene groove kick hat ohat rim perc drone swell
scene acid   all pause
scene break  drone acid perc filter down
song intro:8 groove:16 acid:16 break:8 acid:16 groove:8
`,
  },
  {
    id: 'lofi', name: 'Lo-fi Hip Hop',
    head: {
      ko: '// Lo-fi Hip Hop — 82 BPM, 스윙 .3. prog에 코드 이름을 직접 써요 (Gm7 C7 Fmaj7 Dm7)',
      en: '// Lo-fi Hip Hop — 82 BPM, swing .3. The prog line uses chord names directly (Gm7 C7 Fmaj7 Dm7)',
    },
    body: `bpm 82
key F major
prog <Gm7 C7 Fmaj7 Dm7>   // chord symbols: degrees follow each chord
swing .3
master warm

kick   x . . . . . . x . . x . . . . .  | gain .9 tune .85 dec .8
snare  . . . . x . . . . . . . x . . .  | gain .55 tune .85 verb .25 dec 1.3 nudge 14 human .3
hat    x*16?.2                          | gain [.28 .1 .18 .1]*4 dec .8 pan .3 human .4
vinyl  x*32                             | hat gain .05 tune .5 dec .4 pan rand(-.6,.2) degrade .8
bass   0 _ . [. 0] . . 4 .              | sine oct 2 gain .85 rel .1
keys   0^7 _ _ . . . [. 0^7'] _         | oct 3 cut k1(1200,7000) gain .4 verb .3 shape .1 drop2 human .3
bell   <[4 . . 2] [. . 0 .] [6 . 4 .] .> | oct 5 gain .22 delay .35 verb k3(.2,.8) cut 3000 jux rev

scene intro keys vinyl
scene beat  all -bell pause
scene full  all
scene break keys bell vinyl filter
song intro:4 beat:8 full:16 break:8 full:16
`,
  },
  {
    id: 'synthwave', name: 'Synthwave',
    head: {
      ko: '// Synthwave — 108 BPM. 큰 리버브 스네어와 옥타브 베이스, k1 아르페지오 필터',
      en: '// Synthwave — 108 BPM. Big reverb snare and octave bass, k1 filters the arpeggio',
    },
    body: `bpm 108
key E minor
prog <0 5 3 4>          // Em C Am Bm

kick   x . x .                          | gain 1
snare  . x . x                          | gain .7 verb .6 dec 1.5 human .15
hat    x*8                              | gain .3 vel [1 .55]*4 human .2 sometimes .15 ply 2
bass   [0 7]*4                          | saw oct 1 cut k2(400,2000) env .5 dec .15 res 3 duck .4
arp    0^7                              | updown rate 16 oct 4 cut k1(600,5000) delay .3 gain .35
pad    0^                               | gain .3 verb .6 duck .4
lead   <[7 _ _ 6] [5 _ 4 _] [4 _ _ 2] [4 _ _ _]> | supersaw oct 4 cut 2600 atk .04 verb .5 gain .4 echo 3 3/16 .4   // echoes instead of a delay send, so they follow the notes

scene intro  pad arp
scene verse  kick snare hat bass pad fill
scene build  snare hat arp riser | arp.cut 600>5000
scene chorus all pause
song intro:8 verse:16 build:4 chorus:16 verse:8 build:4 chorus:16 intro:8
`,
  },
  {
    id: 'lowpressure', name: 'Low Pressure (analog mono bass)',
    head: {
      ko: '// Low Pressure — 아날로그 모노신스 베이스 데모 영상의 소리를 분석해서 만든 새 곡이에요 (음은 새로 썼어요). D#단조 120 BPM, E 가 섞인 프리지안 색\n// mono 악기: 톱니파 두 개 + 한 옥타브 아래 서브(sub), 24dB 필터가 음마다 툭 열렸다 닫혀요. glide 는 앞 음에서 미끄러져 오는 시간\n// pulse 는 8분음표로 뛰는 베이스에 필터가 8마디에 걸쳐 열렸다 닫히고(cut 250~1400/8), bounce 는 옥타브로 튀며 서브가 바닥을 받쳐요',
      en: '// Low Pressure — an original built from an analysis of an analog monosynth bass demo (the notes are new). D# minor at 120 BPM, with a Phrygian E\n// The mono instrument: two saws plus a square sub an octave down (sub), into a 24 dB filter that snaps open on each note. glide is the time to slide in from the last note\n// pulse is an eighth-note bass under a filter that opens and closes over 8 bars (cut 250~1400/8); bounce jumps octaves with the sub holding the floor',
    },
    body: `bpm 120
key D# minor
master warm
space room

pulse  <[d#2 d#2 d#2 d#2 d#2 d#2 e2 d#2] [d#2 d#2 d#2 d#2 f#2 d#2 a#2 b2] [d#2 d#2 d#2 d#2 d#2 d#2 e2 d#2] [f#2 f#2 e2 e2 d#2 d#2 a#1 c#2]> | mono cut 250~1400/8 res 2 vel [1 .7 .85 .7]*2 glide .03
bounce <[d#2 d#3 . d#2 . d#3 a#2 d#3] [d#2 d#3 . d#2 f#3 . e3 d#3] [b1 b2 . b1 . b2 f#2 b2] [c#2 c#3 . c#2 g#2 . e3 d#3]> | mono sub .5 glide .06 cut 600~1300/4 env .8 dec .12 duck .4
kick   x x x x                       | gain .9
hat    [. x]*4                       | gain .3 human .15
clap   . x . x                       | gain .45 verb .2

scene dial   pulse
scene groove pulse kick hat
scene drop   bounce kick hat clap
song dial:8 groove:8 drop:16 groove:8
`,
  },
  {
    id: 'reeserun', name: 'Reese Run (DnB, analog voices)',
    head: {
      ko: '// Reese Run — 174 BPM 드럼앤베이스. 새 신스 엔진 데모로 새로 쓴 곡이에요\n// reese: analog 소리를 5개 겹쳐(voices 5) 조금씩 어긋나게(detune) 울려서 넓고 흔들리는 베이스. lfo cut 2 는 필터가 2마디에 한 번 천천히 열렸다 닫혀요\n// pad 는 lfo pw 로 사각파 폭이 흔들리는 PWM 패드, arp 는 FM 벨이에요. 소리 모양은 블록 보기의 〰 버튼으로 끌어서 바꿀 수 있어요',
      en: '// Reese Run — 174 BPM drum and bass, an original written to show the new synth engine\n// reese: five analog voices (voices 5), each a little detuned, for a wide moving bass. lfo cut 2 opens and closes the filter once every 2 bars\n// pad is a PWM pad (lfo pw sways the pulse width), arp is an FM bell. In the block view, the 〰 button lets you drag the sound shape',
    },
    body: `bpm 174
key F minor
prog <0 5 2 6>          // Fm Db Ab Eb
master loud
space hall

kick   x . . . . . . . . . x . . . . .   | gain 1
snare  . . . . x . . . . . . . x . . x?  | gain .8 verb .15
hat    [x x? x x]*4                      | gain .26 human .2 pan .15
reese  <[f1 _ _ _ _ _ _ _] [c#2 _ _ _ _ _ c2 _] [g#1 _ _ _ _ _ _ _] [d#1 _ _ _ d#2 _ c2 _]> | analog voices 5 detune 24 cut 420 res 1.4 env .35 dec .25 sus .8 drive .35 sub .5 lfo cut 2 sine 260 duck .6 gain .75
pad    0^                                | analog wave 1 pw .4 lfo pw 4 tri .2 voices 3 detune 16 atk .6 rel 1.5 cut 1800 gain .3 duck .8 verb .5
arp    [0 2 4 7 4 2 0' 4]                 | fmsynth oct 5 ratio 3.5 fm 2.5 fmdec .15 dec .25 sus 0 rel .3 gain .28 delay .3 pan .2 duck .4

scene intro  pad arp
scene roll   kick snare hat arp
scene drop   all
scene break  pad reese
song intro:8 roll:8 drop:16 break:8 drop:16
`,
  },
  {
    id: 'growl', name: 'Vowel Growl (halftime, wavetable)',
    head: {
      ko: '// Vowel Growl — 140 BPM 하프타임. 웨이브테이블과 모음 필터 데모로 새로 쓴 곡이에요\n// growl: wt table growl 의 프레임을 lfo scan 이 4분음표마다 훑고, vowel o 에 lfo vowel 이 모음을 a→e→i→o→u 로 움직여서 말하는 듯한 베이스가 돼요\n// vox 는 formant 테이블에 vowel <a e i o> 로 마디마다 모음이 바뀌는 리드예요',
      en: '// Vowel Growl — 140 BPM halftime, an original written to show the wavetables and the vowel filter\n// growl: lfo scan sweeps the growl table every quarter note, and lfo vowel moves the vowel filter through a e i o u, so the bass seems to talk\n// vox is a lead on the formant table whose vowel changes every bar (vowel <a e i o>)',
    },
    body: `bpm 140
key E minor
prog <0 5 2 6>          // Em C G D
master loud
space room

kick   x . . . . . . . . . x . . . . .   | gain 1
snare  . . . . . . . . x . . . . . . .   | gain .85 verb .2
hat    [. x . x? . x . x]*2              | gain .25 human .2
growl  <[e1 _ _ _ . e1 . g1] [e1 _ . e2 _ . d2 b1] [c2 _ _ _ . c2 . b1] [a1 _ . a2 g2 . e1 _]> | wt table growl scan .2 lfo scan 1/4 tri .45 vowel o lfo vowel 1/2 saw 2 cut 2400 res 1.5 drive .4 sub .45 duck .5 gain .7
vox    <[b4 _ _ _ g4 _ a4 _] [b4 _ d5 _ e5 _ _ _] [c5 _ _ _ b4 _ g4 _] [a4 _ _ _ _ _ . .]> | wt table formant scan .5 vowel <a e i o> voices 3 detune 12 atk .03 rel .4 gain .32 delay .25 verb .3 duck .4
pad    0^                                | wt table organ scan .3 atk .5 rel 1.2 cut 2600 gain .22 duck .8 verb .5

scene calm   pad vox
scene build  pad vox kick hat
scene drop   kick snare hat growl
scene full   all
song calm:8 build:8 drop:16 full:16
`,
  },
  {
    id: 'fmglass', name: 'Glass Garden (FM)',
    head: {
      ko: '// Glass Garden — 96 BPM 칠 비트. FM 신스 데모로 새로 쓴 곡이에요\n// fmsynth 는 한 사인파(모듈레이터)가 다른 사인파를 흔들어 배음을 만들어요. ratio 는 두 사인파의 비율, fm 은 흔드는 세기, fmdec 은 그 세기가 줄어드는 시간\n// keys 는 ratio 1 의 일렉트릭 피아노, bell 은 ratio 3.5 의 유리 종, bass 는 feed(되먹임)로 조금 거칠게 만든 FM 베이스예요',
      en: '// Glass Garden — 96 BPM chill beat, an original written to show the FM synth\n// fmsynth: one sine (the modulator) wobbles another, which makes harmonics. ratio sets the two sines\' ratio, fm how hard it wobbles, fmdec how fast that fades\n// keys is an electric piano (ratio 1), bell a glass bell (ratio 3.5), bass an FM bass roughened with feedback (feed)',
    },
    body: `bpm 96
key D major
prog <0 3 5 4>          // D G Bm A
master warm
space hall

kick   x . . . . . x . . . x . . . . .   | gain .85
snare  . . . . x . . . . . . . x . . .   | gain .55 verb .3
hat    [x . x x]*4                       | gain .2 human .3 swing .1
keys   [0^ _ _ . . 0^ _ .]               | fmsynth ratio 1 fm 1.4 fmdec .6 dec 1.2 sus .25 rel .8 gain .4 verb .3 duck .3
bell   <[4' . 2' . 0' . . .] [5' . 4' . 2' . . 0']> | fmsynth oct 5 ratio 3.5 fm 2.2 fmdec .4 dec .8 sus 0 rel 1 gain .24 delay .35 pan -.2
bass   [0 _ . 0 . . 4 .]                 | fmsynth oct 2 ratio 1 fm 1 feed .3 fmdec .2 dec .4 sus .5 rel .1 gain .7 duck .3

scene morning keys bell
scene walk    keys bass kick hat
scene garden  all
song morning:8 walk:8 garden:16 walk:8
`,
  },
  {
    id: 'syncchase', name: 'Sync Chase (electro, sync lead)',
    head: {
      ko: '// Sync Chase — 122 BPM 일렉트로. 하드 싱크와 피치 엔벨로프 데모로 새로 쓴 곡이에요\n// lead: sync 2.5 는 안쪽 오실레이터를 2.5배로 돌리다 겉 오실레이터에 맞춰 다시 시작시켜 날카로운 배음을 내요. lfo sync 가 그 비율을 움직이고, penv 12 pdec .04 는 음마다 한 옥타브 위에서 뚝 떨어지며 시작해요\n// pwm 패드는 wave 1(사각파)의 폭을 lfo pw 로 흔들어요',
      en: '// Sync Chase — 122 BPM electro, an original written to show hard sync and the pitch envelope\n// lead: sync 2.5 runs an inner oscillator 2.5 times faster and restarts it with the outer one, for a sharp edge; lfo sync moves that ratio, and penv 12 pdec .04 drops each note in from an octave above\n// The pwm pad sways the width of a pulse wave (wave 1) with lfo pw',
    },
    body: `bpm 122
key A minor
prog <0 5 6 4>          // Am F G Em
master loud
space room

kick   x x x x                           | gain .95
clap   . x . x                           | gain .6 verb .2
hat    [. x]*4                           | gain .3 human .15
bass   [0 0' . 0 . 0 0' .]               | analog oct 2 wave .5 cut 500 res 3 env .7 dec .12 sus .2 duck .7 gain .7
lead   <[0' . 4 . 2' . 0' 4] [5 . 4 . 2 _ 4 .] [0' . 4 . 2' . 4' 2'] [0' _ _ . . . . .]> | analog oct 4 sync 2.5 lfo sync 4 tri 1.2 penv 12 pdec .04 cut 3500 voices 2 detune 10 rel .2 gain .3 delay .3 duck .4
pwm    0^                                | analog wave 1 pw .5 lfo pw 2 tri .35 atk .3 rel .8 cut 2500 gain .26 duck .8 verb .4

scene night  pwm bass
scene run    pwm bass kick hat
scene chase  all
song night:8 run:8 chase:16 run:8 chase:16
`,
  },
  {
    id: 'calmstreets', name: 'Calm Streets (a CC0 loop, taken apart)',
    head: {
      ko: '// Calm Streets — 75 BPM 로파이. 퍼블릭 도메인(CC0) 루프 한 개를 불러와 드럼과 나머지로 나눠 가지고 노는 곡이에요\n// 루프: Ben Burnes (Abstraction), 2 Hour Track Challenge Samples Vol 4 의 "Streets of Calm - I Love This Loop", CC0\n// sample loop1 줄이 GitHub 에서 루프를 받아 loop1 칸에 넣고 드럼을 바로 나눠요 (녹음 탭에서 보여요)\n// loop1 의 drums 와 rest 가 마디마다 바뀌어요: 처음엔 드럼 없이, 다음엔 원래대로, 그다음엔 루프 드럼 대신 Tactus 킷이 같은 비트를 치고, 마지막엔 루프 드럼 위에 새 화음과 베이스가 올라가요',
      en: '// Calm Streets — 75 BPM lo-fi, built around one public-domain (CC0) loop, split into its drums and the rest\n// Loop: "Streets of Calm - I Love This Loop" from 2 Hour Track Challenge Samples Vol 4 by Ben Burnes (Abstraction), CC0\n// The sample loop1 line fetches the loop from GitHub into slot loop1 and separates its drums right away (see the Record tab)\n// loop1\'s drums and rest change by the bar: first without its drums, then as it is, then with the Tactus kit playing its beat instead, and last its drums alone under new chords and bass',
    },
    body: `bpm 75
key D minor
prog <0 5 3 4>          // Dm Bb Gm A
master warm
space room

sample loop1 github:nakosung/tactus/main/assets/loops/streets-of-calm.wav
loop1  | drums <0 0 0 0 1 1 1 1 0 0 0 0 1 1 1 1> rest <1 1 1 1 1 1 1 1 1 1 1 1 0 0 0 0> gain 1.15

kick   <[x . . . . . x . . . . . . . . .] [x . . x . . x . . . . . . . . .]> | gain .85 tune .9
snare  . . . . x . . . . . . . x . . .   | asnare gain .6 human .2
hat    [. . x .]*4                       | ahat gain .35 human .3
vibes  <[4' . . 2' . . 0' .] . [. . 5 . 4 . 2 .] .> | oct 5 gain .3 delay .3 verb .3
keys   [0^7 _ _ _ . . . .]               | epiano gain .28 verb .3
bass   [0 _ _ . . 0 4 .]                 | sine oct 2 gain .5

scene street loop1 vibes
scene groove loop1
scene kit    loop1 kick snare hat
scene dub    loop1 keys bass vibes
song street:4 groove:4 kit:4 dub:4
`,
  },
  {
    id: 'gdchip', name: 'Neon Steps (GD style)',
    head: {
      ko: '// Neon Steps — 138 BPM 칩 하우스. Geometry Dash 같은 리듬 게임 음악 스타일로 새로 쓴 곡이에요 (원곡 없음)\n// 사각파 아르페지오, 오프비트 베이스, 사이드체인 슈퍼소 훅. 마지막 드롭에선 사각파가 한 옥타브 위에서 훅을 겹쳐요\n// auto 줄은 FX 시퀀스예요: 패드를 패턴대로 자동으로 눌러요 (스터터, 에코 아웃)',
      en: '// Neon Steps — 138 BPM chip house. An original in the style of rhythm-game music like Geometry Dash (not based on any song)\n// Square-wave arpeggio, offbeat bass, a sidechained supersaw hook. In the last drop a square wave doubles the hook an octave up\n// The auto lines are FX sequences: they press pads from a pattern (a stutter, an echo out)',
    },
    body: `bpm 138
key F major
prog <0 4 5 3>          // F C Dm Bb
master loud

kick   x x x x                          | gain 1 drive .1
clap   . x . x                          | gain .6 verb .2
hat    [. x]*4                          | gain .4 pan .2 human .15 every 4 ply 2
ohat   . . . . . . x .                  | gain .28
crash  <x . . . . . . .>                | gain .35
bass   [. 0 . 0']*2                     | bass oct 2 cut 900 res 4 duck .8 gain .8
chip   [0 2 4 7 4 2 0' 2]*2             | square oct 5 cut 5000 gain .17 duck .5 delay .2 iter 4
pad    0^                               | gain .3 duck .9 verb .5
let hook = <[4 . 4 . 2 4 . 7] [6 _ 4 . 1 _ 4 .] [5 . 5 . 2 5 . 7] [8 _ 7 . 5 _ 3 _]>

lead   $hook | supersaw fixed oct 4 gain .62 duck .4 verb .3 delay .2
lead2  $hook | square fixed oct 5 gain .16 cut 6000 delay .3
auto stut <. . . [. . . x]>       | repeat 16      // FX sequence: a stutter on the last beat of every 4 bars
auto out  <. . . [. . x _]>       | echo           // echo out at the end of each 4 bars of the break

scene intro chip pad hat
scene build chip pad clap hat riser | chip.cut 600>6000
scene drop  kick clap hat ohat crash bass chip pad lead stut
scene break pad lead chip out filter
scene last  all -out
song intro:8 build:4 drop:16 break:8 build:4 last:16
`,
  },
  {
    id: 'gddnb', name: 'Hyperdrive (GD style)',
    head: {
      ko: '// Hyperdrive — 174 BPM 드럼앤베이스. Geometry Dash 같은 리듬 게임 음악 스타일로 새로 쓴 곡이에요 (원곡 없음)\n// 리스 베이스 + 사인 서브, 사각파 훅, 빠른 플럭 아르페지오. k1 리스 필터, k2 훅 필터. auto 줄이 4마디마다 리피트, 8마디마다 저음을 빼요',
      en: '// Hyperdrive — 174 BPM drum & bass. An original in the style of rhythm-game music like Geometry Dash (not based on any song)\n// Reese bass over a sine sub, a square-wave hook, a fast pluck arpeggio. k1 opens the reese, k2 the hook. The auto lines repeat every 4 bars and cut the lows every 8',
    },
    body: `bpm 174
key D minor
prog <0 5 3 4>          // Dm Bb Gm Am
master loud

kick   x . . . . . . . . . x . . . . .  | gain 1
snare  . . . . x . . . . . . . x . . .  | gain .85 tune 1.15 verb .15
ghost  . . . . . . . x . x . . . . . x? | snare gain .2 tune 1.3 pan -.2 human .4
hat    x*16                             | gain .3 vel [1 .4 .7 .4]*4 pan .2 human .2 every 8 ply 2
reese  0 _ . 0 _ . . . 0 _ . . <2 4> _ . . | supersaw oct 1 cut k1(300,2200) res 3 detune 35 shape .4 gain .65 duck .5
sub    0 _ . 0 _ . . . 0 _ . . <2 4> _ . . | sine oct 1 gain .36 duck .5
hook   <[0 . 2 . 4 . 7 . 6 . 4 . 2 _ . .] [4 . 2 . 0 . 2 . 4 _ . . -1 _ . .]> | square oct 5 cut k2(1500,7000) gain .28 duck .3 echo 3 3/16 .45
arp    [0 4 7 4]*4                      | pluck oct 4 gain .3 cut 3500 delay .3 duck .4
pad    0^7                              | gain .22 atk 1 rel 2 verb .6 duck .3
auto rep  <. . . [. . x x]>       | repeat 8       // FX sequence: an eighth-note repeat closing every 4 bars
auto kill <. . . . . . . [. . . x]> | kill low    // the lows drop out for the last beat of 8 bars

scene intro pad arp hat
scene build hat snare arp pad riser
scene drop  all pause
scene roll  kick snare ghost hat reese sub hook rep fill
scene break pad hook arp filter down
song intro:8 build:8 drop:16 roll:8 break:8 build:4 drop:16
`,
  },
  {
    id: 'gdstep', name: 'Gravity Flip (GD style)',
    head: {
      ko: '// Gravity Flip — 150 BPM 하프타임 덥스텝. Geometry Dash 같은 리듬 게임 음악 스타일로 새로 쓴 곡이에요 (원곡 없음)\n// 워블 베이스는 16분음표마다 필터 값을 바꿔서 만들어요 (cut [250 1800 600 3200]*4). 스네어는 3박에 한 번. auto 줄이 드롭을 게이트로 썰고 필터로 가라앉혀요',
      en: '// Gravity Flip — 150 BPM half-time dubstep. An original in the style of rhythm-game music like Geometry Dash (not based on any song)\n// The wobble bass changes its filter on every sixteenth (cut [250 1800 600 3200]*4). The snare lands once, on beat 3. The auto lines gate the drop and sink it under a filter',
    },
    body: `bpm 150
key G minor
prog <0 0 5 6>          // Gm Gm Eb F
master loud

kick   x . . . . . . x . . x . . . . .  | gain 1 drive .2
snare  . . . . . . . . x . . . . . . .  | gain .95 tune .9 verb .2 shape .2
clap   . . . . . . . . x . . . . . . .  | gain .4
hat    x*8                              | gain .3 vel [1 .5]*4 pan .2 human .2 every 4 ply 3
wob    [0 0 0 0 0 0 . 0 0 0 . . <3 5> <3 5> . .] | saw oct 2 cut [250 1800 600 3200]*4 res 8 env .2 shape .7 hpf 90 gain .6 duck .6
sub    0 _ _ _ _ _ . 0 _ _ . . <3 5> _ . .  | sine oct 1 gain .55 duck .6
chip   <[7 . 4 . 7 . 9 . 7 . 4 . 2 . 4 .] [7 . 4 . 7 . 9 . 11 _ 9 _ 7 _ . .]> | square oct 4 cut 4500 gain .3 delay .25 duck .3 jux rev
arp    [0 2 4 2]*4                      | pluck oct 4 gain .15 cut 3000 delay .35
pad    0^                               | gain .26 atk .8 rel 2 verb .6 duck .4
auto chop <. [. . . . . . x x] . [. . x _]> | gate 16   // FX sequence: the drop is gated in sixteenths here and there
auto dive <. . . . . . . [. . . x]> | lp 600>150 in .25 // and dives under a closing filter before the next 8

scene intro pad arp
scene build arp chip hat snare riser
scene drop  kick snare clap hat wob sub chip pad chop dive
scene break pad arp chip filter down
song intro:8 build:4 drop:16 break:8 build:4 drop:16
`,
  },
  {
    id: 'rpgtown', name: 'Harbor Lantern (retro RPG town)',
    head: {
      ko: '// Harbor Lantern — 80년대 말 PC RPG의 마을 음악 감성으로 새로 쓴 곡이에요 (원곡 없음). 6/8, D장조, 한 마디 = 8분음표 6칸\n// FM 느낌의 사각파 선율과 일렉 피아노, 하프 아르페지오. 두 번째 바퀴에는 벨이 한 옥타브 위에서 겹치고 대선율과 가벼운 리듬이 들어와요',
      en: '// Harbor Lantern — an original in the spirit of late-80s PC RPG town music (not based on any song). 6/8 in D major, one bar = six eighths\n// An FM-style square lead over electric piano and a harp arpeggio. On the second pass a bell doubles the tune an octave up, with a counter-line and a light groove',
    },
    body: `bpm 120
key D major
prog <0 5 3 4 0 2 3 4 3 4 2 5 3 4 0 0>     // D Bm G A D F#m G A · G A F#m Bm G A D D
master warm
space hall

let tune = <[4 _ 2 4 _ 7] [9 _ 7 5 _ _] [7 _ 5 3 _ 4] [4 _ _ 6 _ 5] [4 _ 2 4 _ 7] [8 _ 9 8 _ 6] [7 _ 5 4 _ 3] [6 _ 4 1 _ _] [3 _ 4 5 _ 7] [8 _ 7 6 _ 4] [5 _ 4 2 _ 4] [5@4 6 7] [7 _ 9 10 _ 9] [8 _ 7 6 _ 8] [7 _ _ 4 _ 2] [0@6]>

lead   $tune | square fixed oct 4 cut 3200 vib 14 gain .42 delay .25 verb .3 human .1
bell   $tune | bell fixed oct 5 gain .16 delay .3 verb .4
alto   <[2@6] [4 _ _ 3 _ _] [2@6] [1 _ _ 2 _ _] [2@6] [4 _ _ 6 _ _] [5@6] [4 _ _ . . .] [1@6] [2@6] [0 _ _ . 1 2] [3@6] [5@6] [4 _ _ 6 _ _] [4@6] [2@6]> | flute fixed oct 4 gain .14 verb .4 atk .08
keys   0^7 _ _ _ _ _                     | epiano oct 3 gain .3 verb .3
harp   [0 2 4 7 4 2]                     | harp oct 3 gain .36 verb .3 human .15
bass   [0 _ _ 4 _ .]                     | bass oct 2 cut 900 gain .62 rel .1
kick   x . . . . .                       | gain .55 tune .9 dec .7
rim    . . . x . .                       | gain .55 verb .2
shake  x x x x x x                       | gain .2 vel [1 .5 .7 .9 .5 .7] human .3

scene town  lead keys harp bass
scene fair  all
song town:16 fair:16
`,
  },
  {
    id: 'rpgopen', name: 'Crimson Horizon (retro RPG opening)',
    head: {
      ko: '// Crimson Horizon — 80년대 말 PC RPG 오프닝 감성으로 새로 쓴 곡이에요 (원곡 없음). C단조, 150 BPM, 화성단음계의 G로 몰아쳐요\n// FM 브라스 같은 쏘우 리드, 옥타브로 튀는 슬랩 베이스, 16분 사각파 아르페지오. 마지막 8마디는 auto 줄이 온음 올려 전조해요',
      en: '// Crimson Horizon — an original in the spirit of late-80s PC RPG openings (not based on any song). C minor at 150 BPM, driven by the harmonic-minor G\n// A saw lead like FM brass, octave-jumping slap bass, a sixteenth square arpeggio. In the last 8 bars an auto line lifts the key a whole step',
    },
    body: `bpm 150
key C minor
prog <Cm Ab Bb Cm Cm Ab Fm G>
master loud
space chamber

let a = <[g4 _ _ c5 _ _ d5 _ eb5@4 d5 _ c5 _] [eb5@6 c5 _ ab4@4 c5 _ eb5 _] [f5 _ _ eb5 _ _ d5 _ bb4@4 d5 _ f5 _] [g5@8 g5 _ ab5 _ g5 _ f5 _] [eb5 _ _ g5 _ _ c6@6 bb5 _ g5 _] [ab5@4 g5 _ f5 _ eb5@4 c5 _ eb5 _] [f5 _ _ ab5 _ _ c6@4 bb5 _ ab5 _ f5 _] [g5@8 b4 _ d5 _ f5 _ ab5 _]>
let b = <[c6 _ _ bb5 _ _ g5@4 eb5 _ g5 _ c6 _] [c6@4 eb6@4 c6 _ ab5@4 g5 _] [f5 _ _ g5 _ _ bb5@4 d6 _ c6 _ bb5 _] [c6@12 g5 _ c6 _] [eb6 _ _ d6 _ _ c6@4 g5 _ c6 _ eb6 _] [f6@4 eb6 _ c6 _ ab5@4 c6 _ eb6 _] [d6 _ _ c6 _ _ ab5@4 f5 _ ab5 _ c6 _] [b5@8 d6@4 f6@4]>

theme  $a | saw cut 2600 env .5 dec .3 res 2 detune 8 vib 10 gain .52 delay .2 verb .3
hero   $b | saw cut 3000 env .5 dec .3 res 2 detune 8 vib 12 gain .5 delay .2 verb .35
echo   $a | square cut 4000 gain .12 delay .4 verb .4 nudge 30
arp    [0 2 4 7]*4                         | square oct 5 cut 3800 gain .16 delay .2 duck .3
brass  [0^ . . 0^' . . 0^ . . . 0^ . 0^' . . .] | saw oct 4 cut 2200 env .4 dec .2 gain .22 duck .3
pad    0^7                                  | pad gain .22 verb .5 duck .5
bass   [0 . 7 0 . 7 0' 7]*2                 | bass oct 2 cut 1400 env .5 dec .12 shape .25 gain .5 duck .4
kick   x . . . . . x . x . . . . . . .      | gain 1 drive .1
snare  . . . . x . . . . . . . x . . x?     | gain .8 verb .2 lpf 9000
hat    x*16                                 | gain .26 vel [1 .45 .7 .45]*4 human .15
crash  <x . . . . . . .>                    | gain .35
auto lift x                                 | pitch 2

scene intro arp pad bass hat riser
scene a     theme echo arp brass pad bass kick snare hat crash
scene b     hero arp brass pad bass kick snare hat crash fill
scene last  theme echo arp brass pad bass kick snare hat crash lift fill
song intro:8 a:8 b:8 a:8 last:8
`,
  },
  {
    id: 'puffball', name: 'Puffball Parade (bouncy platformer)',
    head: {
      ko: '// Puffball Parade — 통통 튀는 액션 게임 음악 감성으로 새로 쓴 곡이에요 (원곡 없음). F장조 156 BPM, maj7·m7 코드와 반음 경과음\n// 브라스 같은 사각파 선율($tune), 옥타브로 통통 튀는 베이스, 오프비트 스탭. 두 번째 바퀴엔 벨이 한 옥타브 위로 겹치고 16분 아르페지오가 좌우로 대답해요\n// auto 줄이 8마디 끝마다 드럼 필을 넣어요. B단락 끝의 Bbm6 는 장조 곡에서 잠깐 빌려 오는 단조 화음이에요',
      en: '// Puffball Parade — an original in the spirit of bouncy platformer music (not based on any song). F major at 156 BPM, maj7 and m7 chords with chromatic passing notes\n// A brassy square tune ($tune), an octave-bouncing bass, offbeat stabs. On the second pass a bell doubles the tune an octave up and a sixteenth arpeggio answers left and right\n// An auto line plays a drum fill before every 8th bar. The Bbm6 near the end is a minor chord borrowed for a moment',
    },
    body: `bpm 156
key F major
prog <Fmaj7 Dm7 Gm7 C7 Fmaj7 Am7 Bbmaj7 C7 Bbmaj7 C7 Am7 D7 Gm7 Bbm6 F F>
master loud
space room

let tune = <[c5 . a4 c5 . f5 . e5] [d5 . f5 _ e5 d5 c5 a4] [bb4 . d5 bb4 . g5 . f5] [e5 . d5 c5 bb4 . g4 .] [c5 . a4 c5 . f5 . a5] [g5 _ e5 c5 . e5 g#5 a5] [f5 . d5 bb4 . d5 f5 a5] [g5@4 e5 _ c5 _] [d6 . c6 a5 . f5 . d5] [e5 _ g5 _ bb5 _ a5 g5] [c6 . a5 e5 . c5 . e5] [f#5 _ a5 _ c6 _ a5 f#5] [g5 . bb5 d6 . bb5 . g5] [f5 . db5 _ bb4 _ g4 .] [a4 _ c5 _ f5 _ a5 _] [g5 . f5 e5 d5 . c5 .]>

lead   $tune                              | square cut 3600 env .3 dec .2 vib 10 gain .4 delay .15 verb .2
bell   $tune                              | bell oct 6 gain .14 verb .3
stab   [. 0^ . . 0^' . 0^ .]              | saw oct 4 cut 2400 env .4 dec .12 gain .11 duck .3
arp    [0 2 4 7]*4                        | pluck oct 5 gain .16 cut 4000 jux rev
bass   [0 . 7 0 . 4 . 2]                  | bass oct 2 cut 1200 env .4 dec .15 gain .62 duck .3
kick   x . . . . . x . x . . . . . . .    | gain .95
snare  . . . . x . . . . . . . x . . x?   | gain .7 verb .2
hat    x*8                                | gain .28 vel [1 .55]*4 sometimes .15 ply 2
tamb   [. x]*4                            | gain .08 pan .3
crash  <x . . . . . . .>                  | gain .3
auto roll <. . . . . . . x>               | fill        // a drum fill into every 8th bar

scene stroll lead stab bass kick snare hat crash roll
scene parade all
song stroll:16 parade:16
`,
  },
  {
    id: 'village', name: 'Lazy Afternoon (cozy village)',
    head: {
      ko: '// Lazy Afternoon — 아기자기한 마을 생활 게임 음악 감성으로 새로 쓴 곡이에요 (원곡 없음). G장조 100 BPM, 살짝 스윙\n// 휘파람 같은 플루트 선율($tune), 기타 줄 퉁기기, 업라이트 베이스, 브러시. B단락의 Cm6 는 잠깐 빌려 오는 단조 화음이라 저녁 느낌이 나요\n// 두 번째 바퀴엔 칼림바가 가끔씩(degrade) 반짝이고, 비브라폰이 오른쪽에서 거꾸로 대답해요. 플루트 떨림은 perlin 으로 천천히 바뀌어요',
      en: '// Lazy Afternoon — an original in the spirit of cozy village life-sim music (not based on any song). G major at 100 BPM, a little swing\n// A whistle-like flute tune ($tune), plucked guitar, upright bass, brushes. The Cm6 in the B part is a borrowed minor chord with an evening feel\n// On the second pass a kalimba sparkles now and then (degrade) and vibes answer reversed on the right. The flute vibrato drifts with perlin',
    },
    body: `bpm 100
key G major
prog <Gmaj7 Em7 Am7 D7 Bm7 E7 Am7 D7 Cmaj7 Cm6 Bm7 E7 Am7 D7 Gmaj7 Gmaj7>
swing .18
master warm
space room

let tune = <[. d5 _ b4 . a4 g4 .] [e4 . g4 b4 _ _ . .] [. c5 _ e5 . d5 c5 .] [a4 _ _ _ f#4 . . .] [. d5 _ f#5 . e5 d5 .] [b4 _ g#4 _ e4 . . .] [. e5 _ c5 . b4 a4 .] [c5 _ _ _ . . . .] [. e5 _ g5 . b5 a5 .] [. eb5 _ g5 . a5 g5 .] [f#5 _ d5 _ b4 . . .] [. g#4 _ b4 . d5 e5 .] [c5 _ _ a4 . e5 . c5] [d5 _ f#4 _ a4 . c5 .] [b4 _ _ _ _ _ . .] [. . d5 . b4 . g4 .]>

flute  $tune                              | flute gain .42 vib perlin(6,20,4) atk .04 verb .35 delay .15 human .1
guitar [0^7 . . 0^7] [. 0^7 . .]          | zither oct 3 bright .45 dec .8 gain .26 pan -.2 human .25
bass   [0 _ 4 _]                          | upright gain .8 human .15
kalim  [0 . 4 . 2 . 7 .]                  | kalimba oct 5 gain .4 degrade .45 pan rand(-.6,.6)
vibes  <. [4 . 2 .] . [6 . 4 2]>          | vibes oct 5 gain .26 verb .3 jux rev
brush  [. x]*2                            | asnare gain .4 vel .5 dec .4 human .3
ride   x x x x                            | aride gain .14 human .2
kick   x . . . x . . .                    | gain .25 dec .6

scene day     flute guitar bass brush kick
scene evening all
song day:16 evening:16
`,
  },
  {
    id: 'hopper', name: 'Pipe Hopper (8-bit platformer)',
    head: {
      ko: '// Pipe Hopper — 슈퍼 마리오 같은 8비트 플랫포머 음악 감성으로 새로 쓴 곡이에요 (원곡 없음). C장조 180 BPM, 한 마디 = 8분음표 8칸\n// 사각파 선율과 오프비트로 통통 튀는 사각파 화음, 삼각파 베이스, 잡음 같은 드럼(crush). 7마디째 Ab→Bb→C 는 게임 음악에서 사랑받는 "골인" 진행이에요\n// 두 번째 바퀴엔 콩가가 라틴 리듬을 넣고, 벨이 한 옥타브 위에서 반짝여요',
      en: '// Pipe Hopper — an original in the spirit of 8-bit platformer music like Super Mario (not based on any song). C major at 180 BPM, one bar = eight eighths\n// A square-wave tune over offbeat square chords, a triangle bass and noisy drums (crush). The Ab→Bb→C in bar 7 is the "level clear" move game music loves\n// On the second pass congas add a Latin lilt and a bell sparkles an octave up',
    },
    body: `bpm 180
key C major
prog <C F C G7 C F [Ab Bb] C F C Dm G F E7 [Dm G7] C>
master loud
space room

let tune = <[g4 c5 . e5 . g5 e5 .] [f5 . a5 f5 . c5 d5 .] [e5 g5 . c6 . g5 a5 g5] [f5 _ d5 . b4 . g4 .] [g4 c5 . e5 . g5 c6 .] [a5 . c6 a5 . f5 g5 a5] [ab5 _ eb5 c5 bb5 _ f5 d5] [c6 . g5 . c5 _ . .] [a5 . . f5 . c5 f5 a5] [g5 . . e5 . c5 e5 g5] [f5 . . d5 . a4 d5 f5] [e5 _ d5 _ b4 . . .] [a5 . . f5 . c6 a5 c6] [b5 _ g#5 _ e5 . . .] [d5 f5 a5 . b5 g5 f5 d5] [c5 _ e5 _ g5 _ c6 .]>

lead   $tune                         | square cut 9000 env 0 dec .3 sus .7 rel .05 vib 5 gain .34 delay .1
bell   $tune                         | bell oct 6 gain .12 verb .3
chord  [. 0^ . 0^ . 0^ . 0^']        | square oct 4 cut 5000 env 0 dec .08 sus 0 rel .03 gain .1 duck .2
bass   [0 . 4 . 0' . 4 4]            | tri oct 2 cut 8000 env 0 dec .12 sus .6 rel .04 gain .5
kick   x . . . x . . .               | gain .7 dec .5
snare  . . x . . . x .               | gain .5 crush .55 tune 1.2
hat    [. x]*4                       | gain .22 crush .6 pan .15
conga  [. . x . . x . x]             | gain .35 pan -.3 human .2
crash  <x . . . . . . . x . . . . . . .> | gain .25 crush .3

scene world  lead chord bass kick snare hat crash
scene bonus  all
song world:16 bonus:16
`,
  },
  {
    id: 'herofield', name: "Hero's Field (adventure overworld)",
    head: {
      ko: '// Hero\'s Field — 젤다 같은 모험 게임 필드 음악 감성으로 새로 쓴 곡이에요 (원곡 없음). Bb장조 132 BPM 행진\n// 길게 뻗는 사각파 팡파르, 셋잇단 사각파 아르페지오, 행진 스네어, 삼각파 베이스. Ab·Ebm·Gb 처럼 장조 밖에서 빌려 온 화음이 영웅적인 색을 내요\n// B단락(Gm부터)은 더 높이 올라가고, 두 번째 바퀴엔 플루트가 같은 선율을 살짝 늦게 겹쳐 부드럽게 받쳐요',
      en: '// Hero\'s Field — an original in the spirit of adventure-game overworld music like Zelda (not based on any song). A 132 BPM march in Bb major\n// A long-breathed square fanfare, a triplet square arpeggio, a marching snare, a triangle bass. Chords borrowed from outside the key (Ab, Ebm, Gb) give it the heroic colour\n// The B part (from Gm) climbs higher; on the second pass a flute doubles the tune a hair late, softening it',
    },
    body: `bpm 132
key Bb major
prog <Bb Bb Ab Bb Eb Ebm Bb F7 Gm Eb Bb F Gm Eb [Gb Ab] Bb>
master loud
space hall

let fanfare = <[bb4@6 f4@2 bb4 _ c5 d5 eb5 _ f5 _] [f5@10 . . f5 . g5 _] [ab5@8 c6@4 ab5@2 eb5@2] [bb5@12 . . d5 f5] [g5@4 eb5@2 g5@2 bb5@4 g5@2 eb5@2] [gb5@4 eb5@2 gb5@2 bb5@4 ab5@2 gb5@2] [f5@6 d5@2 bb4@4 d5@2 f5@2] [c5@4 f4@2 a4@2 c5@2 eb5@2 f5@2 a5@2] [d6@6 bb5@2 g5@4 bb5@2 d6@2] [eb6@8 d6@2 c6@2 bb5@2 g5@2] [f5@6 bb5@2 d6@8] [c6@12 a5@2 f5@2] [g5@4 bb5@4 d6@4 g6@4] [f6@6 eb6@2 bb5@4 g5@4] [gb5@4 bb5@2 db6@2 ab5@4 c6@2 eb6@2] [d6@4 f6@4 bb6@8]>

lead   $fanfare                      | square cut 7000 env .1 dec .4 sus .7 rel .1 vib 8 gain .36 delay .2 verb .3
flute  $fanfare                      | flute gain .18 verb .4 atk .05 nudge 15
arp    [0 2 4 7 4 2]*2               | square oct 4 cut 4000 env 0 dec .1 sus .2 gain .1 pan .25
pad    0^                            | pad gain .16 atk .5 rel 1 verb .5
bass   [0 . . 0 0 . 4 . 0 . . 0 4 . 7 .] | tri oct 2 cut 8000 env 0 dec .15 sus .6 gain .5
snare  [x . . x x . x . x . . x x x x x] | gain .4 vel [1 .4 .5 .7 .9 .4 .7 .4 1 .4 .5 .7 .6 .7 .8 1] crush .35 tune 1.1 human .15
kick   x . . . . . . . x . . . . . . .  | gain .6 dec .7
crash  <x . . . . . . . x . . . . . . .> | gain .28

scene field  lead arp bass snare kick crash
scene quest  all
song field:16 quest:16
`,
  },
  {
    id: 'korobeiniki', name: 'Korobeiniki (falling-block chip)',
    head: {
      ko: '// Korobeiniki — 러시아 민요 「코로베이니키」(19세기, 퍼블릭 도메인) 선율. 테트리스로 널리 알려진 노래예요. A단조 150 BPM\n// 선율은 민요 그대로, 편곡(3도 아래 화음 대선율, 옥타브로 뛰는 삼각파 베이스, 잡음 드럼, 아르페지오)은 새로 썼어요\n// 첫 바퀴는 선율과 베이스만, 두 번째 바퀴에 대선율과 드럼이 들어와요',
      en: '// Korobeiniki — the Russian folk song (19th century, public domain), famous from Tetris. A minor at 150 BPM\n// The tune is the folk melody; the arrangement (a harmony line a third below, an octave-jumping triangle bass, noisy drums, an arpeggio) is new\n// The first pass is tune and bass alone; the harmony and drums join on the second',
    },
    body: `bpm 150
key A minor
prog <E Am E Am Dm Am E Am>
master loud
space room

let tune = <[e5@4 b4@2 c5@2 d5@4 c5@2 b4@2] [a4@4 a4@2 c5@2 e5@4 d5@2 c5@2] [b4@6 c5@2 d5@4 e5@4] [c5@4 a4@4 a4@4 .@4] [.@2 d5@4 f5@2 a5@4 g5@2 f5@2] [e5@6 c5@2 e5@4 d5@2 c5@2] [b4@4 b4@2 c5@2 d5@4 e5@4] [c5@4 a4@4 a4@4 .@4]>
let third = <[g#4@4 g#4@2 a4@2 b4@4 a4@2 g#4@2] [e4@4 e4@2 a4@2 c5@4 b4@2 a4@2] [g#4@6 a4@2 b4@4 c5@4] [a4@4 e4@4 e4@4 .@4] [.@2 f4@4 a4@2 f5@4 e5@2 d5@2] [c5@6 a4@2 c5@4 b4@2 a4@2] [g#4@4 g#4@2 a4@2 b4@4 c5@4] [a4@4 e4@4 e4@4 .@4]>

lead   $tune                         | square cut 9000 env 0 dec .3 sus .7 rel .05 vib 4 gain .34 delay .1
alto   $third                        | square cut 4500 env 0 dec .3 sus .6 rel .05 gain .13 pan -.25
arp    [0 2 4 2]*4                   | square oct 5 cut 3500 env 0 dec .06 sus 0 gain .07 pan .3
bass   [0 7]*4                       | tri oct 2 cut 8000 env 0 dec .12 sus .6 rel .04 gain .5
kick   x . . . x . . .               | gain .65 dec .5
snare  . . x . . . x .               | gain .45 crush .55 tune 1.25
hat    x*8                           | gain .2 vel [1 .5]*4 crush .6 pan .15

scene solo  lead bass
scene full  all
song solo:8 full:16
`,
  },
  {
    id: 'steelstage', name: 'Steel Stage (8-bit action rock)',
    head: {
      ko: '// Steel Stage — 록맨 같은 8비트 액션 게임 스테이지 음악 감성으로 새로 쓴 곡이에요 (원곡 없음). E단조 160 BPM\n// 내달리는 삼각파 8분 베이스, 근음과 5도로 긁는 사각파 리듬, 16분 아르페지오, 애틋하게 치솟는 사각파 선율\n// 마지막 마디의 B장조(화성단음계의 V)가 처음 Em로 다시 끌어당겨요',
      en: '// Steel Stage — an original in the spirit of 8-bit action-game stage music like Mega Man (not based on any song). E minor at 160 BPM\n// A driving eighth-note triangle bass, square-wave power chords (root and fifth), a sixteenth arpeggio, a soaring square lead\n// The B major in the last bar (the harmonic-minor V) pulls back to Em',
    },
    body: `bpm 160
key E minor
prog <Em C D Bm Em C D B>
master loud
space room

let hero = <[e5@4 b4@2 e5@2 g5@2 f#5@2 e5@2 d5@2] [e5@6 c5@2 e5@2 g5@2 c6@2 b5@2] [a5@4 f#5@2 d5@2 a5@2 b5@2 a5@2 f#5@2] [b5@8 f#5@2 d5@2 b4@2 d5@2] [e5 _ g5 _ b5 _ e6 _ d6 _ b5 _ g5 _ b5 _] [c6@4 b5@2 a5@2 g5@4 e5@2 g5@2] [f#5@2 a5@2 d6@2 c6@2 b5@2 a5@2 f#5@2 d5@2] [d#5@4 f#5@4 b5@4 a5@2 f#5@2]>

lead   $hero                         | square cut 9000 env 0 dec .3 sus .75 rel .05 vib 6 gain .34 delay .15 verb .15
chug   [[0,4] . [0,4] [0,4] . [0,4] . [0,4]] | square oct 3 cut 2200 env .3 dec .1 sus .2 gain .12 pan -.2
arp    [0 2 4 7]*4                   | square oct 5 cut 4000 env 0 dec .06 sus 0 gain .08 pan .3
bass   [0 0 7 0 0 7 0 7]             | tri oct 2 cut 8000 env 0 dec .1 sus .6 rel .03 gain .55
kick   x . . . . . x . x . . . . . . .  | gain .85
snare  . . . . x . . . . . . . x . . x? | gain .55 crush .5 tune 1.1
hat    x*8                           | gain .22 vel [1 .5]*4 crush .6 pan .15
crash  <x . . . . . . .>             | gain .3 crush .3

scene intro arp bass hat
scene stage all
song intro:8 stage:16
`,
  },
  {
    id: 'gutgeori', name: '굿거리 Gutgeori',
    head: {
      ko: '// 굿거리 — 계면조, 한 마디 = 굿거리 한 장단 (3칸 × 4박 = 12칸). 장구 궁편(kung)·채편(deok), 징, 가야금, 대금\n// 구음: 덩 - 기덕 | 쿵 - 더러러러 | 쿵 - 기덕 | 쿵 - 더러러러',
      en: '// Gutgeori — gyemyeonjo mode; one bar = one gutgeori cycle (4 beats of 3 = 12 steps). Janggu low/high heads, jing gong, gayageum, daegeum flute\n// Vocables: deong - gideok | kung - deoreoreoreo | kung - gideok | kung - deoreoreoreo',
    },
    body: `bpm 80
key D gyemyeonjo
master open

kung     x' . . x . . x . . x . .                       | gain 1.1 verb .2 human .3
deok     x' . [x x] . . [x x x x] . . [x x] . . [x x x x] | gain .65 pan .2 verb .15 human .3 vel [1 .8 .9 .8] sometimes .12 ply 2
buk      x . . . . . x . . . . .                        | gain .8
jing     <x . . .>                                      | gain .85 verb .4
gayageum [0 . 2] [3 . 2] [4 . 3] [2 . 0]                | dantranh oct 4 cut k1(1500,12000) vib 14 delay .25 pan -.2 gain .75
daegeum  <[4 _ _ 3 _ 2] [3 _ _ _ _ _] [2 _ 3 4 _ _] [0 _ _ _ _ _]> | oct 5 rel .8 delay .3 verb k3(.2,.8) gain .5
bass     <0 0 3 2>/2                                    | sine oct 2 gain .5 atk .05 rel .6

scene jangdan kung deok buk jing
scene gayageum kung deok jing gayageum bass
scene full    all
scene solo    daegeum gayageum jing filter
song jangdan:4 gayageum:8 full:16 solo:8 full:16 jangdan:4
`,
  },
  {
    id: 'hwimori', name: '휘모리 Fusion',
    head: {
      ko: '// 휘모리 퓨전 — 132 BPM, 평조(솔라도레미). 장구·꽹과리·징 위에 EDM 킥, 해금 리드. madang 씬은 풍물판',
      en: '// Hwimori fusion — 132 BPM, pyeongjo pentatonic. EDM kick under janggu, kkwaenggwari and jing, with a haegeum lead. The madang scene is a pungmul jam',
    },
    body: `bpm 132
key G pyeongjo
prog <0 0 3 4>

kick     x x x x                                 | gain 1
kung     x . . x . . x .                         | gain 1 verb .15
deok     [. x] [x x] [. x] [x [x x]]             | gain .5 pan .25
kkwang   x . x x . x x . x . x x . x x .         | kkwaeng gain [.4 .3 .34 .3]*4 pan -.3 human .2 sometimes .15 ply 2
kkwangm  . x . . x . . x . x . . x . . x         | kkwaengm gain .22 pan -.3 human .2
jing     <x . . . . . . .>                       | gain .65 verb .35
bass     [0 . 0 4] [. 0 3 .]                     | cut k2(300,1600) res 4 duck .6
gayageum [0 2 3 4]*4                             | oct 4 dec .7 bright k1(.2,.9) delay .25 gain .45 iter 4
haegeum  <[4 _ 3 2] [3 _ _ _] [4 4 3 2] [0 _ _ _]> | oct 4 delay .3 verb .3 gain .5

scene intro  kkwang kkwangm jing gayageum
scene build  kung deok kkwang kkwangm gayageum riser
scene drop   all pause
scene madang kung deok kkwang kkwangm jing haegeum
song intro:8 build:8 drop:16 madang:8 build:4 drop:16 intro:4
`,
  },
  {
    id: 'jeongak', name: '정악 Ambient',
    head: {
      ko: '// 정악 앰비언트 — 60 BPM, 평조. 긴 대금 선율에 해금, 성긴 가야금, 4마디마다 징. k3로 공간감',
      en: '// Jeongak ambient — 60 BPM, pyeongjo. Long daegeum lines with haegeum, sparse gayageum, a jing every 4 bars. k3 opens the space',
    },
    body: `bpm 60
key Eb pyeongjo
master open

daegeum  <[0 _ _ _] [2 _ 1 _] [3 _ _ _] [2 _ _ _] [1 _ 0 _] [4 _ _ 3] [2 _ _ _] [0 _ _ _]> | oct 5 atk .3 rel 1.5 delay .4 verb k3(.4,.95) gain .45
haegeum  <[. . 3 _] . [2 _ _ _] .>               | oct 4 cut k1(900,3500) atk .4 rel 1.2 verb .6 gain .4
gayageum [0 . . 2 . . 4 .]                       | dantranh oct 3 vib 16 rel 1.6 delay .4 verb .5 gain .7 human .4 degrade .3 pan rand(-.5,.5)
jing     <x . . .>                               | gain .65 verb .6
buk      x . . . . . . . . . x . . . . .         | gain .55 verb .4
drone    0/4                                     | pad oct 2 gain .15 atk 3 rel 4 verb .8

scene dawn  daegeum jing drone
scene court all -buk
scene full  all
song dawn:8 court:16 full:16 dawn:8
`,
  },
  {
    id: 'jazz', name: 'Jazz Swing',
    head: {
      ko: '// Jazz Swing — 132 BPM, ii–V–I (Dm7 G7 Cmaj7 A7). 트리플렛 라이드, 찰스턴 피아노 컴핑, 워킹 베이스, 테너 색소폰 헤드\n// [x _ _] [x _ x] = "딩 딩-가 딩" 스윙 라이드. solo 씬에서는 비브라폰이 즉흥처럼 들어와요',
      en: '// Jazz Swing — 132 BPM, ii–V–I (Dm7 G7 Cmaj7 A7). Triplet ride, Charleston piano comping, walking bass, tenor sax head\n// [x _ _] [x _ x] is the "ding ding-a ding" swing ride. In the solo scene the vibraphone improvises',
    },
    body: `bpm 132
key C major
prog <Dm7 G7 Cmaj7 A7>
master open

ride     [x _ _] [x' _ x] [x _ _] [x' _ x]        | aride gain .3 pan .2 human .3
foot     . x . x                                  | ahat gain .45 vel .6 dec .4
brush    [. . x] . [. . x] [. x x]?.4             | asnare gain .3 vel .5 dec .45 pan -.15 human .4
kick     x?.3 . . .                               | gain .3 dec .8
bass     <[0 2 4 6] [0 4 2 -1] [0 2 4 2] [0 2 4 6]> | upright gain .9 human .2 vel [1 .85 .95 .85] sometimes .12 +7
comp     0^7 [. . 0^7'] . .                       | piano oct 4 gain .36 rel .25 cut k1(1500,12000) pan -.2 drop2 human .3
sax      <[4 _ 5] [6 _ 4] [2 _ 4] [5 _ 6]>/1      | sax oct 4 gain .5 verb .25
head     <[[4 _ 5] [6 _ 4] [2 _ 4] [5 _ 6]] [[7 _ 6] [4 _ 2] [3 _ 1] [0 _ .]] [[2 _ _] [4 _ 6] [7 _ _] .] [[6 _ 5] [4 _ 3] [1 _ 2] [3 _ .]]> | sax oct 4 gain .55 verb k3(.1,.5) rel .1
vibes    [[r _ r] [r' _ r] [r _ r] [r' _ r]]?.2   | oct 5 gain .35 delay .25 verb .3 range 9 human .3 pan perlin(-.5,.5,4)

scene intro  ride foot bass comp
scene head   ride foot brush kick bass comp head fill
scene solo   ride foot brush kick bass comp vibes fill
scene trade  ride foot brush bass sax
song intro:4 head:8 solo:8 trade:4 head:8
`,
  },
  {
    id: 'bach', name: 'Bach Prelude BWV 846',
    head: {
      ko: '// 바흐 평균율 1권 전주곡 C장조 BWV 846 (1722, 퍼블릭 도메인) 첫 11마디. 음 이름을 직접 써요 (소문자 c4 = 단음)\n// piano 씬은 그랜드 피아노, cembalo 씬은 하프시코드. len 3 은 페달처럼 음을 길게 끌어요',
      en: '// J.S. Bach, Prelude in C major BWV 846 (1722, public domain), first 11 bars, written with note names (lowercase c4 = single note)\n// The piano scene uses a grand piano, the cembalo scene a harpsichord. len 3 lets notes ring like the sustain pedal',
    },
    body: `bpm 66
key C major
master open

piano    <[c4 e4 g4 c5 e5 g4 c5 e5]*2 [c4 d4 a4 d5 f5 a4 d5 f5]*2 [b3 d4 g4 d5 f5 g4 d5 f5]*2 [c4 e4 g4 c5 e5 g4 c5 e5]*2 [c4 e4 a4 e5 a5 a4 e5 a5]*2 [c4 d4 f#4 a4 d5 f#4 a4 d5]*2 [b3 d4 g4 d5 g5 g4 d5 g5]*2 [b3 c4 e4 g4 c5 e4 g4 c5]*2 [a3 c4 e4 g4 c5 e4 g4 c5]*2 [d3 a3 d4 f#4 c5 d4 f#4 c5]*2 [g3 b3 d4 g4 b4 d4 g4 b4]*2> | gain .6 len 3 rel 1.2 verb .3 vel [1.05 .85 .9 .95 .85 .9 .95 .85]*2 human .2
cembalo  <[c4 e4 g4 c5 e5 g4 c5 e5]*2 [c4 d4 a4 d5 f5 a4 d5 f5]*2 [b3 d4 g4 d5 f5 g4 d5 f5]*2 [c4 e4 g4 c5 e5 g4 c5 e5]*2 [c4 e4 a4 e5 a5 a4 e5 a5]*2 [c4 d4 f#4 a4 d5 f#4 a4 d5]*2 [b3 d4 g4 d5 g5 g4 d5 g5]*2 [b3 c4 e4 g4 c5 e4 g4 c5]*2 [a3 c4 e4 g4 c5 e4 g4 c5]*2 [d3 a3 d4 f#4 c5 d4 f#4 c5]*2 [g3 b3 d4 g4 b4 d4 g4 b4]*2> | harpsi gain .55 len 1.5 verb .25

scene piano   piano
scene cembalo cembalo
song piano:11 cembalo:11
`,
  },
  {
    id: 'elise', name: 'Für Elise (Lo-fi)',
    head: {
      ko: '// 베토벤, 엘리제를 위하여 WoO 59 (1810, 퍼블릭 도메인) 첫 부분 44마디를 음 하나하나 옮겼어요. 3/8박자 두 마디가 한 칸(16분음표 12칸)\n// 처음 8칸은 피아노만, 그다음은 6/8 로파이 비트와 업라이트 베이스가 들어와요. 악보: Mutopia Project (퍼블릭 도메인 판)\n// let 줄은 두 마디짜리 프레이즈예요. rh, lh 줄이 그 순서를 적어요 ($rh1 $rh2 …)',
      en: '// Beethoven, Für Elise WoO 59 (1810, public domain): the first 44 bars, note for note. Each step of <> is two 3/8 bars (twelve sixteenths)\n// Piano alone for 8 steps, then a 6/8 lo-fi beat and upright bass. Score: Mutopia Project (public domain edition)\n// Each let line is a two-bar phrase; the rh and lh lines put them in order ($rh1 $rh2 …)',
    },
    body: `bpm 90
key A minor
master warm
space room

let rh1 = [e5 d#5 e5 b4 d5 c5 a4 _ . c4 e4 a4]
let rh2 = [b4 _ . e4 g#4 b4 c5 _ . e4 e5 d#5]
let rh3 = [b4 _ . e4 c5 b4 a4@4 e5 d#5]
let rh4 = [b4 _ . e4 c5 b4 a4 _ . b4 c5 d5]
let rh5 = [e5@3 g4 f5 e5 d5@3 f4 e5 d5]
let rh6 = [c5@3 e4 d5 c5 b4 _ . e4 e5 .]
let rh7 = [. e5 e6 . . d#5 e5 _ . d#5 e5 d#5]
let lh1 = [.@6 a2 e3 a3 .@3]
let lh2 = [e2 e3 g#3 .@3 a2 e3 a3 .@3]
let lh3 = [c3 g3 c4 .@3 g2 g3 b3 .@3]
let lh4 = [a2 e3 a3 .@3 e2 e3 e4 . . e4]
let lh5 = [e5 . . d#5 e5 . . d#5 e5 .@3]

rh     <$rh1 $rh2 $rh1 $rh3 $rh1 $rh2 $rh1 $rh4 $rh5 $rh6 $rh7 $rh1 $rh2 $rh1 $rh4 $rh5 $rh6 $rh7 $rh1 $rh2 $rh1 $rh3> | piano gain .6 len 1.6 rel .8 verb .2 human .15
lh     <$lh1 $lh2 $lh1 $lh2 $lh1 $lh2 $lh1 $lh2 $lh3 $lh4 $lh5 $lh1 $lh2 $lh1 $lh2 $lh3 $lh4 $lh5 $lh1 $lh2 $lh1 $lh2> | piano gain .42 len 2.5 rel 1 pan -.15 human .15
bass   <[. a2] [e2 a2] [. a2] [e2 a2] [. a2] [e2 a2] [. a2] [e2 a2] [c3 g2] [a2 e2] . [. a2] [e2 a2] [. a2] [e2 a2] [c3 g2] [a2 e2] . [. a2] [e2 a2] [. a2] [e2 a2]> | upright gain .75 human .1
kick   x . . . . . . . . x . .    | gain .8 tune .85 dec .9
snare  . . . . . . x . . . . .    | asnare gain .45 nudge 12 human .2
hat    x*6                        | ahat gain .3 vel [1 .55 .8 .55 .9 .55] human .3
vinyl  x*24?.8                    | hat gain .05 tune .5 dec .4 pan -.4

scene piano rh lh vinyl
scene lofi  all
song piano:8 lofi:14
`,
  },
  {
    id: 'gymno', name: 'Gymnopédie No.1',
    head: {
      ko: '// 사티, 짐노페디 1번 (1888, 퍼블릭 도메인) 앞 39마디. 3/4박자 한 마디가 한 칸(8분음표 6칸)\n// 선율·화음·베이스를 피아노 세 줄로 나눴고, 19마디부터 GPU 합창(choir)과 사인 베이스가 화음을 감싸요. 악보: Mutopia Project (퍼블릭 도메인 판)',
      en: '// Satie, Gymnopédie No. 1 (1888, public domain): the first 39 bars. Each step of <> is one 3/4 bar (six eighths)\n// Melody, chords and bass on three piano lines; from bar 19 a GPU choir and a sine bass wrap the chords. Score: Mutopia Project (public domain edition)',
    },
    body: `bpm 88
key D major
master open
space hall

let mel1 = [g5 f#5 c#5]
let chord1 = [. [b3,d4,f#4] _]
let chord2 = [. [a3,c#4,f#4] _]
let chord3 = [. [a3,c4,e4] _]
let chord4 = [. [d3,g3,b3,e4] _]
let chord5 = [. [c3,e3,a3,d4] _]
let chord6 = [. [c3,f#3,a3,d4] _]

mel     <. . . . [. f#5 a5] $mel1 [b4 c#5 d5] a4 f#4 . . . [. f#5 a5] $mel1 [b4 c#5 d5] a4 c#5 f#5 e4 . . [a4 b4 c5] [e5 d5 b4] [d5 c5 b4] d5 [. . d5] [e5 f5 g5] [a5 c5 d5] [e5 d5 b4] d5 [. . d5] g5 f#5 [b4 a4 b4] [c#5 d5 e5] [c#5 d5 e5] f#4 . .> | piano gain .85 len 2 rel 2 verb .35 human .1
chords  <$chord1 $chord2 $chord1 $chord2 $chord1 $chord2 $chord1 $chord2 $chord1 $chord2 $chord1 $chord2 $chord1 $chord2 $chord1 $chord2 $chord2 $chord1 [. [g3,b3] _] [. [b3,d4,g4] _] [. [f3,a3,d4] _] $chord3 [. [g3,b3,e4] _] $chord4 $chord5 $chord6 [. [a3,c4,f4] _] $chord3 $chord4 $chord5 $chord6 [. [b3,e4,g4] _] $chord2 $chord1 [. [c#4,e4,a4] _] [. [a3,c#4,f#4,a4] _] [. [a3,d4] [e3,b3,d4,g4]] [g3,c4,e4,a4,c5] [d3,d4,f#4,a4,d5]> | piano gain .46 len 1.2 rel 1.5 verb .3 human .1
bass    <g2 d2 g2 d2 g2 d2 g2 d2 g2 d2 g2 d2 g2 d2 g2 d2 f#2 b1 e2 e2 d2 a1 d2 d2 d2 d2 d2 d2 d2 d2 d2 e2 f#2 b1 e2 e2 [. b2 ., e2] a2 [d2,a2]> | piano gain .68 len 1.1 rel 2 verb .3
air     <$chord1 $chord2 $chord1 $chord2 $chord1 $chord2 $chord1 $chord2 $chord1 $chord2 $chord1 $chord2 $chord1 $chord2 $chord1 $chord2 $chord2 $chord1 [. [g3,b3] _] [. [b3,d4,g4] _] [. [f3,a3,d4] _] $chord3 [. [g3,b3,e4] _] $chord4 $chord5 $chord6 [. [a3,c4,f4] _] $chord3 $chord4 $chord5 $chord6 [. [b3,e4,g4] _] $chord2 $chord1 [. [c#4,e4,a4] _] [. [a3,c#4,f#4,a4] _] [. [a3,d4] [e3,b3,d4,g4]] [g3,c4,e4,a4,c5] [d3,d4,f#4,a4,d5]> | choir gain .16 atk 1 rel 2.5 verb .6
sub     <g2 d2 g2 d2 g2 d2 g2 d2 g2 d2 g2 d2 g2 d2 g2 d2 f#2 b1 e2 e2 d2 a1 d2 d2 d2 d2 d2 d2 d2 d2 d2 e2 f#2 b1 e2 e2 [. b2 ., e2] a2 [d2,a2]> | sine gain .3 atk .3 rel 1.5

scene piano mel chords bass
scene air   all
song piano:18 air:21
`,
  },
  {
    id: 'bistro', name: 'Little Forest Bistro (piano waltz)',
    head: {
      ko: '// 숲속 작은 식당 — 일본 카페 피아노 감성으로 새로 쓴 왈츠예요 (원곡 없음). F장조, 한 마디가 3/4 (8분음표 6칸)\n// 왼손은 쪼갠 화음(1-5-3-5), 오른손 선율. B단락은 Bb-C-Am-Dm, J-팝에서 많이 쓰는 IV-V-iii-vi 진행이에요\n// 첫 바퀴는 피아노 혼자, 두 번째 바퀴엔 현악기와 업라이트 베이스, 플루트가 한 옥타브 아래로 따라 불러요',
      en: '// Little Forest Bistro — an original waltz in the spirit of Japanese café piano (not based on any song). F major, each bar 3/4 (six eighths)\n// Broken chords in the left hand (1-5-3-5), the tune in the right. The B part is Bb-C-Am-Dm, the IV-V-iii-vi run J-pop loves\n// The first time round the piano is alone; the second time strings, an upright bass and a flute an octave below join in',
    },
    body: `bpm 184
key F major
master warm
space room

let tune  = <[a4 _ _ _ g4 a4] [c5 _ _ _ bb4 a4] [f4 _ a4 _ d5 _] [e5 _ _ _ d5 c5] [d5 _ _ _ c5 bb4] [c5 _ _ _ f5 e5] [d5 _ c5 _ bb4 a4] [g4 _ _ _ . .] [a4 _ _ _ g4 a4] [c5 _ _ _ d5 e5] [f5 _ e5 _ d5 _] [c5 _ _ _ a4 c5] [d5 _ _ _ c5 bb4] [g4 _ _ _ e4 _] [f4 _ _ _ _ _] [. . . . c5 d5] [f5 _ _ _ d5 bb4] [e5 _ _ _ c5 g4] [e5 _ _ _ c5 a4] [d5 _ _ _ e5 f5] [g5 _ _ _ f5 d5] [e5 _ _ _ g5 _] [a5 _ g5 _ e5 _] [f5 _ _ _ e5 d5]>
let hands = <[f2 c3 a3 c4 a3 c3] [e2 c3 g3 c4 g3 c3] [d2 a2 f3 a3 f3 a2] [a2 e3 a3 c4 a3 e3] [bb1 f2 d3 f3 d3 f2] [a2 f3 a3 c4 a3 f3] [g2 d3 f3 bb3 f3 d3] [c3 g3 bb3 e4 bb3 g3] [f2 c3 a3 c4 a3 c3] [e2 c3 g3 c4 g3 c3] [d2 a2 f3 a3 f3 a2] [a2 e3 a3 c4 a3 e3] [bb1 f2 d3 f3 d3 f2] [c3 g3 c4 e4 c4 g3] [f2 c3 a3 c4 a3 c3] [f2 c3 a3 c4 a3 c3] [bb1 f2 d3 f3 d3 f2] [c3 g3 c4 e4 c4 g3] [a2 e3 a3 c4 a3 e3] [d2 a2 f3 a3 f3 a2] [g2 d3 f3 bb3 f3 d3] [c3 g3 c4 e4 c4 g3] [f2 c3 e3 a3 e3 c3] [c3 g3 bb3 f4 bb3 g3]>

mel     $tune                 | piano gain .8 len 1.6 rel 1.4 verb .3 human .12
left    $hands                | piano gain .4 len 2.5 rel 1.6 verb .3 human .15 vel [1 .7 .8 .75 .8 .7]
flute   $tune                 | flute tr -12 gain .2 atk .05 vib .15 verb .4
strings <[c3,a3,c4] [c3,g3,c4] [a2,f3,a3] [e3,a3,c4] [f2,d3,f3] [f3,a3,c4] [d3,f3,bb3] [g3,bb3,e4] [c3,a3,c4] [c3,g3,c4] [a2,f3,a3] [e3,a3,c4] [f2,d3,f3] [g3,c4,e4] [c3,a3,c4] [c3,a3,c4] [f2,d3,f3] [g3,c4,e4] [e3,a3,c4] [a2,f3,a3] [d3,f3,bb3] [g3,c4,e4] [c3,e3,a3] [g3,bb3,f4]> | bowed tr 12 gain .14 atk .6 rel 1.5 verb .45
bass    <[f2 . .] [e2 . .] [d2 . .] [a2 . .] [bb1 . .] [a2 . .] [g2 . .] [c3 . .] [f2 . .] [e2 . .] [d2 . .] [a2 . .] [bb1 . .] [c3 . .] [f2 . .] [f2 . .] [bb1 . .] [c3 . .] [a2 . .] [d2 . .] [g2 . .] [c3 . .] [f2 . .] [c3 . .]> | upright gain .55 human .1

scene alone   mel left
scene friends all
song alone:24 friends:24
`,
  },
  {
    id: 'rainwindow', name: 'Rain on the Window (piano ballad)',
    head: {
      ko: '// 비 오는 창가 — 일본 힐링 피아노 발라드 감성으로 새로 쓴 곡이에요 (원곡 없음). D장조 72 BPM\n// 왼손은 8분음표로 쪼갠 화음, 화음은 Gmaj7-A-F#m7-Bm7 처럼 maj7·m7 이 많아요. 17마디부터 브리지(Bm7-F#m7-Gmaj7-D/F#)\n// 빗소리는 셰이커를 가끔씩(degrade) 흩뿌린 거예요. 두 번째 바퀴엔 현악기가 화음을 받쳐요',
      en: '// Rain on the Window — an original in the spirit of Japanese healing piano ballads (not based on any song). D major at 72 BPM\n// Broken eighth-note chords in the left hand; lots of maj7 and m7 (Gmaj7-A-F#m7-Bm7). The bridge starts at bar 17 (Bm7-F#m7-Gmaj7-D/F#)\n// The rain is a shaker scattered now and then (degrade). The second time round strings hold the chords',
    },
    body: `bpm 72
key D major
master warm
space hall

let tune  = <[f#5 _ _ _ e5 _ d5 _] [e5 _ _ _ . c#5 d5 e5] [a5 _ _ _ f#5 _ e5 _] [d5 _ _ _ _ _ . .] [. b4 d5 e5 g5 _ f#5 e5] [e5 _ _ d5 _ _ c#5 _] [d5 _ _ _ _ _ a4 b4] [c5 _ _ _ a4 _ f#4 _] [b4 _ _ _ d5 _ f#5 _] [e5 _ _ _ . e5 f#5 g5] [a5 _ _ _ a5 _ f#5 _] [g5 _ _ _ e5 _ . .] [d5 _ e5 _ f#5 _ g5 _] [e5 _ _ _ c#5 _ e5 _] [d5 _ _ _ _ _ _ _] [. . . . a4 b4 d5 e5] [f#5 _ _ _ d5 _ b4 _] [c#5 _ _ _ a4 _ c#5 e5] [d5 _ _ _ b4 _ d5 f#5] [e5 _ _ _ _ _ d5 c#5] [b4 _ _ _ e5 _ g5 _] [a#4 _ _ _ c#5 _ e5 _] [d5 _ _ _ c#5 _ b4 _] [a4 _ _ _ . . . .]>
let hands = <[g2 d3 b3 d4 f#4 d4 b3 d3] [a2 e3 a3 c#4 e4 c#4 a3 e3] [f#2 c#3 a3 c#4 e4 c#4 a3 c#3] [b1 f#2 d3 a3 b3 a3 d3 f#2] [e2 b2 g3 b3 d4 b3 g3 b2] [a2 e3 g3 d4 a2 e3 g3 c#4] [d2 a2 f#3 a3 c#4 a3 f#3 a2] [d2 a2 c3 f#3 a3 f#3 c3 a2] [g2 d3 b3 d4 f#4 d4 b3 d3] [a2 e3 a3 c#4 e4 c#4 a3 e3] [f#2 c#3 a3 e4 b1 a2 d#3 f#3] [e2 b2 g3 b3 d4 b3 g3 b2] [a2 e3 g3 d4 e4 d4 g3 e3] [a2 e3 g3 c#4 e4 c#4 g3 e3] [d2 a2 d3 f#3 a3 f#3 d3 a2] [d2 a2 d3 f#3 a3 f#3 d3 a2] [b1 f#2 d3 a3 b3 a3 d3 f#2] [f#2 c#3 a3 c#4 e4 c#4 a3 c#3] [g2 d3 b3 d4 f#4 d4 b3 d3] [f#2 a2 d3 f#3 a3 f#3 d3 a2] [e2 b2 g3 b3 d4 b3 g3 b2] [f#2 c#3 e3 a#3 c#4 a#3 e3 c#3] [b1 f#2 d3 a3 b3 a3 d3 f#2] [a2 e3 g3 d4 a2 e3 g3 c#4]>

mel     $tune                 | piano gain .98 len 1.8 rel 1.6 verb .35 human .12
left    $hands                | piano gain .48 len 3 rel 2 verb .35 human .15 vel [1 .65 .75 .7 .85 .65 .75 .7]
strings <[d3,b3,d4] [e3,a3,c#4] [c#3,a3,c#4] [f#2,d3,a3] [b2,g3,b3] [e3,g3,c#4] [a2,f#3,a3] [a2,c3,f#3] [d3,b3,d4] [e3,a3,c#4] [a2,d#3,f#3] [b2,g3,b3] [e3,g3,d4] [e3,g3,c#4] [a2,d3,f#3] [a2,d3,f#3] [f#2,d3,a3] [c#3,a3,c#4] [d3,b3,d4] [a2,d3,f#3] [b2,g3,b3] [c#3,e3,a#3] [f#2,d3,a3] [e3,g3,c#4]> | bowed tr 12 gain .16 atk .8 rel 2 verb .5
rain    x*16                  | shaker gain .06 degrade .55 hpf 4000 pan rand(-.8,.8) human .5

scene alone mel left rain
scene swell all
song alone:24 swell:24
`,
  },
  {
    id: 'rag', name: 'The Entertainer',
    head: {
      ko: '// 스콧 조플린, 디 엔터테이너 (1902, 퍼블릭 도메인)의 A·B 스트레인 32마디. 2/4박자 두 마디가 한 칸(16분음표 16칸)\n// A는 피아노 솔로, B에서 업라이트 베이스와 브러시 스네어가 들어와 래그타임 밴드가 돼요. 악보: Mutopia Project (퍼블릭 도메인 판)\n// 되풀이되는 두 마디는 let 프레이즈로 이름을 붙였어요',
      en: '// Scott Joplin, The Entertainer (1902, public domain): the A and B strains, 32 bars. Each step of <> is two 2/4 bars (sixteen sixteenths)\n// Solo piano for A; in B an upright bass and a brushed snare turn it into a ragtime band. Score: Mutopia Project (public domain edition)\n// The two-bar phrases that repeat are named with let',
    },
    body: `bpm 76
key C major
master warm
space room

let rh1 = [e4 c5 _ e4 c5 _ e4 c5@6 [c5,e5,c6] [d5,f5,d6] [d#5,f#5,d#6]]
let rh2 = [[g4,e5,g5] _ [a4,e5,a5] [g4,e5,g5] _ [e4,c5,e5] [f4,d5,f5] [f#4,d#5,f#5] [g4,e5,g5] _ [a4,e5,a5] [g4,e5,g5] _ e5 c5 g4]
let lh1 = [c3 [e3,g3,c4] [g2,g3] [g3,bb3,c4] [f2,f3] [a3,c4] [e2,e3] [g3,c4]]
let lh2 = [[c2,c3] [g3,c4,e4] g2 [g3,c4,e4] c3 [g3,c4,e4] g2 [g3,c4,e4]]
let bass1 = [c3 . g2 . f2 . e2 .]
let bass2 = [g2 . g2 . c3 .@3]
let bass3 = [c2 . g2 . c3 . g2 .]

rh     <$rh1 [[e5,g5,e6] [c5,e5,c6] [d5,f5,d6] [e5,g5,e6] _ [b4,d5,b5] [d5,f5,d6] _ [c5,e5,c6]@6 d4 d#4] [e4 c5 _ e4 c5 _ e4 c5@7 [a4,c5,a5] [g4,c5,g5]] [[f#4,c5,f#5] [a4,a5] [c5,c6] [e5,e6] _ [d5,d6] [c5,c6] [a4,a5] [d5,f5,d6]@6 d4 d#4] $rh1 [[e5,g5,e6] [c5,e5,c6] [d5,f5,d6] [e5,g5,e6] _ [b4,d5,b5] [d5,f5,d6] _ [c5,e5,c6]@6 [c5,c6] [d5,d6]] [[e5,e6] [c5,c6] [d5,d6] [e5,e6] _ [c5,c6] [d5,d6] [c5,c6] [e5,e6] [c5,c6] [d5,d6] [e5,e6] _ [c5,c6] [d5,d6] [c5,c6]] [[e5,g5,e6] [c5,e5,c6] [d5,f5,d6] [e5,g5,e6] _ [b4,d5,b5] [d5,f5,d6] _ [c5,e5,c6]@5 [e4,c5,e5] [f4,d5,f5] [f#4,d#5,f#5]] $rh2 [a4 b4 c5 d5 e5 d5 c5 d5 g4 e5 f5 g5 a5 g5 e5 f5] [[g4,e5,g5] _ [a4,e5,a5] [g4,e5,g5] _ [e4,c5,e5] [f4,d5,f5] [f#4,d#5,f#5] [g4,e5,g5] _ [a4,e5,a5] [g4,e5,g5] _ g5 a5 bb5] [[d5,g5,b5] [d5,g5,b5] _ [c5,f#5,b5] _ a5 [c5,f#5] d5 [b4,g5]@5 [e4,c5,e5] [f4,d5,f5] [f#4,d#5,f#5]] $rh2 [a4 b4 c5 d5 e5 d5 c5 d5 c5@5 g4 f#4 g4] [c5 _ a4 c5 _ a4 c5 a4 g4 c5 e5 g5 _ e5 c5 g4] [[f#4,a4] _ [f#4,c5] _ [f4,e5] [f4,d5] _ [e4,c5]@7 d4 d#4]> | piano gain .5 len 1.2 rel .35 human .1
lh     <$lh1 [g2 [e3,g3,c4] g2 [f3,g3,b3] c3 [e3,g3,c4] [e3,g3,c4] [g3,b3]] [c3 [e3,g3,c4] [g2,g3] [g3,bb3,c4] [f2,f3] [a3,c4] [e2,e3] [d#2,d#3]] [[d2,d3] [d3,f#3,a3,c4] d3 [f#3,a3,c4] [g3,b3] [g2,g3] [a2,a3] [b2,b3]] $lh1 [g2 [e3,g3,c4] g2 [f3,g3,b3] c3 [e3,g3,c4] [g3,c4,e4] .] [[c3,c4] [g3,c4,e4] [bb2,bb3] [g3,c4,e4] [a2,a3] [a3,c4,f4] [ab2,ab3] [ab3,c4,f4]] [[g2,g3] [g3,c4,e4] g2 [g3,b3] [c3,g3,c4] [g2,g3] [c2,c3] .] $lh2 [f2 [a3,c4,f4] f3 [ab3,c4,f4] e3 [g3,c4,e4] g2 [g3,c4,e4]] [c3 [g3,c4,e4] g2 [g3,c4,e4] c3 [g3,c4,e4] e3 d#3] [d3 [g3,b3,d4] d3 [a3,c4,d4] [g3,b3,d4] [f2,f3] [e2,e3] [d2,d3]] $lh2 [f2 [a3,c4,f4] f3 [ab3,c4,f4] e3 [g3,c4,e4] c3 [bb3,c4,e4]] [[f3,a3,c4,f4] [f3,a3,c4,f4] [f#3,a3,c4,d#4] [f#3,a3,c4,d#4] [g3,c4,e4] [g3,c4,e4] [g3,c4,e4] [g3,c4,e4]] [[d3,c4] [d3,a3] [g3,b3] [g3,b3] [c3,c4] [g2,g3] [c2,c3] .]> | piano gain .42 len 1.1 rel .3 pan -.1 human .1
bass   <$bass1 $bass2 $bass1 [d2 . d3 .@3 a2 .] $bass1 $bass2 [c3 . bb2 . a2 . ab2 .] [g2 . g2 . c3 . c2 .] $bass3 [f2 .@5 g2 .] [c3 . g2 . c3 .@3] [d3 . d3 .@3 e2 .] $bass3 [f2 .@5 c3 .] . [d3 .@3 c3 . c2 .]> | upright gain .7 human .1
kick   x . . . . . . . x . . . . . . .   | gain .45 tune .9 dec .6
brush  . . . . x . . . . . . . x . . .   | asnare gain .32 human .3 verb .15

scene solo rh lh
scene band all
song solo:8 band:8
`,
  },
  {
    id: 'mountain', name: 'Mountain King (Techno)',
    head: {
      ko: '// 그리그, 산왕의 궁전에서 (페르 귄트, 1875, 퍼블릭 도메인)의 주제 16마디: B단조 두 번, F# 두 번. 한 마디가 한 칸(8분음표 8칸)\n// 원곡처럼 조용히 숨어 들어와 점점 쌓여요: 피치카토 → 킥 → 애시드 → 라이저 → 슈퍼소 리드. 악보: Mutopia Project (퍼블릭 도메인 판)',
      en: '// Grieg, In the Hall of the Mountain King (Peer Gynt, 1875, public domain): the 16-bar theme, twice in B minor and twice in F#. Each step of <> is one bar (eight eighths)\n// It creeps in and piles up like the original: pizzicato, then kick, acid, a riser and a supersaw lead. Score: Mutopia Project (public domain edition)',
    },
    body: `bpm 128
key B minor
master loud
space chamber

theme  <[b2 c#3 d3 e3 f#3 d3 f#3 .] [f3 c#3 f3 . e3 c3 e3 .] [b2 c#3 d3 e3 f#3 d3 f#3 b3] [a3 f#3 d3 f#3 [a2,a3]@4] [b2 c#3 d3 e3 f#3 d3 f#3 .] [f3 c#3 f3 . e3 c3 e3 .] [b2 c#3 d3 e3 f#3 d3 f#3 b3] [a3 f#3 d3 f#3 [a2,a3]@4] [f#3 g#3 a#3 b3 c#4 a#3 c#4 .] [d4 a#3 d4 . c#4 a#3 c#4 .] [f#3 g#3 a#3 b3 c#4 a#3 c#4 .] [d4 a#3 d4 . [c#3,c#4]@4] [f#3 g#3 a#3 b3 c#4 a#3 c#4 .] [d4 a#3 d4 . c#4 a#3 c#4 .] [f#3 g#3 a#3 b3 c#4 a#3 c#4 .] [d4 a#3 d4 . [c#3,c#4]@4]> | pluck gain .5 len .6 cut k1(900,6000) verb .2 delay .15
acid   <[b2 c#3 d3 e3 f#3 d3 f#3 .] [f3 c#3 f3 . e3 c3 e3 .] [b2 c#3 d3 e3 f#3 d3 f#3 b3] [a3 f#3 d3 f#3 a2@4] [b2 c#3 d3 e3 f#3 d3 f#3 .] [f3 c#3 f3 . e3 c3 e3 .] [b2 c#3 d3 e3 f#3 d3 f#3 b3] [a3 f#3 d3 f#3 a2@4] [f#3 g#3 a#3 b3 c#4 a#3 c#4 .] [d4 a#3 d4 . c#4 a#3 c#4 .] [f#3 g#3 a#3 b3 c#4 a#3 c#4 .] [d4 a#3 d4 . c#3@4] [f#3 g#3 a#3 b3 c#4 a#3 c#4 .] [d4 a#3 d4 . c#4 a#3 c#4 .] [f#3 g#3 a#3 b3 c#4 a#3 c#4 .] [d4 a#3 d4 . c#3@4]> | acid gain .45 cut k2(300,2600) res 8 env .6 len .7 duck .3
lead   <[b4 c#5 d5 e5 f#5 d5 f#5 .] [f5 c#5 f5 . e5 c5 e5 .] [b4 c#5 d5 e5 f#5 d5 f#5 b5] [a5 f#5 d5 f#5 [a4,a5]@4] [b4 c#5 d5 e5 f#5 d5 f#5 .] [f5 c#5 f5 . e5 c5 e5 .] [b4 c#5 d5 e5 f#5 d5 f#5 b5] [a5 f#5 d5 f#5 [a4,a5]@4] [f#5 g#5 a#5 b5 c#6 a#5 c#6 .] [d6 a#5 d6 . c#6 a#5 c#6 .] [f#5 g#5 a#5 b5 c#6 a#5 c#6 .] [d6 a#5 d6 . [c#5,c#6]@4] [f#5 g#5 a#5 b5 c#6 a#5 c#6 .] [d6 a#5 d6 . c#6 a#5 c#6 .] [f#5 g#5 a#5 b5 c#6 a#5 c#6 .] [d6 a#5 d6 . [c#5,c#6]@4]> | supersaw gain .28 len .8 verb .3 duck .4
bass   <[b1 . f#2 . b1 . f#2 .] [b1 . f#2 . b1 . f#2 .] [b1 . f#2 . b1 . f#2 .] [d2 . a2 . d2 . a2 .] [b1 . f#2 . b1 . f#2 .] [b1 . f#2 . b1 . f#2 .] [b1 . f#2 . b1 . f#2 .] [d2 . a2 . d2 . a2 .] [f#2 c#3 f#2 c#3] [d2 a#2 f#2 c#3] [f#2 c#3 f#2 c#3] [d2 a#2 f#2 c#3] [f#2 c#3 f#2 c#3] [d2 a#2 f#2 c#3] [f#2 c#3 f#2 c#3] [d2 a#2 f#2 c#3]> | bass gain .75 len .5 duck .6
kick   x*4                       | gain 1 drive .15
hat    [. x]*4                   | gain .4 human .15
clap   . x . x                   | gain .5 verb .2
ohat   . . x . . . x .           | gain .25
auto stut <. . . [. . . x]>      | repeat 16   // the last beat of every 4 bars stutters (full scene only)

scene creep  theme bass
scene march  theme bass kick hat
scene acid   acid bass kick hat clap ohat
scene build  acid bass hat clap riser
scene full   lead acid bass kick hat clap ohat stut
song creep:16 march:16 acid:12 build:4 full:16
`,
  },
  {
    id: 'canon', name: 'Canon in D',
    head: {
      ko: '// 파헬벨, 카논 D장조 (1700년 무렵, 퍼블릭 도메인) 앞 18마디. 한 마디가 한 칸(16분음표 16칸)\n// 첼로의 2마디 바소 오스티나토 위로 세 성부가 2마디씩 늦게 같은 선율을 따라가요(현·플루트·하프). 11마디부터 로파이 비트\n// 악보: Mutopia Project, Michael Fischer v. Mollard 판 (CC BY 4.0)',
      en: '// Pachelbel, Canon in D (c. 1700, public domain): the first 18 bars. Each step of <> is one bar (sixteen sixteenths)\n// Over the two-bar ground bass of the cello, three voices play the same line two bars apart (strings, flute, harp). A lo-fi beat from bar 11\n// Score: Mutopia Project, edition by Michael Fischer v. Mollard (CC BY 4.0)',
    },
    body: `bpm 72
key D major
master warm
space hall

cello  <[d3 a2 b2 f#2] [g2 d2 g2 a2]> | upright gain .8 human .1
v1     <. . [f#5 e5 d5 c#5] [b4 a4 b4 c#5] [d5 c#5 b4 a4] [g4 f#4 g4 e4] [d4 f#4 a4 g4 f#4 d4 f#4 e4] [d4 b3 d4 a4 g4 b4 a4 g4] [f#4 d4 e4 c#5 d5 f#5 a5 a4] [b4 _ g4 _ a4 _ f#4 _ d4 _ d5 _ d5@3 c#5] [d5 c#5 d5 d4 c#4 a4 e4 f#4 d4 d5 c#5 b4 c#5 f#5 a5 b5] [g5 f#5 e5 g5 f#5 e5 d5 c#5 b4 a4 g4 f#4 e4 g4 f#4 e4] [d4 e4 f#4 g4 a4 e4 a4 g4 f#4 b4 a4 g4 a4 g4 f#4 e4] [d4 b3 b4 c#5 d5 c#5 b4 a4 g4 f#4 e4 b4 a4 b4 a4 g4] [f#4 f#5 e5 _ . d5 f#5 _] [b5 a5 b5 c#6] [d6 d5 c#5 _ . b4 d5 _] [d5@3 d5 d5 g5 e5 a5]> | bowed gain .42 pan -.35 verb .35 human .1
v2     <. . . . [f#5 e5 d5 c#5] [b4 a4 b4 c#5] [d5 c#5 b4 a4] [g4 f#4 g4 e4] [d4 f#4 a4 g4 f#4 d4 f#4 e4] [d4 b3 d4 a4 g4 b4 a4 g4] [f#4 d4 e4 c#5 d5 f#5 a5 a4] [b4 _ g4 _ a4 _ f#4 _ d4 _ d5 _ d5@3 c#5] [d5 c#5 d5 d4 c#4 a4 e4 f#4 d4 d5 c#5 b4 c#5 f#5 a5 b5] [g5 f#5 e5 g5 f#5 e5 d5 c#5 b4 a4 g4 f#4 e4 g4 f#4 e4] [d4 e4 f#4 g4 a4 e4 a4 g4 f#4 b4 a4 g4 a4 g4 f#4 e4] [d4 b3 b4 c#5 d5 c#5 b4 a4 g4 f#4 e4 b4 a4 b4 a4 g4] [f#4 f#5 e5 _ . d5 f#5 _] [b5 a5 b5 c#6]> | flute gain .38 pan .35 verb .35 human .1
v3     <. . . . . . [f#5 e5 d5 c#5] [b4 a4 b4 c#5] [d5 c#5 b4 a4] [g4 f#4 g4 e4] [d4 f#4 a4 g4 f#4 d4 f#4 e4] [d4 b3 d4 a4 g4 b4 a4 g4] [f#4 d4 e4 c#5 d5 f#5 a5 a4] [b4 _ g4 _ a4 _ f#4 _ d4 _ d5 _ d5@3 c#5] [d5 c#5 d5 d4 c#4 a4 e4 f#4 d4 d5 c#5 b4 c#5 f#5 a5 b5] [g5 f#5 e5 g5 f#5 e5 d5 c#5 b4 a4 g4 f#4 e4 g4 f#4 e4] [d4 e4 f#4 g4 a4 e4 a4 g4 f#4 b4 a4 g4 a4 g4 f#4 e4] [d4 b3 b4 c#5 d5 c#5 b4 a4 g4 f#4 e4 b4 a4 b4 a4 g4]> | harp gain .5 verb .3 human .1
keys   <[D A Bm F#m] [G D G A]>   | epiano oct 3 gain .28 verb .3 human .2
kick   x . . . . . . x . . x . . . . .  | gain .8 tune .85 dec .8
snare  . . . . x . . . . . . . x . . .  | asnare gain .45 nudge 10 human .2
hat    x*8                              | ahat gain .3 vel [1 .6]*4 human .3

scene strings cello v1 v2 v3
scene beat    all
song strings:10 beat:8
`,
  },
  {
    id: 'mathrock', name: 'Math Rock 7/8',
    head: {
      ko: '// Math Rock — 한 마디 = 7/8 (8분음표 7칸). 태핑 기타는 현 튕김 모델, 10:7 폴리리듬 하프가 엇갈려요\n// prog 에 maj7·m7·6 코드를 직접 써요',
      en: '// Math Rock — one bar = 7/8 (seven eighth notes). Tapped guitar uses the plucked-string model; a harp line plays 10 against 7\n// The prog line uses maj7, m7 and 6 chords directly',
    },
    body: `bpm 150
key E major
prog <Emaj7 C#m7 Amaj7 B6>

kick     x . . x . x .                            | gain .9 drive .1
snare    . . x . . . x'                           | asnare gain .6 human .2
hat      x*7                                      | ahat gain .5 vel [1.25 .6 .85 .6 1 .6 .85] human .2
crash    <x . . .>                                | acrash gain .35
tap      [0 4 7 9 7 4 2]*2                        | zither oct 4 bright k1(.4,.95) dec .9 gain .5 pan .3 delay .15 every 4 rev
tap2     [9 . 7 . 4 . 2 . 4 . 7 . 9 .]            | zither oct 4 bright .7 dec .7 gain .35 pan -.35 palindrome
poly     [0 2 4 6 4]*2                            | harp oct 5 gain .35 verb .3 pan -.2 iter 5
bass     0 _ _ 4 _ 2 _                            | bass oct 2 cut k2(500,2000) gain .7 duck .3

scene intro  tap hat
scene verse  kick snare hat tap bass
scene build  snare hat tap tap2 poly riser
scene drop   all fill
song intro:4 verse:8 build:4 drop:8 verse:4 drop:8
`,
  },
  {
    id: 'bossa', name: 'Bossa Nova',
    head: {
      ko: '// Bossa Nova — 128 BPM, I–VI7–ii–V (Dmaj7 B7 Em7 A7). 크로스스틱, 셰이커, 나일론 기타 컴핑(현 튕김 모델)과 플루트',
      en: '// Bossa Nova — 128 BPM, I–VI7–ii–V (Dmaj7 B7 Em7 A7). Cross-stick, shaker, nylon-guitar comping (plucked-string model) and flute',
    },
    body: `bpm 128
key D major
prog <Dmaj7 B7 Em7 A7>
master open

rim      x . . x . . x . . . x . . x . .          | gain .35 pan .2 human .2
kick     [x . . x] [x . . x] [x . . x] [x . . x]  | gain .4 dec .7
shake    x*16                                     | gain [.4 .15 .25 .15]*4 pan -.3
guitar   [0^7 . . 0^7] [. 0^7 . .] [0^7 . . 0^7] [. . 0^7 .] | zither oct 3 bright .5 dec .8 gain .26 pan -.15 human .25 degrade .08
bass     0 _ 4 _                                  | upright gain .85 human .15
flute    <[4 _ _ 5] [6 _ 4 _] [2 _ _ 1] [0 _ _ _]> | oct 5 gain .4 verb .35 delay .2 vib perlin(6,18,4)
vibes    <. [. 4 . 2] . [6 . 4 .]>                | oct 5 gain .3 verb .3 jux rev

scene intro  rim shake guitar
scene band   rim kick shake guitar bass
scene melody all -vibes
scene outro  rim shake guitar vibes
song intro:4 band:4 melody:16 outro:8
`,
  },
  {
    id: 'boombap', name: 'Boom Bap',
    head: {
      ko: '// Boom Bap — 88 BPM, 스윙 .18. 신스 킥 + 어쿠스틱 스네어·하이햇 샘플, 피아노 샘플 찹, 사인 베이스. k1 피아노 필터',
      en: '// Boom Bap — 88 BPM, swing .18. Synth kick with acoustic snare and hi-hat samples, chopped piano samples, sine bass. k1 filters the piano',
    },
    body: `bpm 88
key A minor
prog <Am7 Am7 Dm7 E7>
swing .18
master warm

kick     x . . . . . . x . . x . . . . .          | gain 1 tune .85 dec 1.1 drive .2
snare    . . . . x . . . . . . . x . . .          | asnare gain .8 nudge 12 human .2
hat      x*8                                      | ahat gain .5 vel [1 .6]*4 human .3 sometimes .12 ply 2
chop     [0^7 _ . .] [. . 0^7' .] . [. 0^7 . .]   | piano oct 4 gain .45 cut k1(1500,9000) shape .15 verb .15
bass     0 _ . [. 0] . . 4 .                      | sine oct 2 gain .85
vibes    <. [4 . 2 .] . [6 . 4 2]>                | oct 5 gain .3 delay .3 jux rev
tamb     . x . x                                  | gain .25 pan .4

scene intro  chop vibes
scene verse  kick snare hat chop bass
scene hook   all pause
song intro:4 verse:8 hook:8 verse:8 hook:8
`,
  },
  {
    id: 'gpu', name: 'WebGPU Drift',
    head: {
      ko: '// WebGPU Drift — 84 BPM, D 리디안. swarm(사인파 수천 개 패드)·choir(포먼트 합창)·plate(금속판 수백 개 모드)는 GPU가 음표를 미리 렌더링해요\n// P를 누르고 있으면 지금 소리를 얼려요(프리즈). 코드 위 시각화에서 terrain·contour·dots·demo를 고르면 GPU 셰이더 배경이 소리에 맞춰 움직여요. GPU가 없으면 CPU 소리로 대신 연주해요',
      en: '// WebGPU Drift — 84 BPM, D lydian. swarm (a pad of thousands of sines), choir (formant voices) and plate (hundreds of metal-plate modes) are rendered note by note on the GPU\n// Hold P to freeze the sound. Pick terrain, contour, dots or demo above the code for a GPU shader backdrop that follows the sound. Without a GPU, CPU voices stand in',
    },
    body: `bpm 84
key D lydian
prog <0 4 5 3>

kick   x . . . . . . . x . . . . . . .    | gain .75 tune .8 dec 1.2
hat    [. x]*4?.3                          | gain .2 human .3
swarm  0^7                                 | gain .55 atk .6 rel 2 duck .4 verb .3
choir  <[0^ _ _ _] [2^ _ _ _]>/2           | gain .5 bright .3 verb .5
plate  [0 . . 4 . . 7 .] [. 9 . . 4 . . .] | oct 5 gain .55 dec .6 delay .3 verb .4 jux rev
bass   0 _ _ _ . . . .                     | sine oct 2 gain .6

scene air   swarm choir
scene ring  swarm plate choir swell
scene pulse all fill
song air:8 ring:8 pulse:16 ring:8
`,
  },
  {
    id: 'gpulab', name: 'GPU Lab',
    head: {
      ko: '// GPU Lab — 92 BPM, D 마이너. timp는 파동 방정식으로 시뮬레이션한 북, sax는 신경망 색소폰(nsax), space cathedral은 공진 모드 수만 개로 만든 성당 잔향\n// viz 줄이 8마디마다 배경을 바꾸고, shader 줄의 glow는 직접 쓴 WGSL 식이에요. 식을 고치면 바로 다시 그려요',
      en: '// GPU Lab — 92 BPM, D minor. timp is a drum simulated as the wave equation, sax is the neural sax (nsax), space cathedral is a reverb made of tens of thousands of modes\n// The viz line changes the backdrop every 8 bars, and glow on the shader line is a WGSL expression you can edit live',
    },
    body: `bpm 92
key D minor
prog <0 5 3 4>
space cathedral
viz <terrain glow sono>/8
shader glow  vec3f(1., .55, .3) * (1. - smoothstep(0., .02, abs(length(q) - .22 - bass * .2))) + ink * fbm(q * 3. + t * .1) * .12

timp   0 . . . 0 . 4 . 0 . . . [4 0] . . .   | oct 2 gain .9 dec .6 human .2
kick   x . . . . . . . x . . . . . . .       | gain .7 tune .8
hat    [. x]*4                               | gain .18 human .3
sax    <[0 _ 2 _ 4 _ _ 2] [5 _ 4 2 _ 0 _ _]> | nsax gain .7 rel .3 vib .3 verb .3 delay .2 echo 2 3/16 .35
choir  <0^ 3^>/2                             | gain .4 verb .5 bright .3
bass   0 _ . . 0 . . .                       | sine oct 2 gain .6

scene open  timp choir
scene full  all
song open:8 full:16
`,
  },
  {
    id: 'lab', name: 'Pattern Lab',
    head: {
      ko: '// Pattern Lab — 프레이즈(let)와 패턴 변형을 한곳에 모았어요. 줄마다 하나씩 바꿔 보세요\n// off 1/8 +2: 8분음표 늦게 2도 위로 한 겹 더 · jux rev: 오른쪽은 거꾸로 · echo 3 3/16 .5: 메아리 · iter 4: 마디마다 시작점 밀기\n// sometimes .25 ply 2: 가끔 두 번 치기 · degrade .2: 가끔 빼기 · struct x..x..x...x.x...: 이 리듬으로 · chunk 4 +2: 한 조각씩 돌아가며 2도 위\n// 값 자리에 perlin(300,1800,4): 4마디에 걸쳐 떠도는 필터 · rand(-.6,.6): 음마다 다른 위치',
      en: '// Pattern Lab — phrases (let) and pattern changes in one place. Change one line at a time\n// off 1/8 +2: one more layer, an eighth late and a step up · jux rev: reversed on the right · echo 3 3/16 .5: echoes · iter 4: start each bar further in\n// sometimes .25 ply 2: now and then a double hit · degrade .2: drop some · struct x..x..x...x.x...: replay on this rhythm · chunk 4 +2: a step up, one part per bar\n// In place of a value, perlin(300,1800,4) drifts the filter over 4 bars · rand(-.6,.6) places each note somewhere new',
    },
    body: `bpm 124
key D dorian
prog <0 3>              // Dm7 G7
master default

let motif  = 0 2 4 [7 6]
let answer = 4 . 2 [0 -1]

lead   <$motif $answer>                 | pluck oct 4 off 1/8 +2 jux rev gain .75 delay .3
bell   <$motif $answer>                 | bell oct 5 echo 3 3/16 .5 iter 4 gain .24 verb .4
kick   x . . . x . . . x . . . x . . .  | gain 1
hat    x*16                             | sometimes .25 ply 2 gain [.35 .15 .25 .15]*4 pan .2
clap   . x . x                          | degrade .2 gain .5 verb .2
bass   0 _ . 0 . . 4 .                  | bass oct 2 cut perlin(300,1800,4) res 6 duck .6 gain .75
stab   0^7*16                           | epiano oct 3 struct x..x..x...x.x... chunk 4 +2 gain .15 pan rand(-.6,.6) verb .2
pad    0^7                              | gain .18 verb .6 duck .7

scene a lead bass kick hat pad
scene b all
song a:8 b:16
`,
  },
  {
    id: 'mixbus', name: 'Mix & Buses',
    head: {
      ko: '// Mix & Buses — 122 BPM, F 마이너. 믹스를 코드로: wash(코러스+리버브)와 grit(디스토션+크러시) 버스에 트랙이 이름으로 보내요\n// bus delay·bus verb가 기본 리턴을, master 줄의 | 뒤가 마스터 컴프레서·EQ·폭·리미터를 정해요. 값은 LFO나 k1으로 움직일 수 있어요',
      en: '// Mix & Buses — 122 BPM, F minor. The mix in code: tracks send to the wash (chorus + reverb) and grit (distortion + crush) buses by name\n// bus delay and bus verb set up the built-in returns; after | on the master line come its compressor, EQ, width and limiter. Any value can move with an LFO or k1',
    },
    body: `bpm 122
key F minor
prog <Fm7 Dbmaj7 Ebm7 Cm7>
master warm | thr -20 ratio 3 low 1 high 1.5 width 1.25 limit -1
bus wash  | chorus .6 hpf 250 verb .7 duck .7
bus grit  | dist .45 crush k2(0,.7) lpf 5000 gain .7
bus delay | time 3 fb .5 lpf 2800 duck .5
bus verb  | pre 35 hpf 300

kick   x*4                         | gain 1 tune .9
clap   . x . x                     | gain .6 grit .3
hat    [. x]*4                     | gain .35 phaser .5
keys   <0^7 _ . [. 0^7]>           | epiano gain .5 wash .5 thr -24 ratio 4
bass   [0 . . 0] [. 0 . .]         | bass oct 2 gain .8 dist .2 duck .6
lead   <[4 . 2 .] [. 7 . 4]>       | pluck gain .4 delay .35 wash .2 chorus .4 lpf k1(1200,9000)
auto throw <. [. . . x] . [. . x _]> | throw .7   // delay throws on the last beats, from a pattern
`,
  },
];
function presetText(p, lang) { return p.head[lang] + '\n' + p.body; }
