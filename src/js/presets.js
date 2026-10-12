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
hat    [. x]*4                          | gain .45 pan .25 human .2 every 8 ply 2
ohat   . . . . . . x .                  | gain .3
clap   . x . x                          | gain .6 verb .25
bass   [. 0 0 0]*4                      | cut 600 res 5 shape k4(0,.7) duck .8
arp    [0' 2 4 7 4' 2 0 2]*2             | cut k1(300,6000) res 9 delay .35 duck .5
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
bell   [. . 4 .] [. 7 . .] [. . 6 .] [4 . . .] | oct 5 gain .25 delay .45 verb .5 cut k2(1500,9000)

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
shaker x*16                             | gain .3 vel [.35 .95 .55 1]*4 pan -.3 human .3
bass   [. 0 . 0] [. . 0 4]              | cut k2(300,1500) res 4 duck .6
stab   [. . 0^7 .] [. 0^7 . .] . [. . 0^7 .] | oct 3 cut k1(500,4000) res 3 env .5 dec .3 delay .3 verb .3 duck .5 gain .5
pad    0^7                              | gain .2 atk .8 rel 1.5 verb .6 duck .7
bell   <. [. . 4 .] . [. 6 . 4]>        | oct 5 gain .2 delay .5 verb k3(.2,.8)

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
rim    x(3,8,2)                         | gain .35 delay .35 pan .3 every 8 ply 2
perc   {x . . x . x . . x . . x .}%16  | tom tune 1.4 gain .3 pan -.3 delay .2
acid   [0 0 7 0] [3 0 1 0] [0 7 0 10] [0 1 0 3] | cut k1(200,2500) res 14 env .9 dec .14 slide [0 0 1 0 0 1 0 0]*2 acc [1 0 0 1 0 0 1 0]*2 delay .2 duck .3 shape k4(0,.6) every 8 rev
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
vinyl  x*32?.8                          | hat gain .05 tune .5 dec .4 pan -.4
bass   0 _ . [. 0] . . 4 .              | sine oct 2 gain .85 rel .1
keys   0^7 _ _ . . . [. 0^7'] _         | oct 3 cut k1(1200,7000) gain .4 verb .3 shape .1 drop2 human .3
bell   <[4 . . 2] [. . 0 .] [6 . 4 .] .> | oct 5 gain .22 delay .35 verb k3(.2,.8) cut 3000

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
hat    x*8                              | gain .3 vel [1 .55]*4 human .2
bass   [0 7]*4                          | saw oct 1 cut k2(400,2000) env .5 dec .15 res 3 duck .4
arp    0^7                              | updown rate 16 oct 4 cut k1(600,5000) delay .3 gain .35
pad    0^                               | gain .3 verb .6 duck .4
lead   <[7 _ _ 6] [5 _ 4 _] [4 _ _ 2] [4 _ _ _]> | supersaw oct 4 cut 2600 atk .04 delay .35 verb .5 gain .4

scene intro  pad arp
scene verse  kick snare hat bass pad fill
scene build  snare hat arp riser | arp.cut 600>5000
scene chorus all pause
song intro:8 verse:16 build:4 chorus:16 verse:8 build:4 chorus:16 intro:8
`,
  },
  {
    id: 'gdchip', name: 'Neon Steps (GD style)',
    head: {
      ko: '// Neon Steps — 138 BPM 칩 하우스. Geometry Dash 같은 리듬 게임 음악 스타일로 새로 쓴 곡이에요 (원곡 없음)\n// 사각파 아르페지오, 오프비트 베이스, 사이드체인 슈퍼소 훅. 마지막 드롭에선 사각파가 한 옥타브 위에서 훅을 겹쳐요',
      en: '// Neon Steps — 138 BPM chip house. An original in the style of rhythm-game music like Geometry Dash (not based on any song)\n// Square-wave arpeggio, offbeat bass, a sidechained supersaw hook. In the last drop a square wave doubles the hook an octave up',
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
chip   [0 2 4 7 4 2 0' 2]*2             | square oct 5 cut 5000 gain .17 duck .5 delay .2
pad    0^                               | gain .3 duck .9 verb .5
lead   <[4 . 4 . 2 4 . 7] [6 _ 4 . 1 _ 4 .] [5 . 5 . 2 5 . 7] [8 _ 7 . 5 _ 3 _]> | supersaw fixed oct 4 gain .62 duck .4 verb .3 delay .2
lead2  <[4 . 4 . 2 4 . 7] [6 _ 4 . 1 _ 4 .] [5 . 5 . 2 5 . 7] [8 _ 7 . 5 _ 3 _]> | square fixed oct 5 gain .16 cut 6000 delay .3

scene intro chip pad hat
scene build chip pad clap hat riser | chip.cut 600>6000
scene drop  kick clap hat ohat crash bass chip pad lead
scene break pad lead chip filter
scene last  all
song intro:8 build:4 drop:16 break:8 build:4 last:16
`,
  },
  {
    id: 'gddnb', name: 'Hyperdrive (GD style)',
    head: {
      ko: '// Hyperdrive — 174 BPM 드럼앤베이스. Geometry Dash 같은 리듬 게임 음악 스타일로 새로 쓴 곡이에요 (원곡 없음)\n// 리스 베이스 + 사인 서브, 사각파 훅, 빠른 플럭 아르페지오. k1 리스 필터, k2 훅 필터',
      en: '// Hyperdrive — 174 BPM drum & bass. An original in the style of rhythm-game music like Geometry Dash (not based on any song)\n// Reese bass over a sine sub, a square-wave hook, a fast pluck arpeggio. k1 opens the reese, k2 the hook',
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
hook   <[0 . 2 . 4 . 7 . 6 . 4 . 2 _ . .] [4 . 2 . 0 . 2 . 4 _ . . -1 _ . .]> | square oct 5 cut k2(1500,7000) gain .28 delay .25 duck .3
arp    [0 4 7 4]*4                      | pluck oct 4 gain .3 cut 3500 delay .3 duck .4
pad    0^7                              | gain .22 atk 1 rel 2 verb .6 duck .3

scene intro pad arp hat
scene build hat snare arp pad riser
scene drop  all pause
scene roll  kick snare ghost hat reese sub hook fill
scene break pad hook arp filter down
song intro:8 build:8 drop:16 roll:8 break:8 build:4 drop:16
`,
  },
  {
    id: 'gdstep', name: 'Gravity Flip (GD style)',
    head: {
      ko: '// Gravity Flip — 150 BPM 하프타임 덥스텝. Geometry Dash 같은 리듬 게임 음악 스타일로 새로 쓴 곡이에요 (원곡 없음)\n// 워블 베이스는 16분음표마다 필터 값을 바꿔서 만들어요 (cut [250 1800 600 3200]*4). 스네어는 3박에 한 번',
      en: '// Gravity Flip — 150 BPM half-time dubstep. An original in the style of rhythm-game music like Geometry Dash (not based on any song)\n// The wobble bass changes its filter on every sixteenth (cut [250 1800 600 3200]*4). The snare lands once, on beat 3',
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
chip   <[7 . 4 . 7 . 9 . 7 . 4 . 2 . 4 .] [7 . 4 . 7 . 9 . 11 _ 9 _ 7 _ . .]> | square oct 4 cut 4500 gain .3 delay .25 duck .3
arp    [0 2 4 2]*4                      | pluck oct 4 gain .15 cut 3000 delay .35
pad    0^                               | gain .26 atk .8 rel 2 verb .6 duck .4

scene intro pad arp
scene build arp chip hat snare riser
scene drop  kick snare clap hat wob sub chip pad
scene break pad arp chip filter down
song intro:8 build:4 drop:16 break:8 build:4 drop:16
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
deok     x' . [x x] . . [x x x x] . . [x x] . . [x x x x] | gain .65 pan .2 verb .15 human .3 vel [1 .8 .9 .8]
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
kkwang   x . x x . x x . x . x x . x x .         | kkwaeng gain [.4 .3 .34 .3]*4 pan -.3 human .2
kkwangm  . x . . x . . x . x . . x . . x         | kkwaengm gain .22 pan -.3 human .2
jing     <x . . . . . . .>                       | gain .65 verb .35
bass     [0 . 0 4] [. 0 3 .]                     | cut k2(300,1600) res 4 duck .6
gayageum [0 2 3 4]*4                             | oct 4 dec .7 bright k1(.2,.9) delay .25 gain .45
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
gayageum [0 . . 2 . . 4 .]?.3                    | dantranh oct 3 vib 16 rel 1.6 delay .4 verb .5 gain .7 human .4
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
bass     <[0 2 4 6] [0 4 2 -1] [0 2 4 2] [0 2 4 6]> | upright gain .9 human .2 vel [1 .85 .95 .85]
comp     0^7 [. . 0^7'] . .                       | piano oct 4 gain .36 rel .25 cut k1(1500,12000) pan -.2 drop2 human .3
sax      <[4 _ 5] [6 _ 4] [2 _ 4] [5 _ 6]>/1      | sax oct 4 gain .5 verb .25
head     <[[4 _ 5] [6 _ 4] [2 _ 4] [5 _ 6]] [[7 _ 6] [4 _ 2] [3 _ 1] [0 _ .]] [[2 _ _] [4 _ 6] [7 _ _] .] [[6 _ 5] [4 _ 3] [1 _ 2] [3 _ .]]> | sax oct 4 gain .55 verb k3(.1,.5) rel .1
vibes    [[r _ r] [r' _ r] [r _ r] [r' _ r]]?.2   | oct 5 gain .35 delay .25 verb .3 range 9 human .3

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
      ko: '// 베토벤, 엘리제를 위하여 WoO 59 (1810, 퍼블릭 도메인) 첫 부분 44마디를 음 하나하나 옮겼어요. 3/8박자 두 마디가 한 칸(16분음표 12칸)\n// 처음 8칸은 피아노만, 그다음은 6/8 로파이 비트와 업라이트 베이스가 들어와요. 악보: Mutopia Project (퍼블릭 도메인 판)',
      en: '// Beethoven, Für Elise WoO 59 (1810, public domain): the first 44 bars, note for note. Each step of <> is two 3/8 bars (twelve sixteenths)\n// Piano alone for 8 steps, then a 6/8 lo-fi beat and upright bass. Score: Mutopia Project (public domain edition)',
    },
    body: `bpm 90
key A minor
master warm
space room

rh     <[e5 d#5 e5 b4 d5 c5 a4 _ . c4 e4 a4] [b4 _ . e4 g#4 b4 c5 _ . e4 e5 d#5] [e5 d#5 e5 b4 d5 c5 a4 _ . c4 e4 a4] [b4 _ . e4 c5 b4 a4@4 e5 d#5] [e5 d#5 e5 b4 d5 c5 a4 _ . c4 e4 a4] [b4 _ . e4 g#4 b4 c5 _ . e4 e5 d#5] [e5 d#5 e5 b4 d5 c5 a4 _ . c4 e4 a4] [b4 _ . e4 c5 b4 a4 _ . b4 c5 d5] [e5@3 g4 f5 e5 d5@3 f4 e5 d5] [c5@3 e4 d5 c5 b4 _ . e4 e5 .] [. e5 e6 . . d#5 e5 _ . d#5 e5 d#5] [e5 d#5 e5 b4 d5 c5 a4 _ . c4 e4 a4] [b4 _ . e4 g#4 b4 c5 _ . e4 e5 d#5] [e5 d#5 e5 b4 d5 c5 a4 _ . c4 e4 a4] [b4 _ . e4 c5 b4 a4 _ . b4 c5 d5] [e5@3 g4 f5 e5 d5@3 f4 e5 d5] [c5@3 e4 d5 c5 b4 _ . e4 e5 .] [. e5 e6 . . d#5 e5 _ . d#5 e5 d#5] [e5 d#5 e5 b4 d5 c5 a4 _ . c4 e4 a4] [b4 _ . e4 g#4 b4 c5 _ . e4 e5 d#5] [e5 d#5 e5 b4 d5 c5 a4 _ . c4 e4 a4] [b4 _ . e4 c5 b4 a4@4 e5 d#5]> | piano gain .6 len 1.6 rel .8 verb .2 human .15
lh     <[.@6 a2 e3 a3 .@3] [e2 e3 g#3 .@3 a2 e3 a3 .@3] [.@6 a2 e3 a3 .@3] [e2 e3 g#3 .@3 a2 e3 a3 .@3] [.@6 a2 e3 a3 .@3] [e2 e3 g#3 .@3 a2 e3 a3 .@3] [.@6 a2 e3 a3 .@3] [e2 e3 g#3 .@3 a2 e3 a3 .@3] [c3 g3 c4 .@3 g2 g3 b3 .@3] [a2 e3 a3 .@3 e2 e3 e4 . . e4] [e5 . . d#5 e5 . . d#5 e5 .@3] [.@6 a2 e3 a3 .@3] [e2 e3 g#3 .@3 a2 e3 a3 .@3] [.@6 a2 e3 a3 .@3] [e2 e3 g#3 .@3 a2 e3 a3 .@3] [c3 g3 c4 .@3 g2 g3 b3 .@3] [a2 e3 a3 .@3 e2 e3 e4 . . e4] [e5 . . d#5 e5 . . d#5 e5 .@3] [.@6 a2 e3 a3 .@3] [e2 e3 g#3 .@3 a2 e3 a3 .@3] [.@6 a2 e3 a3 .@3] [e2 e3 g#3 .@3 a2 e3 a3 .@3]> | piano gain .42 len 2.5 rel 1 pan -.15 human .15
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

mel     <. . . . [. f#5 a5] [g5 f#5 c#5] [b4 c#5 d5] a4 f#4 . . . [. f#5 a5] [g5 f#5 c#5] [b4 c#5 d5] a4 c#5 f#5 e4 . . [a4 b4 c5] [e5 d5 b4] [d5 c5 b4] d5 [. . d5] [e5 f5 g5] [a5 c5 d5] [e5 d5 b4] d5 [. . d5] g5 f#5 [b4 a4 b4] [c#5 d5 e5] [c#5 d5 e5] f#4 . .> | piano gain .85 len 2 rel 2 verb .35 human .1
chords  <[. [b3,d4,f#4] _] [. [a3,c#4,f#4] _] [. [b3,d4,f#4] _] [. [a3,c#4,f#4] _] [. [b3,d4,f#4] _] [. [a3,c#4,f#4] _] [. [b3,d4,f#4] _] [. [a3,c#4,f#4] _] [. [b3,d4,f#4] _] [. [a3,c#4,f#4] _] [. [b3,d4,f#4] _] [. [a3,c#4,f#4] _] [. [b3,d4,f#4] _] [. [a3,c#4,f#4] _] [. [b3,d4,f#4] _] [. [a3,c#4,f#4] _] [. [a3,c#4,f#4] _] [. [b3,d4,f#4] _] [. [g3,b3] _] [. [b3,d4,g4] _] [. [f3,a3,d4] _] [. [a3,c4,e4] _] [. [g3,b3,e4] _] [. [d3,g3,b3,e4] _] [. [c3,e3,a3,d4] _] [. [c3,f#3,a3,d4] _] [. [a3,c4,f4] _] [. [a3,c4,e4] _] [. [d3,g3,b3,e4] _] [. [c3,e3,a3,d4] _] [. [c3,f#3,a3,d4] _] [. [b3,e4,g4] _] [. [a3,c#4,f#4] _] [. [b3,d4,f#4] _] [. [c#4,e4,a4] _] [. [a3,c#4,f#4,a4] _] [. [a3,d4] [e3,b3,d4,g4]] [g3,c4,e4,a4,c5] [d3,d4,f#4,a4,d5]> | piano gain .46 len 1.2 rel 1.5 verb .3 human .1
bass    <g2 d2 g2 d2 g2 d2 g2 d2 g2 d2 g2 d2 g2 d2 g2 d2 f#2 b1 e2 e2 d2 a1 d2 d2 d2 d2 d2 d2 d2 d2 d2 e2 f#2 b1 e2 e2 [. b2 ., e2] a2 [d2,a2]> | piano gain .68 len 1.1 rel 2 verb .3
air     <[. [b3,d4,f#4] _] [. [a3,c#4,f#4] _] [. [b3,d4,f#4] _] [. [a3,c#4,f#4] _] [. [b3,d4,f#4] _] [. [a3,c#4,f#4] _] [. [b3,d4,f#4] _] [. [a3,c#4,f#4] _] [. [b3,d4,f#4] _] [. [a3,c#4,f#4] _] [. [b3,d4,f#4] _] [. [a3,c#4,f#4] _] [. [b3,d4,f#4] _] [. [a3,c#4,f#4] _] [. [b3,d4,f#4] _] [. [a3,c#4,f#4] _] [. [a3,c#4,f#4] _] [. [b3,d4,f#4] _] [. [g3,b3] _] [. [b3,d4,g4] _] [. [f3,a3,d4] _] [. [a3,c4,e4] _] [. [g3,b3,e4] _] [. [d3,g3,b3,e4] _] [. [c3,e3,a3,d4] _] [. [c3,f#3,a3,d4] _] [. [a3,c4,f4] _] [. [a3,c4,e4] _] [. [d3,g3,b3,e4] _] [. [c3,e3,a3,d4] _] [. [c3,f#3,a3,d4] _] [. [b3,e4,g4] _] [. [a3,c#4,f#4] _] [. [b3,d4,f#4] _] [. [c#4,e4,a4] _] [. [a3,c#4,f#4,a4] _] [. [a3,d4] [e3,b3,d4,g4]] [g3,c4,e4,a4,c5] [d3,d4,f#4,a4,d5]> | choir gain .16 atk 1 rel 2.5 verb .6
sub     <g2 d2 g2 d2 g2 d2 g2 d2 g2 d2 g2 d2 g2 d2 g2 d2 f#2 b1 e2 e2 d2 a1 d2 d2 d2 d2 d2 d2 d2 d2 d2 e2 f#2 b1 e2 e2 [. b2 ., e2] a2 [d2,a2]> | sine gain .3 atk .3 rel 1.5

scene piano mel chords bass
scene air   all
song piano:18 air:21
`,
  },
  {
    id: 'rag', name: 'The Entertainer',
    head: {
      ko: '// 스콧 조플린, 디 엔터테이너 (1902, 퍼블릭 도메인)의 A·B 스트레인 32마디. 2/4박자 두 마디가 한 칸(16분음표 16칸)\n// A는 피아노 솔로, B에서 업라이트 베이스와 브러시 스네어가 들어와 래그타임 밴드가 돼요. 악보: Mutopia Project (퍼블릭 도메인 판)',
      en: '// Scott Joplin, The Entertainer (1902, public domain): the A and B strains, 32 bars. Each step of <> is two 2/4 bars (sixteen sixteenths)\n// Solo piano for A; in B an upright bass and a brushed snare turn it into a ragtime band. Score: Mutopia Project (public domain edition)',
    },
    body: `bpm 76
key C major
master warm
space room

rh     <[e4 c5 _ e4 c5 _ e4 c5@6 [c5,e5,c6] [d5,f5,d6] [d#5,f#5,d#6]] [[e5,g5,e6] [c5,e5,c6] [d5,f5,d6] [e5,g5,e6] _ [b4,d5,b5] [d5,f5,d6] _ [c5,e5,c6]@6 d4 d#4] [e4 c5 _ e4 c5 _ e4 c5@7 [a4,c5,a5] [g4,c5,g5]] [[f#4,c5,f#5] [a4,a5] [c5,c6] [e5,e6] _ [d5,d6] [c5,c6] [a4,a5] [d5,f5,d6]@6 d4 d#4] [e4 c5 _ e4 c5 _ e4 c5@6 [c5,e5,c6] [d5,f5,d6] [d#5,f#5,d#6]] [[e5,g5,e6] [c5,e5,c6] [d5,f5,d6] [e5,g5,e6] _ [b4,d5,b5] [d5,f5,d6] _ [c5,e5,c6]@6 [c5,c6] [d5,d6]] [[e5,e6] [c5,c6] [d5,d6] [e5,e6] _ [c5,c6] [d5,d6] [c5,c6] [e5,e6] [c5,c6] [d5,d6] [e5,e6] _ [c5,c6] [d5,d6] [c5,c6]] [[e5,g5,e6] [c5,e5,c6] [d5,f5,d6] [e5,g5,e6] _ [b4,d5,b5] [d5,f5,d6] _ [c5,e5,c6]@5 [e4,c5,e5] [f4,d5,f5] [f#4,d#5,f#5]] [[g4,e5,g5] _ [a4,e5,a5] [g4,e5,g5] _ [e4,c5,e5] [f4,d5,f5] [f#4,d#5,f#5] [g4,e5,g5] _ [a4,e5,a5] [g4,e5,g5] _ e5 c5 g4] [a4 b4 c5 d5 e5 d5 c5 d5 g4 e5 f5 g5 a5 g5 e5 f5] [[g4,e5,g5] _ [a4,e5,a5] [g4,e5,g5] _ [e4,c5,e5] [f4,d5,f5] [f#4,d#5,f#5] [g4,e5,g5] _ [a4,e5,a5] [g4,e5,g5] _ g5 a5 bb5] [[d5,g5,b5] [d5,g5,b5] _ [c5,f#5,b5] _ a5 [c5,f#5] d5 [b4,g5]@5 [e4,c5,e5] [f4,d5,f5] [f#4,d#5,f#5]] [[g4,e5,g5] _ [a4,e5,a5] [g4,e5,g5] _ [e4,c5,e5] [f4,d5,f5] [f#4,d#5,f#5] [g4,e5,g5] _ [a4,e5,a5] [g4,e5,g5] _ e5 c5 g4] [a4 b4 c5 d5 e5 d5 c5 d5 c5@5 g4 f#4 g4] [c5 _ a4 c5 _ a4 c5 a4 g4 c5 e5 g5 _ e5 c5 g4] [[f#4,a4] _ [f#4,c5] _ [f4,e5] [f4,d5] _ [e4,c5]@7 d4 d#4]> | piano gain .5 len 1.2 rel .35 human .1
lh     <[c3 [e3,g3,c4] [g2,g3] [g3,bb3,c4] [f2,f3] [a3,c4] [e2,e3] [g3,c4]] [g2 [e3,g3,c4] g2 [f3,g3,b3] c3 [e3,g3,c4] [e3,g3,c4] [g3,b3]] [c3 [e3,g3,c4] [g2,g3] [g3,bb3,c4] [f2,f3] [a3,c4] [e2,e3] [d#2,d#3]] [[d2,d3] [d3,f#3,a3,c4] d3 [f#3,a3,c4] [g3,b3] [g2,g3] [a2,a3] [b2,b3]] [c3 [e3,g3,c4] [g2,g3] [g3,bb3,c4] [f2,f3] [a3,c4] [e2,e3] [g3,c4]] [g2 [e3,g3,c4] g2 [f3,g3,b3] c3 [e3,g3,c4] [g3,c4,e4] .] [[c3,c4] [g3,c4,e4] [bb2,bb3] [g3,c4,e4] [a2,a3] [a3,c4,f4] [ab2,ab3] [ab3,c4,f4]] [[g2,g3] [g3,c4,e4] g2 [g3,b3] [c3,g3,c4] [g2,g3] [c2,c3] .] [[c2,c3] [g3,c4,e4] g2 [g3,c4,e4] c3 [g3,c4,e4] g2 [g3,c4,e4]] [f2 [a3,c4,f4] f3 [ab3,c4,f4] e3 [g3,c4,e4] g2 [g3,c4,e4]] [c3 [g3,c4,e4] g2 [g3,c4,e4] c3 [g3,c4,e4] e3 d#3] [d3 [g3,b3,d4] d3 [a3,c4,d4] [g3,b3,d4] [f2,f3] [e2,e3] [d2,d3]] [[c2,c3] [g3,c4,e4] g2 [g3,c4,e4] c3 [g3,c4,e4] g2 [g3,c4,e4]] [f2 [a3,c4,f4] f3 [ab3,c4,f4] e3 [g3,c4,e4] c3 [bb3,c4,e4]] [[f3,a3,c4,f4] [f3,a3,c4,f4] [f#3,a3,c4,d#4] [f#3,a3,c4,d#4] [g3,c4,e4] [g3,c4,e4] [g3,c4,e4] [g3,c4,e4]] [[d3,c4] [d3,a3] [g3,b3] [g3,b3] [c3,c4] [g2,g3] [c2,c3] .]> | piano gain .42 len 1.1 rel .3 pan -.1 human .1
bass   <[c3 . g2 . f2 . e2 .] [g2 . g2 . c3 .@3] [c3 . g2 . f2 . e2 .] [d2 . d3 .@3 a2 .] [c3 . g2 . f2 . e2 .] [g2 . g2 . c3 .@3] [c3 . bb2 . a2 . ab2 .] [g2 . g2 . c3 . c2 .] [c2 . g2 . c3 . g2 .] [f2 .@5 g2 .] [c3 . g2 . c3 .@3] [d3 . d3 .@3 e2 .] [c2 . g2 . c3 . g2 .] [f2 .@5 c3 .] . [d3 .@3 c3 . c2 .]> | upright gain .7 human .1
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

scene creep  theme bass
scene march  theme bass kick hat
scene acid   acid bass kick hat clap ohat
scene build  acid bass hat clap riser
scene full   lead acid bass kick hat clap ohat
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
tap2     [9 . 7 . 4 . 2 . 4 . 7 . 9 .]            | zither oct 4 bright .7 dec .7 gain .35 pan -.35
poly     [0 2 4 6 4]*2                            | harp oct 5 gain .35 verb .3 pan -.2
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
guitar   [0^7 . . 0^7] [. 0^7 . .] [0^7 . . 0^7] [. . 0^7 .] | zither oct 3 bright .5 dec .8 gain .26 pan -.15 human .25
bass     0 _ 4 _                                  | upright gain .85 human .15
flute    <[4 _ _ 5] [6 _ 4 _] [2 _ _ 1] [0 _ _ _]> | oct 5 gain .4 verb .35 delay .2
vibes    <. [. 4 . 2] . [6 . 4 .]>                | oct 5 gain .3 verb .3

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
hat      x*8                                      | ahat gain .5 vel [1 .6]*4 human .3
chop     [0^7 _ . .] [. . 0^7' .] . [. 0^7 . .]   | piano oct 4 gain .45 cut k1(1500,9000) shape .15 verb .15
bass     0 _ . [. 0] . . 4 .                      | sine oct 2 gain .85
vibes    <. [4 . 2 .] . [6 . 4 2]>                | oct 5 gain .3 delay .3
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
plate  [0 . . 4 . . 7 .] [. 9 . . 4 . . .] | oct 5 gain .55 dec .6 delay .3 verb .4
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
sax    <[0 _ 2 _ 4 _ _ 2] [5 _ 4 2 _ 0 _ _]> | nsax gain .7 rel .3 vib .3 verb .3 delay .2
choir  <0^ 3^>/2                             | gain .4 verb .5 bright .3
bass   0 _ . . 0 . . .                       | sine oct 2 gain .6

scene open  timp choir
scene full  all
song open:8 full:16
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
`,
  },
];
function presetText(p, lang) { return p.head[lang] + '\n' + p.body; }
