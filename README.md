# Tactus

A live-coding music instrument for the browser. One line of code is one track, and every edit is heard on the next bar. Play it with pads, compose a whole piece from a seed, tap it together as blocks, shape synth sounds by hand, plug in a guitar or a mic and use it as an effects box, and conduct it with your hands in front of a camera. Nothing to install; it opens on a phone too.

**Try it:** https://nakosung.github.io/tactus/ (desktop Chrome or Edge, sound on)

```
bpm 92
key D minor
prog <0 5 3 4>
space cathedral

kick   x . . . x . . .                 | gain .9
timp   0 . . . 0 . 4 . [4 0] . . .     | oct 2 dec .6
sax    <[0 _ 2 _ 4 _ _ 2] [5 _ 4 2]>   | nsax gain .7 vib .3 wash .4
bus wash | chorus .5 verb .7
```

- **Write.** `kick x x x x`: one line per track, scenes and a song order, chords by name, values that move with patterns, LFOs and knobs. Edits land on the bar, so the music never stops.
- **Tap.** The same piece as cards: drum steps, a piano roll in the song's scale, chords, scenes and an effects board. Every change is written back into the code.
- **Shape.** Analog, wavetable and FM synths with unison, six filter types, a vowel filter, envelopes and tempo-synced LFOs. Drag the envelope and the filter curve, or play one note and get the closest sound.
- **Plug in.** A mic or a guitar through fourteen effects (amp and cabinet, wah, modulation, delay, reverb, octaver, a harmonizer that follows the song's key, tuner) that add no delay of their own.
- **Sing.** Beatbox or hum and it becomes code; a loop station records in time with the bar.
- **Under the hood.** The audio thread runs no_std Rust as WebAssembly, with a matching JavaScript fallback; WebGPU adds instruments of thousands of sines, modal reverb, a wave-equation drum and a neural sax.

## What is inside

| Part | Where | What it does |
|---|---|---|
| Pattern language | `src/js/engine.js` | Mini-notation, chords and scales, scenes and song form, parameters that move (LFOs, ramps, knobs, patterns), FX sequences that play the performance pads (`auto`) |
| Composition | `src/js/gen.js` | Seeded generators for beats, bass lines, melodies, chord progressions and whole songs |
| Audio engine | `src/js/audio.js`, `src/js/musical.js` | Scheduler with 120 ms look-ahead, drum and synth voices, voice leading, fills and transitions, performance pads |
| Mix | `src/js/mix.js` | Buses and sends, insert effects, compressors, built-in returns and the master chain, all set from code |
| Rust DSP | `dsp/` | The AudioWorklet voices in `no_std` Rust compiled to WebAssembly: plucked strings, a TB-303 style acid line, an analog mono bass, and a synth engine (analog, wavetable and FM voices with unison, filter types, a vowel filter, envelopes and LFOs) |
| Sound match | `src/js/match.js`, `src/js/wavetables.js` | Play or sing one note, or drop a short file, and get the wavetable synth line that sounds closest (frame, filter, envelopes, pitch drop, vibrato, noise) |
| WebGPU | `src/js/gpu.js` | Instruments of thousands of sines, spectral freeze, modal reverb (up to 65,536 modes), a wave-equation drum, the neural sax, and shader backdrops you can live-code |
| Neural sax | `neural/` | A 14→64→64→1 network trained on the kit's sax recordings that predicts the spectral envelope; training code included |
| Korean percussion | `korean/` | Janggu, buk, jing and kkwaenggwari, synthesized from physical models and measured partials |
| Samples | `src/js/kit.js`, `tools/kit/`, `src/js/sounds.js` | A compact CC0 kit from the Versilian Community Sample Library, plus your own sounds: drop audio files on the page (kept in the browser) or load them from an address with a `sample` line |
| UI | `src/app.html`, `src/js/ui.js`, `src/js/viz.js` | Editor with highlighting and autocomplete, pads, macros, visualizations, three skins (Studio, Field, Pop, shared with the welcome page) with keys that travel when pressed, an armed state that blinks on the beat and counts down to the bar where a change lands, Korean and English |
| Landing page | `src/landing.html` | The page at /tactus/ with the playable demos |
| Block view | `src/js/blocks.js` | The same song as cards, for children and anyone who would rather tap: drum steps (on, off or now and then), melody lanes as a piano roll in the song's scale (notes of any length that may overlap, a box or Shift to choose several, Alt-drag to copy, a velocity lane written as `vel`; a chord written as one value, like 3^ or Am7, moves as one, and a chord brush puts one in with a tap), bar pages, sound stickers, rule blocks (every few bars, sometimes, left and right, echo, faster), phrases as variables, a chord progression row, scenes and a song train, tempo, key and scale. Stopped, an edit plays what it made; buttons tick in the skin's voice. A synth track's sound shape can be dragged: the amp envelope, the filter curve and type, with a live scope. Code and blocks edit each other; patterns the grid cannot hold stay as code |
| Live effects | `src/js/live.js`, `dsp/` | A mic or an instrument through an audio interface, through an effects chain in Rust and straight out, with nothing that looks ahead: gate, compressor, pitch shift, octave down, a harmony that follows the song's key, wah, drive (clean, crunch, lead, fuzz) with a tone stack and a cabinet, chorus, flanger, phaser, tremolo, delay, reverb and a tuner. Set by an `input` line in the code (or as stompboxes in the block view), so the rates and delay times are in bars of the song; a demo guitar lets you hear them without an instrument, and the panel measures the round-trip delay on the device |
| Phones | `src/js/mobile.js` | One module at a time: a top bar that stays put, tabs for code, blocks, pads, song, record, sounds and guide, code or blocks beside the pads when held sideways; on a desktop, ⤢ fills the window with one panel |
| Voice to code | `src/js/vxdsp.js`, `src/js/voice.js` | Beatbox or hum into the mic in time with the bar: hits become kick, snare and hat lines on a 16th grid; humming is pitch-tracked (YIN), tuned, fitted to the song's key and written as a melody line |
| Sharing | `src/js/share.js` | A song as a link (the code, compressed, after the #) or as a recording of a few bars or the whole song; on phones both go through the share sheet (KakaoTalk, Messages…) |
| Install | `src/sw.js`, `src/js/pwa.js` | Installs as an app from the browser and opens offline |

## Build and run

Requirements: Python 3 and Node 18+. Nothing is downloaded at build time.

```sh
python3 build.py            # dist/index.html (landing), dist/play/index.html (app), dist/tactus.html (app, one file)
python3 -m http.server -d dist 8000   # then open http://localhost:8000/play/
node tests/compile.test.js  # every example song compiles in both languages
node dsp/bench/bench.js 30  # Rust vs JavaScript voices: speed and output match
```

Each page is a single self-contained HTML file with the scripts, the sample kit, the WebAssembly module and the demo audio inlined. You can also open `dist/tactus.html` straight from disk; hand control needs a served page.

To rebuild the Rust module, see `dsp/README.md`. Then run `python3 dsp/embed.py` to refresh `src/js/dsp_wasm.js`.

## Contributing

Issues and pull requests are welcome, from people and from agents. Start with [CONTRIBUTING.md](CONTRIBUTING.md). If you are an AI agent, read [AGENTS.md](AGENTS.md) first.

## License

The code is dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option. Unless you say otherwise, any contribution you submit is licensed the same way.

Samples, trained weights and other bundled data keep their own licenses, listed in [ATTRIBUTION.md](ATTRIBUTION.md). All of them allow redistribution.

The name "Tactus" and its logo are not covered by the code license. If you publish a modified version, please give it a different name.

---

## 한국어

브라우저에서 바로 여는 라이브 코딩 악기입니다. 코드 한 줄이 한 트랙이고, 고치면 다음 마디에 바로 들립니다. 설치할 것 없이 폰에서도 열립니다.

- **쓰기:** `kick x x x x` 한 줄이 한 트랙. 장면과 곡 순서, 코드 이름, 패턴·LFO·노브로 움직이는 값. 고친 것은 마디에 맞춰 반영돼 음악이 끊기지 않습니다.
- **누르기:** 같은 곡을 카드로. 드럼 칸, 곡의 음계로 된 피아노 롤, 코드 진행, 장면, 이펙터 보드. 바꾼 것은 그대로 코드에 써집니다.
- **빚기:** 아날로그·웨이브테이블·FM 신스, 유니즌, 필터 여섯 가지, 모음 필터, 박자에 맞춘 LFO. 엔벨로프와 필터 곡선을 끌어서 바꾸고, 한 음을 들려주면 가장 비슷한 소리를 찾아 줍니다.
- **꽂기:** 마이크나 기타를 이펙터 14개(앰프와 캐비닛, 와우, 모듈레이션, 딜레이, 리버브, 옥타버, 곡의 키를 따르는 하모나이저, 튜너)로. 이펙터가 지연을 더하지 않습니다.
- **부르기:** 비트박스와 허밍이 코드가 되고, 루프 스테이션은 마디에 맞춰 녹음합니다.
- **속:** 오디오 스레드는 no_std Rust를 WebAssembly로 돌리고, 같은 계산을 하는 JavaScript가 대신할 수 있습니다. WebGPU로 사인파 수천 개 악기, 모달 리버브, 파동 방정식 북, 신경망 색소폰을 만듭니다.

- 직접 써 보기: https://nakosung.github.io/tactus/
- 빌드: `python3 build.py` → `dist/`
- 기여: 이슈와 PR 모두 환영합니다. [CONTRIBUTING.md](CONTRIBUTING.md)를 먼저 봐 주세요.
- 라이선스: 코드는 MIT 또는 Apache-2.0 중 원하는 쪽을 따르면 됩니다. 샘플과 데이터의 라이선스는 [ATTRIBUTION.md](ATTRIBUTION.md)에 있습니다.
