# Notes for AI agents

You are working on Tactus, a browser live-coding music instrument. Read this before changing anything.

## Map

- `src/app.html` is the app page: markup, all CSS, and `/*NAME*/` placeholders where `build.py` inlines the scripts.
- `src/landing.html` is the landing page.
- `src/js/` holds the scripts, loaded in this order (later files use names from earlier ones; there are no modules):
  `i18n, skin, pwa, kit, engine, gen, presets, audio, mix, dsp_wasm, wavetables, synth, samples, musical, nsax_net, gpu, loops, preview, sounds, hand, ui, share, vxdsp, sep, match, voice, live, pedals, blocks, viz, mobile`.
- `blocks.js` is the block view: cards drawn from the code. The code is the only source of truth; a card edit rewrites just the pattern or the one value it touched, so keep `bkSplit`/`bkJoin` lossless when you change the line format. A loop line is drawn as a sampler card (`bkSmpHTML`): the slot's waveform, pads for its `slices`, the line's pattern as the order of the slices (a number is a slice, `_` holds it), and `drums`/`rest` as one switch per bar. A chopped loop plays through `playChop`, which must honour `drums` and `rest` as the whole loop does.
- `vxdsp.js` turns a voice recording into patterns (beatbox to kick/snare/hat, humming to a melody). It is pure, like `engine.js`, and `tests/voice.test.js` runs it on synthesized voices.
- `sep.js` splits a loop into drums and the rest (median-filter HPSS; the soft masks add up to one, so the stems sum to the loop) and writes the drums down on the loop's grid. It is pure and also runs as a worker built from its own functions (`sepWorkerSrc`); `tests/sep.test.js` checks it on a made-up loop.
- A loop can come from the code: `sample loop1 github:user/repo/main/file.wav` puts the file in that loop slot on every run (`out.loopFiles`, then `loopApplyCode` in `loops.js`), and the slot is split into drums and the rest as soon as it loads. Example songs that use a loop load it from `assets/loops/` in this repository, so a file there must be one we may redistribute and must be listed in `ATTRIBUTION.md`.
- `match.js` fits a wavetable synth line to one recorded note, and `wavetables.js` builds the tables it compares against (the same tables the synth plays). Both are pure; `tests/match.test.js` checks the fit on made-up notes whose settings are known.
- `live.js` is live input (the page as an effects box): mic or interface in, the `tactus-live` worklet, straight to the output, skipping the strips and the master chain because their compressors look ahead. Anything put on this path must not add delay: no lookahead, no FFT blocks, no `DynamicsCompressorNode`. The effects are the `Fx` class in `SYN_CODE` and `fx_*` in `dsp/src/lib.rs`; like the voices, the two must match (`node dsp/bench/bench.js` checks them).
- `master.js` puts the mastering worklet (`Mst` in `SYN_CODE`, `mst_*` in Rust) between the mix and the output, and the speaker check (`Spk`, `sp_*`) after the analyser, so the speaker check is never recorded or exported. Mastering is on when the master line has `target`, `bands`, `ceil` or `monobass`; the classic limiter is crossfaded out then. `node dsp/bench/bench.js` checks that JS and Rust agree, that the true peak stays under the ceiling, that the loud part meets the target, and that every speaker model comes out as loud as pink noise went in (set the model's trim from that line when you change a model).
- `pedals.js` draws the input line as stompboxes (in the block view and, as switches, in the live panel) and writes it back in the chain's order. A file that draws early (live.js) must not touch names declared in a later file before it has run: everything is one script, and a `const` used too early stops the rest of the page.
- `mobile.js` is the phone layout (one module at a time, by `body.mob` and `data-mt`). Anything new in the top bar or the side panel should be checked at 390 × 844 and sideways at 844 × 390.
- `src/skins.css` and `src/js/skin.js` are shared by both pages: the skin is kept in localStorage (`tactus-skin`), so a choice on one page carries to the other.
- `src/sw.js` is the service worker and `build.py` writes `manifest.webmanifest`; together they make the site installable and usable offline. The single-file build (`dist/tactus.html`) has neither.
- `engine.js` is pure: parsing, patterns and `compile(text)`. It has no audio, and the tests load it in Node.
- The audio-thread code is the `SYN_CODE` string inside `synth.js`. The Rust version of the same voices is in `dsp/src/lib.rs`, and the two must produce the same output (`node dsp/bench/bench.js`).
- WebGPU is optional everywhere. Every GPU feature has a CPU fallback, and the app must work with `?gpu=off`.

## Rules

1. **Run the checks.** Run `node tests/compile.test.js`, `node tests/voice.test.js`, `node tests/match.test.js`, `node tests/sep.test.js` and `python3 build.py` before you finish. Open the built page and look at the console.
2. **Keep both languages.** Every user-facing string goes in `src/js/i18n.js`, under both `ko` and `en`.
3. **Don't break the language.** Old code must keep compiling. If a new keyword could clash with track names, check `GLOBALS`, `PARAMS` and `NAME_INST` in `engine.js`.
4. **Listen, or say you could not.** You may not be able to hear audio. When you change a sound, measure it (render it, compare spectra and levels before and after), and say in the pull request what you measured and what still needs a human ear.
5. **Keep levels steady.** A change should not make an existing song louder or quieter unless that is the point. The master chain compensates its own gain changes; follow that pattern (`compMakeupDb`, `curveGain`).
6. **Change only when it changes.** AudioParams are scheduled ahead of time, and pads ramp some of them. Mix code writes a value only when it changes (`setIf` in `mix.js`), so it doesn't fight a pad.
7. **Bring the license.** Don't add samples, models or other data without one that allows redistribution, and list them in `ATTRIBUTION.md`. Measuring a recording to tune a model is fine; shipping its audio is not, unless its license allows it.
8. **Keep comments useful.** Explain why, not what, and use plain words.
