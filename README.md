# Tactus

A live-coding music instrument for the browser. One line of code is one track, and every edit is heard on the next bar. You can play it with pads, compose a whole piece from a seed, shape the mix in code, and conduct it with your hands in front of a camera.

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

Tactus was built live in conversation with an AI coding agent (Claude). The author set the direction, listened, and said what sounded wrong; the agent wrote the code. The project shows how far that way of working goes for audio software, including the parts usually written by specialists: a Rust DSP core, GPU synthesis, physical models and a small neural voice.

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

브라우저에서 바로 여는 라이브 코딩 악기입니다. 코드 한 줄이 한 트랙이고, 고치면 다음 마디에 바로 들립니다. 패드로 연주하고, 시드 하나로 곡을 만들고, 믹스까지 코드로 다듬고, 카메라 앞에서 손으로 지휘할 수 있습니다.

AI 코딩 에이전트(Claude)와 대화하며 만들었습니다. 사람은 방향을 정하고, 듣고, 어색한 부분을 짚었고, 코드는 에이전트가 썼습니다. 보통 전문가가 맡는 Rust DSP, GPU 합성, 물리 모델, 작은 신경망 음원까지 포함합니다.

- 직접 써 보기: https://nakosung.github.io/tactus/
- 빌드: `python3 build.py` → `dist/`
- 기여: 이슈와 PR 모두 환영합니다. [CONTRIBUTING.md](CONTRIBUTING.md)를 먼저 봐 주세요.
- 라이선스: 코드는 MIT 또는 Apache-2.0 중 원하는 쪽을 따르면 됩니다. 샘플과 데이터의 라이선스는 [ATTRIBUTION.md](ATTRIBUTION.md)에 있습니다.
