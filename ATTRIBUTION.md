# Attribution and data licenses

The code is MIT or Apache-2.0 (see the README). Bundled audio and data are listed here with their own licenses.

## Samples

| What | Source | License |
|---|---|---|
| Piano, vibraphone, harp, tenor sax, đàn tranh, harpsichord, marimba, kalimba, acoustic drum kit, cymbals, hand percussion, gong (`src/js/kit.js`) | [Versilian Community Sample Library (VCSL)](https://github.com/sgossner/VCSL) by Versilian Studios. Selected, trimmed and encoded by `tools/kit/build_kit.py` and `tools/kit/rebuild_hits.py` | CC0 1.0 |
| Korean percussion: `kung`, `deok`, `buk`, `buktak`, `jing`, `kkwaeng`, `kkwaengm` (`src/js/kit.js`) | Synthesized for Tactus by `korean/kr_synth.py` and `korean/kkw_synth.py` | CC0 1.0 |
| Upright bass | Synthesized in the browser at load time (`src/js/samples.js`) | Same as the code |
| Landing page demo audio (`assets/demos/`) | Rendered by Tactus from its own example songs | Same as the code |

The kkwaenggwari and jing partials were measured from reference recordings of performances (`korean/kkw_fit.py`). Only the measured numbers (frequencies, levels, decay times) are kept in `korean/kkw_fit.json` and in the scripts. No audio from those recordings is included.

## Trained weights

| What | Trained on | License |
|---|---|---|
| Neural sax network (`src/js/nsax_net.js`) | The 20 tenor sax recordings in the VCSL kit above, with `neural/analyze.py` and `neural/train.py` | Same as the code |

## Loaded at run time (not bundled)

| What | From | License |
|---|---|---|
| Fonts: Instrument Sans, Spline Sans Mono, IBM Plex Sans KR | Google Fonts | SIL Open Font License 1.1 |
| Hand tracking: MediaPipe Tasks Vision and the hand landmarker model, used only when hand control is turned on | cdn.jsdelivr.net, storage.googleapis.com | Apache-2.0 |

## Adding data

New samples, impulse responses, weights or other data must come with a license that allows redistribution and modification (CC0, CC-BY or a permissive software license). Add a row to this file in the same pull request. If a license requires attribution, put the credit here.
