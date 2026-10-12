# Transcribed example songs

Five example songs (Für Elise, Gymnopédie No. 1, The Entertainer, In the Hall of the Mountain King, Canon in D) play
note-for-note transcriptions of public-domain pieces. The notes come from the LilyPond scores of the
[Mutopia Project](https://www.mutopiaproject.org/), turned into Tactus mini-notation by these scripts:

```sh
cd tools/scores
./render.sh          # sparse-clones Mutopia, renders each score to MIDI with the repeats written out
python3 lines.py     # prints the <…> lines and writes lines.json
```

`conv.py` maps each bar (or pair of bars) to one step of a `<…>`: notes become note names, held notes `_` or `@n`,
chords `[a,b,c]`, and overlapping voices are layered with `,`. The instruments, drums and scenes around those lines are
arranged by hand in `src/js/presets.js`. Sources and their licenses are listed in `ATTRIBUTION.md`.
