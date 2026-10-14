# Notes for AI agents

You are working on Tactus, a browser live-coding music instrument. Read this before changing anything.

## Map

- `src/app.html` is the app page: markup, all CSS, and `/*NAME*/` placeholders where `build.py` inlines the scripts.
- `src/landing.html` is the landing page.
- `src/js/` holds the scripts, loaded in this order (later files use names from earlier ones; there are no modules):
  `i18n, skin, pwa, kit, engine, gen, presets, audio, mix, dsp_wasm, wavetables, synth, samples, musical, nsax_net, gpu, loops, preview, sounds, hand, ui, share, vxdsp, match, voice, live, blocks, viz, mobile`.
- `blocks.js` is the block view: cards drawn from the code. The code is the only source of truth; a card edit rewrites just the pattern or the one value it touched, so keep `bkSplit`/`bkJoin` lossless when you change the line format.
- `vxdsp.js` turns a voice recording into patterns (beatbox to kick/snare/hat, humming to a melody). It is pure, like `engine.js`, and `tests/voice.test.js` runs it on synthesized voices.
- `match.js` fits a wavetable synth line to one recorded note, and `wavetables.js` builds the tables it compares against (the same tables the synth plays). Both are pure; `tests/match.test.js` checks the fit on made-up notes whose settings are known.
- `live.js` is live input (the page as an effects box): mic or interface in, the `tactus-live` worklet, straight to the output, skipping the strips and the master chain because their compressors look ahead. Anything put on this path must not add delay: no lookahead, no FFT blocks, no `DynamicsCompressorNode`.
- `mobile.js` is the phone layout (one module at a time, by `body.mob` and `data-mt`). Anything new in the top bar or the side panel should be checked at 390 × 844 and sideways at 844 × 390.
- `src/skins.css` and `src/js/skin.js` are shared by both pages: the skin is kept in localStorage (`tactus-skin`), so a choice on one page carries to the other.
- `src/sw.js` is the service worker and `build.py` writes `manifest.webmanifest`; together they make the site installable and usable offline. The single-file build (`dist/tactus.html`) has neither.
- `engine.js` is pure: parsing, patterns and `compile(text)`. It has no audio, and the tests load it in Node.
- The audio-thread code is the `SYN_CODE` string inside `synth.js`. The Rust version of the same voices is in `dsp/src/lib.rs`, and the two must produce the same output (`node dsp/bench/bench.js`).
- WebGPU is optional everywhere. Every GPU feature has a CPU fallback, and the app must work with `?gpu=off`.

## Rules

1. **Run the checks.** Run `node tests/compile.test.js`, `node tests/voice.test.js`, `node tests/match.test.js` and `python3 build.py` before you finish. Open the built page and look at the console.
2. **Keep both languages.** Every user-facing string goes in `src/js/i18n.js`, under both `ko` and `en`.
3. **Don't break the language.** Old code must keep compiling. If a new keyword could clash with track names, check `GLOBALS`, `PARAMS` and `NAME_INST` in `engine.js`.
4. **Listen, or say you could not.** You may not be able to hear audio. When you change a sound, measure it (render it, compare spectra and levels before and after), and say in the pull request what you measured and what still needs a human ear.
5. **Keep levels steady.** A change should not make an existing song louder or quieter unless that is the point. The master chain compensates its own gain changes; follow that pattern (`compMakeupDb`, `curveGain`).
6. **Change only when it changes.** AudioParams are scheduled ahead of time, and pads ramp some of them. Mix code writes a value only when it changes (`setIf` in `mix.js`), so it doesn't fight a pad.
7. **Bring the license.** Don't add samples, models or other data without one that allows redistribution, and list them in `ATTRIBUTION.md`. Measuring a recording to tune a model is fine; shipping its audio is not, unless its license allows it.
8. **Keep comments useful.** Explain why, not what, and use plain words.
