# Tactus DSP (Rust → WebAssembly)

The audio-thread voices of [Tactus](../), written in Rust and compiled to a small WebAssembly module that runs inside an `AudioWorklet`.

- **Karplus-Strong plucked strings.** Up to 16 voices at once, with vibrato and a release damping. They play the gayageum, koto, guitar and harp sounds.
- **A TB-303 style acid voice.** A polyBLEP saw or square feeds a saturating 4-pole ladder filter, with slide and accent.
- **An analog mono bass.** Two polyBLEP saws a few cents apart (or squares, or a blend) and a square sub an octave down feed the same kind of ladder, with a filter envelope that snaps open on each note, an ADSR that restarts from where it is, and glide. It was tuned against a recorded monosynth bassline.
- **The synth engine.** Twelve polyphonic voices per track, each up to seven unison copies spread in pitch and stereo, in three kinds: analog (a polyBLEP saw and pulse blend with pulse width, hard sync and ring modulation), wavetable (eight 16-frame tables, band-limited by octave, scanned smoothly) and two-operator FM (ratio, depth, feedback and a decaying index). Each voice has a sub, noise, amp, filter and pitch envelopes, two LFOs, and a choice of filters: 12 and 24 dB state-variable low-pass, a ladder, high-pass, band-pass, notch, and a vowel filter of three formant band-passes. With `glide` it plays mono and slides. The tables are built in `src/js/wavetables.js` and copied into the module's memory once.
- **Live effects.** One mono input and a fixed chain to stereo: gate, compressor, pitch voices (a shift, an octave down, and a harmony that tracks the pitch with a small YIN and moves it by steps of the song's scale), wah (by level or on the beat), drive at four times the rate into a tone stack and a cabinet, chorus, flanger, phaser, tremolo, delay (normal, ping-pong, tape) and an eight-line feedback-delay reverb. Nothing looks ahead, so the chain adds no delay of its own; the pitch voices sound about 20 ms after the dry signal, as any shifter of this kind does. Rates and delay times are in bars of the song. The long buffers are taken from new memory pages by `fx_init`, so the synth's instances do not carry them.

The crate is `no_std` and never allocates, so the audio thread never pauses for garbage collection. The worklet passes each note event in at its exact sample frame and calls `render(n)` for the samples between events, so timing stays sample-accurate. If WebAssembly is unavailable, Tactus falls back to the original JavaScript voices; add `?dsp=js` to the URL to force that path. The build stamp in the app shows `· Rust DSP` when this module is running.

## Files

| File | Purpose |
|---|---|
| `src/lib.rs` | The voices: `init`, `ks_on`, `acid_on`, `mono_on`, the engine (`vs_params` for the 96-value parameter block, `vs_on`, `vs_seed`, `wt_ptr`/`wt_len` for the tables), `live`, `render`, `out_l`, `out_r`; the live effects (`fx_init`, `fx_params` for the 48-value block, `fx_in`, `fx_process`, `fx_out_l`/`fx_out_r`, `fx_tuner`, `fx_reset`) |
| `tactus_dsp.wasm` | The compiled module (79 KB). `embed.py` writes it into `src/js/dsp_wasm.js`, which the build inlines |
| `bench/bench.js` | Renders the same events through the JavaScript voices (from `src/js/synth.js`) and through the module, then compares speed and output |

## Build

```sh
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown
# → target/wasm32-unknown-unknown/release/tactus_dsp.wasm
```

Without network access to `static.rust-lang.org` (so `rustup target add` fails), build `core` and `compiler_builtins` for the target from the Rust sources of the same version, then point `rustc` at them:

```sh
git clone --depth 1 --filter=blob:none --sparse --branch 1.97.0 https://github.com/rust-lang/rust.git
cd rust && git sparse-checkout set library/core library/stdarch library/portable-simd library/compiler-builtins && cd ..
L=sysroot/lib/rustlib/wasm32-unknown-unknown/lib; mkdir -p $L
RUSTC_BOOTSTRAP=1 rustc --edition 2024 --crate-type rlib --crate-name core --target wasm32-unknown-unknown \
  -C opt-level=3 -C panic=abort -C embed-bitcode=yes -Zforce-unstable-if-unmarked rust/library/core/src/lib.rs -o $L/libcore.rlib
RUSTC_BOOTSTRAP=1 rustc --edition 2024 --crate-type rlib --crate-name compiler_builtins --target wasm32-unknown-unknown --sysroot sysroot \
  -C opt-level=3 -C panic=abort -C embed-bitcode=yes -Zforce-unstable-if-unmarked --cfg 'feature="compiler-builtins"' --cfg 'feature="mem"' \
  rust/library/compiler-builtins/compiler-builtins/src/lib.rs -o $L/libcompiler_builtins.rlib
rustc --edition 2024 --crate-type cdylib --crate-name tactus_dsp --target wasm32-unknown-unknown --sysroot sysroot \
  -C opt-level=3 -C lto -C panic=abort -C codegen-units=1 -C link-arg=-zstack-size=65536 src/lib.rs -o tactus_dsp.wasm
python3 embed.py
```

## Benchmark

```sh
node bench/bench.js 30
```

Both paths render the same workload in 128-sample blocks: 16 ringing strings, a 16th-note acid line, an off-beat mono bass and engine chords (analog, wavetable and FM with unison and LFOs), 30 seconds of audio at 48 kHz, on Node 22:

| | Time | Speed vs realtime |
|---|---|---|
| JavaScript voices | ≈2,230 ms | ≈13× |
| Rust → WASM | ≈1,200 ms | ≈25× |

That makes Rust about 1.85× faster on the same load; on the mono bass and on the engine alone it is a little over 2×.

The acid and mono voices have no randomness, so their two outputs can be compared sample by sample: both match within 0.8% of peak. The engine's noise comes from the same seeded generator on both sides, and its two outputs are identical. The live effects, with every effect on at once, match within 1e-7, and run at about 15× realtime in WASM. The strings start from random noise, so for them only the overall level is compared, and it matches.

